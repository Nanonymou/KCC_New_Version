// ============================================================
// inventory_config.gs — Konfigurasi Inventory Engine
// Tambahan SHEET dan HEADERS khusus inventory.
// Tidak mengubah config.gs (Recipe Engine).
// ============================================================

// Nama sheet inventory (terpisah dari SHEET di config.gs)
const INV_SHEET = {
  STOCK_CARD : 'STOCK_CARD',
  PURCHASE   : 'PURCHASE',
  PRODUCTION : 'PRODUCTION',
  SALES      : 'SALES',
};

// Header kolom setiap sheet inventory
const INV_HEADERS = {

  // ─── STOCK_CARD ─────────────────────────────────────────────
  // Satu baris per lot stok (FIFO layer).
  // Setiap pembelian = 1 lot baru. Produksi/Penjualan menggerus lot dari atas.
  STOCK_CARD: [
    'OUTLET_ID',       // FK → MASTER_OUTLET (multi-outlet filter)
    'ID_KARTU',        // SC-YYYYMMDD-NNN (unik per baris)
    'ID_BAHAN',        // FK → MASTER_BAHAN
    'NAMA_BAHAN',      // denormalized untuk kemudahan baca
    'TANGGAL',         // tanggal transaksi (ISO date string)
    'JENIS',           // IN | OUT | ADJUSTMENT
    'REFERENSI',       // ID transaksi sumber (PUR-xxx, PRD-xxx, SLS-xxx)
    'LOT_ID',          // ID lot FIFO (PUR-xxx) — kosong jika OUT/ADJUSTMENT
    'QTY_MASUK',       // satuan pakai
    'QTY_KELUAR',      // satuan pakai
    'SISA_LOT',        // sisa qty dalam lot ini setelah transaksi OUT
    'HARGA_PER_UNIT',  // harga beli per satuan pakai (dari lot)
    'NILAI_MASUK',     // QTY_MASUK × HARGA_PER_UNIT
    'NILAI_KELUAR',    // QTY_KELUAR × HARGA_PER_UNIT (FIFO cost)
    'STOK_AKHIR_QTY',  // akumulatif qty (dihitung saat insert)
    'STOK_AKHIR_NILAI',// akumulatif nilai (dihitung saat insert)
    'CATATAN',
    'CREATED_AT',
  ],

  // ─── PURCHASE ───────────────────────────────────────────────
  // Header pembelian bahan baku. Setiap baris = 1 item bahan dalam 1 PO.
  PURCHASE: [
    'OUTLET_ID',       // FK → MASTER_OUTLET (multi-outlet filter)
    'ID_PURCHASE',     // PUR-YYYYMMDD-NNN
    'TANGGAL',
    'ID_SUPPLIER',     // FK → MASTER_SUPPLIER
    'NAMA_SUPPLIER',   // denormalized
    'ID_BAHAN',        // FK → MASTER_BAHAN
    'NAMA_BAHAN',      // denormalized
    'QTY_BELI',        // satuan beli (kg, liter, karung, dll)
    'SATUAN_BELI',
    'KONVERSI',        // 1 satuan beli = N satuan pakai (snapshot saat beli)
    'QTY_PAKAI',       // = QTY_BELI × KONVERSI (satuan pakai)
    'HARGA_SATUAN',    // harga per satuan beli
    'TOTAL_HARGA',     // = QTY_BELI × HARGA_SATUAN
    'STATUS',          // POSTED | VOID
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ─── PRODUCTION ─────────────────────────────────────────────
  // Produksi: mengeluarkan bahan (sesuai resep) dan mencatat hasil produk jadi.
  PRODUCTION: [
    'OUTLET_ID',       // FK → MASTER_OUTLET (multi-outlet filter)
    'ID_PRODUKSI',     // PRD-YYYYMMDD-NNN
    'TANGGAL',
    'ID_PRODUK',       // FK → MASTER_PRODUK
    'NAMA_PRODUK',     // denormalized
    'JUMLAH_BATCH',    // berapa batch yang dibuat
    'QTY_HASIL',       // = JUMLAH_BATCH × YIELD_PCS
    'HPP_PER_BATCH',   // dari recipe_engine (snapshot saat produksi)
    'TOTAL_HPP',       // = JUMLAH_BATCH × HPP_PER_BATCH
    'STATUS',          // POSTED | VOID
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ─── SALES ──────────────────────────────────────────────────
  // Penjualan produk jadi. Tidak langsung keluar bahan (sudah keluar saat produksi).
  // Dicatat untuk tracking revenue & margin.
  SALES: [
    'OUTLET_ID',       // FK → MASTER_OUTLET (multi-outlet filter)
    'ID_SALES',        // SLS-YYYYMMDD-NNN
    'TANGGAL',
    'ID_PRODUK',       // FK → MASTER_PRODUK
    'NAMA_PRODUK',     // denormalized
    'QTY_JUAL',
    'SATUAN_JUAL',
    'HARGA_JUAL',      // per unit
    'TOTAL_PENJUALAN', // = QTY_JUAL × HARGA_JUAL
    'HPP_PER_UNIT',    // snapshot dari MASTER_PRODUK.HPP saat dijual
    'TOTAL_HPP',       // = QTY_JUAL × HPP_PER_UNIT
    'MARGIN_NILAI',    // = TOTAL_PENJUALAN - TOTAL_HPP
    'MARGIN_PCT',      // = MARGIN_NILAI / TOTAL_PENJUALAN × 100
    'STATUS',          // POSTED | VOID
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

};
