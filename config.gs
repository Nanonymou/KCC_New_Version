// ============================================================
// config.gs — Konstanta global, nama sheet, dan header kolom
// V3 Enterprise: semua nilai runtime diambil dari PropertiesService.
// File ini hanya berisi: nama konstanta, nama sheet, nama kolom.
// TIDAK ADA nilai hardcoded seperti SPREADSHEET_ID atau TIMEZONE.
// ============================================================


// ─── Runtime Config (nilai dari PropertiesService) ──────────
//
// Ambil via: getConfig('KEY')   → lihat fungsi di bawah
// Set  via:  setConfig('KEY', value)
//
// Kunci wajib yang harus di-set sebelum pertama kali digunakan:
//   SPREADSHEET_ID   — ID Google Spreadsheet database
//   DEFAULT_TIMEZONE — default jika outlet tidak punya timezone sendiri
//   APP_SECRET       — secret key untuk HMAC session token
//   LOG_LEVEL        — INFO | WARN | ERROR (default: INFO)
//
// Cara set (jalankan sekali dari Apps Script editor):
//   function initProperties() {
//     PropertiesService.getScriptProperties().setProperties({
//       SPREADSHEET_ID  : 'YOUR_SPREADSHEET_ID',
//       DEFAULT_TIMEZONE: 'Asia/Makassar',
//       APP_SECRET      : 'ganti-dengan-random-string-panjang',
//       LOG_LEVEL       : 'INFO',
//     });
//   }

/** @type {Object} In-memory cache untuk PropertiesService — hindari re-read */
let _configCache = null;

/**
 * Ambil semua config dari PropertiesService (cached).
 * @returns {Object}
 */
function getAllConfig() {
  if (!_configCache) {
    _configCache = PropertiesService.getScriptProperties().getProperties();
  }
  return _configCache;
}

/**
 * Ambil satu nilai config.
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
function getConfig(key, fallback = '') {
  return getAllConfig()[key] || fallback;
}

/**
 * Set satu nilai config (persistent + invalidate cache).
 * @param {string} key
 * @param {string} value
 */
function setConfig(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  _configCache = null; // invalidate
}

/**
 * Set banyak nilai config sekaligus.
 * @param {Object} props
 */
function setConfigBatch(props) {
  PropertiesService.getScriptProperties().setProperties(props);
  _configCache = null;
}

/** Invalidate config cache (dipanggil setelah update) */
function invalidateConfigCache() {
  _configCache = null;
}

// Shorthand yang dipakai di seluruh codebase
const APP_NAME       = 'Kitchen Cost Control Enterprise';
const APP_VERSION    = '3.0.0';


// ─── Nama Sheet ──────────────────────────────────────────────

const SHEET = {
  // Master data (per-outlet: semua punya kolom OUTLET_ID)
  BAHAN      : 'MASTER_BAHAN',
  PRODUK     : 'MASTER_PRODUK',
  RESEP      : 'MASTER_RESEP',
  SUPPLIER   : 'MASTER_SUPPLIER',

  // Multi-tenant core
  OUTLET     : 'MASTER_OUTLET',
  USER       : 'MASTER_USER',

  // Config & Log (global, bukan per-outlet)
  APP_CONFIG : 'MASTER_CONFIG',
  LOG        : 'SYSTEM_LOG',
};

// Nama sheet inventory (dari inventory_config.gs — tidak diubah)
// INV_SHEET tetap di inventory_config.gs


// ─── Header Kolom ────────────────────────────────────────────
//
// PENTING: urutan array = urutan kolom di Spreadsheet.
// Semua sheet transaksional/master wajib punya OUTLET_ID di posisi kedua
// (setelah primary key) agar filter per-outlet selalu O(1) column lookup.

const HEADERS = {

  // ── Outlet (super-admin only) ────────────────────────────
  MASTER_OUTLET: [
    'ID_OUTLET',     // O001, O002, …
    'KODE_OUTLET',   // kode pendek unik, dipakai saat login (e.g. "DMSUM01")
    'NAMA_OUTLET',   // nama tampilan
    'STATUS',        // ACTIVE | INACTIVE
    'TIMEZONE',      // e.g. Asia/Makassar — override DEFAULT_TIMEZONE
    'CURRENCY',      // e.g. IDR
    'ALAMAT',
    'PIC',           // Person in Charge outlet
    'TELEPON',
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ── User (login credentials) ─────────────────────────────
  MASTER_USER: [
    'ID_USER',       // U001, U002, …
    'OUTLET_ID',     // FK → MASTER_OUTLET. NULL = Super Admin (akses semua outlet)
    'USERNAME',      // unik per sistem (bukan hanya per outlet)
    'PASSWORD_HASH', // HMAC-SHA256(password + SALT)
    'SALT',          // random string 16 char, unik per user
    'ROLE',          // SUPER_ADMIN | ADMIN | MANAGER | VIEWER
    'NAMA_LENGKAP',
    'AKTIF',
    'LAST_LOGIN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ── Bahan (per-outlet) ──────────────────────────────────
  MASTER_BAHAN: [
    'ID_BAHAN',
    'OUTLET_ID',       // ← BARU: tenant filter
    'NAMA_BAHAN',
    'KATEGORI',
    'ID_SUPPLIER',
    'SATUAN_BELI',
    'SATUAN_PAKAI',
    'KONVERSI',
    'HARGA_TERAKHIR',
    'HARGA_RATA2',
    'STOK_MINIMUM',
    'AKTIF',
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ── Produk (per-outlet) ─────────────────────────────────
  MASTER_PRODUK: [
    'ID_PRODUK',
    'OUTLET_ID',       // ← BARU
    'NAMA_PRODUK',
    'KATEGORI',
    'HARGA_JUAL',
    'HPP',
    'MARGIN_PCT',
    'YIELD_PCS',
    'SATUAN_JUAL',
    'AKTIF',
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ── Resep (per-outlet) ──────────────────────────────────
  MASTER_RESEP: [
    'ID_RESEP',
    'OUTLET_ID',       // ← BARU
    'ID_PRODUK',
    'ID_BAHAN',
    'JUMLAH',
    'SATUAN',
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ── Supplier (per-outlet) ────────────────────────────────
  MASTER_SUPPLIER: [
    'ID_SUPPLIER',
    'OUTLET_ID',       // ← BARU
    'NAMA_SUPPLIER',
    'PIC',
    'TELEPON',
    'ALAMAT',
    'AKTIF',
    'CATATAN',
    'CREATED_AT',
    'UPDATED_AT',
  ],

  // ── App Config (per-outlet, difilter by OUTLET_ID) ───────
  MASTER_CONFIG: [
    'OUTLET_ID',       // ← BARU: NULL = global, isi = per-outlet
    'KEY',
    'VALUE',
    'DESKRIPSI',
    'UPDATED_AT',
  ],

  // ── System Log (global + outlet info) ───────────────────
  SYSTEM_LOG: [
    'TIMESTAMP',
    'LEVEL',          // INFO | WARN | ERROR
    'MODULE',         // nama file .gs pemanggil
    'ACTION',         // CREATE | READ | UPDATE | DELETE | AUTH | SYSTEM | ERROR
    'MESSAGE',
    'USER_ID',        // ← BARU: dari session
    'OUTLET_ID',      // ← BARU: dari session
    'IP_INFO',        // ← BARU: dari request jika tersedia
    'DETAIL',         // JSON string
  ],

};


// ─── Default App Config ──────────────────────────────────────
//
// Diinsert saat setup() untuk setiap outlet baru.
// OUTLET_ID akan di-inject saat insert (tidak di sini).

const DEFAULT_OUTLET_CONFIG = [
  { KEY: 'HPP_METHOD',      VALUE: 'WEIGHTED_AVG', DESKRIPSI: 'Metode kalkulasi HPP: WEIGHTED_AVG | FIFO' },
  { KEY: 'LOW_STOCK_ALERT', VALUE: 'TRUE',          DESKRIPSI: 'Aktifkan alert stok minimum' },
  { KEY: 'TAX_RATE',        VALUE: '0',             DESKRIPSI: 'Persentase pajak (0 = tidak ada)' },
  { KEY: 'MARGIN_WARNING',  VALUE: '20',            DESKRIPSI: 'Threshold margin rendah (%)' },
];

// Config global (bukan per-outlet)
const DEFAULT_GLOBAL_CONFIG = [
  { KEY: 'LOG_LEVEL', VALUE: 'INFO', DESKRIPSI: 'Level log minimum (INFO/WARN/ERROR)' },
];


// ─── Role Hierarchy ──────────────────────────────────────────

const ROLES = {
  SUPER_ADMIN : 'SUPER_ADMIN',  // akses semua outlet, bisa CRUD outlet & user
  ADMIN       : 'ADMIN',        // akses satu outlet, bisa CRUD semua data outlet
  MANAGER     : 'MANAGER',      // akses satu outlet, read-only untuk config
  VIEWER      : 'VIEWER',       // read-only semua data outlet
};

/** Bobot role untuk perbandingan (lebih tinggi = lebih banyak akses) */
const ROLE_LEVEL = {
  SUPER_ADMIN : 100,
  ADMIN       : 70,
  MANAGER     : 40,
  VIEWER      : 10,
};

/**
 * Cek apakah role memiliki akses minimal yang dibutuhkan.
 * @param {string} userRole
 * @param {string} requiredRole
 * @returns {boolean}
 */
function hasPermission(userRole, requiredRole) {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
}


// ─── Session Config ──────────────────────────────────────────

const SESSION = {
  TTL_SECONDS  : 8 * 60 * 60,   // 8 jam
  TOKEN_PREFIX : 'KCC_SESSION_', // prefix key di CacheService
};


// ─── Cache TTL ───────────────────────────────────────────────

const CACHE_TTL = {
  MASTER_DATA : 5 * 60,   // 5 menit untuk Bahan, Produk, Supplier, Resep
  OUTLET_DATA : 10 * 60,  // 10 menit untuk data outlet (jarang berubah)
  SESSION     : SESSION.TTL_SECONDS,
};
