// ============================================================
// inventory_engine.gs — Inventory Engine (FIFO)
// Mengelola stok bahan baku dengan metode FIFO.
// Berdiri sendiri — tidak mengubah Recipe Engine.
// Bergantung pada: service.gs, utils.gs, inventory_config.gs
// ============================================================


// ════════════════════════════════════════════════════════════
// HELPER INTERNAL
// ════════════════════════════════════════════════════════════

/**
 * Dapatkan sheet inventory. Throw jika tidak ditemukan.
 * Menggunakan getSpreadsheet() dari service.gs.
 */
function _invGetSheet(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan. Jalankan setupInventory() terlebih dahulu.`);
  return sheet;
}

/**
 * Baca semua baris dari sheet inventory sebagai array of objects.
 * Menggunakan INV_HEADERS (bukan HEADERS milik config.gs).
 */
function _invReadAll(sheetName) {
  const sheet = _invGetSheet(sheetName);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
}

/**
 * Tulis satu baris ke sheet inventory.
 * Inject CREATED_AT / UPDATED_AT otomatis.
 */
function _invInsertRow(sheetName, data) {
  const sheet   = _invGetSheet(sheetName);
  const headers = INV_HEADERS[sheetName];
  if (!headers) throw new Error(`INV_HEADERS["${sheetName}"] tidak terdefinisi.`);

  const ts = now();
  if (headers.includes('CREATED_AT')) data.CREATED_AT = ts;
  if (headers.includes('UPDATED_AT')) data.UPDATED_AT = ts;

  const row = headers.map(h => (data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(row);
  return data;
}

/**
 * Update satu baris di sheet inventory berdasarkan key column.
 */
function _invUpdateRow(sheetName, keyColumn, keyValue, updateData) {
  const sheet = _invGetSheet(sheetName);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx  = headers.indexOf(keyColumn);
  if (keyIdx === -1) throw new Error(`Kolom "${keyColumn}" tidak ada di sheet "${sheetName}"`);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(keyValue)) {
      const existing = {};
      headers.forEach((h, idx) => { existing[h] = data[i][idx]; });
      const merged = Object.assign({}, existing, updateData, { UPDATED_AT: now() });
      const newRow = headers.map(h => (merged[h] !== undefined ? merged[h] : ''));
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([newRow]);
      return true;
    }
  }
  return false;
}

/**
 * Generate ID untuk transaksi inventory.
 * Format: PREFIX-YYYYMMDD-NNN
 */
function _invGenerateId(prefix, existingIds) {
  const today    = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd');
  const pattern  = new RegExp(`^${prefix}-${today}-(\\d+)$`);
  const todayNums = existingIds
    .map(id => { const m = String(id).match(pattern); return m ? parseInt(m[1]) : 0; })
    .filter(n => n > 0);
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}-${today}-${String(next).padStart(3, '0')}`;
}

/** Round ke 2 desimal */
function _invRound2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}


// ════════════════════════════════════════════════════════════
// FIFO STOCK ENGINE
// ════════════════════════════════════════════════════════════

/**
 * Hitung total stok bahan dari STOCK_CARD.
 * @param {string} idBahan
 * @returns {{qty: number, nilai: number}}
 */
function _getStokBahan(idBahan) {
  const rows = _invReadAll(INV_SHEET.STOCK_CARD)
    .filter(r => r.ID_BAHAN === idBahan);

  if (rows.length === 0) return { qty: 0, nilai: 0 };

  // Ambil baris terakhir yang memiliki stok akhir
  const last = rows[rows.length - 1];
  return {
    qty   : Number(last.STOK_AKHIR_QTY)   || 0,
    nilai : Number(last.STOK_AKHIR_NILAI)  || 0,
  };
}

/**
 * Ambil lot-lot stok FIFO untuk bahan tertentu yang masih punya sisa.
 * Lot diurutkan dari yang PALING LAMA (oldest first = FIFO).
 * @param {string} idBahan
 * @returns {Object[]} lot-lot dengan SISA_LOT > 0
 */
function _getFifoLots(idBahan) {
  return _invReadAll(INV_SHEET.STOCK_CARD)
    .filter(r =>
      r.ID_BAHAN   === idBahan &&
      r.JENIS      === 'IN' &&
      Number(r.SISA_LOT) > 0
    )
    .sort((a, b) => {
      // Normalize to string for consistent comparison (GAS may return Date objects)
      const tglA = _normalizeTanggal(a.TANGGAL);
      const tglB = _normalizeTanggal(b.TANGGAL);
      if (tglA < tglB) return -1;
      if (tglA > tglB) return 1;
      return String(a.ID_KARTU).localeCompare(String(b.ID_KARTU));
    });
}

/**
 * Keluar stok dengan metode FIFO.
 * Menggerus lot mulai dari yang paling lama.
 * Mencatat setiap penggunaan lot sebagai baris OUT di STOCK_CARD.
 *
 * @param {string} idBahan
 * @param {number} qtyKeluar - dalam satuan pakai
 * @param {string} referensi - ID transaksi sumber (PRD-xxx, SLS-xxx, dll)
 * @param {string} tanggal
 * @param {string} catatan
 * @returns {{success: boolean, totalNilai: number, detail: Object[]}}
 */
function _fifoOut(idBahan, qtyKeluar, referensi, tanggal, catatan) {
  const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan);
  if (!bahan) throw new Error(`Bahan ${idBahan} tidak ditemukan`);

  const lots = _getFifoLots(idBahan);
  const totalStok = lots.reduce((s, l) => s + Number(l.SISA_LOT), 0);

  if (totalStok < qtyKeluar) {
    throw new Error(
      `Stok ${bahan.NAMA_BAHAN} tidak cukup. Dibutuhkan: ${qtyKeluar}, tersedia: ${_invRound2(totalStok)}`
    );
  }

  let sisaKeluar  = qtyKeluar;
  let totalNilai  = 0;
  const detail    = [];
  const allCardIds = _invReadAll(INV_SHEET.STOCK_CARD).map(r => r.ID_KARTU);

  for (const lot of lots) {
    if (sisaKeluar <= 0) break;

    const pakeDariLot = Math.min(Number(lot.SISA_LOT), sisaKeluar);
    const harga       = Number(lot.HARGA_PER_UNIT) || 0;
    const nilaiKeluar = _invRound2(pakeDariLot * harga);
    totalNilai       += nilaiKeluar;
    sisaKeluar       -= pakeDariLot;

    // Update sisa lot di baris IN
    const sisaBaru = _invRound2(Number(lot.SISA_LOT) - pakeDariLot);
    _invUpdateRow(INV_SHEET.STOCK_CARD, 'ID_KARTU', lot.ID_KARTU, { SISA_LOT: sisaBaru });

    // Hitung stok akhir setelah transaksi ini
    const stokSebelum = _getStokBahan(idBahan);

    const idKartu = _invGenerateId('SC', allCardIds);
    allCardIds.push(idKartu);

    const kartu = {
      ID_KARTU         : idKartu,
      ID_BAHAN         : idBahan,
      NAMA_BAHAN       : bahan.NAMA_BAHAN,
      TANGGAL          : tanggal,
      JENIS            : 'OUT',
      REFERENSI        : referensi,
      LOT_ID           : lot.ID_KARTU,
      QTY_MASUK        : 0,
      QTY_KELUAR       : pakeDariLot,
      SISA_LOT         : '',
      HARGA_PER_UNIT   : harga,
      NILAI_MASUK      : 0,
      NILAI_KELUAR     : nilaiKeluar,
      STOK_AKHIR_QTY   : _invRound2(stokSebelum.qty   - pakeDariLot),
      STOK_AKHIR_NILAI : _invRound2(stokSebelum.nilai  - nilaiKeluar),
      CATATAN          : catatan || '',
    };

    _invInsertRow(INV_SHEET.STOCK_CARD, kartu);
    detail.push({ lotId: lot.ID_KARTU, pakeDariLot, harga, nilaiKeluar });
  }

  return { success: true, totalNilai: _invRound2(totalNilai), detail };
}


// ════════════════════════════════════════════════════════════
// PURCHASE — Pembelian Bahan Baku
// ════════════════════════════════════════════════════════════

/**
 * Catat pembelian bahan baku. Otomatis menambah stok (masuk ke FIFO lot baru).
 *
 * @param {Object} data
 *   {TANGGAL, ID_SUPPLIER, ID_BAHAN, QTY_BELI, HARGA_SATUAN, CATATAN}
 * @returns {{success:boolean, data:Object, message:string}}
 */
function createPurchase(data) {
  try {
    const { valid, missing } = validateRequired(data, ['TANGGAL', 'ID_BAHAN', 'QTY_BELI', 'HARGA_SATUAN']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '));

    // Validate tanggal
    const tglStr = String(data.TANGGAL).split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tglStr) || isNaN(new Date(tglStr).getTime())) {
      return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD');
    }

    const qtyBeli    = Number(data.QTY_BELI)     || 0;
    const hargaSat   = Number(data.HARGA_SATUAN)  || 0;

    if (qtyBeli <= 0) return fail('QTY_BELI harus lebih dari 0');
    if (hargaSat <= 0) return fail('HARGA_SATUAN harus lebih dari 0');

    const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN);
    if (!bahan) return fail(`Bahan ${data.ID_BAHAN} tidak ditemukan`);

    let namaSupplier = '';
    if (data.ID_SUPPLIER) {
      const sup = readOne(SHEET.SUPPLIER, 'ID_SUPPLIER', data.ID_SUPPLIER);
      if (!sup) return fail(`Supplier ${data.ID_SUPPLIER} tidak ditemukan`);
      namaSupplier = sup.NAMA_SUPPLIER;
    }

    const konversi   = Number(bahan.KONVERSI)     || 1;
    const qtyPakai   = _invRound2(qtyBeli * konversi);
    const totalHarga = _invRound2(qtyBeli * hargaSat);
    const allPurIds = _invReadAll(INV_SHEET.PURCHASE).map(r => r.ID_PURCHASE);
    const idPurchase = _invGenerateId('PUR', allPurIds);

    const purchase = {
      ID_PURCHASE   : idPurchase,
      TANGGAL       : data.TANGGAL,
      ID_SUPPLIER   : data.ID_SUPPLIER || '',
      NAMA_SUPPLIER : namaSupplier,
      ID_BAHAN      : data.ID_BAHAN,
      NAMA_BAHAN    : bahan.NAMA_BAHAN,
      QTY_BELI      : qtyBeli,
      SATUAN_BELI   : bahan.SATUAN_BELI,
      KONVERSI      : konversi,
      QTY_PAKAI     : qtyPakai,
      HARGA_SATUAN  : hargaSat,
      TOTAL_HARGA   : totalHarga,
      STATUS        : 'POSTED',
      CATATAN       : sanitize(data.CATATAN || ''),
    };

    _invInsertRow(INV_SHEET.PURCHASE, purchase);

    // ── Masukkan ke STOCK_CARD sebagai lot IN ──
    const stokSebelum = _getStokBahan(data.ID_BAHAN);
    const hargaPerUnit = konversi > 0 ? _invRound2(hargaSat / konversi) : 0;
    const nilaiMasuk   = _invRound2(qtyPakai * hargaPerUnit);

    const allCardIds = _invReadAll(INV_SHEET.STOCK_CARD).map(r => r.ID_KARTU);
    const idKartu    = _invGenerateId('SC', allCardIds);

    const kartu = {
      ID_KARTU         : idKartu,
      ID_BAHAN         : data.ID_BAHAN,
      NAMA_BAHAN       : bahan.NAMA_BAHAN,
      TANGGAL          : data.TANGGAL,
      JENIS            : 'IN',
      REFERENSI        : idPurchase,
      LOT_ID           : idKartu,   // lot = dirinya sendiri
      QTY_MASUK        : qtyPakai,
      QTY_KELUAR       : 0,
      SISA_LOT         : qtyPakai,  // FIFO: awalnya sisa = masuk
      HARGA_PER_UNIT   : hargaPerUnit,
      NILAI_MASUK      : nilaiMasuk,
      NILAI_KELUAR     : 0,
      STOK_AKHIR_QTY   : _invRound2(stokSebelum.qty   + qtyPakai),
      STOK_AKHIR_NILAI : _invRound2(stokSebelum.nilai  + nilaiMasuk),
      CATATAN          : data.CATATAN || '',
    };

    _invInsertRow(INV_SHEET.STOCK_CARD, kartu);

    // ── Update harga terakhir di MASTER_BAHAN ──
    updateRow(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN, {
      HARGA_TERAKHIR : hargaSat,
      HARGA_RATA2    : _hitungHargaRata2(data.ID_BAHAN, hargaSat, qtyPakai),
    });

    log.info('inventory', 'CREATE', `Purchase: ${idPurchase} — ${bahan.NAMA_BAHAN} ${qtyBeli} ${bahan.SATUAN_BELI}`);
    return ok(purchase, `Purchase ${idPurchase} berhasil dicatat. Stok +${qtyPakai} ${bahan.SATUAN_PAKAI}`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createPurchase gagal', { error: e.message });
    return fail('Gagal catat purchase: ' + e.message);
  }
}

/**
 * Hitung harga rata-rata (weighted average) setelah pembelian baru.
 * Rumus: (nilai_stok_lama + nilai_baru) / (qty_lama + qty_baru)
 * Konversi ke per satuan beli.
 */
function _hitungHargaRata2(idBahan, hargaBeli, qtyPakaiMasuk) {
  const stok      = _getStokBahan(idBahan);
  const nilaiLama = stok.nilai;
  const qtyLama   = stok.qty;
  const bahan     = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan);
  const konversi  = Number(bahan?.KONVERSI) || 1;
  const nilaiMasuk = _invRound2(qtyPakaiMasuk * (hargaBeli / konversi));

  const totalQty   = qtyLama + qtyPakaiMasuk;
  const totalNilai = nilaiLama + nilaiMasuk;

  if (totalQty === 0) return hargaBeli;

  // Kembalikan dalam harga per satuan beli
  const hargaPerPakai = totalNilai / totalQty;
  return _invRound2(hargaPerPakai * konversi);
}

/**
 * Void purchase (soft void — ubah STATUS ke VOID, kurangi stok).
 */
function voidPurchase(idPurchase) {
  try {
    const purchase = _invReadAll(INV_SHEET.PURCHASE).find(r => r.ID_PURCHASE === idPurchase);
    if (!purchase) return fail(`Purchase ${idPurchase} tidak ditemukan`);
    if (purchase.STATUS === 'VOID') return fail(`Purchase ${idPurchase} sudah VOID`);

    const qtyPakai = Number(purchase.QTY_PAKAI) || 0;
    const stok     = _getStokBahan(purchase.ID_BAHAN);
    if (stok.qty < qtyPakai) {
      return fail(`Tidak bisa void: stok ${purchase.NAMA_BAHAN} saat ini (${stok.qty}) lebih kecil dari qty purchase (${qtyPakai})`);
    }

    // Kurangi sisa lot di STOCK_CARD
    const kartu = _invReadAll(INV_SHEET.STOCK_CARD).find(r => r.REFERENSI === idPurchase && r.JENIS === 'IN');
    if (kartu) {
      const sisaLot     = Number(kartu.SISA_LOT);
      const sudahKeluar = Number(kartu.QTY_MASUK) - sisaLot;
      if (sudahKeluar > 0) {
        return fail(`Tidak bisa void: sebagian lot sudah digunakan (${sudahKeluar} ${purchase.SATUAN_BELI} telah keluar)`);
      }

      // Catat adjustment OUT di STOCK_CARD
      const allCardIds = _invReadAll(INV_SHEET.STOCK_CARD).map(r => r.ID_KARTU);
      const idKartu    = _invGenerateId('SC', allCardIds);
      const stokSbl    = _getStokBahan(purchase.ID_BAHAN);

      _invInsertRow(INV_SHEET.STOCK_CARD, {
        ID_KARTU         : idKartu,
        ID_BAHAN         : purchase.ID_BAHAN,
        NAMA_BAHAN       : purchase.NAMA_BAHAN,
        TANGGAL          : now().split('T')[0],
        JENIS            : 'ADJUSTMENT',
        REFERENSI        : 'VOID:' + idPurchase,
        LOT_ID           : kartu.ID_KARTU,
        QTY_MASUK        : 0,
        QTY_KELUAR       : qtyPakai,
        SISA_LOT         : '',
        HARGA_PER_UNIT   : Number(kartu.HARGA_PER_UNIT),
        NILAI_MASUK      : 0,
        NILAI_KELUAR     : _invRound2(qtyPakai * Number(kartu.HARGA_PER_UNIT)),
        STOK_AKHIR_QTY   : _invRound2(stokSbl.qty   - qtyPakai),
        STOK_AKHIR_NILAI : _invRound2(stokSbl.nilai  - qtyPakai * Number(kartu.HARGA_PER_UNIT)),
        CATATAN          : 'Void purchase ' + idPurchase,
      });

      // Nolkan sisa lot
      _invUpdateRow(INV_SHEET.STOCK_CARD, 'ID_KARTU', kartu.ID_KARTU, { SISA_LOT: 0 });
    }

    _invUpdateRow(INV_SHEET.PURCHASE, 'ID_PURCHASE', idPurchase, { STATUS: 'VOID' });
    log.info('inventory', 'UPDATE', `Void purchase: ${idPurchase}`);
    return ok(null, `Purchase ${idPurchase} berhasil di-void`);

  } catch (e) {
    log.error('inventory', 'UPDATE', 'voidPurchase gagal', { error: e.message });
    return fail('Gagal void purchase: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// PRODUCTION — Produksi
// ════════════════════════════════════════════════════════════

/**
 * Catat produksi. Otomatis mengeluarkan bahan sesuai resep (FIFO).
 *
 * @param {Object} data
 *   {TANGGAL, ID_PRODUK, JUMLAH_BATCH, CATATAN}
 * @returns {{success:boolean, data:Object, message:string}}
 */
function createProduction(data) {
  try {
    const { valid, missing } = validateRequired(data, ['TANGGAL', 'ID_PRODUK', 'JUMLAH_BATCH']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '));

    // Validate tanggal
    const tglStr = String(data.TANGGAL).split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tglStr) || isNaN(new Date(tglStr).getTime())) {
      return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD');
    }

    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', data.ID_PRODUK);
    if (!produk) return fail(`Produk ${data.ID_PRODUK} tidak ditemukan`);

    const jumlahBatch = Number(data.JUMLAH_BATCH) || 0;
    if (jumlahBatch <= 0) return fail('JUMLAH_BATCH harus lebih dari 0');

    // Ambil resep
    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === data.ID_PRODUK);
    if (itemResep.length === 0) return fail(`Resep produk ${data.ID_PRODUK} belum ada`);

    // Validasi ketersediaan stok semua bahan SEBELUM transaksi
    for (const item of itemResep) {
      const qtyKeluar = _invRound2(Number(item.JUMLAH) * jumlahBatch);
      const stok      = _getStokBahan(item.ID_BAHAN);
      if (stok.qty < qtyKeluar) {
        const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN);
        return fail(
          `Stok tidak cukup: ${bahan?.NAMA_BAHAN || item.ID_BAHAN}. ` +
          `Dibutuhkan: ${qtyKeluar}, tersedia: ${_invRound2(stok.qty)}`
        );
      }
    }

    // Generate ID Produksi
    const allPrdIds  = _invReadAll(INV_SHEET.PRODUCTION).map(r => r.ID_PRODUKSI);
    const idProduksi = _invGenerateId('PRD', allPrdIds);

    const yieldPcs     = Number(produk.YIELD_PCS) || 1;
    const qtyHasil     = _invRound2(jumlahBatch * yieldPcs);
    const hppPerBatch  = Number(produk.HPP) * yieldPcs || 0;   // HPP dari recipe_engine
    const totalHpp     = _invRound2(jumlahBatch * hppPerBatch);

    const production = {
      ID_PRODUKSI   : idProduksi,
      TANGGAL       : data.TANGGAL,
      ID_PRODUK     : data.ID_PRODUK,
      NAMA_PRODUK   : produk.NAMA_PRODUK,
      JUMLAH_BATCH  : jumlahBatch,
      QTY_HASIL     : qtyHasil,
      HPP_PER_BATCH : hppPerBatch,
      TOTAL_HPP     : totalHpp,
      STATUS        : 'POSTED',
      CATATAN       : sanitize(data.CATATAN || ''),
    };

    _invInsertRow(INV_SHEET.PRODUCTION, production);

    // ── Keluarkan bahan FIFO untuk setiap item resep ──
    for (const item of itemResep) {
      const qtyKeluar = _invRound2(Number(item.JUMLAH) * jumlahBatch);
      _fifoOut(
        item.ID_BAHAN,
        qtyKeluar,
        idProduksi,
        data.TANGGAL,
        `Produksi ${jumlahBatch}x batch ${produk.NAMA_PRODUK}`
      );
    }

    log.info('inventory', 'CREATE', `Produksi: ${idProduksi} — ${produk.NAMA_PRODUK} ${jumlahBatch} batch`);
    return ok(production, `Produksi ${idProduksi} berhasil. ${qtyHasil} pcs ${produk.NAMA_PRODUK} diproduksi.`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createProduction gagal', { error: e.message });
    return fail('Gagal catat produksi: ' + e.message);
  }
}

/**
 * Void produksi — kembalikan bahan ke stok sebagai ADJUSTMENT IN.
 */
function voidProduction(idProduksi) {
  try {
    const prod = _invReadAll(INV_SHEET.PRODUCTION).find(r => r.ID_PRODUKSI === idProduksi);
    if (!prod) return fail(`Produksi ${idProduksi} tidak ditemukan`);
    if (prod.STATUS === 'VOID') return fail(`Produksi ${idProduksi} sudah VOID`);

    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === prod.ID_PRODUK);
    const jumlahBatch = Number(prod.JUMLAH_BATCH) || 0;
    const allCardIds = _invReadAll(INV_SHEET.STOCK_CARD).map(r => r.ID_KARTU);

    for (const item of itemResep) {
      const qtyKembali = _invRound2(Number(item.JUMLAH) * jumlahBatch);
      const bahan      = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN);
      const stokSbl    = _getStokBahan(item.ID_BAHAN);
      const hargaPerUnit = Number(bahan?.HARGA_RATA2 || 0) / (Number(bahan?.KONVERSI) || 1);
      const nilaiKembali = _invRound2(qtyKembali * hargaPerUnit);

      const idKartu = _invGenerateId('SC', allCardIds);
      allCardIds.push(idKartu);

      _invInsertRow(INV_SHEET.STOCK_CARD, {
        ID_KARTU         : idKartu,
        ID_BAHAN         : item.ID_BAHAN,
        NAMA_BAHAN       : bahan?.NAMA_BAHAN || item.ID_BAHAN,
        TANGGAL          : now().split('T')[0],
        JENIS            : 'ADJUSTMENT',
        REFERENSI        : 'VOID:' + idProduksi,
        LOT_ID           : '',
        QTY_MASUK        : qtyKembali,
        QTY_KELUAR       : 0,
        SISA_LOT         : qtyKembali,
        HARGA_PER_UNIT   : hargaPerUnit,
        NILAI_MASUK      : nilaiKembali,
        NILAI_KELUAR     : 0,
        STOK_AKHIR_QTY   : _invRound2(stokSbl.qty   + qtyKembali),
        STOK_AKHIR_NILAI : _invRound2(stokSbl.nilai  + nilaiKembali),
        CATATAN          : 'Void produksi ' + idProduksi,
      });
    }

    _invUpdateRow(INV_SHEET.PRODUCTION, 'ID_PRODUKSI', idProduksi, { STATUS: 'VOID' });
    log.info('inventory', 'UPDATE', `Void produksi: ${idProduksi}`);
    return ok(null, `Produksi ${idProduksi} berhasil di-void. Stok bahan dikembalikan.`);

  } catch (e) {
    log.error('inventory', 'UPDATE', 'voidProduction gagal', { error: e.message });
    return fail('Gagal void produksi: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// SALES — Penjualan
// ════════════════════════════════════════════════════════════

/**
 * Catat penjualan produk jadi.
 * Sales tidak langsung mengurangi stok bahan (sudah keluar saat produksi).
 * Digunakan untuk tracking revenue & margin.
 *
 * @param {Object} data
 *   {TANGGAL, ID_PRODUK, QTY_JUAL, HARGA_JUAL, CATATAN}
 * @returns {{success:boolean, data:Object, message:string}}
 */
function createSales(data) {
  try {
    const { valid, missing } = validateRequired(data, ['TANGGAL', 'ID_PRODUK', 'QTY_JUAL', 'HARGA_JUAL']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '));

    // Validate tanggal
    const tglStr = String(data.TANGGAL).split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tglStr) || isNaN(new Date(tglStr).getTime())) {
      return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD');
    }

    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', data.ID_PRODUK);
    if (!produk) return fail(`Produk ${data.ID_PRODUK} tidak ditemukan`);

    const qtyJual       = Number(data.QTY_JUAL)   || 0;
    const hargaJual     = Number(data.HARGA_JUAL)  || 0;
    const hppPerUnit    = Number(produk.HPP)        || 0;

    if (qtyJual <= 0)  return fail('QTY_JUAL harus lebih dari 0');
    if (hargaJual < 0) return fail('HARGA_JUAL tidak boleh negatif');

    const totalPenjualan = _invRound2(qtyJual * hargaJual);
    const totalHpp       = _invRound2(qtyJual * hppPerUnit);
    const marginNilai    = _invRound2(totalPenjualan - totalHpp);
    const marginPct      = totalPenjualan > 0
      ? _invRound2(marginNilai / totalPenjualan * 100) : 0;

    const allSlsIds = _invReadAll(INV_SHEET.SALES).map(r => r.ID_SALES);
    const idSales   = _invGenerateId('SLS', allSlsIds);

    const sales = {
      ID_SALES        : idSales,
      TANGGAL         : data.TANGGAL,
      ID_PRODUK       : data.ID_PRODUK,
      NAMA_PRODUK     : produk.NAMA_PRODUK,
      QTY_JUAL        : qtyJual,
      SATUAN_JUAL     : produk.SATUAN_JUAL,
      HARGA_JUAL      : hargaJual,
      TOTAL_PENJUALAN : totalPenjualan,
      HPP_PER_UNIT    : hppPerUnit,
      TOTAL_HPP       : totalHpp,
      MARGIN_NILAI    : marginNilai,
      MARGIN_PCT      : marginPct,
      STATUS          : 'POSTED',
      CATATAN         : sanitize(data.CATATAN || ''),
    };

    _invInsertRow(INV_SHEET.SALES, sales);

    log.info('inventory', 'CREATE', `Sales: ${idSales} — ${produk.NAMA_PRODUK} ${qtyJual} pcs`);
    return ok(sales, `Sales ${idSales} berhasil. Revenue: ${formatRupiah(totalPenjualan)}, Margin: ${marginPct}%`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createSales gagal', { error: e.message });
    return fail('Gagal catat sales: ' + e.message);
  }
}

/**
 * Void sales.
 */
function voidSales(idSales) {
  try {
    const sale = _invReadAll(INV_SHEET.SALES).find(r => r.ID_SALES === idSales);
    if (!sale) return fail(`Sales ${idSales} tidak ditemukan`);
    if (sale.STATUS === 'VOID') return fail(`Sales ${idSales} sudah VOID`);

    _invUpdateRow(INV_SHEET.SALES, 'ID_SALES', idSales, { STATUS: 'VOID' });
    log.info('inventory', 'UPDATE', `Void sales: ${idSales}`);
    return ok(null, `Sales ${idSales} berhasil di-void`);
  } catch (e) {
    return fail('Gagal void sales: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// QUERY — Stock Card & Movement History
// ════════════════════════════════════════════════════════════

/**
 * Ambil stock card untuk satu bahan (semua pergerakan).
 * @param {string} idBahan
 * @returns {{success:boolean, data:Object}}
 */
function getStockCard(idBahan) {
  try {
    const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan);
    if (!bahan) return fail(`Bahan ${idBahan} tidak ditemukan`);

    const movements = _invReadAll(INV_SHEET.STOCK_CARD)
      .filter(r => r.ID_BAHAN === idBahan)
      .sort((a, b) => String(a.ID_KARTU).localeCompare(String(b.ID_KARTU)));

    const stokAkhir = _getStokBahan(idBahan);
    const lots      = _getFifoLots(idBahan);

    return ok({
      bahan     : bahan,
      movements : movements,
      stokAkhir : stokAkhir,
      fifoLots  : lots,
      summary   : {
        totalMasuk  : _invRound2(movements.filter(r => r.JENIS === 'IN').reduce((s, r) => s + Number(r.QTY_MASUK), 0)),
        totalKeluar : _invRound2(movements.filter(r => r.JENIS === 'OUT').reduce((s, r) => s + Number(r.QTY_KELUAR), 0)),
        totalAdj    : movements.filter(r => r.JENIS === 'ADJUSTMENT').length,
        stokQty     : stokAkhir.qty,
        stokNilai   : stokAkhir.nilai,
        jumlahLot   : lots.length,
      }
    });
  } catch (e) {
    return fail('Gagal ambil stock card: ' + e.message);
  }
}

/**
 * Ambil ringkasan stok semua bahan.
 * @returns {{success:boolean, data:Object[]}}
 */
function getStokSemua() {
  try {
    const semuaBahan = readAll(SHEET.BAHAN).filter(r => String(r.AKTIF) !== 'FALSE');
    const result = semuaBahan.map(bahan => {
      const stok = _getStokBahan(bahan.ID_BAHAN);
      const lots = _getFifoLots(bahan.ID_BAHAN);
      const alert = Number(bahan.STOK_MINIMUM) > 0 && stok.qty < Number(bahan.STOK_MINIMUM);
      return {
        ID_BAHAN      : bahan.ID_BAHAN,
        NAMA_BAHAN    : bahan.NAMA_BAHAN,
        KATEGORI      : bahan.KATEGORI,
        SATUAN_PAKAI  : bahan.SATUAN_PAKAI,
        STOK_QTY      : stok.qty,
        STOK_NILAI    : stok.nilai,
        STOK_MINIMUM  : Number(bahan.STOK_MINIMUM) || 0,
        JUMLAH_LOT    : lots.length,
        LOW_STOCK     : alert,
      };
    });

    return ok(result);
  } catch (e) {
    return fail('Gagal ambil stok semua: ' + e.message);
  }
}

/**
 * Ambil movement history berdasarkan referensi transaksi.
 * @param {string} referensi - ID transaksi (PUR-xxx, PRD-xxx, SLS-xxx)
 * @returns {{success:boolean, data:Object[]}}
 */
function getMovementByRef(referensi) {
  try {
    const rows = _invReadAll(INV_SHEET.STOCK_CARD)
      .filter(r => r.REFERENSI === referensi || r.REFERENSI === ('VOID:' + referensi));
    return ok(rows);
  } catch (e) {
    return fail('Gagal ambil movement: ' + e.message);
  }
}

/**
 * Ambil semua movement dalam rentang tanggal.
 * @param {string} dari - 'YYYY-MM-DD'
 * @param {string} sampai - 'YYYY-MM-DD'
 * @returns {{success:boolean, data:Object[]}}
 */
function getMovementByRange(dari, sampai) {
  try {
    // Validate input dates
    if (!dari || !sampai) return fail('Parameter tanggal dari dan sampai wajib diisi');
    const rows = _invReadAll(INV_SHEET.STOCK_CARD)
      .filter(r => {
        // Normalize TANGGAL: may be a Date object (GAS) or ISO string
        const tgl = _normalizeTanggal(r.TANGGAL);
        return tgl >= dari && tgl <= sampai;
      })
      .sort((a, b) => _normalizeTanggal(a.TANGGAL).localeCompare(_normalizeTanggal(b.TANGGAL)));
    return ok(rows);
  } catch (e) {
    return fail('Gagal ambil movement by range: ' + e.message);
  }
}

/**
 * Normalize TANGGAL field to YYYY-MM-DD string.
 * GAS may return Date objects from Spreadsheet cells.
 * @param {Date|string} val
 * @returns {string} 'YYYY-MM-DD'
 */
function _normalizeTanggal(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  // ISO string: "2026-06-25T14:30:00" or plain "2026-06-25"
  return String(val).split('T')[0];
}

/**
 * Ringkasan laporan inventory (dashboard).
 */
function getInventorySummary() {
  try {
    const stokAll    = getStokSemua();
    if (!stokAll.success) return fail('Gagal ambil stok: ' + stokAll.message);
    const stokData   = stokAll.data || [];

    const purchases  = _invReadAll(INV_SHEET.PURCHASE) .filter(r => r.STATUS === 'POSTED');
    const productions= _invReadAll(INV_SHEET.PRODUCTION).filter(r => r.STATUS === 'POSTED');
    const salesAll   = _invReadAll(INV_SHEET.SALES)    .filter(r => r.STATUS === 'POSTED');

    const totalNilaiStok = stokData.reduce((s, r) => s + Number(r.STOK_NILAI), 0);
    const totalPembelian = purchases .reduce((s, r) => s + Number(r.TOTAL_HARGA), 0);
    const totalRevenue   = salesAll  .reduce((s, r) => s + Number(r.TOTAL_PENJUALAN), 0);
    const totalHppSales  = salesAll  .reduce((s, r) => s + Number(r.TOTAL_HPP), 0);
    const lowStockItems  = stokData.filter(r => r.LOW_STOCK);

    return ok({
      totalNilaiStok   : _invRound2(totalNilaiStok),
      jumlahBahan      : stokData.length,
      lowStockItems    : lowStockItems,
      totalPembelian   : _invRound2(totalPembelian),
      jumlahPurchase   : purchases.length,
      jumlahProduksi   : productions.length,
      jumlahSales      : salesAll.length,
      totalRevenue     : _invRound2(totalRevenue),
      totalHppSales    : _invRound2(totalHppSales),
      totalMargin      : _invRound2(totalRevenue - totalHppSales),
      marginPct        : totalRevenue > 0
        ? _invRound2((totalRevenue - totalHppSales) / totalRevenue * 100) : 0,
    });
  } catch (e) {
    return fail('Gagal ambil inventory summary: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// STOCK ADJUSTMENT — Koreksi Stok Manual
// ════════════════════════════════════════════════════════════

/**
 * Koreksi stok manual (untuk susut, rusak, stock opname, dll).
 * @param {Object} data
 *   {ID_BAHAN, TANGGAL, QTY_ADJUSTMENT, JENIS_ADJ ('ADD'|'SUB'), HARGA_PER_UNIT, CATATAN}
 */
function createStockAdjustment(data) {
  try {
    const { valid, missing } = validateRequired(data, ['ID_BAHAN', 'TANGGAL', 'QTY_ADJUSTMENT', 'JENIS_ADJ']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '));

    // Validate tanggal
    const tglStr = String(data.TANGGAL).split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tglStr) || isNaN(new Date(tglStr).getTime())) {
      return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD');
    }

    const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN);
    if (!bahan) return fail(`Bahan ${data.ID_BAHAN} tidak ditemukan`);

    const qty   = Number(data.QTY_ADJUSTMENT) || 0;
    if (qty <= 0) return fail('QTY_ADJUSTMENT harus lebih dari 0');

    const jenis = String(data.JENIS_ADJ).toUpperCase();
    if (!['ADD', 'SUB'].includes(jenis)) return fail('JENIS_ADJ harus ADD atau SUB');

    const stokSbl      = _getStokBahan(data.ID_BAHAN);
    const hargaPerUnit = Number(data.HARGA_PER_UNIT) ||
      (Number(bahan.HARGA_RATA2) / (Number(bahan.KONVERSI) || 1));

    if (jenis === 'SUB' && stokSbl.qty < qty) {
      return fail(`Stok tidak cukup untuk dikurangi. Stok: ${stokSbl.qty}, pengurangan: ${qty}`);
    }

    const allCardIds = _invReadAll(INV_SHEET.STOCK_CARD).map(r => r.ID_KARTU);
    const idKartu    = _invGenerateId('SC', allCardIds);
    const nilaiAdj   = _invRound2(qty * hargaPerUnit);

    const isAdd = jenis === 'ADD';
    const kartu = {
      ID_KARTU         : idKartu,
      ID_BAHAN         : data.ID_BAHAN,
      NAMA_BAHAN       : bahan.NAMA_BAHAN,
      TANGGAL          : data.TANGGAL,
      JENIS            : 'ADJUSTMENT',
      REFERENSI        : 'ADJ-MANUAL',
      LOT_ID           : isAdd ? idKartu : '',
      QTY_MASUK        : isAdd ? qty : 0,
      QTY_KELUAR       : isAdd ? 0  : qty,
      SISA_LOT         : isAdd ? qty : '',
      HARGA_PER_UNIT   : hargaPerUnit,
      NILAI_MASUK      : isAdd ? nilaiAdj : 0,
      NILAI_KELUAR     : isAdd ? 0 : nilaiAdj,
      STOK_AKHIR_QTY   : _invRound2(stokSbl.qty   + (isAdd ? qty : -qty)),
      STOK_AKHIR_NILAI : _invRound2(stokSbl.nilai  + (isAdd ? nilaiAdj : -nilaiAdj)),
      CATATAN          : sanitize(data.CATATAN || 'Adjustment manual'),
    };

    _invInsertRow(INV_SHEET.STOCK_CARD, kartu);
    log.info('inventory', 'CREATE', `Adjustment: ${idKartu} — ${bahan.NAMA_BAHAN} ${jenis} ${qty}`);
    return ok(kartu, `Adjustment stok ${bahan.NAMA_BAHAN}: ${jenis} ${qty} ${bahan.SATUAN_PAKAI} berhasil`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createStockAdjustment gagal', { error: e.message });
    return fail('Gagal buat adjustment: ' + e.message);
  }
}
