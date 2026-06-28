// ============================================================
// recipe.gs — Recipe Engine (v3 Multi-Outlet)
// Rename dari recipe_engine.gs.
//
// PERUBAHAN UTAMA dari V1:
//  - Semua fungsi public terima `session` sebagai parameter terakhir
//  - Fix N+1: batch readAll BAHAN + RESEP, lalu lookup map — tidak ada readOne per bahan
//  - outletId selalu di-scope ke session.outletId
//  - Write guard: hasPermission(ROLES.ADMIN) + failForbidden()
//  - _round2() diganti round2() dari utils.gs
//  - fail() pakai code string sebagai argumen kedua
//  - recalcSemuaHPP & getRingkasanHPPSemua di-refactor agar tidak loop kalkulasiResep per produk
//
// Dependensi: config.gs, utils.gs, service.gs, auth.gs, master.gs (untuk SHEET/ROLES)
// ============================================================


// ════════════════════════════════════════════════════════════
// PRIVATE HELPER — Batch Loader
// ════════════════════════════════════════════════════════════

/**
 * Load semua BAHAN dan RESEP untuk satu outlet sekaligus,
 * kembalikan sebagai lookup map. Dipanggil sekali per request
 * untuk menghindari N+1.
 *
 * @param {string} outletId
 * @returns {{ bahanMap: Object, allResep: Object[] }}
 */
function _loadBahanAndResep(outletId) {
  const allBahan = readAll(SHEET.BAHAN, outletId);
  const allResep = readAll(SHEET.RESEP, outletId);

  // Build lookup map ID_BAHAN → row
  const bahanMap = {};
  allBahan.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

  return { bahanMap, allResep };
}

/**
 * Build lookup map RESEP per produk dari array flat.
 * { [ID_PRODUK]: [item, item, ...] }
 *
 * @param {Object[]} allResep
 * @returns {Object}
 */
function _groupResepByProduk(allResep) {
  const map = {};
  allResep.forEach(item => {
    if (!map[item.ID_PRODUK]) map[item.ID_PRODUK] = [];
    map[item.ID_PRODUK].push(item);
  });
  return map;
}

/**
 * Kalkulasi HPP untuk satu produk dari data yang sudah di-load (no I/O).
 * Dipakai secara internal oleh kalkulasiResep, recalcSemuaHPP, getRingkasanHPPSemua.
 *
 * @param {Object} produk - row MASTER_PRODUK
 * @param {Object[]} itemResep - array item resep untuk produk ini
 * @param {Object} bahanMap - { [ID_BAHAN]: bahanRow }
 * @returns {{ ok: boolean, data: Object|null, warnings: string[], message: string }}
 */
function _hitungHPPFromMap(produk, itemResep, bahanMap) {
  if (!itemResep || itemResep.length === 0) {
    return { ok: false, data: null, warnings: [], message: 'Belum ada resep' };
  }

  const detailBahan = [];
  let biayaResep   = 0;
  let totalGram    = 0;
  const warnings   = [];

  for (const item of itemResep) {
    const bahan = bahanMap[item.ID_BAHAN];
    if (!bahan) {
      warnings.push(`Bahan ${item.ID_BAHAN} tidak ditemukan — item resep dilewati`);
      continue;
    }

    const jumlah              = Number(item.JUMLAH)         || 0;
    const konversi            = Number(bahan.KONVERSI)       || 1;
    const hargaRata2          = Number(bahan.HARGA_RATA2)    || Number(bahan.HARGA_TERAKHIR) || 0;
    const hargaPerSatuanPakai = konversi > 0 ? hargaRata2 / konversi : 0;
    const biayaBahan          = jumlah * hargaPerSatuanPakai;

    biayaResep += biayaBahan;
    totalGram  += jumlah;

    detailBahan.push({
      ID_RESEP              : item.ID_RESEP,
      ID_BAHAN              : bahan.ID_BAHAN,
      NAMA_BAHAN            : bahan.NAMA_BAHAN,
      KATEGORI_BAHAN        : bahan.KATEGORI || '',
      SATUAN_BELI           : bahan.SATUAN_BELI,
      SATUAN_PAKAI          : bahan.SATUAN_PAKAI || item.SATUAN,
      KONVERSI              : konversi,
      HARGA_RATA2           : hargaRata2,
      HARGA_PER_SATUAN_PAKAI: round2(hargaPerSatuanPakai),
      JUMLAH                : jumlah,
      BIAYA_BAHAN           : round2(biayaBahan),
      CATATAN               : item.CATATAN || '',
    });
  }

  if (detailBahan.length === 0) {
    return { ok: false, data: null, warnings, message: 'Tidak ada bahan valid di resep' };
  }

  const yieldPcs    = Number(produk.YIELD_PCS)  || 1;
  const hargaJual   = Number(produk.HARGA_JUAL) || 0;
  const hppPerBatch = round2(biayaResep);
  const hppPerPcs   = round2(yieldPcs > 0 ? biayaResep / yieldPcs : 0);
  const marginPct   = round2(hargaJual > 0 ? ((hargaJual - hppPerPcs) / hargaJual) * 100 : 0);
  const marginRp    = round2(hargaJual - hppPerPcs);

  return {
    ok: true,
    warnings,
    message: 'OK',
    data: {
      ID_PRODUK    : produk.ID_PRODUK,
      NAMA_PRODUK  : produk.NAMA_PRODUK,
      KATEGORI     : produk.KATEGORI || '',
      HARGA_JUAL   : hargaJual,
      YIELD_PCS    : yieldPcs,
      SATUAN_JUAL  : produk.SATUAN_JUAL || '',
      DETAIL_BAHAN : detailBahan,
      TOTAL_BAHAN  : detailBahan.length,
      TOTAL_GRAM   : round2(totalGram),
      BIAYA_RESEP  : hppPerBatch,
      HPP_PER_BATCH: hppPerBatch,
      HPP_PER_PCS  : hppPerPcs,
      MARGIN_PCT   : marginPct,
      MARGIN_RP    : marginRp,
      WARNINGS     : warnings,
      DIHITUNG_PADA: now(),
    },
  };
}


// ════════════════════════════════════════════════════════════
// CORE ENGINE — Kalkulasi utama
// ════════════════════════════════════════════════════════════

/**
 * Hitung HPP lengkap satu produk berdasarkan MASTER_RESEP.
 *
 * FIX N+1 dari V1: batch readAll BAHAN + RESEP untuk outlet ini,
 * lalu lookup dari map — bukan readOne per bahan.
 *
 * Rumus per bahan:
 *   harga_per_satuan_pakai = HARGA_RATA2 / KONVERSI
 *   biaya_bahan            = JUMLAH × harga_per_satuan_pakai
 *
 * Rumus batch:
 *   hpp_per_batch = Σ biaya_bahan
 *   hpp_per_pcs   = hpp_per_batch / YIELD_PCS
 *   margin_pct    = (HARGA_JUAL - hpp_per_pcs) / HARGA_JUAL × 100
 *
 * @param {string} idProduk
 * @param {Object} session - dari validateRequest()
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function kalkulasiResep(idProduk, session) {
  try {
    const outletId = session.outletId;

    // 1. Validasi produk (scoped ke outlet)
    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk, outletId);
    if (!produk) return fail(`Produk ${idProduk} tidak ditemukan`, 'NOT_FOUND');

    // 2. Batch load — SATU kali baca semua bahan + resep untuk outlet ini
    const { bahanMap, allResep } = _loadBahanAndResep(outletId);
    const itemResep = allResep.filter(r => r.ID_PRODUK === idProduk);

    if (itemResep.length === 0) {
      return fail(
        `Resep untuk produk ${idProduk} belum ada. Tambahkan bahan terlebih dahulu.`,
        'NOT_FOUND'
      );
    }

    // 3. Hitung dari map (no I/O di sini)
    const calc = _hitungHPPFromMap(produk, itemResep, bahanMap);

    if (!calc.ok) {
      return fail(`Tidak ada bahan valid di resep produk ${idProduk}`, 'VALIDATION_ERROR');
    }

    // Log warning bahan tidak ditemukan
    if (calc.warnings.length > 0) {
      calc.warnings.forEach(w =>
        log.warn('recipe', 'CALC', w, { idProduk }, session)
      );
    }

    log.info('recipe', 'CALC',
      `kalkulasiResep: ${idProduk} | HPP/pcs=${calc.data.HPP_PER_PCS} | margin=${calc.data.MARGIN_PCT}%`,
      null, session
    );

    return ok(calc.data, `Kalkulasi resep ${produk.NAMA_PRODUK} selesai`);

  } catch (e) {
    log.error('recipe', 'CALC', 'kalkulasiResep gagal', { idProduk, error: e.message }, session);
    return fail('Kalkulasi gagal: ' + e.message, 'SERVER_ERROR');
  }
}


/**
 * Hitung HPP dan langsung simpan ke MASTER_PRODUK.
 * Update kolom HPP dan MARGIN_PCT di row produk.
 *
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {string} idProduk
 * @param {Object} session
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function hitungDanSimpanHPP(idProduk, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const result = kalkulasiResep(idProduk, session);
    if (!result.success) return result;

    const data = result.data;

    // Simpan HPP & margin ke MASTER_PRODUK (scoped ke outlet)
    updateRow(SHEET.PRODUK, 'ID_PRODUK', idProduk, {
      HPP        : data.HPP_PER_PCS,
      MARGIN_PCT : data.MARGIN_PCT,
    }, session.outletId);

    log.info('recipe', 'UPDATE',
      `HPP disimpan: ${idProduk} → HPP/pcs=${data.HPP_PER_PCS}, margin=${data.MARGIN_PCT}%`,
      null, session
    );

    return ok(data, `HPP produk "${data.NAMA_PRODUK}" berhasil dihitung & disimpan`);

  } catch (e) {
    log.error('recipe', 'UPDATE', 'hitungDanSimpanHPP gagal', { idProduk, error: e.message }, session);
    return fail('Gagal menyimpan HPP: ' + e.message, 'SERVER_ERROR');
  }
}


/**
 * Recalculate HPP untuk SEMUA produk aktif di outlet sekaligus.
 * Dipakai setelah update harga bahan massal.
 *
 * FIX N+1 dari V1: satu batch readAll BAHAN + RESEP + PRODUK,
 * lalu loop kalkulasi dari map — tidak ada readOne atau readWhere per produk.
 *
 * WRITE → wajib role ADMIN ke atas.
 *
 * @param {Object} session
 * @returns {{success:boolean, data:Object, message:string}}
 */
function recalcSemuaHPP(session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) return failForbidden();

    const outletId = session.outletId;

    // Batch load semua data outlet sekaligus
    const semuaProduk = readAll(SHEET.PRODUK, outletId).filter(
      p => String(p.AKTIF) !== 'FALSE'
    );
    const { bahanMap, allResep } = _loadBahanAndResep(outletId);
    const resepByProduk = _groupResepByProduk(allResep);

    const hasil = { berhasil: [], gagal: [], dilewati: [] };

    for (const produk of semuaProduk) {
      const itemResep = resepByProduk[produk.ID_PRODUK];

      if (!itemResep || itemResep.length === 0) {
        hasil.dilewati.push({
          id    : produk.ID_PRODUK,
          nama  : produk.NAMA_PRODUK,
          alasan: 'Belum ada resep',
        });
        continue;
      }

      const calc = _hitungHPPFromMap(produk, itemResep, bahanMap);

      if (calc.ok) {
        // Simpan per produk (masih satu updateRow per produk — tidak ada cara batch)
        updateRow(SHEET.PRODUK, 'ID_PRODUK', produk.ID_PRODUK, {
          HPP        : calc.data.HPP_PER_PCS,
          MARGIN_PCT : calc.data.MARGIN_PCT,
        }, outletId);

        hasil.berhasil.push({
          id         : produk.ID_PRODUK,
          nama       : produk.NAMA_PRODUK,
          hpp_per_pcs: calc.data.HPP_PER_PCS,
          margin_pct : calc.data.MARGIN_PCT,
        });
      } else {
        hasil.gagal.push({
          id   : produk.ID_PRODUK,
          nama : produk.NAMA_PRODUK,
          error: calc.message,
        });
      }
    }

    const msg = `Recalc selesai: ${hasil.berhasil.length} berhasil, ` +
                `${hasil.gagal.length} gagal, ${hasil.dilewati.length} dilewati`;
    log.info('recipe', 'RECALC', msg, hasil, session);

    return ok(hasil, msg);

  } catch (e) {
    log.error('recipe', 'RECALC', 'recalcSemuaHPP gagal', { error: e.message }, session);
    return fail('Recalc semua HPP gagal: ' + e.message, 'SERVER_ERROR');
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
 * FIX N+1 dari V1: batch load BAHAN outlet, lookup dari map.
 *
 * @param {string} idProduk
 * @param {Object} session
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function getResepLengkap(idProduk, session) {
  try {
    const outletId = session.outletId;

    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk, outletId);
    if (!produk) return fail(`Produk ${idProduk} tidak ditemukan`, 'NOT_FOUND');

    // Batch load bahan (satu read untuk semua bahan outlet ini)
    const allBahan  = readAll(SHEET.BAHAN, outletId);
    const bahanMap  = {};
    allBahan.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === idProduk, outletId);

    // Enrich setiap item dari map (tidak ada I/O di dalam loop)
    const items = itemResep.map(item => {
      const bahan = bahanMap[item.ID_BAHAN];

      if (!bahan) {
        return {
          ...item,
          NAMA_BAHAN            : `[Bahan ${item.ID_BAHAN} tidak ditemukan]`,
          SATUAN_BELI           : '',
          SATUAN_PAKAI          : item.SATUAN || '',
          HARGA_PER_SATUAN_PAKAI: 0,
          BIAYA_BAHAN           : 0,
          _ERROR                : true,
        };
      }

      const jumlah              = Number(item.JUMLAH)         || 0;
      const konversi            = Number(bahan.KONVERSI)       || 1;
      const hargaRata2          = Number(bahan.HARGA_RATA2)    || Number(bahan.HARGA_TERAKHIR) || 0;
      const hargaPerSatuanPakai = konversi > 0 ? hargaRata2 / konversi : 0;
      const biayaBahan          = jumlah * hargaPerSatuanPakai;

      return {
        ID_RESEP              : item.ID_RESEP,
        ID_PRODUK             : item.ID_PRODUK,
        ID_BAHAN              : bahan.ID_BAHAN,
        NAMA_BAHAN            : bahan.NAMA_BAHAN,
        KATEGORI_BAHAN        : bahan.KATEGORI || '',
        SATUAN_BELI           : bahan.SATUAN_BELI,
        SATUAN_PAKAI          : bahan.SATUAN_PAKAI || item.SATUAN,
        KONVERSI              : konversi,
        HARGA_RATA2           : hargaRata2,
        HARGA_PER_SATUAN_PAKAI: round2(hargaPerSatuanPakai),
        JUMLAH                : jumlah,
        BIAYA_BAHAN           : round2(biayaBahan),
        CATATAN               : item.CATATAN || '',
        CREATED_AT            : item.CREATED_AT || '',
        UPDATED_AT            : item.UPDATED_AT || '',
      };
    });

    return ok({
      PRODUK: produk,
      ITEMS : items,
      COUNT : items.length,
    }, `Resep ${produk.NAMA_PRODUK} ditemukan (${items.length} bahan)`);

  } catch (e) {
    log.error('recipe', 'READ', 'getResepLengkap gagal', { idProduk, error: e.message }, session);
    return fail('Gagal mengambil resep: ' + e.message, 'SERVER_ERROR');
  }
}


/**
 * Ringkasan HPP semua produk aktif (untuk dashboard / tabel HPP).
 * Tidak menyimpan ke sheet — hanya kalkulasi on-demand.
 *
 * FIX N+1 dari V1: tidak memanggil kalkulasiResep() per produk.
 * Satu batch readAll PRODUK + BAHAN + RESEP, lalu kalkulasi dari map.
 *
 * @param {Object} session
 * @returns {{success:boolean, data:Object[], message:string}}
 */
function getRingkasanHPPSemua(session) {
  try {
    const outletId = session.outletId;

    // Satu batch load semua data
    const semuaProduk = readAll(SHEET.PRODUK, outletId).filter(
      p => String(p.AKTIF) !== 'FALSE'
    );
    const { bahanMap, allResep } = _loadBahanAndResep(outletId);
    const resepByProduk = _groupResepByProduk(allResep);

    const ringkasan = [];

    for (const produk of semuaProduk) {
      const itemResep = resepByProduk[produk.ID_PRODUK];

      if (!itemResep || itemResep.length === 0) {
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

      const calc = _hitungHPPFromMap(produk, itemResep, bahanMap);

      if (calc.ok) {
        ringkasan.push({
          ID_PRODUK    : produk.ID_PRODUK,
          NAMA_PRODUK  : produk.NAMA_PRODUK,
          KATEGORI     : produk.KATEGORI || '',
          HARGA_JUAL   : Number(produk.HARGA_JUAL) || 0,
          YIELD_PCS    : calc.data.YIELD_PCS,
          HPP_PER_PCS  : calc.data.HPP_PER_PCS,
          HPP_PER_BATCH: calc.data.HPP_PER_BATCH,
          MARGIN_PCT   : calc.data.MARGIN_PCT,
          MARGIN_RP    : calc.data.MARGIN_RP,
          TOTAL_BAHAN  : calc.data.TOTAL_BAHAN,
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
          ERROR_MSG    : calc.message,
        });
      }
    }

    return ok(ringkasan, `Ringkasan HPP: ${ringkasan.length} produk`);

  } catch (e) {
    log.error('recipe', 'READ', 'getRingkasanHPPSemua gagal', { error: e.message }, session);
    return fail('Gagal mengambil ringkasan HPP: ' + e.message, 'SERVER_ERROR');
  }
}


// ════════════════════════════════════════════════════════════
// SIMULASI — What-if tanpa menyimpan
// ════════════════════════════════════════════════════════════

/**
 * Simulasi HPP: gunakan harga bahan yang diinput user (bukan dari sheet).
 * Berguna untuk what-if analisis kenaikan harga bahan.
 *
 * FIX N+1 dari V1: batch load BAHAN outlet, apply override dari map.
 *
 * @param {string} idProduk
 * @param {Object[]} overrideHarga - [{ID_BAHAN, HARGA_RATA2}, ...]
 * @param {number|null} [overrideYield]
 * @param {Object} session
 * @returns {{success:boolean, data:Object|null, message:string}}
 */
function simulasiResep(idProduk, overrideHarga = [], overrideYield = null, session) {
  try {
    const outletId = session.outletId;

    const produk = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk, outletId);
    if (!produk) return fail(`Produk ${idProduk} tidak ditemukan`, 'NOT_FOUND');

    const itemResep = readWhere(SHEET.RESEP, r => r.ID_PRODUK === idProduk, outletId);
    if (itemResep.length === 0) {
      return fail(`Belum ada resep untuk produk ${idProduk}`, 'NOT_FOUND');
    }

    // Build harga override map
    const hargaOverrideMap = {};
    overrideHarga.forEach(o => { hargaOverrideMap[o.ID_BAHAN] = Number(o.HARGA_RATA2) || 0; });

    // Batch load semua bahan outlet
    const allBahan = readAll(SHEET.BAHAN, outletId);
    const bahanMap = {};
    allBahan.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

    const detailBahan = [];
    let biayaResep = 0;
    let totalGram  = 0;

    for (const item of itemResep) {
      const bahan = bahanMap[item.ID_BAHAN];
      if (!bahan) continue;

      const jumlah     = Number(item.JUMLAH)   || 0;
      const konversi   = Number(bahan.KONVERSI) || 1;

      // Pakai harga override jika ada, fallback ke HARGA_RATA2 dari sheet
      const isOverride = hargaOverrideMap[bahan.ID_BAHAN] !== undefined;
      const hargaRata2 = isOverride
        ? hargaOverrideMap[bahan.ID_BAHAN]
        : (Number(bahan.HARGA_RATA2) || Number(bahan.HARGA_TERAKHIR) || 0);

      const hargaPerSatuanPakai = konversi > 0 ? hargaRata2 / konversi : 0;
      const biayaBahan          = jumlah * hargaPerSatuanPakai;

      biayaResep += biayaBahan;
      totalGram  += jumlah;

      detailBahan.push({
        ID_BAHAN              : bahan.ID_BAHAN,
        NAMA_BAHAN            : bahan.NAMA_BAHAN,
        JUMLAH                : jumlah,
        SATUAN_PAKAI          : bahan.SATUAN_PAKAI || item.SATUAN,
        HARGA_RATA2           : hargaRata2,
        HARGA_OVERRIDE        : isOverride,
        HARGA_PER_SATUAN_PAKAI: round2(hargaPerSatuanPakai),
        BIAYA_BAHAN           : round2(biayaBahan),
      });
    }

    if (detailBahan.length === 0) {
      return fail('Tidak ada bahan valid di resep untuk simulasi', 'VALIDATION_ERROR');
    }

    const yieldPcs    = overrideYield !== null
      ? (Number(overrideYield) || 1)
      : (Number(produk.YIELD_PCS) || 1);
    const hargaJual   = Number(produk.HARGA_JUAL) || 0;
    const hppPerBatch = round2(biayaResep);
    const hppPerPcs   = round2(yieldPcs > 0 ? biayaResep / yieldPcs : 0);
    const marginPct   = round2(hargaJual > 0 ? ((hargaJual - hppPerPcs) / hargaJual) * 100 : 0);

    // Perbandingan dengan HPP tersimpan
    const hppLama    = Number(produk.HPP) || 0;
    const selisihHPP = round2(hppPerPcs - hppLama);
    const persenNaik = round2(hppLama > 0 ? (selisihHPP / hppLama) * 100 : 0);

    return ok({
      ID_PRODUK    : produk.ID_PRODUK,
      NAMA_PRODUK  : produk.NAMA_PRODUK,
      DETAIL_BAHAN : detailBahan,
      TOTAL_GRAM   : round2(totalGram),
      BIAYA_RESEP  : hppPerBatch,
      HPP_PER_BATCH: hppPerBatch,
      HPP_PER_PCS  : hppPerPcs,
      YIELD_PCS    : yieldPcs,
      MARGIN_PCT   : marginPct,
      HARGA_JUAL   : hargaJual,
      HPP_LAMA     : hppLama,
      SELISIH_HPP  : selisihHPP,
      PERSEN_NAIK  : persenNaik,
      IS_SIMULASI  : true,
    }, 'Simulasi selesai — tidak disimpan ke sheet');

  } catch (e) {
    log.error('recipe', 'SIM', 'simulasiResep gagal', { idProduk, error: e.message }, session);
    return fail('Simulasi gagal: ' + e.message, 'SERVER_ERROR');
  }
}
