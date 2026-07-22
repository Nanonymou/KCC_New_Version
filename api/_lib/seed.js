// ═══════════════════════════════════════════════════════════════════════════
// api/_lib/seed.js
// Initial data used to provision a fresh database (mirrors the constants that
// used to live in kcc_data_layer.jsx as offline fallback).
//
// Multi-site: 10 outlets are provisioned (OUTLET01..OUTLET10), each with its
// own admin & kasir account and a full copy of the template master data, so
// the app can serve up to 10 independent sites out of the box.
//
// Default credentials (CHANGE IN PRODUCTION):
//   Outlet code : OUTLET01 .. OUTLET10
//   Username    : admin   Password: admin123   (SUPER_ADMIN di OUTLET01, ADMIN di lainnya)
//   Username    : kasir   Password: kasir123   (KASIR)
// ═══════════════════════════════════════════════════════════════════════════

export const NUM_OUTLETS = 10;

export const OUTLETS = Array.from({ length: NUM_OUTLETS }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    id:   `OUT${n}`,
    code: `OUTLET${n}`,
    name: i === 0 ? 'KCC Pusat' : `KCC Site ${i + 1}`,
  };
});

// Two accounts per outlet; the first outlet's admin is the SUPER_ADMIN.
export const USER_TEMPLATE = [
  { key: 'A', username: 'admin', password: 'admin123', roleFirst: 'SUPER_ADMIN', role: 'ADMIN' },
  { key: 'K', username: 'kasir', password: 'kasir123', role: 'KASIR' },
];

export const SEED = {

  bahan: [
    { ID_BAHAN: 'B001', NAMA_BAHAN: 'Ayam Potong',   SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 38000, HARGA_SEBELUMNYA: 34000 },
    { ID_BAHAN: 'B002', NAMA_BAHAN: 'Tepung Terigu', SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 14000, HARGA_SEBELUMNYA: 12000 },
    { ID_BAHAN: 'B003', NAMA_BAHAN: 'Minyak Goreng', SATUAN_BELI: 'ltr', SATUAN_PAKAI: 'ml',   KONVERSI: 1000, HARGA_RATA2: 18000, HARGA_SEBELUMNYA: 15000 },
    { ID_BAHAN: 'B004', NAMA_BAHAN: 'Bawang Putih',  SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 42000, HARGA_SEBELUMNYA: 35000 },
    { ID_BAHAN: 'B005', NAMA_BAHAN: 'Bawang Merah',  SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 35000, HARGA_SEBELUMNYA: 33000 },
    { ID_BAHAN: 'B006', NAMA_BAHAN: 'Telur Ayam',    SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 28000, HARGA_SEBELUMNYA: 27000 },
    { ID_BAHAN: 'B007', NAMA_BAHAN: 'Santan Kelapa', SATUAN_BELI: 'ltr', SATUAN_PAKAI: 'ml',   KONVERSI: 1000, HARGA_RATA2: 16000, HARGA_SEBELUMNYA: 16000 },
    { ID_BAHAN: 'B008', NAMA_BAHAN: 'Cabai Merah',   SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 55000, HARGA_SEBELUMNYA: 45000 },
    { ID_BAHAN: 'B009', NAMA_BAHAN: 'Garam',         SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2:  8000, HARGA_SEBELUMNYA:  8000 },
    { ID_BAHAN: 'B010', NAMA_BAHAN: 'Kemiri',        SATUAN_BELI: 'kg',  SATUAN_PAKAI: 'gram', KONVERSI: 1000, HARGA_RATA2: 60000, HARGA_SEBELUMNYA: 55000 },
  ],

  produk: [
    { ID_PRODUK: 'P001', NAMA_PRODUK: 'Ayam Goreng Crispy',  KATEGORI: 'Main Course', HARGA_JUAL: 25000, YIELD_PCS: 1 },
    { ID_PRODUK: 'P002', NAMA_PRODUK: 'Nasi Ayam Bakar',     KATEGORI: 'Main Course', HARGA_JUAL: 28000, YIELD_PCS: 1 },
    { ID_PRODUK: 'P003', NAMA_PRODUK: 'Sambal Goreng Telur', KATEGORI: 'Side Dish',   HARGA_JUAL: 12000, YIELD_PCS: 2 },
    { ID_PRODUK: 'P004', NAMA_PRODUK: 'Rendang Ayam',        KATEGORI: 'Main Course', HARGA_JUAL: 32000, YIELD_PCS: 1 },
    { ID_PRODUK: 'P005', NAMA_PRODUK: 'Perkedel',            KATEGORI: 'Side Dish',   HARGA_JUAL:  5000, YIELD_PCS: 3 },
  ],

  resep: [
    { ID_PRODUK: 'P001', ID_BAHAN: 'B001', JUMLAH: 200 },
    { ID_PRODUK: 'P001', ID_BAHAN: 'B002', JUMLAH:  50 },
    { ID_PRODUK: 'P001', ID_BAHAN: 'B003', JUMLAH: 200 },
    { ID_PRODUK: 'P001', ID_BAHAN: 'B004', JUMLAH:  15 },
    { ID_PRODUK: 'P001', ID_BAHAN: 'B009', JUMLAH:   5 },
    { ID_PRODUK: 'P002', ID_BAHAN: 'B001', JUMLAH: 250 },
    { ID_PRODUK: 'P002', ID_BAHAN: 'B004', JUMLAH:  20 },
    { ID_PRODUK: 'P002', ID_BAHAN: 'B005', JUMLAH:  20 },
    { ID_PRODUK: 'P002', ID_BAHAN: 'B009', JUMLAH:   5 },
    { ID_PRODUK: 'P002', ID_BAHAN: 'B010', JUMLAH:  10 },
    { ID_PRODUK: 'P003', ID_BAHAN: 'B006', JUMLAH: 150 },
    { ID_PRODUK: 'P003', ID_BAHAN: 'B005', JUMLAH:  30 },
    { ID_PRODUK: 'P003', ID_BAHAN: 'B008', JUMLAH:  40 },
    { ID_PRODUK: 'P003', ID_BAHAN: 'B003', JUMLAH:  50 },
    { ID_PRODUK: 'P004', ID_BAHAN: 'B001', JUMLAH: 300 },
    { ID_PRODUK: 'P004', ID_BAHAN: 'B007', JUMLAH: 200 },
    { ID_PRODUK: 'P004', ID_BAHAN: 'B005', JUMLAH:  40 },
    { ID_PRODUK: 'P004', ID_BAHAN: 'B004', JUMLAH:  30 },
    { ID_PRODUK: 'P004', ID_BAHAN: 'B008', JUMLAH:  60 },
    { ID_PRODUK: 'P004', ID_BAHAN: 'B010', JUMLAH:  15 },
    { ID_PRODUK: 'P005', ID_BAHAN: 'B006', JUMLAH: 100 },
    { ID_PRODUK: 'P005', ID_BAHAN: 'B002', JUMLAH:  30 },
    { ID_PRODUK: 'P005', ID_BAHAN: 'B004', JUMLAH:  10 },
    { ID_PRODUK: 'P005', ID_BAHAN: 'B003', JUMLAH:  80 },
    { ID_PRODUK: 'P005', ID_BAHAN: 'B009', JUMLAH:   3 },
  ],

  supplier: [
    { ID_SUPPLIER: 'S001', NAMA: 'Pasar Segar',      ID_BAHAN: 'B001', HARGA: 36000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.5, TELP: '021-5551001' },
    { ID_SUPPLIER: 'S002', NAMA: 'CV Makmur',        ID_BAHAN: 'B001', HARGA: 38000, SATUAN: 'kg',  LEAD_TIME: 2, RATING: 4.0, TELP: '021-5551002' },
    { ID_SUPPLIER: 'S003', NAMA: 'Toko Sumber',      ID_BAHAN: 'B002', HARGA: 13500, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.2, TELP: '021-5551003' },
    { ID_SUPPLIER: 'S004', NAMA: 'UD Berkah',        ID_BAHAN: 'B002', HARGA: 14000, SATUAN: 'kg',  LEAD_TIME: 2, RATING: 3.8, TELP: '021-5551004' },
    { ID_SUPPLIER: 'S005', NAMA: 'Minyak Prima',     ID_BAHAN: 'B003', HARGA: 17500, SATUAN: 'ltr', LEAD_TIME: 1, RATING: 4.3, TELP: '021-5551005' },
    { ID_SUPPLIER: 'S006', NAMA: 'Grosir Mulia',     ID_BAHAN: 'B003', HARGA: 18000, SATUAN: 'ltr', LEAD_TIME: 3, RATING: 3.9, TELP: '021-5551006' },
    { ID_SUPPLIER: 'S007', NAMA: 'Pasar Bawang',     ID_BAHAN: 'B004', HARGA: 40000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.1, TELP: '021-5551007' },
    { ID_SUPPLIER: 'S008', NAMA: 'CV Segar Abadi',   ID_BAHAN: 'B004', HARGA: 42000, SATUAN: 'kg',  LEAD_TIME: 2, RATING: 4.4, TELP: '021-5551008' },
    { ID_SUPPLIER: 'S009', NAMA: 'Pasar Bawang',     ID_BAHAN: 'B005', HARGA: 33000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.1, TELP: '021-5551007' },
    { ID_SUPPLIER: 'S010', NAMA: 'CV Segar Abadi',   ID_BAHAN: 'B005', HARGA: 35000, SATUAN: 'kg',  LEAD_TIME: 2, RATING: 4.4, TELP: '021-5551008' },
    { ID_SUPPLIER: 'S011', NAMA: 'Peternak Lokal',   ID_BAHAN: 'B006', HARGA: 27000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.6, TELP: '021-5551009' },
    { ID_SUPPLIER: 'S012', NAMA: 'Supermarket X',    ID_BAHAN: 'B006', HARGA: 29000, SATUAN: 'kg',  LEAD_TIME: 0, RATING: 4.0, TELP: '021-5551010' },
    { ID_SUPPLIER: 'S013', NAMA: 'Kebun Kelapa',     ID_BAHAN: 'B007', HARGA: 15500, SATUAN: 'ltr', LEAD_TIME: 2, RATING: 4.2, TELP: '021-5551011' },
    { ID_SUPPLIER: 'S014', NAMA: 'Pasar Cabai',      ID_BAHAN: 'B008', HARGA: 52000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.0, TELP: '021-5551012' },
    { ID_SUPPLIER: 'S015', NAMA: 'Grosir Rempah',    ID_BAHAN: 'B008', HARGA: 55000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.3, TELP: '021-5551013' },
    { ID_SUPPLIER: 'S016', NAMA: 'Toko Garam',       ID_BAHAN: 'B009', HARGA: 7500,  SATUAN: 'kg',  LEAD_TIME: 3, RATING: 3.7, TELP: '021-5551014' },
    { ID_SUPPLIER: 'S017', NAMA: 'Rempah Nusantara', ID_BAHAN: 'B010', HARGA: 58000, SATUAN: 'kg',  LEAD_TIME: 2, RATING: 4.5, TELP: '021-5551015' },
    { ID_SUPPLIER: 'S018', NAMA: 'Bumbu Jaya',       ID_BAHAN: 'B010', HARGA: 61000, SATUAN: 'kg',  LEAD_TIME: 1, RATING: 4.0, TELP: '021-5551016' },
  ],

  // ID_PO memakai format berbasis tanggal: PO-YYYYMMDD-NNN (urutan per hari).
  pembelian: [
    { ID_PO: 'PO-20260620-001', TANGGAL: '2026-06-20', ID_BAHAN: 'B001', ID_SUPPLIER: 'S001', QTY: 5,   HARGA_BELI: 36000, TOTAL: 180000, STATUS: 'Diterima' },
    { ID_PO: 'PO-20260621-001', TANGGAL: '2026-06-21', ID_BAHAN: 'B003', ID_SUPPLIER: 'S005', QTY: 3,   HARGA_BELI: 17500, TOTAL: 52500,  STATUS: 'Diterima' },
    { ID_PO: 'PO-20260622-001', TANGGAL: '2026-06-22', ID_BAHAN: 'B004', ID_SUPPLIER: 'S007', QTY: 2,   HARGA_BELI: 40000, TOTAL: 80000,  STATUS: 'Diterima' },
    { ID_PO: 'PO-20260622-002', TANGGAL: '2026-06-22', ID_BAHAN: 'B008', ID_SUPPLIER: 'S014', QTY: 1.5, HARGA_BELI: 52000, TOTAL: 78000,  STATUS: 'Diterima' },
    { ID_PO: 'PO-20260623-001', TANGGAL: '2026-06-23', ID_BAHAN: 'B002', ID_SUPPLIER: 'S003', QTY: 10,  HARGA_BELI: 13500, TOTAL: 135000, STATUS: 'Diterima' },
    { ID_PO: 'PO-20260623-002', TANGGAL: '2026-06-23', ID_BAHAN: 'B006', ID_SUPPLIER: 'S011', QTY: 4,   HARGA_BELI: 27000, TOTAL: 108000, STATUS: 'Diterima' },
    { ID_PO: 'PO-20260624-001', TANGGAL: '2026-06-24', ID_BAHAN: 'B001', ID_SUPPLIER: 'S001', QTY: 3,   HARGA_BELI: 36500, TOTAL: 109500, STATUS: 'Diterima' },
    { ID_PO: 'PO-20260624-002', TANGGAL: '2026-06-24', ID_BAHAN: 'B005', ID_SUPPLIER: 'S009', QTY: 2,   HARGA_BELI: 33000, TOTAL: 66000,  STATUS: 'Diterima' },
    { ID_PO: 'PO-20260625-001', TANGGAL: '2026-06-25', ID_BAHAN: 'B010', ID_SUPPLIER: 'S017', QTY: 1,   HARGA_BELI: 58000, TOTAL: 58000,  STATUS: 'Diterima' },
    { ID_PO: 'PO-20260625-002', TANGGAL: '2026-06-25', ID_BAHAN: 'B007', ID_SUPPLIER: 'S013', QTY: 3,   HARGA_BELI: 15500, TOTAL: 46500,  STATUS: 'Diterima' },
    { ID_PO: 'PO-20260626-001', TANGGAL: '2026-06-26', ID_BAHAN: 'B001', ID_SUPPLIER: 'S001', QTY: 4,   HARGA_BELI: 36000, TOTAL: 144000, STATUS: 'Pending'  },
    { ID_PO: 'PO-20260626-002', TANGGAL: '2026-06-26', ID_BAHAN: 'B008', ID_SUPPLIER: 'S014', QTY: 2,   HARGA_BELI: 52000, TOTAL: 104000, STATUS: 'Pending'  },
    { ID_PO: 'PO-20260626-003', TANGGAL: '2026-06-26', ID_BAHAN: 'B003', ID_SUPPLIER: 'S005', QTY: 2,   HARGA_BELI: 17500, TOTAL: 35000,  STATUS: 'Pending'  },
  ],

  stok: [
    { ID_BAHAN: 'B001', STOK: 2.5, MIN_STOK: 3   },
    { ID_BAHAN: 'B002', STOK: 8,   MIN_STOK: 5   },
    { ID_BAHAN: 'B003', STOK: 1.2, MIN_STOK: 2   },
    { ID_BAHAN: 'B004', STOK: 1.5, MIN_STOK: 2   },
    { ID_BAHAN: 'B005', STOK: 4,   MIN_STOK: 3   },
    { ID_BAHAN: 'B006', STOK: 3,   MIN_STOK: 3   },
    { ID_BAHAN: 'B007', STOK: 5,   MIN_STOK: 2   },
    { ID_BAHAN: 'B008', STOK: 0.8, MIN_STOK: 1.5 },
    { ID_BAHAN: 'B009', STOK: 10,  MIN_STOK: 2   },
    { ID_BAHAN: 'B010', STOK: 0.9, MIN_STOK: 1   },
  ],

  penjualan: [
    { ID_PRODUK: 'P001', QTY: 42 },
    { ID_PRODUK: 'P002', QTY: 38 },
    { ID_PRODUK: 'P003', QTY: 61 },
    { ID_PRODUK: 'P004', QTY: 27 },
    { ID_PRODUK: 'P005', QTY: 55 },
  ],
};

export default SEED;
