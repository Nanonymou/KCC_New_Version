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
// DATA FALLBACK (dev / offline preview)
// Production: gunakan fetch helpers di bawah (fetchBahan, dst.)
// ─────────────────────────────────────────────────────────────
export const INITIAL_BAHAN = [
  { ID_BAHAN: "B001", NAMA_BAHAN: "Ayam Potong",   SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 38000, HARGA_SEBELUMNYA: 34000 },
  { ID_BAHAN: "B002", NAMA_BAHAN: "Tepung Terigu", SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 14000, HARGA_SEBELUMNYA: 12000 },
  { ID_BAHAN: "B003", NAMA_BAHAN: "Minyak Goreng", SATUAN_BELI: "ltr", SATUAN_PAKAI: "ml",   KONVERSI: 1000, HARGA_RATA2: 18000, HARGA_SEBELUMNYA: 15000 },
  { ID_BAHAN: "B004", NAMA_BAHAN: "Bawang Putih",  SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 42000, HARGA_SEBELUMNYA: 35000 },
  { ID_BAHAN: "B005", NAMA_BAHAN: "Bawang Merah",  SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 35000, HARGA_SEBELUMNYA: 33000 },
  { ID_BAHAN: "B006", NAMA_BAHAN: "Telur Ayam",    SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 28000, HARGA_SEBELUMNYA: 27000 },
  { ID_BAHAN: "B007", NAMA_BAHAN: "Santan Kelapa", SATUAN_BELI: "ltr", SATUAN_PAKAI: "ml",   KONVERSI: 1000, HARGA_RATA2: 16000, HARGA_SEBELUMNYA: 16000 },
  { ID_BAHAN: "B008", NAMA_BAHAN: "Cabai Merah",   SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 55000, HARGA_SEBELUMNYA: 45000 },
  { ID_BAHAN: "B009", NAMA_BAHAN: "Garam",         SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2:  8000, HARGA_SEBELUMNYA:  8000 },
  { ID_BAHAN: "B010", NAMA_BAHAN: "Kemiri",        SATUAN_BELI: "kg",  SATUAN_PAKAI: "gram", KONVERSI: 1000, HARGA_RATA2: 60000, HARGA_SEBELUMNYA: 55000 },
];

export const PRODUK = [
  { ID_PRODUK: "P001", NAMA_PRODUK: "Ayam Goreng Crispy",  KATEGORI: "Main Course", HARGA_JUAL: 25000, YIELD_PCS: 1 },
  { ID_PRODUK: "P002", NAMA_PRODUK: "Nasi Ayam Bakar",     KATEGORI: "Main Course", HARGA_JUAL: 28000, YIELD_PCS: 1 },
  { ID_PRODUK: "P003", NAMA_PRODUK: "Sambal Goreng Telur", KATEGORI: "Side Dish",   HARGA_JUAL: 12000, YIELD_PCS: 2 },
  { ID_PRODUK: "P004", NAMA_PRODUK: "Rendang Ayam",        KATEGORI: "Main Course", HARGA_JUAL: 32000, YIELD_PCS: 1 },
  { ID_PRODUK: "P005", NAMA_PRODUK: "Perkedel",            KATEGORI: "Side Dish",   HARGA_JUAL:  5000, YIELD_PCS: 3 },
];

export const RESEP = [
  // Ayam Goreng Crispy
  { ID_PRODUK: "P001", ID_BAHAN: "B001", JUMLAH: 200 },
  { ID_PRODUK: "P001", ID_BAHAN: "B002", JUMLAH:  50 },
  { ID_PRODUK: "P001", ID_BAHAN: "B003", JUMLAH: 200 },
  { ID_PRODUK: "P001", ID_BAHAN: "B004", JUMLAH:  15 },
  { ID_PRODUK: "P001", ID_BAHAN: "B009", JUMLAH:   5 },
  // Nasi Ayam Bakar
  { ID_PRODUK: "P002", ID_BAHAN: "B001", JUMLAH: 250 },
  { ID_PRODUK: "P002", ID_BAHAN: "B004", JUMLAH:  20 },
  { ID_PRODUK: "P002", ID_BAHAN: "B005", JUMLAH:  20 },
  { ID_PRODUK: "P002", ID_BAHAN: "B009", JUMLAH:   5 },
  { ID_PRODUK: "P002", ID_BAHAN: "B010", JUMLAH:  10 },
  // Sambal Goreng Telur
  { ID_PRODUK: "P003", ID_BAHAN: "B006", JUMLAH: 150 },
  { ID_PRODUK: "P003", ID_BAHAN: "B005", JUMLAH:  30 },
  { ID_PRODUK: "P003", ID_BAHAN: "B008", JUMLAH:  40 },
  { ID_PRODUK: "P003", ID_BAHAN: "B003", JUMLAH:  50 },
  // Rendang Ayam
  { ID_PRODUK: "P004", ID_BAHAN: "B001", JUMLAH: 300 },
  { ID_PRODUK: "P004", ID_BAHAN: "B007", JUMLAH: 200 },
  { ID_PRODUK: "P004", ID_BAHAN: "B005", JUMLAH:  40 },
  { ID_PRODUK: "P004", ID_BAHAN: "B004", JUMLAH:  30 },
  { ID_PRODUK: "P004", ID_BAHAN: "B008", JUMLAH:  60 },
  { ID_PRODUK: "P004", ID_BAHAN: "B010", JUMLAH:  15 },
  // Perkedel
  { ID_PRODUK: "P005", ID_BAHAN: "B006", JUMLAH: 100 },
  { ID_PRODUK: "P005", ID_BAHAN: "B002", JUMLAH:  30 },
  { ID_PRODUK: "P005", ID_BAHAN: "B004", JUMLAH:  10 },
  { ID_PRODUK: "P005", ID_BAHAN: "B003", JUMLAH:  80 },
  { ID_PRODUK: "P005", ID_BAHAN: "B009", JUMLAH:   3 },
];

export const PENJUALAN_HARI_INI = [
  { ID_PRODUK: "P001", QTY: 42 },
  { ID_PRODUK: "P002", QTY: 38 },
  { ID_PRODUK: "P003", QTY: 61 },
  { ID_PRODUK: "P004", QTY: 27 },
  { ID_PRODUK: "P005", QTY: 55 },
];

export const STOK_BAHAN = [
  { ID_BAHAN: "B001", STOK: 2.5, MIN_STOK: 3   },
  { ID_BAHAN: "B002", STOK: 8,   MIN_STOK: 5   },
  { ID_BAHAN: "B003", STOK: 1.2, MIN_STOK: 2   },
  { ID_BAHAN: "B004", STOK: 1.5, MIN_STOK: 2   },
  { ID_BAHAN: "B005", STOK: 4,   MIN_STOK: 3   },
  { ID_BAHAN: "B006", STOK: 3,   MIN_STOK: 3   },
  { ID_BAHAN: "B007", STOK: 5,   MIN_STOK: 2   },
  { ID_BAHAN: "B008", STOK: 0.8, MIN_STOK: 1.5 },
  { ID_BAHAN: "B009", STOK: 10,  MIN_STOK: 2   },
  { ID_BAHAN: "B010", STOK: 0.9, MIN_STOK: 1   },
];

export const BULAN_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun"];

export const TREND_HARGA_BAHAN = {
  B001: [34000, 35500, 36000, 37000, 38000, 38000],
  B002: [12000, 12500, 13000, 13500, 14000, 14000],
  B003: [15000, 16000, 17000, 17500, 18000, 18000],
  B004: [35000, 37000, 38000, 40000, 42000, 42000],
  B008: [45000, 48000, 50000, 52000, 55000, 55000],
};

export const TREND_HPP = {
  P001: [10200, 10650, 11100, 11340, 11700, 11700],
  P002: [13500, 14200, 14800, 15100, 15600, 15600],
  P003: [ 4800,  5100,  5300,  5500,  5700,  5700],
  P004: [17200, 18100, 19000, 19600, 20400, 20400],
  P005: [ 3800,  4000,  4200,  4350,  4500,  4500],
};

export const TREND_MARGIN = {
  P001: [59.2, 57.4, 55.6, 54.6, 53.2, 53.2],
  P002: [51.8, 49.3, 47.1, 46.1, 44.3, 44.3],
  P003: [60.0, 57.5, 55.8, 54.2, 52.5, 52.5],
  P004: [46.3, 43.4, 40.6, 38.8, 36.3, 36.3],
  P005: [24.0, 20.0, 16.0, 13.0, 10.0, 10.0],
};

export const TREND_FOOD_COST = [28.4, 30.1, 32.5, 33.8, 35.2, 35.2];
export const TREND_OMZET     = [2850000, 3020000, 3180000, 3350000, 3480000, 3480000];

export const SIMULASI_SKENARIO = [
  {
    id: "s1", label: "Ayam naik 20%",
    desc: "Harga ayam naik dari pasar tradisional", icon: "🐔",
    perubahan: [{ ID_BAHAN: "B001", faktor: 1.20 }],
  },
  {
    id: "s2", label: "Minyak & Cabai +30%",
    desc: "Kenaikan BBM memicu efek domino", icon: "🔥",
    perubahan: [
      { ID_BAHAN: "B003", faktor: 1.30 },
      { ID_BAHAN: "B008", faktor: 1.30 },
    ],
  },
  {
    id: "s3", label: "Semua bahan +15%",
    desc: "Inflasi umum bahan pangan", icon: "📈",
    perubahan: INITIAL_BAHAN.map(b => ({ ID_BAHAN: b.ID_BAHAN, faktor: 1.15 })),
  },
  {
    id: "s4", label: "Bawang naik 50%",
    desc: "Musim hujan mempengaruhi panen", icon: "🧅",
    perubahan: [
      { ID_BAHAN: "B004", faktor: 1.50 },
      { ID_BAHAN: "B005", faktor: 1.50 },
    ],
  },
  {
    id: "s5", label: "Harga Normal",
    desc: "Reset ke harga awal", icon: "🔄",
    perubahan: INITIAL_BAHAN.map(b => ({ ID_BAHAN: b.ID_BAHAN, faktor: 1.0, reset: true })),
  },
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

export const SUPPLIER_DATA = [
  { ID_SUPPLIER: "S001", NAMA: "Pasar Segar",      ID_BAHAN: "B001", HARGA: 36000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.5, TELP: "021-5551001" },
  { ID_SUPPLIER: "S002", NAMA: "CV Makmur",        ID_BAHAN: "B001", HARGA: 38000, SATUAN: "kg",  LEAD_TIME: 2, RATING: 4.0, TELP: "021-5551002" },
  { ID_SUPPLIER: "S003", NAMA: "Toko Sumber",      ID_BAHAN: "B002", HARGA: 13500, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.2, TELP: "021-5551003" },
  { ID_SUPPLIER: "S004", NAMA: "UD Berkah",        ID_BAHAN: "B002", HARGA: 14000, SATUAN: "kg",  LEAD_TIME: 2, RATING: 3.8, TELP: "021-5551004" },
  { ID_SUPPLIER: "S005", NAMA: "Minyak Prima",     ID_BAHAN: "B003", HARGA: 17500, SATUAN: "ltr", LEAD_TIME: 1, RATING: 4.3, TELP: "021-5551005" },
  { ID_SUPPLIER: "S006", NAMA: "Grosir Mulia",     ID_BAHAN: "B003", HARGA: 18000, SATUAN: "ltr", LEAD_TIME: 3, RATING: 3.9, TELP: "021-5551006" },
  { ID_SUPPLIER: "S007", NAMA: "Pasar Bawang",     ID_BAHAN: "B004", HARGA: 40000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.1, TELP: "021-5551007" },
  { ID_SUPPLIER: "S008", NAMA: "CV Segar Abadi",   ID_BAHAN: "B004", HARGA: 42000, SATUAN: "kg",  LEAD_TIME: 2, RATING: 4.4, TELP: "021-5551008" },
  { ID_SUPPLIER: "S009", NAMA: "Pasar Bawang",     ID_BAHAN: "B005", HARGA: 33000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.1, TELP: "021-5551007" },
  { ID_SUPPLIER: "S010", NAMA: "CV Segar Abadi",   ID_BAHAN: "B005", HARGA: 35000, SATUAN: "kg",  LEAD_TIME: 2, RATING: 4.4, TELP: "021-5551008" },
  { ID_SUPPLIER: "S011", NAMA: "Peternak Lokal",   ID_BAHAN: "B006", HARGA: 27000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.6, TELP: "021-5551009" },
  { ID_SUPPLIER: "S012", NAMA: "Supermarket X",    ID_BAHAN: "B006", HARGA: 29000, SATUAN: "kg",  LEAD_TIME: 0, RATING: 4.0, TELP: "021-5551010" },
  { ID_SUPPLIER: "S013", NAMA: "Kebun Kelapa",     ID_BAHAN: "B007", HARGA: 15500, SATUAN: "ltr", LEAD_TIME: 2, RATING: 4.2, TELP: "021-5551011" },
  { ID_SUPPLIER: "S014", NAMA: "Pasar Cabai",      ID_BAHAN: "B008", HARGA: 52000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.0, TELP: "021-5551012" },
  { ID_SUPPLIER: "S015", NAMA: "Grosir Rempah",    ID_BAHAN: "B008", HARGA: 55000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.3, TELP: "021-5551013" },
  { ID_SUPPLIER: "S016", NAMA: "Toko Garam",       ID_BAHAN: "B009", HARGA: 7500,  SATUAN: "kg",  LEAD_TIME: 3, RATING: 3.7, TELP: "021-5551014" },
  { ID_SUPPLIER: "S017", NAMA: "Rempah Nusantara", ID_BAHAN: "B010", HARGA: 58000, SATUAN: "kg",  LEAD_TIME: 2, RATING: 4.5, TELP: "021-5551015" },
  { ID_SUPPLIER: "S018", NAMA: "Bumbu Jaya",       ID_BAHAN: "B010", HARGA: 61000, SATUAN: "kg",  LEAD_TIME: 1, RATING: 4.0, TELP: "021-5551016" },
];

export const PEMBELIAN_DATA = [
  { ID_PO: "PO001", TANGGAL: "2026-06-20", ID_BAHAN: "B001", ID_SUPPLIER: "S001", QTY: 5,   HARGA_BELI: 36000, TOTAL: 180000, STATUS: "Diterima" },
  { ID_PO: "PO002", TANGGAL: "2026-06-21", ID_BAHAN: "B003", ID_SUPPLIER: "S005", QTY: 3,   HARGA_BELI: 17500, TOTAL: 52500,  STATUS: "Diterima" },
  { ID_PO: "PO003", TANGGAL: "2026-06-22", ID_BAHAN: "B004", ID_SUPPLIER: "S007", QTY: 2,   HARGA_BELI: 40000, TOTAL: 80000,  STATUS: "Diterima" },
  { ID_PO: "PO004", TANGGAL: "2026-06-22", ID_BAHAN: "B008", ID_SUPPLIER: "S014", QTY: 1.5, HARGA_BELI: 52000, TOTAL: 78000,  STATUS: "Diterima" },
  { ID_PO: "PO005", TANGGAL: "2026-06-23", ID_BAHAN: "B002", ID_SUPPLIER: "S003", QTY: 10,  HARGA_BELI: 13500, TOTAL: 135000, STATUS: "Diterima" },
  { ID_PO: "PO006", TANGGAL: "2026-06-23", ID_BAHAN: "B006", ID_SUPPLIER: "S011", QTY: 4,   HARGA_BELI: 27000, TOTAL: 108000, STATUS: "Diterima" },
  { ID_PO: "PO007", TANGGAL: "2026-06-24", ID_BAHAN: "B001", ID_SUPPLIER: "S001", QTY: 3,   HARGA_BELI: 36500, TOTAL: 109500, STATUS: "Diterima" },
  { ID_PO: "PO008", TANGGAL: "2026-06-24", ID_BAHAN: "B005", ID_SUPPLIER: "S009", QTY: 2,   HARGA_BELI: 33000, TOTAL: 66000,  STATUS: "Diterima" },
  { ID_PO: "PO009", TANGGAL: "2026-06-25", ID_BAHAN: "B010", ID_SUPPLIER: "S017", QTY: 1,   HARGA_BELI: 58000, TOTAL: 58000,  STATUS: "Diterima" },
  { ID_PO: "PO010", TANGGAL: "2026-06-25", ID_BAHAN: "B007", ID_SUPPLIER: "S013", QTY: 3,   HARGA_BELI: 15500, TOTAL: 46500,  STATUS: "Diterima" },
  { ID_PO: "PO011", TANGGAL: "2026-06-26", ID_BAHAN: "B001", ID_SUPPLIER: "S001", QTY: 4,   HARGA_BELI: 36000, TOTAL: 144000, STATUS: "Pending"  },
  { ID_PO: "PO012", TANGGAL: "2026-06-26", ID_BAHAN: "B008", ID_SUPPLIER: "S014", QTY: 2,   HARGA_BELI: 52000, TOTAL: 104000, STATUS: "Pending"  },
  { ID_PO: "PO013", TANGGAL: "2026-06-26", ID_BAHAN: "B003", ID_SUPPLIER: "S005", QTY: 2,   HARGA_BELI: 17500, TOTAL: 35000,  STATUS: "Pending"  },
];

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

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE FUNCTIONS — pure, no side effects, no React
// Semua komponen memanggil fungsi dari sini. Tidak boleh menduplikasi.
// ═══════════════════════════════════════════════════════════════════════════

// ── Format helpers ────────────────────────────────────────────
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
 */
export function recalcSemua(bahanList) {
  const bahanMap = {};
  bahanList.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

  return PRODUK.map(produk => {
    const resepItems = RESEP.filter(r => r.ID_PRODUK === produk.ID_PRODUK);
    return hitungHPP(produk, resepItems, bahanMap);
  });
}

/**
 * Hitung food cost % hari ini dari data penjualan.
 */
export function hitungFoodCostHariIni(produkHPP) {
  let totalHPP = 0, totalOmzet = 0;
  const jualMap = {};
  PENJUALAN_HARI_INI.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });

  produkHPP.forEach(p => {
    const qty   = jualMap[p.ID_PRODUK] || 0;
    totalHPP   += p.HPP_PER_PCS * qty;
    totalOmzet += p.HARGA_JUAL  * qty;
  });

  return totalOmzet > 0 ? round2((totalHPP / totalOmzet) * 100) : 0;
}
