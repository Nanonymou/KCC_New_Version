// ============================================================
// dashboard.gs — Agregasi data untuk Dashboard (V3 Multi-Outlet)
// Dependensi: config.gs, utils.gs, service.gs, auth.gs,
//             recipe.gs (getRingkasanHPPSemua),
//             inventory.gs (getInventorySummary)
// ============================================================

/**
 * Ambil ringkasan lengkap untuk Dashboard, scoped per outlet dari session.
 *
 * @param {object} session  — Objek session dari validateRequest()
 *                            { userId, username, role, outletId, outletName, loginAt }
 * @returns {{success: boolean, data: object}}
 */
function getDashboardSummary(session) {
  try {
    const outletId = session.outletId;

    // ── 1. Master Data counts (filter AKTIF, scoped outletId) ──────────
    const allBahan    = readAll(SHEET.BAHAN,    outletId).filter(r => String(r.AKTIF) !== 'FALSE');
    const allProduk   = readAll(SHEET.PRODUK,   outletId).filter(r => String(r.AKTIF) !== 'FALSE');
    const allSupplier = readAll(SHEET.SUPPLIER, outletId).filter(r => String(r.AKTIF) !== 'FALSE');

    // ── 2. HPP & Margin ringkasan ────────────────────────────────────────
    let hppSemua           = [];
    let avgMargin          = 0;
    let totalProdukBerResep = 0;
    let produkMarginRendah = [];

    try {
      const hppRes = getRingkasanHPPSemua(session);
      if (hppRes.success && hppRes.data) {
        hppSemua            = hppRes.data;
        totalProdukBerResep = hppSemua.filter(p => p.STATUS_RESEP === 'ADA').length;

        const produkValid = hppSemua.filter(p => p.STATUS_RESEP === 'ADA' && p.HARGA_JUAL > 0);
        if (produkValid.length > 0) {
          avgMargin = round2(
            produkValid.reduce((sum, p) => sum + p.MARGIN_PCT, 0) / produkValid.length
          );
        }

        // Produk dengan margin < 20%, urut terendah, top 5
        produkMarginRendah = produkValid
          .filter(p => p.MARGIN_PCT < 20)
          .sort((a, b) => a.MARGIN_PCT - b.MARGIN_PCT)
          .slice(0, 5);
      }
    } catch (e) {
      log.warn('dashboard', 'HPP', 'Gagal ambil HPP: ' + e.message, null, session);
    }

    // ── 3. Inventory / Stok ──────────────────────────────────────────────
    let lowStockItems  = [];
    let totalNilaiStok = 0;
    let invSummary     = null;

    try {
      const invRes = getInventorySummary(session);
      if (invRes.success && invRes.data) {
        invSummary     = invRes.data;
        totalNilaiStok = invRes.data.totalNilaiStok || 0;
        lowStockItems  = (invRes.data.lowStock || []).slice(0, 5);
      }
    } catch (e) {
      log.warn('dashboard', 'INV', 'Gagal ambil inventory: ' + e.message, null, session);
    }

    // ── 4. Pembelian bulan ini (scoped outletId) ─────────────────────────
    let totalPembelianBulanIni  = 0;
    let jumlahTransaksiPembelian = 0;
    let pembelianTerbaru        = [];

    try {
      // Gunakan readAll dari service.gs (support outletId filter) ─
      // inventory_config.gs sudah menambah OUTLET_ID sebagai kolom pertama INV sheets
      const allPurchase = readAll(INV_SHEET.PURCHASE, outletId);
      const now_        = new Date();

      const bulanIni = allPurchase.filter(p => {
        if (!p.TANGGAL || String(p.STATUS) === 'VOID') return false;
        const tgl = new Date(p.TANGGAL);
        return tgl.getFullYear() === now_.getFullYear() && tgl.getMonth() === now_.getMonth();
      });

      totalPembelianBulanIni   = bulanIni.reduce((s, p) => s + (Number(p.TOTAL_HARGA) || 0), 0);
      jumlahTransaksiPembelian = bulanIni.length;

      // 5 pembelian terbaru (non-VOID, urut tanggal desc)
      pembelianTerbaru = allPurchase
        .filter(p => String(p.STATUS) !== 'VOID')
        .sort((a, b) => new Date(b.TANGGAL) - new Date(a.TANGGAL))
        .slice(0, 5)
        .map(p => ({
          ID_PURCHASE  : p.ID_PURCHASE,
          TANGGAL      : p.TANGGAL,
          NAMA_BAHAN   : p.NAMA_BAHAN || p.ID_BAHAN,
          QTY_BELI     : p.QTY_BELI,
          SATUAN_BELI  : p.SATUAN_BELI,
          TOTAL_HARGA  : Number(p.TOTAL_HARGA) || 0,
          NAMA_SUPPLIER: p.NAMA_SUPPLIER || p.ID_SUPPLIER || '-',
        }));
    } catch (e) {
      log.warn('dashboard', 'PURCHASE', 'Gagal ambil pembelian: ' + e.message, null, session);
    }

    // ── 5. Top margin products ───────────────────────────────────────────
    const topMargin = hppSemua
      .filter(p => p.STATUS_RESEP === 'ADA')
      .sort((a, b) => b.MARGIN_PCT - a.MARGIN_PCT)
      .slice(0, 5);

    // ── 6. Resep item count (scoped outletId) ─────────────────────────────
    let totalResepItems = 0;
    try {
      totalResepItems = readAll(SHEET.RESEP, outletId).length;
    } catch (e) {
      log.warn('dashboard', 'RESEP', 'Gagal hitung resep items: ' + e.message, null, session);
    }

    log.info('dashboard', 'READ', 'getDashboardSummary berhasil', null, session);

    return ok({
      // Meta outlet
      outletId                : outletId,
      outletName              : session.outletName,
      // Master counts
      totalBahan              : allBahan.length,
      totalProduk             : allProduk.length,
      totalSupplier           : allSupplier.length,
      // Resep & HPP
      totalProdukBerResep     : totalProdukBerResep,
      totalResepItems         : totalResepItems,
      avgMargin               : avgMargin,
      hppSemua                : hppSemua,
      topMargin               : topMargin,
      produkMarginRendah      : produkMarginRendah,
      // Inventory
      lowStockItems           : lowStockItems,
      totalNilaiStok          : totalNilaiStok,
      invSummary              : invSummary,
      // Pembelian
      totalPembelianBulanIni  : totalPembelianBulanIni,
      jumlahTransaksiPembelian: jumlahTransaksiPembelian,
      pembelianTerbaru        : pembelianTerbaru,
      // Timestamp
      lastUpdated             : now(),
    });

  } catch (e) {
    log.error('dashboard', 'READ', 'getDashboardSummary gagal', { error: e.message }, session);
    return fail('Gagal mengambil ringkasan dashboard: ' + e.message, 'SERVER_ERROR');
  }
}

// ── API Wrapper ──────────────────────────────────────────────────────────────

/**
 * API wrapper untuk getDashboardSummary.
 * Dipanggil dari Code.gs router dengan `params` dari client.
 *
 * @param {{token: string}} params
 */
function apiGetDashboardSummary(params) {
  const session = validateRequest(params.token); // throw jika invalid/expired
  return getDashboardSummary(session);
}
