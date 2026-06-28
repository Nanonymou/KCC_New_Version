// ============================================================
// service.gs — Generic Service Layer untuk Google Sheets
// KCC Enterprise v3.0 — M03
//
// Semua akses Spreadsheet HARUS lewat file ini.
// Dependensi: config.gs (M01), utils.gs (M02)
//
// Perubahan dari V1:
// - getSpreadsheet()  : pakai getConfig() bukan CONFIG.SPREADSHEET_ID
// - readAll()         : tambah outletId filter
// - readOne()         : tambah outletId untuk cross-tenant safety
// - readWhere()       : pre-filter outletId sebelum filterFn
// - insertRow()       : LockService + invalidate cache
// - updateRow()       : LockService + invalidate cache
// - deleteRow()       : LockService + invalidate cache
// - getCached()       : baru — CacheService wrapper
// - setCached()       : baru — CacheService wrapper
// - invalidateCache() : baru — hapus cache per prefix
// - getAppConfig()    : outletId-aware, fallback ke global
// - setAppConfig()    : outletId-aware upsert
// ============================================================


// ─── Cache Key Registry ──────────────────────────────────────
// Menyimpan daftar cache key aktif agar invalidateCache(prefix) bisa bekerja.
// Disimpan di CacheService dengan key khusus.

const _CACHE_KEY_REGISTRY = 'KCC_CACHE_REGISTRY';

/**
 * Ambil registry (list key aktif) dari CacheService.
 * @returns {string[]}
 */
function _getCacheRegistry() {
  try {
    const raw = CacheService.getScriptCache().get(_CACHE_KEY_REGISTRY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Simpan cache key ke registry.
 * @param {string} key
 */
function _registerCacheKey(key) {
  try {
    const registry = _getCacheRegistry();
    if (!registry.includes(key)) {
      registry.push(key);
      // Registry disimpan 6 jam (lebih lama dari TTL data manapun)
      CacheService.getScriptCache().put(_CACHE_KEY_REGISTRY, JSON.stringify(registry), 21600);
    }
  } catch (e) {
    // Registry failure tidak boleh block operasi utama
    console.warn('_registerCacheKey error:', e.message);
  }
}

/**
 * Hapus cache key dari registry.
 * @param {string} key
 */
function _unregisterCacheKey(key) {
  try {
    const registry = _getCacheRegistry().filter(k => k !== key);
    CacheService.getScriptCache().put(_CACHE_KEY_REGISTRY, JSON.stringify(registry), 21600);
  } catch (e) {
    console.warn('_unregisterCacheKey error:', e.message);
  }
}


// ─── Cache Helpers ────────────────────────────────────────────

/**
 * Ambil data dari CacheService (parse JSON otomatis).
 * @param {string} cacheKey
 * @returns {any|null} - null jika tidak ada atau expired
 */
function getCached(cacheKey) {
  try {
    const raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('getCached error untuk key', cacheKey, ':', e.message);
    return null;
  }
}

/**
 * Simpan data ke CacheService (stringify JSON otomatis).
 * @param {string} cacheKey
 * @param {any} data
 * @param {number} ttl - detik (default 300 = 5 menit)
 */
function setCached(cacheKey, data, ttl) {
  try {
    const ttlSec = ttl || CACHE_TTL.MASTER_DATA;
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(data), ttlSec);
    _registerCacheKey(cacheKey);
  } catch (e) {
    // CacheService bisa throw jika value terlalu besar (>100KB)
    console.warn('setCached error untuk key', cacheKey, ':', e.message);
  }
}

/**
 * Hapus semua cache key yang mengandung prefix tertentu.
 * Dipanggil setelah write operation untuk invalidate data stale.
 * @param {string} prefix - misal: 'KCC_MASTER_BAHAN_'
 */
function invalidateCache(prefix) {
  try {
    const cache = CacheService.getScriptCache();
    const registry = _getCacheRegistry();
    const toDelete = registry.filter(k => k.startsWith(prefix));

    if (toDelete.length > 0) {
      cache.removeAll(toDelete);
      const remaining = registry.filter(k => !k.startsWith(prefix));
      cache.put(_CACHE_KEY_REGISTRY, JSON.stringify(remaining), 21600);
    }
  } catch (e) {
    console.warn('invalidateCache error untuk prefix', prefix, ':', e.message);
  }
}

/**
 * Buat cache key standar untuk sheet + outlet.
 * Pattern: 'KCC_{SHEET_NAME}_{outletId}' atau 'KCC_{SHEET_NAME}_ALL' jika global.
 * @param {string} sheetName
 * @param {string|null} outletId
 * @returns {string}
 */
function _makeCacheKey(sheetName, outletId) {
  return 'KCC_' + sheetName + '_' + (outletId || 'ALL');
}


// ─── Spreadsheet Access ──────────────────────────────────────

/**
 * Ambil instance Spreadsheet.
 * ID diambil dari PropertiesService via getConfig() — tidak hardcoded.
 * Jika belum di-set: auto-create dan simpan ID ke PropertiesService.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  const id = getConfig('SPREADSHEET_ID');

  if (id) {
    return SpreadsheetApp.openById(id);
  }

  // Auto-create spreadsheet baru (setup pertama kali)
  const ss = SpreadsheetApp.create(CONFIG.APP_NAME + ' - Database');
  setConfig('SPREADSHEET_ID', ss.getId());
  console.log('Spreadsheet baru dibuat:', ss.getUrl());
  return ss;
}

/**
 * Ambil sheet berdasarkan nama. Throw jika tidak ditemukan.
 * @param {string} sheetName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  return sheet;
}


// ─── Row ↔ Object Mapping ────────────────────────────────────

/**
 * Konversi array baris mentah + array header → object.
 * @param {string[]} headers
 * @param {any[]} row
 * @returns {Object}
 */
function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

/**
 * Konversi object → array baris sesuai urutan header.
 * @param {string[]} headers
 * @param {Object} obj
 * @returns {any[]}
 */
function objToRow(headers, obj) {
  return headers.map(h => (obj[h] !== undefined ? obj[h] : ''));
}


// ─── Generic CRUD ────────────────────────────────────────────

/**
 * Baca semua data dari sheet, kembalikan sebagai array of objects.
 * Baris 1 adalah header. Baris kosong dilewati.
 *
 * @param {string} sheetName
 * @param {string|null} outletId - jika diisi, hanya return row dengan OUTLET_ID cocok.
 *   Kirim null / undefined untuk SUPER_ADMIN atau sheet yang tidak punya OUTLET_ID.
 * @returns {Object[]}
 */
function readAll(sheetName, outletId) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  let rows = data.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => rowToObj(headers, row));

  // Filter per-outlet jika diminta dan kolom OUTLET_ID tersedia di sheet ini
  if (outletId && headers.includes('OUTLET_ID')) {
    rows = rows.filter(row => String(row.OUTLET_ID) === String(outletId));
  }

  return rows;
}

/**
 * Baca satu baris berdasarkan nilai kolom tertentu.
 * Tambah outletId untuk cross-tenant safety: pastikan baris yang ditemukan
 * memang milik outlet yang benar.
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {string} keyValue
 * @param {string|null} outletId - opsional; jika diisi, validasi kepemilikan tenant
 * @returns {Object|null}
 */
function readOne(sheetName, keyColumn, keyValue, outletId) {
  const rows = readAll(sheetName); // baca semua dulu (tanpa pre-filter)
  const found = rows.find(r => String(r[keyColumn]) === String(keyValue));
  if (!found) return null;

  // Cross-tenant safety: jika outletId diberikan, pastikan cocok
  if (outletId && found.OUTLET_ID !== undefined && String(found.OUTLET_ID) !== String(outletId)) {
    // Data ada tapi bukan milik outlet ini — return null (bukan throw)
    return null;
  }

  return found;
}

/**
 * Filter baris dengan fungsi kondisi kustom.
 * outletId di-pre-filter SEBELUM filterFn dijalankan.
 *
 * @param {string} sheetName
 * @param {function(Object): boolean} filterFn
 * @param {string|null} outletId - opsional pre-filter per tenant
 * @returns {Object[]}
 */
function readWhere(sheetName, filterFn, outletId) {
  return readAll(sheetName, outletId).filter(filterFn);
}

/**
 * Cek apakah nilai sudah ada di kolom tertentu (untuk cek duplikat).
 * @param {string} sheetName
 * @param {string} column
 * @param {string} value
 * @param {string|null} outletId - opsional, untuk scope per outlet
 * @returns {boolean}
 */
function exists(sheetName, column, value, outletId) {
  return readOne(sheetName, column, value, outletId) !== null;
}

/**
 * Tambah baris baru ke sheet.
 * Dilindungi LockService untuk mencegah race condition concurrent write.
 * Otomatis invalidate cache untuk sheet + outlet terkait.
 *
 * @param {string} sheetName
 * @param {Object} data - object dengan key sesuai nama header
 * @returns {Object} data yang ditambahkan (termasuk timestamp)
 */
function insertRow(sheetName, data) {
  const headers = HEADERS[sheetName];
  if (!headers) throw new Error(`HEADERS untuk "${sheetName}" tidak terdefinisi di config.gs`);

  // Inject timestamp otomatis
  const ts = now();
  if (headers.includes('CREATED_AT')) data.CREATED_AT = ts;
  if (headers.includes('UPDATED_AT')) data.UPDATED_AT = ts;

  const row = objToRow(headers, data);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000); // tunggu maks 5 detik, throw jika timeout
  try {
    const sheet = getSheet(sheetName);
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  // Invalidate cache untuk sheet ini (semua outlet dan outlet spesifik)
  invalidateCache('KCC_' + sheetName + '_');

  return data;
}

/**
 * Update baris yang cocok dengan keyColumn=keyValue.
 * Dilindungi LockService. Otomatis invalidate cache.
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {string} keyValue
 * @param {Object} updateData - field yang diupdate (partial update didukung)
 * @param {string|null} outletId - opsional, untuk cross-tenant safety sebelum update
 * @returns {boolean} true jika ditemukan dan diupdate
 */
function updateRow(sheetName, keyColumn, keyValue, updateData, outletId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf(keyColumn);
    if (keyIdx === -1) throw new Error(`Kolom "${keyColumn}" tidak ada di sheet "${sheetName}"`);

    const outletIdx = headers.indexOf('OUTLET_ID');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][keyIdx]) !== String(keyValue)) continue;

      // Cross-tenant safety: jika outletId diberikan, pastikan baris ini milik outlet itu
      if (outletId && outletIdx !== -1 && String(data[i][outletIdx]) !== String(outletId)) {
        return false; // baris ditemukan tapi bukan milik outlet ini
      }

      const existing = rowToObj(headers, data[i]);
      const merged = Object.assign({}, existing, updateData, { UPDATED_AT: now() });
      const newRow = objToRow(headers, merged);

      sheet.getRange(i + 1, 1, 1, headers.length).setValues([newRow]);

      // Invalidate cache
      invalidateCache('KCC_' + sheetName + '_');
      return true;
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hapus baris berdasarkan key (hard delete).
 * Untuk soft delete, gunakan updateRow dengan field AKTIF = 'FALSE'.
 * Dilindungi LockService. Otomatis invalidate cache.
 *
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {string} keyValue
 * @param {string|null} outletId - opsional, untuk cross-tenant safety
 * @returns {boolean}
 */
function deleteRow(sheetName, keyColumn, keyValue, outletId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf(keyColumn);
    if (keyIdx === -1) throw new Error(`Kolom "${keyColumn}" tidak ada di sheet "${sheetName}"`);

    const outletIdx = headers.indexOf('OUTLET_ID');

    // Iterasi dari bawah agar index tidak bergeser setelah deleteRow
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][keyIdx]) !== String(keyValue)) continue;

      // Cross-tenant safety
      if (outletId && outletIdx !== -1 && String(data[i][outletIdx]) !== String(outletId)) {
        return false;
      }

      sheet.deleteRow(i + 1);

      // Invalidate cache
      invalidateCache('KCC_' + sheetName + '_');
      return true;
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}


// ─── App Config Accessor ─────────────────────────────────────

/**
 * Ambil satu nilai dari MASTER_CONFIG.
 * Urutan lookup:
 *   1. Row dengan KEY = key DAN OUTLET_ID = outletId (per-outlet config)
 *   2. Row dengan KEY = key DAN OUTLET_ID kosong/null (global config)
 *
 * @param {string} key
 * @param {string|null} outletId - opsional
 * @returns {string|null}
 */
function getAppConfig(key, outletId) {
  const allRows = readAll(SHEET.APP_CONFIG); // baca semua tanpa filter outlet
  const allForKey = allRows.filter(r => String(r.KEY) === String(key));

  if (outletId) {
    // Cari config spesifik outlet ini
    const outletRow = allForKey.find(r => String(r.OUTLET_ID) === String(outletId));
    if (outletRow) return outletRow.VALUE;
  }

  // Fallback ke global config (OUTLET_ID kosong atau tidak ada)
  const globalRow = allForKey.find(r => !r.OUTLET_ID || r.OUTLET_ID === '');
  return globalRow ? globalRow.VALUE : null;
}

/**
 * Set / update satu nilai di MASTER_CONFIG, scoped ke outletId.
 * Jika outletId null → set global config.
 * Upsert: update jika sudah ada, insert jika belum.
 *
 * @param {string} key
 * @param {string} value
 * @param {string|null} outletId - opsional
 */
function setAppConfig(key, value, outletId) {
  const allRows = readAll(SHEET.APP_CONFIG);
  const existing = allRows.find(r => {
    const keyMatch = String(r.KEY) === String(key);
    if (outletId) {
      return keyMatch && String(r.OUTLET_ID) === String(outletId);
    }
    return keyMatch && (!r.OUTLET_ID || r.OUTLET_ID === '');
  });

  if (existing) {
    updateRow(SHEET.APP_CONFIG, 'KEY', key, { VALUE: value });
  } else {
    insertRow(SHEET.APP_CONFIG, {
      KEY       : key,
      VALUE     : value,
      OUTLET_ID : outletId || '',
      DESKRIPSI : '',
    });
  }
}
