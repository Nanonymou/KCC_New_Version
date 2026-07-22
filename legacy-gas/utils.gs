// ============================================================
// utils.gs — Fungsi utilitas umum
// V3 Enterprise: semua layer boleh memanggil file ini.
// File ini TIDAK boleh memanggil service.gs atau master.gs.
// Dependensi satu-satunya: config.gs (getConfig).
// ============================================================


// ─── In-Memory Cache untuk Log Level ────────────────────────
// Bug V1: writeLog() memanggil getAppConfig('LOG_LEVEL') setiap kali
// dipanggil → 1 Spreadsheet read per log entry.
// Fix: baca sekali, simpan di _logLevel. Diresetdi invalidateLogLevel().

let _logLevel = null;

/**
 * Ambil log level yang efektif (cached).
 * Urutan prioritas: PropertiesService → default INFO.
 * @returns {string} 'INFO' | 'WARN' | 'ERROR'
 */
function _getLogLevel() {
  if (!_logLevel) {
    _logLevel = getConfig('LOG_LEVEL', 'INFO').toUpperCase();
    if (!['INFO','WARN','ERROR'].includes(_logLevel)) _logLevel = 'INFO';
  }
  return _logLevel;
}

/** Invalidate log level cache (dipanggil setelah setConfig LOG_LEVEL) */
function invalidateLogLevel() {
  _logLevel = null;
}


// ─── ID Generator ───────────────────────────────────────────

/**
 * Generate ID dengan prefix dan zero-padding.
 * Contoh: generateId('B', 3) → 'B003'
 * @param {string} prefix
 * @param {number} lastNumber
 * @param {number} [padding=3]
 * @returns {string}
 */
function generateId(prefix, lastNumber, padding = 3) {
  const next = (parseInt(lastNumber) || 0) + 1;
  return prefix + String(next).padStart(padding, '0');
}

/**
 * Ambil nomor urut terakhir dari array ID (format PREFIX + angka).
 * Contoh: getLastNumber(['B001','B002','B005']) → 5
 * @param {string[]} ids
 * @returns {number}
 */
function getLastNumber(ids) {
  if (!ids || ids.length === 0) return 0;
  const numbers = ids.map(id => parseInt(String(id).replace(/\D/g, '')) || 0);
  return Math.max(...numbers);
}

/**
 * Generate ID dengan format tanggal untuk transaksi.
 * Contoh: generateTxId('PUR') → 'PUR-20250628-001'
 * @param {string} prefix
 * @param {string[]} existingIds - ID yang sudah ada hari ini
 * @returns {string}
 */
function generateTxId(prefix, existingIds = []) {
  const tz       = getConfig('DEFAULT_TIMEZONE', 'Asia/Jakarta');
  const today    = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const pattern  = new RegExp('^' + prefix + '-' + today + '-(\\d+)$');
  const todayNums = existingIds
    .map(id => { const m = String(id).match(pattern); return m ? parseInt(m[1]) : 0; })
    .filter(n => n > 0);
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}-${today}-${String(next).padStart(3, '0')}`;
}


// ─── Date & Time ────────────────────────────────────────────

/**
 * Timestamp ISO sekarang, menggunakan timezone dari PropertiesService.
 * Bug V1: pakai CONFIG.TIMEZONE (hardcoded).
 * Fix V3: getConfig('DEFAULT_TIMEZONE') dengan fallback Asia/Jakarta.
 * @returns {string} e.g. "2025-06-28T14:30:00"
 */
function now() {
  const tz = getConfig('DEFAULT_TIMEZONE', 'Asia/Jakarta');
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Format tanggal ke string lokal.
 * @param {Date|string} date
 * @param {string} [fmt='dd/MM/yyyy']
 * @param {string} [tz] - override timezone (opsional, default dari config)
 * @returns {string}
 */
function formatDate(date, fmt = 'dd/MM/yyyy', tz = null) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const timezone = tz || getConfig('DEFAULT_TIMEZONE', 'Asia/Jakarta');
  return Utilities.formatDate(d, timezone, fmt);
}

/**
 * Normalise nilai tanggal dari Sheets (bisa Date object atau string).
 * GAS kadang kembalikan Date object, bukan string.
 * @param {Date|string} val
 * @returns {string} ISO date string
 */
function normalizeTanggal(val) {
  if (!val) return '';
  if (val instanceof Date) return formatDate(val, "yyyy-MM-dd");
  return String(val);
}


// ─── Number & Currency ──────────────────────────────────────

/**
 * Format angka ke Rupiah.
 * @param {number} value
 * @returns {string} e.g. "Rp 12.500"
 */
function formatRupiah(value) {
  if (value == null || isNaN(value)) return 'Rp 0';
  return 'Rp ' + Number(value).toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Parse string Rupiah ke number.
 * @param {string} str
 * @returns {number}
 */
function parseRupiah(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[Rp.\s]/g, '').replace(',', '.')) || 0;
}

/**
 * Hitung persentase margin (2 desimal).
 * @param {number} hargaJual
 * @param {number} hpp
 * @returns {number}
 */
function calcMargin(hargaJual, hpp) {
  if (!hargaJual || hargaJual === 0) return 0;
  return parseFloat(((hargaJual - hpp) / hargaJual * 100).toFixed(2));
}

/**
 * Pembulatan 2 desimal (hindari floating-point artefak).
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}


// ─── Response Builder ────────────────────────────────────────

/**
 * Standard response sukses untuk google.script.run.
 * @param {*} data
 * @param {string} [message]
 * @returns {{success: true, data: *, message: string}}
 */
function ok(data, message = 'Berhasil') {
  return { success: true, data, message };
}

/**
 * Standard response error — TIDAK pernah sertakan stack trace.
 * @param {string} message - pesan aman untuk ditampilkan ke client
 * @param {string} [code] - kode error opsional untuk client handling
 * @returns {{success: false, data: null, message: string, code: string}}
 */
function fail(message, code = 'ERROR') {
  return { success: false, data: null, message, code };
}

/**
 * Response khusus auth error — dipakai client untuk redirect ke login.
 * @param {string} [message]
 * @returns {{success: false, data: null, message: string, code: 'AUTH_REQUIRED'}}
 */
function failAuth(message = 'Sesi tidak valid atau telah berakhir. Silakan login kembali.') {
  return fail(message, 'AUTH_REQUIRED');
}

/**
 * Response khusus permission error.
 * @param {string} [message]
 * @returns {{success: false, data: null, message: string, code: 'FORBIDDEN'}}
 */
function failForbidden(message = 'Anda tidak memiliki akses untuk melakukan tindakan ini.') {
  return fail(message, 'FORBIDDEN');
}


// ─── Security — Password & Token ────────────────────────────

/**
 * Generate salt acak 16 karakter.
 * Dipakai saat membuat user baru.
 * @returns {string}
 */
function generateSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = Utilities.getSecureRandomBytes(16);
  const arr   = new Uint8Array(bytes);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

/**
 * Generate session token acak 32 karakter.
 * @returns {string}
 */
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = Utilities.getSecureRandomBytes(32);
  const arr   = new Uint8Array(bytes);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

/**
 * Hash password dengan HMAC-SHA256 menggunakan APP_SECRET + per-user salt.
 * GAS tidak punya bcrypt, ini best available approach.
 *
 * Rumus: HMAC-SHA256(key=APP_SECRET, message=salt+password)
 *
 * CATATAN: APP_SECRET harus di-set via PropertiesService sebelum dipakai.
 * Jika APP_SECRET kosong, fungsi ini throw — bukan silent fail.
 *
 * @param {string} password - password plaintext
 * @param {string} salt     - salt unik per user (dari generateSalt())
 * @returns {string}        - hex string
 */
function hashPassword(password, salt) {
  const secret = getConfig('APP_SECRET');
  if (!secret) throw new Error('APP_SECRET belum di-set di PropertiesService.');

  const message    = salt + password;
  const keyBytes   = Utilities.newBlob(secret).getBytes();
  const msgBytes   = Utilities.newBlob(message).getBytes();
  const hmacBytes  = Utilities.computeHmacSha256Signature(msgBytes, keyBytes);

  // Convert byte array ke hex string
  return hmacBytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * Verifikasi password plaintext terhadap hash yang tersimpan.
 * @param {string} password     - input dari user
 * @param {string} salt         - salt dari MASTER_USER
 * @param {string} storedHash   - hash dari MASTER_USER
 * @returns {boolean}
 */
function verifyPassword(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  try {
    const inputHash = hashPassword(password, salt);
    // Constant-time comparison — hindari timing attack
    if (inputHash.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < inputHash.length; i++) {
      diff |= inputHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return diff === 0;
  } catch (e) {
    return false;
  }
}


// ─── Logger ─────────────────────────────────────────────────

/**
 * Tulis log ke sheet SYSTEM_LOG.
 *
 * Perbaikan dari V1:
 * - LOG_LEVEL dibaca dari PropertiesService (cached) — bukan Spreadsheet per call
 * - Tambah parameter userId dan outletId (dari session)
 * - Kolom USER diganti USER_ID, tambah OUTLET_ID dan IP_INFO
 * - Stack trace tidak pernah ditulis ke log (keamanan)
 *
 * Tidak throw error — log tidak boleh menghentikan proses utama.
 *
 * @param {string} level    - INFO | WARN | ERROR
 * @param {string} module   - nama file pemanggil (e.g. 'master', 'auth')
 * @param {string} action   - CREATE | READ | UPDATE | DELETE | AUTH | SYSTEM | ERROR
 * @param {string} message  - pesan singkat
 * @param {Object} [detail] - data tambahan (jangan masukkan password/token)
 * @param {string} [userId]   - dari session.userId (opsional)
 * @param {string} [outletId] - dari session.outletId (opsional)
 */
function writeLog(level, module, action, message, detail = null, userId = '', outletId = '') {
  try {
    const levels = { INFO: 0, WARN: 1, ERROR: 2 };
    const minLevel = levels[_getLogLevel()] || 0;
    if ((levels[level] || 0) < minLevel) return;

    const ss = getSpreadsheet();
    if (!ss) return;
    const sheet = ss.getSheetByName(SHEET.LOG);
    if (!sheet) return;

    // Sanitasi detail — hapus field sensitif sebelum log
    let detailStr = '';
    if (detail) {
      const safe = Object.assign({}, detail);
      delete safe.password;
      delete safe.token;
      delete safe.PASSWORD_HASH;
      delete safe.SALT;
      detailStr = JSON.stringify(safe);
    }

    sheet.appendRow([
      now(),                              // TIMESTAMP
      level,                             // LEVEL
      module,                            // MODULE
      action,                            // ACTION
      message,                           // MESSAGE
      userId  || 'system',               // USER_ID
      outletId || '',                    // OUTLET_ID
      '',                                // IP_INFO (belum tersedia di GAS WebApp tanpa workaround)
      detailStr,                         // DETAIL
    ]);
  } catch (e) {
    // Silent — log error tidak boleh cascade ke proses utama
    console.error('LOG FAILED:', e.message);
  }
}

/**
 * Shorthand logger — terima session opsional untuk user/outlet context.
 * @example
 *   log.info('master', 'CREATE', 'Bahan baru ditambahkan', { id }, session);
 */
const log = {
  info  : (mod, act, msg, detail, session) =>
    writeLog('INFO',  mod, act, msg, detail, session?.userId, session?.outletId),
  warn  : (mod, act, msg, detail, session) =>
    writeLog('WARN',  mod, act, msg, detail, session?.userId, session?.outletId),
  error : (mod, act, msg, detail, session) =>
    writeLog('ERROR', mod, act, msg, detail, session?.userId, session?.outletId),
};


// ─── Validation ──────────────────────────────────────────────

/**
 * Validasi field wajib ada dan tidak kosong.
 * @param {Object} data
 * @param {string[]} requiredFields
 * @returns {{valid: boolean, missing: string[]}}
 */
function validateRequired(data, requiredFields) {
  if (!data || typeof data !== 'object') {
    return { valid: false, missing: requiredFields };
  }
  const missing = requiredFields.filter(f => {
    const val = data[f];
    return val === undefined || val === null || String(val).trim() === '';
  });
  return { valid: missing.length === 0, missing };
}

/**
 * Sanitasi string — trim dan cegah formula injection di Sheets.
 *
 * Fix V1: tidak ada guard untuk null/non-string.
 * Fix V3: return '' untuk null/undefined, return as-is untuk non-string non-null.
 *
 * @param {*} val
 * @returns {string|*} string yang aman, atau nilai asli jika bukan string
 */
function sanitize(val) {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'string') return val;           // number, boolean — biarkan
  return val.trim().replace(/^[=+\-@|`]/, "'$&");   // prefix formula + tambahan | dan `
}

/**
 * Sanitasi object — jalankan sanitize() pada semua field string.
 * @param {Object} obj
 * @param {string[]} fields - daftar field yang disanitasi
 * @returns {Object} obj yang sudah disanitasi (mutasi in-place)
 */
function sanitizeFields(obj, fields) {
  if (!obj) return obj;
  fields.forEach(f => {
    if (obj[f] !== undefined) obj[f] = sanitize(obj[f]);
  });
  return obj;
}

/**
 * Validasi format email (basic).
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validasi bahwa nilai adalah angka positif.
 * @param {*} val
 * @param {boolean} [allowZero=false]
 * @returns {boolean}
 */
function isPositiveNumber(val, allowZero = false) {
  const n = Number(val);
  return !isNaN(n) && (allowZero ? n >= 0 : n > 0);
}
