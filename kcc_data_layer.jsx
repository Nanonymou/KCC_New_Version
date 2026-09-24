// ═══════════════════════════════════════════════════════════════════════════
// kcc_data_layer.jsx
// Single Source of Truth untuk seluruh aplikasi KCC.
//
// ATURAN:
//   - Semua data master, engine functions, dan helpers ADA DI SINI.
//   - Tidak ada satu pun const data di hpp_engine / KCC_Dashboard /
//     KCC_Analytics / KCC_RecommendationEngine.
//   - Komponen-komponen di atas hanya import dari file ini.
//   - File ini tidak boleh import React atau render apapun.
//
// M12 NOTE:
//   - INITIAL_BAHAN, PRODUK, RESEP, dll. di bawah adalah DATA FALLBACK
//     untuk development / preview offline saja.
//   - Di production (GAS), semua data diambil via fetchBahan(), fetchProduk(),
//     fetchResep(), dll. yang memanggil google.script.run melalui gasRun().
//   - Engine functions (hitungHPP, recalcSemua, dll.) dan helper exports
//     (idr, pct, THRESHOLDS, dll.) TIDAK BERUBAH — semua komponen tetap
//     menggunakannya seperti sebelumnya.
// ═══════════════════════════════════════════════════════════════════════════

import { gasRun } from "./useGAS";

// ─────────────────────────────────────────────────────────────
// DATA FALLBACK
// Digunakan hanya sebagai initial state sebelum fetch* di bawah selesai,
// dan sebagai fallback jika request gagal / API tidak tersedia. Sengaja
// KOSONG — outlet baru mulai tanpa data contoh apa pun; satu-satunya data
// yang akan tampil di aplikasi adalah yang benar-benar diinput lewat
// Inventory / Resep / Pembelian, dst. Semua data live selalu diambil via
// fetchBahan(), fetchProduk(), fetchResep(), dll. yang memanggil backend
// melalui gasRun().
// ─────────────────────────────────────────────────────────────
export const INITIAL_BAHAN = [];

export const PRODUK = [];

export const RESEP = [];

export const PENJUALAN_HARI_INI = [];

export const STOK_BAHAN = [];

// Skenario simulasi HPP — generik (persentase terhadap SEMUA bahan yang
// sedang ada), tidak terikat ke ID bahan tertentu, supaya tetap berfungsi
// untuk bahan apa pun yang diinput lewat aplikasi. "perubahan" dihitung saat
// skenario dijalankan (lihat hpp_engine.jsx), bukan didaftarkan statis di
// sini, sehingga selalu mengikuti bahanList yang nyata saat ini.
export const SIMULASI_SKENARIO = [
  { id: "up10",  label: "Semua Bahan +10%", desc: "Kenaikan umum ringan",     icon: "📈", pct:  10 },
  { id: "up15",  label: "Semua Bahan +15%", desc: "Inflasi bahan pangan",     icon: "📈", pct:  15 },
  { id: "up20",  label: "Semua Bahan +20%", desc: "Kenaikan signifikan",      icon: "⚠️", pct:  20 },
  { id: "reset", label: "Harga Awal",       desc: "Reset ke harga sesi ini",  icon: "🔄", reset: true },
];

export const THRESHOLDS = {
  MARGIN_TARGET_PCT:     50,
  MARGIN_KRITIS_PCT:     30,
  FOOD_COST_TARGET_PCT:  33,
  FOOD_COST_KRITIS_PCT:  38,
  HARGA_NAIK_MIN_PCT:     5,
  HARGA_NAIK_KRITIS_PCT: 15,
  STOK_KRITIS_RASIO:      1.0,
  STOK_AMAN_RASIO:        1.5,
};

export const SUPPLIER_DATA = [];

export const PEMBELIAN_DATA = [];

// ═══════════════════════════════════════════════════════════════════════════
// GAS FETCH HELPERS
// Dipakai komponen yang sudah siap live — kirim token dari useAuth().
// Pattern: const data = await fetchBahan(token) ?? INITIAL_BAHAN;
//
// Setiap helper return null jika GAS tidak tersedia (dev environment),
// sehingga komponen bisa fallback ke data statis di atas tanpa crash.
// ═══════════════════════════════════════════════════════════════════════════

/** @param {string} token */
export async function fetchBahan(token) {
  try {
    const res = await gasRun("apiGetBahanAll", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token */
export async function fetchProduk(token) {
  try {
    const res = await gasRun("apiGetProdukAll", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token @param {string} date - "YYYY-MM-DD" */
export async function fetchSalesList(token, date) {
  try {
    const res = await gasRun("apiInvSalesList", { token, TANGGAL: date });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token */
export async function fetchResep(token) {
  try {
    const res = await gasRun("apiGetResepAll", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token */
export async function fetchSupplier(token) {
  try {
    const res = await gasRun("apiGetSupplierAll", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token */
export async function fetchPembelian(token) {
  try {
    const res = await gasRun("apiInvPurchaseAll", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token */
export async function fetchStok(token) {
  try {
    const res = await gasRun("apiInvStokSemua", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token */
export async function fetchDashboard(token) {
  try {
    const res = await gasRun("apiGetDashboardSummary", { token });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

// ── Transaksi Harian & Dashboard Stok — bersumber dari bahan (Inventory) ───
// Tidak ada fetch katalog terpisah: apiDailyStockView/apiDashboardStok di
// server sudah membaca langsung dari tabel `bahan` yang sama dipakai
// InventoryManager.

/** @param {string} token @param {string} date - "YYYY-MM-DD" */
export async function fetchDailyStockView(token, date) {
  try {
    const res = await gasRun("apiDailyStockView", { token, TANGGAL: date });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} token @param {string} date @param {{query?:string}} filters */
export async function fetchDashboardStok(token, date, filters = {}) {
  try {
    const res = await gasRun("apiDashboardStok", { token, TANGGAL: date, QUERY: filters.query });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE / MUTATION HELPERS
// Dipakai form input di manager. Berbeda dari fetch helpers: helper ini
// MELEMPAR error (tidak menelannya) supaya form bisa menampilkan pesan gagal
// dan tidak salah menandai sukses. Semua otomatis ter-scope ke outlet lewat
// session token.
// ═══════════════════════════════════════════════════════════════════════════

// ── Inventory / Pembelian ──────────────────────────────────
export const createPurchase = (token, data) => gasRun("apiInvPurchaseCreate", { token, data });
export const voidPurchase   = (token, ID_PO) => gasRun("apiInvPurchaseVoid", { token, ID_PO });
export const deletePurchase = (token, ID_PO) => gasRun("apiInvPurchaseDelete", { token, ID_PO });
export const adjustStok     = (token, data) => gasRun("apiInvAdjustment", { token, data });

// ── Maintenance: hapus sisa data contoh bawaan (SUPER_ADMIN saja) ──────────
export const purgeSeedData  = (token) => gasRun("apiPurgeSeedData", { token });
export const recordSale     = (token, data) => gasRun("apiInvSalesCreate", { token, data });
export const deleteSale     = (token, ID)   => gasRun("apiInvSalesDelete", { token, ID });

// ── Master: Bahan ──────────────────────────────────────────
export const createBahan     = (token, data)    => gasRun("apiBahanCreate", { token, data });
export const updateBahan     = (token, data)    => gasRun("apiBahanUpdate", { token, data });
export const deactivateBahan = (token, ID_BAHAN) => gasRun("apiBahanDeactivate", { token, ID_BAHAN });
export const reactivateBahan = (token, ID_BAHAN) => gasRun("apiBahanReactivate", { token, ID_BAHAN });

// ── Master: Produk ─────────────────────────────────────────
export const createProduk     = (token, data)     => gasRun("apiProdukCreate", { token, data });
export const updateProduk     = (token, data)     => gasRun("apiProdukUpdate", { token, data });
export const deactivateProduk = (token, ID_PRODUK) => gasRun("apiProdukDeactivate", { token, ID_PRODUK });
export const reactivateProduk = (token, ID_PRODUK) => gasRun("apiProdukReactivate", { token, ID_PRODUK });

// ── Master: Supplier ───────────────────────────────────────
export const createSupplier     = (token, data)       => gasRun("apiSupplierCreate", { token, data });
export const updateSupplier     = (token, data)       => gasRun("apiSupplierUpdate", { token, data });
export const deactivateSupplier = (token, ID_SUPPLIER) => gasRun("apiSupplierDeactivate", { token, ID_SUPPLIER });
export const reactivateSupplier = (token, ID_SUPPLIER) => gasRun("apiSupplierReactivate", { token, ID_SUPPLIER });

// ── Resep ──────────────────────────────────────────────────
export const addResepItem    = (token, data) => gasRun("apiResepAddItem", { token, data });
export const updateResepItem = (token, data) => gasRun("apiResepUpdateItem", { token, data });
export const deleteResepItem = (token, data) => gasRun("apiResepDeleteItem", { token, data });

// ── Transaksi Harian (berdasarkan bahan yang sudah ada di Inventory) ────────
// entries: [{ ID_BAHAN, RECEIVING, REGULAR, SNACK, BACKCHARGE, HKL, EVENT, ENT, TO_QTY, SPOIL }]
// BEG_BALANCE & BALANCE tidak dikirim — selalu dihitung ulang di server.
export const saveDailyStock = (token, date, entries) =>
  gasRun("apiDailyStockSave", { token, data: { TANGGAL: date, ENTRIES: entries } });

// Kolom mutasi Transaksi Harian, urutan tampil di tabel (sinkron dengan
// MOVEMENT_COLUMNS di api/_lib/handlers.js).
export const MOVEMENT_COLUMNS = [
  { key: "BEG_BALANCE", label: "Beg. Balance", editable: false },
  { key: "RECEIVING",   label: "Receiving",    editable: true },
  { key: "REGULAR",     label: "Regular",      editable: true },
  { key: "SPOIL",       label: "Spoil",        editable: true },
];

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE FUNCTIONS — pure, no side effects, no React
// Semua komponen memanggil fungsi dari sini. Tidak boleh menduplikasi.
// ═══════════════════════════════════════════════════════════════════════════

// ── Format helpers ────────────────────────────────────────────
// Bahan/Produk yang sudah dihapus (soft-delete → AKTIF=false) tetap ada di
// baris resep/pembelian lama untuk riwayat, tapi tidak boleh lagi ikut
// dihitung di HPP/margin/rekomendasi manapun, dan tidak boleh muncul lagi
// di daftar pilihan. Pakai helper ini di setiap tempat yang menerima
// bahanList/produkList mentah dari fetch sebelum dipakai untuk kalkulasi
// atau ditampilkan sebagai daftar "saat ini".
export function filterAktif(list) {
  return (list || []).filter(x => x.AKTIF !== false);
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export const idr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", minimumFractionDigits: 0,
  }).format(n);

export const pct = (n) => `${Number(n).toFixed(1)}%`;

export function marginColor(m) {
  if (m >= 50) return "#7fa86a";
  if (m >= 35) return "#a9c46a";
  if (m >= 20) return "#d99a4e";
  return "#d1685c";
}

// ── HPP Engine ────────────────────────────────────────────────
/**
 * Hitung HPP satu produk berdasarkan resep + harga bahan.
 */
export function hitungHPP(produk, resepItems, bahanMap) {
  let biayaResep = 0;
  const detail = [];

  for (const item of resepItems) {
    const bahan = bahanMap[item.ID_BAHAN];
    if (!bahan) continue;

    const jumlah               = Number(item.JUMLAH) || 0;
    const konversi             = Number(bahan.KONVERSI) || 1;
    const harga                = Number(bahan.HARGA_RATA2) || 0;
    const hargaPerSatuanPakai  = konversi > 0 ? harga / konversi : 0;
    const biayaBahan           = jumlah * hargaPerSatuanPakai;

    biayaResep += biayaBahan;
    detail.push({
      ID_BAHAN:               bahan.ID_BAHAN,
      NAMA_BAHAN:             bahan.NAMA_BAHAN,
      JUMLAH:                 jumlah,
      SATUAN_PAKAI:           bahan.SATUAN_PAKAI,
      HARGA_RATA2:            harga,
      HARGA_PER_SATUAN_PAKAI: round2(hargaPerSatuanPakai),
      BIAYA_BAHAN:            round2(biayaBahan),
    });
  }

  const yieldPcs  = Number(produk.YIELD_PCS) || 1;
  const hargaJual = Number(produk.HARGA_JUAL) || 0;
  const hppPerPcs = round2(yieldPcs > 0 ? biayaResep / yieldPcs : 0);
  const marginPct = round2(hargaJual > 0 ? ((hargaJual - hppPerPcs) / hargaJual) * 100 : 0);
  const marginRp  = round2(hargaJual - hppPerPcs);

  return {
    ID_PRODUK:     produk.ID_PRODUK,
    NAMA_PRODUK:   produk.NAMA_PRODUK,
    KATEGORI:      produk.KATEGORI,
    HARGA_JUAL:    hargaJual,
    YIELD_PCS:     yieldPcs,
    HPP_PER_BATCH: round2(biayaResep),
    HPP_PER_PCS:   hppPerPcs,
    MARGIN_PCT:    marginPct,
    MARGIN_RP:     marginRp,
    DETAIL:        detail,
  };
}

/**
 * Hitung HPP semua produk dari bahanList saat ini.
 *
 * `produkList` & `resepDataArg` opsional — default ke data fallback (PRODUK/
 * RESEP) untuk kompatibilitas dengan pemanggil lama yang hanya mengirim
 * bahanList. Pemanggil yang sudah fetch data live (mis. ResepManager) WAJIB
 * mengirim produkList & resepData miliknya sendiri, supaya produk/resep yang
 * baru ditambahkan (di luar 5 produk contoh) ikut terhitung — sebelumnya
 * kedua parameter ini diterima tapi diam-diam diabaikan, sehingga produk/
 * item resep baru tidak pernah muncul di ringkasan HPP walau tersimpan di
 * server.
 */
export function recalcSemua(bahanList, produkList = PRODUK, resepDataArg = RESEP) {
  const bahanMap = {};
  bahanList.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

  return produkList.map(produk => {
    const resepItems = resepDataArg.filter(r => r.ID_PRODUK === produk.ID_PRODUK);
    return hitungHPP(produk, resepItems, bahanMap);
  });
}

/**
 * Hitung food cost % hari ini dari data penjualan.
 */
export function hitungFoodCostHariIni(produkHPP, penjualanHariIni = PENJUALAN_HARI_INI) {
  let totalHPP = 0, totalOmzet = 0;
  const jualMap = {};
  penjualanHariIni.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });

  produkHPP.forEach(p => {
    const qty   = jualMap[p.ID_PRODUK] || 0;
    totalHPP   += p.HPP_PER_PCS * qty;
    totalOmzet += p.HARGA_JUAL  * qty;
  });

  return totalOmzet > 0 ? round2((totalHPP / totalOmzet) * 100) : 0;
}
