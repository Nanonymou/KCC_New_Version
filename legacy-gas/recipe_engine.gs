// ============================================================
// recipe_engine.gs — Recipe Engine
// Semua perhitungan HPP dilakukan di sini.
// Tidak ada kalkulasi di HTML/client. Service Layer tetap
// digunakan untuk semua akses data.
// ============================================================


// ════════════════════════════════════════════════════════════
// CORE ENGINE — Kalkulasi utama
// ════════════════════════════════════════════════════════════

/**
 * Hitung HPP lengkap satu produk berdasarkan MASTER_RESEP.
 *
 * Rumus per bahan:
 *   harga_per_satuan_pakai = HARGA_RATA2 / KONVERSI
 *   biaya_bahan            = JUMLAH × harga_per_satuan_pakai
 *
 * Rumus batch:
 *   biaya_resep   = Σ biaya_bahan
 *   hpp_per_batch = biaya_resep
 *   hpp_per_pcs   = biaya_resep / YIELD_PCS
 *   margin_pct    = (HARGA_JUAL - hpp_per_pcs) / HARGA_JUAL × 100
 *
 * @param {string} idProduk
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function kalkulasiResep(idProduk) {
  try {
    // 1. Validasi produk
    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk);
    if (!produk) return fail(`Produk ${idProduk} tidak ditemukan`);

    // 2. Ambil semua item resep produk ini
    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === idProduk);
    if (itemResep.length === 0) {
      return fail(`Resep untuk produk ${idProduk} belum ada. Tambahkan bahan terlebih dahulu.`);
    }

    // 3. Hitung per bahan
    const detailBahan = [];
    let biayaResep   = 0;
    let totalGram    = 0;
    const warnings   = [];

    for (const item of itemResep) {
      const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN);
      if (!bahan) {
        warnings.push(`Bahan ${item.ID_BAHAN} tidak ditemukan — item resep dilewati`);
        log.warn('recipe_engine', 'CALC', `Bahan ${item.ID_BAHAN} tidak ada`, { idProduk });
        continue;
      }

      const jumlah         = Number(item.JUMLAH)         || 0;
      const konversi       = Number(bahan.KONVERSI)       || 1;
      const hargaRata2     = Number(bahan.HARGA_RATA2)    || Number(bahan.HARGA_TERAKHIR) || 0;

      // Harga per 1 satuan pakai (gram, ml, pcs, dll)
      const hargaPerSatuanPakai = konversi > 0 ? hargaRata2 / konversi : 0;

      // Biaya bahan ini untuk 1 batch
      const biayaBahan = jumlah * hargaPerSatuanPakai;

      biayaResep += biayaBahan;
      totalGram  += jumlah;  // akumulasi total unit pakai (bisa gram, ml, dll)

      detailBahan.push({
        ID_RESEP             : item.ID_RESEP,
        ID_BAHAN             : bahan.ID_BAHAN,
        NAMA_BAHAN           : bahan.NAMA_BAHAN,
        KATEGORI_BAHAN       : bahan.KATEGORI || '',
        SATUAN_BELI          : bahan.SATUAN_BELI,
        SATUAN_PAKAI         : bahan.SATUAN_PAKAI || item.SATUAN,
        KONVERSI             : konversi,
        HARGA_RATA2          : hargaRata2,
        HARGA_PER_SATUAN_PAKAI: _round2(hargaPerSatuanPakai),
        JUMLAH               : jumlah,
        BIAYA_BAHAN          : _round2(biayaBahan),
        CATATAN              : item.CATATAN || '',
      });
    }

    if (detailBahan.length === 0) {
      return fail(`Tidak ada bahan valid di resep produk ${idProduk}`);
    }

    // 4. Hitung HPP batch & per pcs
    const yieldPcs   = Number(produk.YIELD_PCS)  || 1;
    const hargaJual  = Number(produk.HARGA_JUAL) || 0;
    const hppPerBatch = _round2(biayaResep);
    const hppPerPcs   = _round2(yieldPcs > 0 ? biayaResep / yieldPcs : 0);
    const marginPct   = _round2(hargaJual > 0 ? ((hargaJual - hppPerPcs) / hargaJual) * 100 : 0);
    const marginRp    = _round2(hargaJual - hppPerPcs);

    // 5. Susun hasil
    const hasil = {
      // Info produk
      ID_PRODUK    : produk.ID_PRODUK,
      NAMA_PRODUK  : produk.NAMA_PRODUK,
      KATEGORI     : produk.KATEGORI || '',
      HARGA_JUAL   : hargaJual,
      YIELD_PCS    : yieldPcs,
      SATUAN_JUAL  : produk.SATUAN_JUAL || '',

      // Detail bahan
      DETAIL_BAHAN : detailBahan,
      TOTAL_BAHAN  : detailBahan.length,

      // Ringkasan kalkulasi
      TOTAL_GRAM       : _round2(totalGram),    // total unit pakai semua bahan
      BIAYA_RESEP      : hppPerBatch,           // biaya 1 batch
      HPP_PER_BATCH    : hppPerBatch,
      HPP_PER_PCS      : hppPerPcs,

      // Analisis margin
      MARGIN_PCT       : marginPct,
      MARGIN_RP        : marginRp,

      // Metadata
      WARNINGS         : warnings,
      DIHITUNG_PADA    : now(),
    };

    log.info('recipe_engine', 'CALC',
      `kalkulasiResep: ${idProduk} | HPP/pcs=${hppPerPcs} | margin=${marginPct}%`
    );

    return ok(hasil, `Kalkulasi resep ${produk.NAMA_PRODUK} selesai`);

  } catch (e) {
    log.error('recipe_engine', 'CALC', 'kalkulasiResep gagal', { idProduk, error: e.message });
    return fail('Kalkulasi gagal: ' + e.message);
  }
}


/**
 * Hitung HPP dan langsung simpan ke MASTER_PRODUK.
 * Update kolom HPP, MARGIN_PCT di row produk.
 *
 * @param {string} idProduk
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function hitungDanSimpanHPP(idProduk) {
  try {
    const result = kalkulasiResep(idProduk);
    if (!result.success) return result;

    const data = result.data;

    // Simpan HPP & margin ke MASTER_PRODUK
    updateRow(SHEET.PRODUK, 'ID_PRODUK', idProduk, {
      HPP        : data.HPP_PER_PCS,
      MARGIN_PCT : data.MARGIN_PCT,
    });

    log.info('recipe_engine', 'UPDATE',
      `HPP disimpan: ${idProduk} → HPP/pcs=${data.HPP_PER_PCS}, margin=${data.MARGIN_PCT}%`
    );

    return ok(data, `HPP produk "${data.NAMA_PRODUK}" berhasil dihitung & disimpan`);

  } catch (e) {
    log.error('recipe_engine', 'UPDATE', 'hitungDanSimpanHPP gagal', { idProduk, error: e.message });
    return fail('Gagal menyimpan HPP: ' + e.message);
  }
}


/**
 * Recalculate HPP untuk SEMUA produk aktif sekaligus.
 * Dipakai setelah update harga bahan massal.
 *
 * @returns {{success:boolean, data:Object, message:string}}
 */
function recalcSemuaHPP() {
  try {
    const semuaProduk = readWhere(SHEET.PRODUK, r => String(r.AKTIF) !== 'FALSE');
    const hasil = { berhasil: [], gagal: [], dilewati: [] };

    for (const produk of semuaProduk) {
      const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === produk.ID_PRODUK);
      if (itemResep.length === 0) {
        hasil.dilewati.push({ id: produk.ID_PRODUK, nama: produk.NAMA_PRODUK, alasan: 'Belum ada resep' });
        continue;
      }

      const res = hitungDanSimpanHPP(produk.ID_PRODUK);
      if (res.success) {
        hasil.berhasil.push({
          id         : produk.ID_PRODUK,
          nama       : produk.NAMA_PRODUK,
          hpp_per_pcs: res.data.HPP_PER_PCS,
          margin_pct : res.data.MARGIN_PCT,
        });
      } else {
        hasil.gagal.push({ id: produk.ID_PRODUK, nama: produk.NAMA_PRODUK, error: res.message });
      }
    }

    const msg = `Recalc selesai: ${hasil.berhasil.length} berhasil, ` +
                `${hasil.gagal.length} gagal, ${hasil.dilewati.length} dilewati`;
    log.info('recipe_engine', 'RECALC', msg, hasil);

    return ok(hasil, msg);

  } catch (e) {
    log.error('recipe_engine', 'RECALC', 'recalcSemuaHPP gagal', { error: e.message });
    return fail('Recalc semua HPP gagal: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// RESEP ENRICHED — Baca resep + data bahan sekaligus
// ════════════════════════════════════════════════════════════

/**
 * Ambil resep lengkap suatu produk — setiap item sudah di-enrich
 * dengan nama bahan, satuan, harga, dan biaya kalkulasi.
 * Dipakai client untuk render tabel resep.
 *
 * @param {string} idProduk
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function getResepLengkap(idProduk) {
  try {
    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk);
    if (!produk) return fail(`Produk ${idProduk} tidak ditemukan`);

    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === idProduk);

    // Enrich setiap item dengan data bahan (tanpa memanggil kalkulasiResep penuh)
    const items = itemResep.map(item => {
      const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN);
      if (!bahan) {
        return {
          ...item,
          NAMA_BAHAN           : `[Bahan ${item.ID_BAHAN} tidak ditemukan]`,
          SATUAN_PAKAI         : item.SATUAN || '',
          HARGA_PER_SATUAN_PAKAI: 0,
          BIAYA_BAHAN          : 0,
          _ERROR               : true,
        };
      }

      const jumlah              = Number(item.JUMLAH)         || 0;
      const konversi            = Number(bahan.KONVERSI)       || 1;
      const hargaRata2          = Number(bahan.HARGA_RATA2)    || Number(bahan.HARGA_TERAKHIR) || 0;
      const hargaPerSatuanPakai = konversi > 0 ? hargaRata2 / konversi : 0;
      const biayaBahan          = jumlah * hargaPerSatuanPakai;

      return {
        ID_RESEP             : item.ID_RESEP,
        ID_PRODUK            : item.ID_PRODUK,
        ID_BAHAN             : bahan.ID_BAHAN,
        NAMA_BAHAN           : bahan.NAMA_BAHAN,
        KATEGORI_BAHAN       : bahan.KATEGORI || '',
        SATUAN_BELI          : bahan.SATUAN_BELI,
        SATUAN_PAKAI         : bahan.SATUAN_PAKAI || item.SATUAN,
        KONVERSI             : konversi,
        HARGA_RATA2          : hargaRata2,
        HARGA_PER_SATUAN_PAKAI: _round2(hargaPerSatuanPakai),
        JUMLAH               : jumlah,
        BIAYA_BAHAN          : _round2(biayaBahan),
        CATATAN              : item.CATATAN || '',
        CREATED_AT           : item.CREATED_AT || '',
        UPDATED_AT           : item.UPDATED_AT || '',
      };
    });

    return ok({
      PRODUK : produk,
      ITEMS  : items,
      COUNT  : items.length,
    }, `Resep ${produk.NAMA_PRODUK} ditemukan (${items.length} bahan)`);

  } catch (e) {
    log.error('recipe_engine', 'READ', 'getResepLengkap gagal', { idProduk, error: e.message });
    return fail('Gagal mengambil resep: ' + e.message);
  }
}


/**
 * Ringkasan HPP semua produk aktif (untuk dashboard / tabel HPP).
 * Tidak menyimpan ke sheet — hanya kalkulasi on-demand.
 *
 * @returns {{success:boolean, data:Object[], message:string}}
 */
function getRingkasanHPPSemua() {
  try {
    const semuaProduk = readWhere(SHEET.PRODUK, r => String(r.AKTIF) !== 'FALSE');
    const ringkasan = [];

    for (const produk of semuaProduk) {
      const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === produk.ID_PRODUK);

      if (itemResep.length === 0) {
        ringkasan.push({
          ID_PRODUK    : produk.ID_PRODUK,
          NAMA_PRODUK  : produk.NAMA_PRODUK,
          KATEGORI     : produk.KATEGORI || '',
          HARGA_JUAL   : Number(produk.HARGA_JUAL) || 0,
          YIELD_PCS    : Number(produk.YIELD_PCS)  || 1,
          HPP_PER_PCS  : Number(produk.HPP)        || 0,
          HPP_PER_BATCH: 0,
          MARGIN_PCT   : Number(produk.MARGIN_PCT)  || 0,
          MARGIN_RP    : 0,
          TOTAL_BAHAN  : 0,
          STATUS_RESEP : 'BELUM_ADA',
        });
        continue;
      }

      const res = kalkulasiResep(produk.ID_PRODUK);
      if (res.success) {
        ringkasan.push({
          ID_PRODUK    : produk.ID_PRODUK,
          NAMA_PRODUK  : produk.NAMA_PRODUK,
          KATEGORI     : produk.KATEGORI || '',
          HARGA_JUAL   : Number(produk.HARGA_JUAL) || 0,
          YIELD_PCS    : res.data.YIELD_PCS,
          HPP_PER_PCS  : res.data.HPP_PER_PCS,
          HPP_PER_BATCH: res.data.HPP_PER_BATCH,
          MARGIN_PCT   : res.data.MARGIN_PCT,
          MARGIN_RP    : res.data.MARGIN_RP,
          TOTAL_BAHAN  : res.data.TOTAL_BAHAN,
          STATUS_RESEP : 'ADA',
        });
      } else {
        ringkasan.push({
          ID_PRODUK    : produk.ID_PRODUK,
          NAMA_PRODUK  : produk.NAMA_PRODUK,
          KATEGORI     : produk.KATEGORI || '',
          HARGA_JUAL   : Number(produk.HARGA_JUAL) || 0,
          YIELD_PCS    : Number(produk.YIELD_PCS)  || 1,
          HPP_PER_PCS  : 0,
          HPP_PER_BATCH: 0,
          MARGIN_PCT   : 0,
          MARGIN_RP    : 0,
          TOTAL_BAHAN  : itemResep.length,
          STATUS_RESEP : 'ERROR',
          ERROR_MSG    : res.message,
        });
      }
    }

    return ok(ringkasan, `Ringkasan HPP: ${ringkasan.length} produk`);

  } catch (e) {
    log.error('recipe_engine', 'READ', 'getRingkasanHPPSemua gagal', { error: e.message });
    return fail('Gagal mengambil ringkasan HPP: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// SIMULASI — What-if tanpa menyimpan
// ════════════════════════════════════════════════════════════

/**
 * Simulasi HPP: gunakan harga bahan yang diinput user (bukan dari sheet).
 * Berguna untuk what-if analisis kenaikan harga bahan.
 *
 * @param {string} idProduk
 * @param {Object[]} overrideHarga - [{ID_BAHAN, HARGA_RATA2}, ...]
 * @param {number} [overrideYield] - override YIELD_PCS
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function simulasiResep(idProduk, overrideHarga = [], overrideYield = null) {
  try {
    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk);
    if (!produk) return fail(`Produk ${idProduk} tidak ditemukan`);

    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === idProduk);
    if (itemResep.length === 0) return fail(`Belum ada resep untuk produk ${idProduk}`);

    // Buat lookup harga override
    const hargaMap = {};
    overrideHarga.forEach(o => { hargaMap[o.ID_BAHAN] = Number(o.HARGA_RATA2) || 0; });

    const detailBahan = [];
    let biayaResep = 0;
    let totalGram  = 0;

    for (const item of itemResep) {
      const bahan = readOne(SHEET.BAHAN, 'ID_BAHAN', item.ID_BAHAN);
      if (!bahan) continue;

      const jumlah       = Number(item.JUMLAH)      || 0;
      const konversi     = Number(bahan.KONVERSI)    || 1;
      // Pakai harga override jika ada, fallback ke HARGA_RATA2
      const hargaRata2   = hargaMap[bahan.ID_BAHAN] !== undefined
                             ? hargaMap[bahan.ID_BAHAN]
                             : (Number(bahan.HARGA_RATA2) || Number(bahan.HARGA_TERAKHIR) || 0);

      const hargaPerSatuanPakai = konversi > 0 ? hargaRata2 / konversi : 0;
      const biayaBahan          = jumlah * hargaPerSatuanPakai;

      biayaResep += biayaBahan;
      totalGram  += jumlah;

      detailBahan.push({
        ID_BAHAN             : bahan.ID_BAHAN,
        NAMA_BAHAN           : bahan.NAMA_BAHAN,
        JUMLAH               : jumlah,
        SATUAN_PAKAI         : bahan.SATUAN_PAKAI || item.SATUAN,
        HARGA_RATA2          : hargaRata2,
        HARGA_OVERRIDE       : hargaMap[bahan.ID_BAHAN] !== undefined,
        HARGA_PER_SATUAN_PAKAI: _round2(hargaPerSatuanPakai),
        BIAYA_BAHAN          : _round2(biayaBahan),
      });
    }

    const yieldPcs   = overrideYield !== null ? Number(overrideYield) : (Number(produk.YIELD_PCS) || 1);
    const hargaJual  = Number(produk.HARGA_JUAL) || 0;
    const hppPerBatch = _round2(biayaResep);
    const hppPerPcs   = _round2(yieldPcs > 0 ? biayaResep / yieldPcs : 0);
    const marginPct   = _round2(hargaJual > 0 ? ((hargaJual - hppPerPcs) / hargaJual) * 100 : 0);

    // Perbandingan dengan HPP tersimpan
    const hppLama     = Number(produk.HPP) || 0;
    const selisihHPP  = _round2(hppPerPcs - hppLama);
    const persenNaik  = _round2(hppLama > 0 ? (selisihHPP / hppLama) * 100 : 0);

    return ok({
      ID_PRODUK       : produk.ID_PRODUK,
      NAMA_PRODUK     : produk.NAMA_PRODUK,
      DETAIL_BAHAN    : detailBahan,
      TOTAL_GRAM      : _round2(totalGram),
      BIAYA_RESEP     : hppPerBatch,
      HPP_PER_BATCH   : hppPerBatch,
      HPP_PER_PCS     : hppPerPcs,
      YIELD_PCS       : yieldPcs,
      MARGIN_PCT      : marginPct,
      HARGA_JUAL      : hargaJual,
      // Perbandingan
      HPP_LAMA        : hppLama,
      SELISIH_HPP     : selisihHPP,
      PERSEN_NAIK     : persenNaik,
      IS_SIMULASI     : true,
    }, 'Simulasi selesai — tidak disimpan ke sheet');

  } catch (e) {
    log.error('recipe_engine', 'SIM', 'simulasiResep gagal', { idProduk, error: e.message });
    return fail('Simulasi gagal: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Pembulatan 2 desimal (hindari floating-point artefak).
 * @param {number} n
 * @returns {number}
 */
function _round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
