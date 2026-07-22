// ============================================================
// inventory.gs — Inventory Engine (v3 Multi-Outlet)
// Merge dari inventory_engine.gs + inventory_api.gs.
//
// PERUBAHAN UTAMA dari V1:
//  - Semua fungsi public terima `session` sebagai parameter terakhir
//  - outletId selalu di-scope ke session.outletId
//  - Write guard: hasPermission(ROLES.ADMIN) + failForbidden()
//  - Hapus: _invReadAll, _invGetSheet, _invGenerateId, _invRound2, _normalizeTanggal
//    → diganti readAll()/readWhere() dari service.gs, generateTxId()/round2()/normalizeTanggal() dari utils.gs
//  - _invInsertRow dipertahankan (insertRow() dari service.gs pakai HEADERS config.gs
//    yang tidak mencakup INV_SHEET) tapi refactor: LockService + invalidateCache + inject OUTLET_ID
//  - _invUpdateRow diganti updateRow() dari service.gs (sudah baca header dari sheet langsung)
//  - CONFIG.TIMEZONE dihapus → getConfig('DEFAULT_TIMEZONE', 'Asia/Jakarta')
//  - fail() pakai code string sebagai argumen kedua
//  - api*() wrappers dipertahankan tapi extract token → validateRequest() di dalam
//  - setupInventory() dipertahankan: tambah OUTLET_ID ke INV_HEADERS (lihat inventory_config.gs)
//
// CATATAN inventory_config.gs: OUTLET_ID ditambahkan ke semua INV_HEADERS
//   agar setiap sheet inventory bisa di-filter per outlet. Konsisten dengan
//   keputusan arsitektur M01 (semua sheet punya OUTLET_ID sebagai kolom filter).
//
// Dependensi: config.gs, utils.gs, service.gs, auth.gs, inventory_config.gs
// ============================================================


// ════════════════════════════════════════════════════════════
// PRIVATE HELPERS — Inventory I/O
// ════════════════════════════════════════════════════════════

/**
 * Insert satu baris ke sheet inventory.
 * Berbeda dari insertRow() di service.gs karena pakai INV_HEADERS (bukan HEADERS config.gs).
 * Fitur yang sama: LockService, invalidateCache, inject CREATED_AT + OUTLET_ID.
 *
 * @param {string} sheetName - harus ada di INV_SHEET
 * @param {Object} data
 * @param {string} outletId
 * @returns {Object} data yang diinsert
 */
function _invInsertRow(sheetName, data, outletId) {
  const headers = INV_HEADERS[sheetName];
  if (!headers) throw new Error(`INV_HEADERS["${sheetName}"] tidak terdefinisi.`);

  // Inject OUTLET_ID dan timestamp
  data.OUTLET_ID = outletId;
  if (headers.includes('CREATED_AT')) data.CREATED_AT = now();
  if (headers.includes('UPDATED_AT')) data.UPDATED_AT = now();

  const row = headers.map(h => (data[h] !== undefined ? data[h] : ''));

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    getSheet(sheetName).appendRow(row);
  } finally {
    lock.releaseLock();
  }

  // Invalidate cache agar readAll() selanjutnya tidak stale
  invalidateCache('KCC_' + sheetName + '_');
  return data;
}

/**
 * Hitung total stok bahan dari STOCK_CARD — ambil baris terakhir per bahan.
 * Sudah scope per outlet.
 *
 * @param {string} idBahan
 * @param {string} outletId
 * @returns {{ qty: number, nilai: number }}
 */
function _getStokBahan(idBahan, outletId) {
  const rows = readAll(INV_SHEET.STOCK_CARD, outletId)
    .filter(r => r.ID_BAHAN === idBahan);

  if (rows.length === 0) return { qty: 0, nilai: 0 };

  const last = rows[rows.length - 1];
  return {
    qty  : Number(last.STOK_AKHIR_QTY)  || 0,
    nilai: Number(last.STOK_AKHIR_NILAI) || 0,
  };
}

/**
 * Ambil lot-lot stok FIFO untuk bahan tertentu yang masih punya sisa.
 * Lot diurutkan dari yang paling lama (oldest first = FIFO).
 *
 * @param {string} idBahan
 * @param {string} outletId
 * @returns {Object[]}
 */
function _getFifoLots(idBahan, outletId) {
  return readAll(INV_SHEET.STOCK_CARD, outletId)
    .filter(r =>
      r.ID_BAHAN === idBahan &&
      r.JENIS    === 'IN' &&
      Number(r.SISA_LOT) > 0
    )
    .sort((a, b) => {
      const tglA = normalizeTanggal(a.TANGGAL);
      const tglB = normalizeTanggal(b.TANGGAL);
      if (tglA < tglB) return -1;
      if (tglA > tglB) return  1;
      return String(a.ID_KARTU).localeCompare(String(b.ID_KARTU));
    });
}

/**
 * Hitung harga rata-rata (weighted average) setelah pembelian baru.
 * Rumus: (nilai_stok_lama + nilai_baru) / (qty_lama + qty_baru)
 * Return dalam harga per satuan beli.
 *
 * @param {string} idBahan
 * @param {number} hargaBeli - per satuan beli
 * @param {number} qtyPakaiMasuk - satuan pakai yang masuk
 * @param {string} outletId
 * @returns {number}
 */
function _hitungHargaRata2(idBahan, hargaBeli, qtyPakaiMasuk, outletId) {
  const stok     = _getStokBahan(idBahan, outletId);
  const bahan    = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan, outletId);
  const konversi = Number(bahan?.KONVERSI) || 1;

  const nilaiMasuk = round2(qtyPakaiMasuk * (hargaBeli / konversi));
  const totalQty   = stok.qty   + qtyPakaiMasuk;
  const totalNilai = stok.nilai + nilaiMasuk;

  if (totalQty === 0) return hargaBeli;

  // Kembalikan dalam harga per satuan beli
  return round2((totalNilai / totalQty) * konversi);
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
 * @param {string} outletId
 * @returns {{ success: boolean, totalNilai: number, detail: Object[] }}
 */
function _fifoOut(idBahan, qtyKeluar, referensi, tanggal, catatan, outletId) {
  const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan, outletId);
  if (!bahan) throw new Error(`Bahan ${idBahan} tidak ditemukan`);

  const lots      = _getFifoLots(idBahan, outletId);
  const totalStok = lots.reduce((s, l) => s + Number(l.SISA_LOT), 0);

  if (totalStok < qtyKeluar) {
    throw new Error(
      `Stok ${bahan.NAMA_BAHAN} tidak cukup. Dibutuhkan: ${qtyKeluar}, tersedia: ${round2(totalStok)}`
    );
  }

  let sisaKeluar = qtyKeluar;
  let totalNilai = 0;
  const detail   = [];

  // Pre-load semua ID kartu untuk generateTxId
  const allCardIds = readAll(INV_SHEET.STOCK_CARD, outletId).map(r => r.ID_KARTU);

  for (const lot of lots) {
    if (sisaKeluar <= 0) break;

    const pakeDariLot = Math.min(Number(lot.SISA_LOT), sisaKeluar);
    const harga       = Number(lot.HARGA_PER_UNIT) || 0;
    const nilaiKeluar = round2(pakeDariLot * harga);
    totalNilai       += nilaiKeluar;
    sisaKeluar       -= pakeDariLot;

    // Update sisa lot di baris IN (gunakan updateRow dari service.gs — baca header dari sheet)
    const sisaBaru = round2(Number(lot.SISA_LOT) - pakeDariLot);
    updateRow(INV_SHEET.STOCK_CARD, 'ID_KARTU', lot.ID_KARTU, { SISA_LOT: sisaBaru }, outletId);

    // Hitung stok akhir setelah update lot
    const stokSebelum = _getStokBahan(idBahan, outletId);

    const idKartu = generateTxId('SC', allCardIds);
    allCardIds.push(idKartu);

    _invInsertRow(INV_SHEET.STOCK_CARD, {
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
      STOK_AKHIR_QTY   : round2(stokSebelum.qty   - pakeDariLot),
      STOK_AKHIR_NILAI : round2(stokSebelum.nilai  - nilaiKeluar),
      CATATAN          : catatan || '',
    }, outletId);

    detail.push({ lotId: lot.ID_KARTU, pakeDariLot, harga, nilaiKeluar });
  }

  return { success: true, totalNilai: round2(totalNilai), detail };
}

/**
 * Validasi format tanggal (YYYY-MM-DD).
 * @param {*} val
 * @returns {{ valid: boolean, tglStr: string }}
 */
function _validateTanggal(val) {
  const tglStr = String(val).split('T')[0];
  const valid  = /^\d{4}-\d{2}-\d{2}$/.test(tglStr) && !isNaN(new Date(tglStr).getTime());
  return { valid, tglStr };
}


// ════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════

/**
 * Inisialisasi sheet-sheet Inventory Engine.
 * Jalankan sekali setelah setupAll() dari sistem utama selesai.
 * Aman dijalankan berulang — tidak akan mengubah data yang sudah ada.
 *
 * Catatan: INV_HEADERS sudah mencakup OUTLET_ID (lihat inventory_config.gs).
 */
function setupInventory() {
  const ss = getSpreadsheet();
  const created = [], existed = [];

  Object.entries(INV_SHEET).forEach(([, sheetName]) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      created.push(sheetName);
    } else {
      existed.push(sheetName);
    }

    const headers = INV_HEADERS[sheetName];
    if (headers && sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange
        .setBackground('#006064')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(10);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    }
  });

  const msg = [
    '✅ Inventory Engine setup selesai',
    `📦 Sheet dibuat: ${created.join(', ') || '-'}`,
    `📦 Sudah ada: ${existed.join(', ') || '-'}`,
  ].join('\n');

  writeLog('INFO', 'inventory', 'SYSTEM', 'setupInventory dijalankan', { created, existed });
  return msg;
}

/**
 * Setup SEMUA (sistem utama + Inventory Engine) sekaligus.
 * Aman dijalankan berulang.
 */
function setupAll() {
  const r1 = setup();           // dari Code.gs (sistem utama)
  const r2 = setupInventory();
  return r1 + '\n\n' + r2;
}


// ════════════════════════════════════════════════════════════
// PURCHASE — Pembelian Bahan Baku
// ════════════════════════════════════════════════════════════

/**
 * Catat pembelian bahan baku. Otomatis menambah stok (masuk ke FIFO lot baru).
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {Object} data - { TANGGAL, ID_SUPPLIER?, ID_BAHAN, QTY_BELI, HARGA_SATUAN, CATATAN? }
 * @param {Object} session
 * @returns {{success:boolean, data:Object, message:string}}
 */
function createPurchase(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['TANGGAL', 'ID_BAHAN', 'QTY_BELI', 'HARGA_SATUAN']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const { valid: tglOk, tglStr } = _validateTanggal(data.TANGGAL);
    if (!tglOk) return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD', 'VALIDATION_ERROR');

    const qtyBeli  = Number(data.QTY_BELI)    || 0;
    const hargaSat = Number(data.HARGA_SATUAN) || 0;
    if (qtyBeli  <= 0) return fail('QTY_BELI harus lebih dari 0',    'VALIDATION_ERROR');
    if (hargaSat <= 0) return fail('HARGA_SATUAN harus lebih dari 0', 'VALIDATION_ERROR');

    const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN, outletId);
    if (!bahan) return fail(`Bahan ${data.ID_BAHAN} tidak ditemukan`, 'NOT_FOUND');

    let namaSupplier = '';
    if (data.ID_SUPPLIER) {
      const sup = readOne(SHEET.SUPPLIER, 'ID_SUPPLIER', data.ID_SUPPLIER, outletId);
      if (!sup) return fail(`Supplier ${data.ID_SUPPLIER} tidak ditemukan`, 'NOT_FOUND');
      namaSupplier = sup.NAMA_SUPPLIER;
    }

    const konversi  = Number(bahan.KONVERSI)  || 1;
    const qtyPakai  = round2(qtyBeli * konversi);
    const totalHarga = round2(qtyBeli * hargaSat);

    const allPurIds  = readAll(INV_SHEET.PURCHASE, outletId).map(r => r.ID_PURCHASE);
    const idPurchase = generateTxId('PUR', allPurIds);

    const purchase = {
      ID_PURCHASE  : idPurchase,
      TANGGAL      : tglStr,
      ID_SUPPLIER  : data.ID_SUPPLIER || '',
      NAMA_SUPPLIER: namaSupplier,
      ID_BAHAN     : data.ID_BAHAN,
      NAMA_BAHAN   : bahan.NAMA_BAHAN,
      QTY_BELI     : qtyBeli,
      SATUAN_BELI  : bahan.SATUAN_BELI,
      KONVERSI     : konversi,
      QTY_PAKAI    : qtyPakai,
      HARGA_SATUAN : hargaSat,
      TOTAL_HARGA  : totalHarga,
      STATUS       : 'POSTED',
      CATATAN      : sanitize(data.CATATAN || ''),
    };

    _invInsertRow(INV_SHEET.PURCHASE, purchase, outletId);

    // ── Masukkan ke STOCK_CARD sebagai lot IN ──
    const stokSebelum  = _getStokBahan(data.ID_BAHAN, outletId);
    const hargaPerUnit = konversi > 0 ? round2(hargaSat / konversi) : 0;
    const nilaiMasuk   = round2(qtyPakai * hargaPerUnit);

    const allCardIds = readAll(INV_SHEET.STOCK_CARD, outletId).map(r => r.ID_KARTU);
    const idKartu    = generateTxId('SC', allCardIds);

    _invInsertRow(INV_SHEET.STOCK_CARD, {
      ID_KARTU         : idKartu,
      ID_BAHAN         : data.ID_BAHAN,
      NAMA_BAHAN       : bahan.NAMA_BAHAN,
      TANGGAL          : tglStr,
      JENIS            : 'IN',
      REFERENSI        : idPurchase,
      LOT_ID           : idKartu,
      QTY_MASUK        : qtyPakai,
      QTY_KELUAR       : 0,
      SISA_LOT         : qtyPakai,
      HARGA_PER_UNIT   : hargaPerUnit,
      NILAI_MASUK      : nilaiMasuk,
      NILAI_KELUAR     : 0,
      STOK_AKHIR_QTY   : round2(stokSebelum.qty   + qtyPakai),
      STOK_AKHIR_NILAI : round2(stokSebelum.nilai  + nilaiMasuk),
      CATATAN          : data.CATATAN || '',
    }, outletId);

    // ── Update harga di MASTER_BAHAN ──
    updateRow(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN, {
      HARGA_TERAKHIR: hargaSat,
      HARGA_RATA2   : _hitungHargaRata2(data.ID_BAHAN, hargaSat, qtyPakai, outletId),
    }, outletId);

    log.info('inventory', 'CREATE',
      `Purchase: ${idPurchase} — ${bahan.NAMA_BAHAN} ${qtyBeli} ${bahan.SATUAN_BELI}`,
      null, session
    );
    return ok(purchase, `Purchase ${idPurchase} berhasil. Stok +${qtyPakai} ${bahan.SATUAN_PAKAI}`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createPurchase gagal', { error: e.message }, session);
    return fail('Gagal catat purchase: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Void purchase (soft void — ubah STATUS ke VOID, kurangi stok).
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {string} idPurchase
 * @param {Object} session
 */
function voidPurchase(idPurchase, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;
    const purchase = readWhere(INV_SHEET.PURCHASE, r => r.ID_PURCHASE === idPurchase, outletId)[0];
    if (!purchase) return fail(`Purchase ${idPurchase} tidak ditemukan`, 'NOT_FOUND');
    if (purchase.STATUS === 'VOID') return fail(`Purchase ${idPurchase} sudah VOID`, 'VALIDATION_ERROR');

    const qtyPakai = Number(purchase.QTY_PAKAI) || 0;
    const stok     = _getStokBahan(purchase.ID_BAHAN, outletId);
    if (stok.qty < qtyPakai) {
      return fail(
        `Tidak bisa void: stok ${purchase.NAMA_BAHAN} saat ini (${stok.qty}) lebih kecil dari qty purchase (${qtyPakai})`,
        'VALIDATION_ERROR'
      );
    }

    // Cari lot IN yang sesuai purchase ini
    const kartu = readWhere(
      INV_SHEET.STOCK_CARD,
      r => r.REFERENSI === idPurchase && r.JENIS === 'IN',
      outletId
    )[0];

    if (kartu) {
      const sudahKeluar = Number(kartu.QTY_MASUK) - Number(kartu.SISA_LOT);
      if (sudahKeluar > 0) {
        return fail(
          `Tidak bisa void: sebagian lot sudah digunakan (${sudahKeluar} ${purchase.SATUAN_BELI} telah keluar)`,
          'VALIDATION_ERROR'
        );
      }

      // Catat ADJUSTMENT OUT di STOCK_CARD
      const allCardIds = readAll(INV_SHEET.STOCK_CARD, outletId).map(r => r.ID_KARTU);
      const idKartu    = generateTxId('SC', allCardIds);
      const stokSbl    = _getStokBahan(purchase.ID_BAHAN, outletId);

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
        NILAI_KELUAR     : round2(qtyPakai * Number(kartu.HARGA_PER_UNIT)),
        STOK_AKHIR_QTY   : round2(stokSbl.qty   - qtyPakai),
        STOK_AKHIR_NILAI : round2(stokSbl.nilai  - qtyPakai * Number(kartu.HARGA_PER_UNIT)),
        CATATAN          : 'Void purchase ' + idPurchase,
      }, outletId);

      // Nolkan sisa lot di baris IN
      updateRow(INV_SHEET.STOCK_CARD, 'ID_KARTU', kartu.ID_KARTU, { SISA_LOT: 0 }, outletId);
    }

    updateRow(INV_SHEET.PURCHASE, 'ID_PURCHASE', idPurchase, { STATUS: 'VOID' }, outletId);
    log.info('inventory', 'UPDATE', `Void purchase: ${idPurchase}`, null, session);
    return ok(null, `Purchase ${idPurchase} berhasil di-void`);

  } catch (e) {
    log.error('inventory', 'UPDATE', 'voidPurchase gagal', { error: e.message }, session);
    return fail('Gagal void purchase: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Ambil semua purchase untuk outlet session.
 * @param {Object} session
 */
function getPurchaseAll(session) {
  try {
    return ok(readAll(INV_SHEET.PURCHASE, session.outletId));
  } catch (e) {
    return fail('Gagal ambil purchase: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Ambil satu purchase berdasarkan ID.
 * @param {string} idPurchase
 * @param {Object} session
 */
function getPurchaseById(idPurchase, session) {
  try {
    const row = readWhere(INV_SHEET.PURCHASE, r => r.ID_PURCHASE === idPurchase, session.outletId)[0];
    return row ? ok(row) : fail(`Purchase ${idPurchase} tidak ditemukan`, 'NOT_FOUND');
  } catch (e) {
    return fail('Gagal ambil purchase: ' + e.message, 'SERVER_ERROR');
  }
}


// ════════════════════════════════════════════════════════════
// PRODUCTION — Produksi
// ════════════════════════════════════════════════════════════

/**
 * Catat produksi. Otomatis mengeluarkan bahan sesuai resep (FIFO).
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {Object} data - { TANGGAL, ID_PRODUK, JUMLAH_BATCH, CATATAN? }
 * @param {Object} session
 */
function createProduction(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['TANGGAL', 'ID_PRODUK', 'JUMLAH_BATCH']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const { valid: tglOk, tglStr } = _validateTanggal(data.TANGGAL);
    if (!tglOk) return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD', 'VALIDATION_ERROR');

    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', data.ID_PRODUK, outletId);
    if (!produk) return fail(`Produk ${data.ID_PRODUK} tidak ditemukan`, 'NOT_FOUND');

    const jumlahBatch = Number(data.JUMLAH_BATCH) || 0;
    if (jumlahBatch <= 0) return fail('JUMLAH_BATCH harus lebih dari 0', 'VALIDATION_ERROR');

    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === data.ID_PRODUK, outletId);
    if (itemResep.length === 0) return fail(`Resep produk ${data.ID_PRODUK} belum ada`, 'NOT_FOUND');

    // Validasi ketersediaan stok semua bahan SEBELUM transaksi
    for (const item of itemResep) {
      const qtyKeluar = round2(Number(item.JUMLAH) * jumlahBatch);
      const stok      = _getStokBahan(item.ID_BAHAN, outletId);
      if (stok.qty < qtyKeluar) {
        const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN, outletId);
        return fail(
          `Stok tidak cukup: ${bahan?.NAMA_BAHAN || item.ID_BAHAN}. ` +
          `Dibutuhkan: ${qtyKeluar}, tersedia: ${round2(stok.qty)}`,
          'VALIDATION_ERROR'
        );
      }
    }

    // Generate ID Produksi
    const allPrdIds  = readAll(INV_SHEET.PRODUCTION, outletId).map(r => r.ID_PRODUKSI);
    const idProduksi = generateTxId('PRD', allPrdIds);

    const yieldPcs    = Number(produk.YIELD_PCS) || 1;
    const qtyHasil    = round2(jumlahBatch * yieldPcs);
    const hppPerBatch = (Number(produk.HPP) * yieldPcs) || 0;
    const totalHpp    = round2(jumlahBatch * hppPerBatch);

    const production = {
      ID_PRODUKSI  : idProduksi,
      TANGGAL      : tglStr,
      ID_PRODUK    : data.ID_PRODUK,
      NAMA_PRODUK  : produk.NAMA_PRODUK,
      JUMLAH_BATCH : jumlahBatch,
      QTY_HASIL    : qtyHasil,
      HPP_PER_BATCH: hppPerBatch,
      TOTAL_HPP    : totalHpp,
      STATUS       : 'POSTED',
      CATATAN      : sanitize(data.CATATAN || ''),
    };

    _invInsertRow(INV_SHEET.PRODUCTION, production, outletId);

    // ── Keluarkan bahan FIFO untuk setiap item resep ──
    for (const item of itemResep) {
      const qtyKeluar = round2(Number(item.JUMLAH) * jumlahBatch);
      _fifoOut(
        item.ID_BAHAN,
        qtyKeluar,
        idProduksi,
        tglStr,
        `Produksi ${jumlahBatch}x batch ${produk.NAMA_PRODUK}`,
        outletId
      );
    }

    log.info('inventory', 'CREATE',
      `Produksi: ${idProduksi} — ${produk.NAMA_PRODUK} ${jumlahBatch} batch`,
      null, session
    );
    return ok(production, `Produksi ${idProduksi} berhasil. ${qtyHasil} pcs ${produk.NAMA_PRODUK} diproduksi.`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createProduction gagal', { error: e.message }, session);
    return fail('Gagal catat produksi: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Void produksi — kembalikan bahan ke stok sebagai ADJUSTMENT IN.
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {string} idProduksi
 * @param {Object} session
 */
function voidProduction(idProduksi, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;
    const prod     = readWhere(INV_SHEET.PRODUCTION, r => r.ID_PRODUKSI === idProduksi, outletId)[0];
    if (!prod) return fail(`Produksi ${idProduksi} tidak ditemukan`, 'NOT_FOUND');
    if (prod.STATUS === 'VOID') return fail(`Produksi ${idProduksi} sudah VOID`, 'VALIDATION_ERROR');

    const itemResep   = readWhere(SHEET.RESEP, r => r.ID_PRODUK === prod.ID_PRODUK, outletId);
    const jumlahBatch = Number(prod.JUMLAH_BATCH) || 0;
    const allCardIds  = readAll(INV_SHEET.STOCK_CARD, outletId).map(r => r.ID_KARTU);

    for (const item of itemResep) {
      const qtyKembali   = round2(Number(item.JUMLAH) * jumlahBatch);
      const bahan        = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN, outletId);
      const stokSbl      = _getStokBahan(item.ID_BAHAN, outletId);
      const hargaPerUnit = Number(bahan?.HARGA_RATA2 || 0) / (Number(bahan?.KONVERSI) || 1);
      const nilaiKembali = round2(qtyKembali * hargaPerUnit);

      const idKartu = generateTxId('SC', allCardIds);
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
        STOK_AKHIR_QTY   : round2(stokSbl.qty   + qtyKembali),
        STOK_AKHIR_NILAI : round2(stokSbl.nilai  + nilaiKembali),
        CATATAN          : 'Void produksi ' + idProduksi,
      }, outletId);
    }

    updateRow(INV_SHEET.PRODUCTION, 'ID_PRODUKSI', idProduksi, { STATUS: 'VOID' }, outletId);
    log.info('inventory', 'UPDATE', `Void produksi: ${idProduksi}`, null, session);
    return ok(null, `Produksi ${idProduksi} berhasil di-void. Stok bahan dikembalikan.`);

  } catch (e) {
    log.error('inventory', 'UPDATE', 'voidProduction gagal', { error: e.message }, session);
    return fail('Gagal void produksi: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * @param {Object} session
 */
function getProductionAll(session) {
  try {
    return ok(readAll(INV_SHEET.PRODUCTION, session.outletId));
  } catch (e) {
    return fail('Gagal ambil produksi: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * @param {string} idProduksi
 * @param {Object} session
 */
function getProductionById(idProduksi, session) {
  try {
    const row = readWhere(INV_SHEET.PRODUCTION, r => r.ID_PRODUKSI === idProduksi, session.outletId)[0];
    return row ? ok(row) : fail(`Produksi ${idProduksi} tidak ditemukan`, 'NOT_FOUND');
  } catch (e) {
    return fail('Gagal ambil produksi: ' + e.message, 'SERVER_ERROR');
  }
}


// ════════════════════════════════════════════════════════════
// SALES — Penjualan
// ════════════════════════════════════════════════════════════

/**
 * Catat penjualan produk jadi.
 * Sales tidak langsung mengurangi stok bahan (sudah keluar saat produksi).
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {Object} data - { TANGGAL, ID_PRODUK, QTY_JUAL, HARGA_JUAL, CATATAN? }
 * @param {Object} session
 */
function createSales(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['TANGGAL', 'ID_PRODUK', 'QTY_JUAL', 'HARGA_JUAL']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const { valid: tglOk, tglStr } = _validateTanggal(data.TANGGAL);
    if (!tglOk) return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD', 'VALIDATION_ERROR');

    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', data.ID_PRODUK, outletId);
    if (!produk) return fail(`Produk ${data.ID_PRODUK} tidak ditemukan`, 'NOT_FOUND');

    const qtyJual    = Number(data.QTY_JUAL)  || 0;
    const hargaJual  = Number(data.HARGA_JUAL) || 0;
    const hppPerUnit = Number(produk.HPP)       || 0;

    if (qtyJual   <= 0) return fail('QTY_JUAL harus lebih dari 0',      'VALIDATION_ERROR');
    if (hargaJual <  0) return fail('HARGA_JUAL tidak boleh negatif',    'VALIDATION_ERROR');

    const totalPenjualan = round2(qtyJual * hargaJual);
    const totalHpp       = round2(qtyJual * hppPerUnit);
    const marginNilai    = round2(totalPenjualan - totalHpp);
    const marginPct      = totalPenjualan > 0
      ? round2(marginNilai / totalPenjualan * 100) : 0;

    const allSlsIds = readAll(INV_SHEET.SALES, outletId).map(r => r.ID_SALES);
    const idSales   = generateTxId('SLS', allSlsIds);

    const sales = {
      ID_SALES       : idSales,
      TANGGAL        : tglStr,
      ID_PRODUK      : data.ID_PRODUK,
      NAMA_PRODUK    : produk.NAMA_PRODUK,
      QTY_JUAL       : qtyJual,
      SATUAN_JUAL    : produk.SATUAN_JUAL,
      HARGA_JUAL     : hargaJual,
      TOTAL_PENJUALAN: totalPenjualan,
      HPP_PER_UNIT   : hppPerUnit,
      TOTAL_HPP      : totalHpp,
      MARGIN_NILAI   : marginNilai,
      MARGIN_PCT     : marginPct,
      STATUS         : 'POSTED',
      CATATAN        : sanitize(data.CATATAN || ''),
    };

    _invInsertRow(INV_SHEET.SALES, sales, outletId);
    log.info('inventory', 'CREATE',
      `Sales: ${idSales} — ${produk.NAMA_PRODUK} ${qtyJual} pcs`,
      null, session
    );
    return ok(sales, `Sales ${idSales} berhasil. Revenue: ${totalPenjualan}, Margin: ${marginPct}%`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createSales gagal', { error: e.message }, session);
    return fail('Gagal catat sales: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Void sales.
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {string} idSales
 * @param {Object} session
 */
function voidSales(idSales, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;
    const sale     = readWhere(INV_SHEET.SALES, r => r.ID_SALES === idSales, outletId)[0];
    if (!sale) return fail(`Sales ${idSales} tidak ditemukan`, 'NOT_FOUND');
    if (sale.STATUS === 'VOID') return fail(`Sales ${idSales} sudah VOID`, 'VALIDATION_ERROR');

    updateRow(INV_SHEET.SALES, 'ID_SALES', idSales, { STATUS: 'VOID' }, outletId);
    log.info('inventory', 'UPDATE', `Void sales: ${idSales}`, null, session);
    return ok(null, `Sales ${idSales} berhasil di-void`);

  } catch (e) {
    log.error('inventory', 'UPDATE', 'voidSales gagal', { error: e.message }, session);
    return fail('Gagal void sales: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * @param {Object} session
 */
function getSalesAll(session) {
  try {
    return ok(readAll(INV_SHEET.SALES, session.outletId));
  } catch (e) {
    return fail('Gagal ambil sales: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * @param {string} idSales
 * @param {Object} session
 */
function getSalesById(idSales, session) {
  try {
    const row = readWhere(INV_SHEET.SALES, r => r.ID_SALES === idSales, session.outletId)[0];
    return row ? ok(row) : fail(`Sales ${idSales} tidak ditemukan`, 'NOT_FOUND');
  } catch (e) {
    return fail('Gagal ambil sales: ' + e.message, 'SERVER_ERROR');
  }
}


// ════════════════════════════════════════════════════════════
// STOCK ADJUSTMENT — Koreksi Stok Manual
// ════════════════════════════════════════════════════════════

/**
 * Koreksi stok manual (untuk susut, rusak, stock opname, dll).
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {Object} data - { ID_BAHAN, TANGGAL, QTY_ADJUSTMENT, JENIS_ADJ ('ADD'|'SUB'), HARGA_PER_UNIT?, CATATAN? }
 * @param {Object} session
 */
function createStockAdjustment(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['ID_BAHAN', 'TANGGAL', 'QTY_ADJUSTMENT', 'JENIS_ADJ']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const { valid: tglOk, tglStr } = _validateTanggal(data.TANGGAL);
    if (!tglOk) return fail('Format tanggal tidak valid. Gunakan YYYY-MM-DD', 'VALIDATION_ERROR');

    const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN, outletId);
    if (!bahan) return fail(`Bahan ${data.ID_BAHAN} tidak ditemukan`, 'NOT_FOUND');

    const qty   = Number(data.QTY_ADJUSTMENT) || 0;
    if (qty <= 0) return fail('QTY_ADJUSTMENT harus lebih dari 0', 'VALIDATION_ERROR');

    const jenis = String(data.JENIS_ADJ).toUpperCase();
    if (!['ADD', 'SUB'].includes(jenis)) return fail('JENIS_ADJ harus ADD atau SUB', 'VALIDATION_ERROR');

    const stokSbl      = _getStokBahan(data.ID_BAHAN, outletId);
    const hargaPerUnit = Number(data.HARGA_PER_UNIT) ||
      (Number(bahan.HARGA_RATA2) / (Number(bahan.KONVERSI) || 1));

    if (jenis === 'SUB' && stokSbl.qty < qty) {
      return fail(
        `Stok tidak cukup untuk dikurangi. Stok: ${stokSbl.qty}, pengurangan: ${qty}`,
        'VALIDATION_ERROR'
      );
    }

    const allCardIds = readAll(INV_SHEET.STOCK_CARD, outletId).map(r => r.ID_KARTU);
    const idKartu    = generateTxId('SC', allCardIds);
    const nilaiAdj   = round2(qty * hargaPerUnit);
    const isAdd      = jenis === 'ADD';

    const kartu = {
      ID_KARTU         : idKartu,
      ID_BAHAN         : data.ID_BAHAN,
      NAMA_BAHAN       : bahan.NAMA_BAHAN,
      TANGGAL          : tglStr,
      JENIS            : 'ADJUSTMENT',
      REFERENSI        : 'ADJ-MANUAL',
      LOT_ID           : isAdd ? idKartu : '',
      QTY_MASUK        : isAdd ? qty : 0,
      QTY_KELUAR       : isAdd ? 0  : qty,
      SISA_LOT         : isAdd ? qty : '',
      HARGA_PER_UNIT   : hargaPerUnit,
      NILAI_MASUK      : isAdd ? nilaiAdj : 0,
      NILAI_KELUAR     : isAdd ? 0 : nilaiAdj,
      STOK_AKHIR_QTY   : round2(stokSbl.qty   + (isAdd ? qty    : -qty)),
      STOK_AKHIR_NILAI : round2(stokSbl.nilai  + (isAdd ? nilaiAdj : -nilaiAdj)),
      CATATAN          : sanitize(data.CATATAN || 'Adjustment manual'),
    };

    _invInsertRow(INV_SHEET.STOCK_CARD, kartu, outletId);
    log.info('inventory', 'CREATE',
      `Adjustment: ${idKartu} — ${bahan.NAMA_BAHAN} ${jenis} ${qty}`,
      null, session
    );
    return ok(kartu, `Adjustment stok ${bahan.NAMA_BAHAN}: ${jenis} ${qty} ${bahan.SATUAN_PAKAI} berhasil`);

  } catch (e) {
    log.error('inventory', 'CREATE', 'createStockAdjustment gagal', { error: e.message }, session);
    return fail('Gagal buat adjustment: ' + e.message, 'SERVER_ERROR');
  }
}


// ════════════════════════════════════════════════════════════
// QUERY — Stock Card, Movement History, Ringkasan
// ════════════════════════════════════════════════════════════

/**
 * Ambil stock card untuk satu bahan (semua pergerakan).
 *
 * @param {string} idBahan
 * @param {Object} session
 */
function getStockCard(idBahan, session) {
  try {
    const outletId = session.outletId;
    const bahan    = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan, outletId);
    if (!bahan) return fail(`Bahan ${idBahan} tidak ditemukan`, 'NOT_FOUND');

    const movements = readAll(INV_SHEET.STOCK_CARD, outletId)
      .filter(r => r.ID_BAHAN === idBahan)
      .sort((a, b) => String(a.ID_KARTU).localeCompare(String(b.ID_KARTU)));

    const stokAkhir = _getStokBahan(idBahan, outletId);
    const lots      = _getFifoLots(idBahan, outletId);

    return ok({
      bahan    : bahan,
      movements: movements,
      stokAkhir: stokAkhir,
      fifoLots : lots,
      summary  : {
        totalMasuk : round2(movements.filter(r => r.JENIS === 'IN').reduce((s, r) => s + Number(r.QTY_MASUK),  0)),
        totalKeluar: round2(movements.filter(r => r.JENIS === 'OUT').reduce((s, r) => s + Number(r.QTY_KELUAR), 0)),
        totalAdj   : movements.filter(r => r.JENIS === 'ADJUSTMENT').length,
        stokQty    : stokAkhir.qty,
        stokNilai  : stokAkhir.nilai,
        jumlahLot  : lots.length,
      },
    });
  } catch (e) {
    return fail('Gagal ambil stock card: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Ambil ringkasan stok semua bahan aktif di outlet.
 *
 * @param {Object} session
 */
function getStokSemua(session) {
  try {
    const outletId   = session.outletId;
    const semuaBahan = readAll(SHEET.BAHAN, outletId).filter(r => String(r.AKTIF) !== 'FALSE');

    const result = semuaBahan.map(bahan => {
      const stok  = _getStokBahan(bahan.ID_BAHAN, outletId);
      const lots  = _getFifoLots(bahan.ID_BAHAN, outletId);
      const alert = Number(bahan.STOK_MINIMUM) > 0 && stok.qty < Number(bahan.STOK_MINIMUM);
      return {
        ID_BAHAN    : bahan.ID_BAHAN,
        NAMA_BAHAN  : bahan.NAMA_BAHAN,
        KATEGORI    : bahan.KATEGORI,
        SATUAN_PAKAI: bahan.SATUAN_PAKAI,
        STOK_QTY    : stok.qty,
        STOK_NILAI  : stok.nilai,
        STOK_MINIMUM: Number(bahan.STOK_MINIMUM) || 0,
        JUMLAH_LOT  : lots.length,
        LOW_STOCK   : alert,
      };
    });

    return ok(result);
  } catch (e) {
    return fail('Gagal ambil stok semua: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Ambil movement berdasarkan ID referensi transaksi.
 *
 * @param {string} referensi
 * @param {Object} session
 */
function getMovementByRef(referensi, session) {
  try {
    const rows = readAll(INV_SHEET.STOCK_CARD, session.outletId)
      .filter(r => r.REFERENSI === referensi || r.REFERENSI === ('VOID:' + referensi));
    return ok(rows);
  } catch (e) {
    return fail('Gagal ambil movement: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Ambil semua movement dalam rentang tanggal.
 *
 * @param {string} dari - 'YYYY-MM-DD'
 * @param {string} sampai - 'YYYY-MM-DD'
 * @param {Object} session
 */
function getMovementByRange(dari, sampai, session) {
  try {
    if (!dari || !sampai) return fail('Parameter tanggal dari dan sampai wajib diisi', 'VALIDATION_ERROR');
    const rows = readAll(INV_SHEET.STOCK_CARD, session.outletId)
      .filter(r => {
        const tgl = normalizeTanggal(r.TANGGAL);
        return tgl >= dari && tgl <= sampai;
      })
      .sort((a, b) => normalizeTanggal(a.TANGGAL).localeCompare(normalizeTanggal(b.TANGGAL)));
    return ok(rows);
  } catch (e) {
    return fail('Gagal ambil movement by range: ' + e.message, 'SERVER_ERROR');
  }
}

/**
 * Ringkasan laporan inventory (dashboard).
 *
 * @param {Object} session
 */
function getInventorySummary(session) {
  try {
    const outletId = session.outletId;

    const stokAll  = getStokSemua(session);
    if (!stokAll.success) return fail('Gagal ambil stok: ' + stokAll.message, 'SERVER_ERROR');
    const stokData = stokAll.data || [];

    const purchases  = readAll(INV_SHEET.PURCHASE,   outletId).filter(r => r.STATUS === 'POSTED');
    const productions= readAll(INV_SHEET.PRODUCTION, outletId).filter(r => r.STATUS === 'POSTED');
    const salesAll   = readAll(INV_SHEET.SALES,      outletId).filter(r => r.STATUS === 'POSTED');

    const totalNilaiStok = stokData.reduce((s, r) => s + Number(r.STOK_NILAI),       0);
    const totalPembelian = purchases.reduce((s, r) => s + Number(r.TOTAL_HARGA),     0);
    const totalRevenue   = salesAll .reduce((s, r) => s + Number(r.TOTAL_PENJUALAN), 0);
    const totalHppSales  = salesAll .reduce((s, r) => s + Number(r.TOTAL_HPP),       0);
    const lowStockItems  = stokData.filter(r => r.LOW_STOCK);

    return ok({
      totalNilaiStok : round2(totalNilaiStok),
      jumlahBahan    : stokData.length,
      lowStockItems  : lowStockItems,
      totalPembelian : round2(totalPembelian),
      jumlahPurchase : purchases.length,
      jumlahProduksi : productions.length,
      jumlahSales    : salesAll.length,
      totalRevenue   : round2(totalRevenue),
      totalHppSales  : round2(totalHppSales),
      totalMargin    : round2(totalRevenue - totalHppSales),
      marginPct      : totalRevenue > 0
        ? round2((totalRevenue - totalHppSales) / totalRevenue * 100) : 0,
    });
  } catch (e) {
    return fail('Gagal ambil inventory summary: ' + e.message, 'SERVER_ERROR');
  }
}


// ════════════════════════════════════════════════════════════
// PUBLIC API WRAPPERS — Entry point dari Code.gs router
// Semua wrapper: extract token → validateRequest() → panggil fungsi bisnis
// ════════════════════════════════════════════════════════════

// ── Purchase ──
function apiInvPurchaseCreate(params) {
  const session = validateRequest(params.token);
  return createPurchase(params.data, session);
}
function apiInvPurchaseVoid(params) {
  const session = validateRequest(params.token);
  return voidPurchase(params.idPurchase, session);
}
function apiInvPurchaseGetAll(params) {
  const session = validateRequest(params.token);
  return getPurchaseAll(session);
}
function apiInvPurchaseGetById(params) {
  const session = validateRequest(params.token);
  return getPurchaseById(params.id, session);
}

// ── Production ──
function apiInvProductionCreate(params) {
  const session = validateRequest(params.token);
  return createProduction(params.data, session);
}
function apiInvProductionVoid(params) {
  const session = validateRequest(params.token);
  return voidProduction(params.id, session);
}
function apiInvProductionGetAll(params) {
  const session = validateRequest(params.token);
  return getProductionAll(session);
}
function apiInvProductionGetById(params) {
  const session = validateRequest(params.token);
  return getProductionById(params.id, session);
}

// ── Sales ──
function apiInvSalesCreate(params) {
  const session = validateRequest(params.token);
  return createSales(params.data, session);
}
function apiInvSalesVoid(params) {
  const session = validateRequest(params.token);
  return voidSales(params.id, session);
}
function apiInvSalesGetAll(params) {
  const session = validateRequest(params.token);
  return getSalesAll(session);
}
function apiInvSalesGetById(params) {
  const session = validateRequest(params.token);
  return getSalesById(params.id, session);
}

// ── Stock & Movement ──
function apiInvGetStockCard(params) {
  const session = validateRequest(params.token);
  return getStockCard(params.idBahan, session);
}
function apiInvGetStokSemua(params) {
  const session = validateRequest(params.token);
  return getStokSemua(session);
}
function apiInvGetMovementByRef(params) {
  const session = validateRequest(params.token);
  return getMovementByRef(params.referensi, session);
}
function apiInvGetMovementByRange(params) {
  const session = validateRequest(params.token);
  return getMovementByRange(params.dari, params.sampai, session);
}
function apiInvGetSummary(params) {
  const session = validateRequest(params.token);
  return getInventorySummary(session);
}

// ── Adjustment ──
function apiInvAdjustment(params) {
  const session = validateRequest(params.token);
  return createStockAdjustment(params.data, session);
}
