// ============================================================
// outlet.gs — Outlet Management
// KCC Enterprise v3.0 — M05
//
// File baru (tidak ada di V1). Menangani CRUD outlet.
// Semua fungsi publik hanya bisa diakses SUPER_ADMIN,
// kecuali getOutletById dan getOutletAll yang ADMIN bisa
// akses untuk outlet sendiri.
//
// Dependensi: config.gs (M01), utils.gs (M02),
//             service.gs (M03), auth.gs (M04)
// ============================================================


// ─── Internal Helpers ────────────────────────────────────────

/**
 * Generate ID outlet berikutnya: O001, O002, dst.
 * @returns {string}
 */
function _generateOutletId() {
  const existing = readAll(SHEET.OUTLET).map(o => o.ID_OUTLET);
  return generateTxId('O', existing);
}

/**
 * Generate KODE_OUTLET dari nama outlet (uppercase, max 8 char, tanpa spasi).
 * Jika sudah ada yang sama, tambah suffix angka.
 * @param {string} namaOutlet
 * @returns {string}
 */
function _generateKodeOutlet(namaOutlet) {
  const base = sanitize(namaOutlet)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 8);

  if (!base) return 'OUTLET' + Date.now().toString().slice(-3);

  // Cek duplikat
  const existing = readAll(SHEET.OUTLET).map(o => o.KODE_OUTLET);
  if (!existing.includes(base)) return base;

  // Tambah suffix numerik
  let n = 1;
  while (existing.includes(base.substring(0, 6) + String(n).padStart(2, '0'))) {
    n++;
  }
  return base.substring(0, 6) + String(n).padStart(2, '0');
}

/**
 * Validasi field wajib outlet dan kembalikan error message atau null.
 * @param {Object} data
 * @returns {string|null}
 */
function _validateOutletData(data) {
  if (!data.namaOutlet || !sanitize(data.namaOutlet)) {
    return 'Nama outlet wajib diisi.';
  }
  if (data.timezone && typeof data.timezone !== 'string') {
    return 'Timezone tidak valid.';
  }
  if (data.currency && !/^[A-Z]{3}$/.test(data.currency)) {
    return 'Currency harus 3 huruf kapital (misal: IDR, USD).';
  }
  return null;
}


// ─── Create Outlet ───────────────────────────────────────────

/**
 * Buat outlet baru.
 * Hanya SUPER_ADMIN.
 *
 * @param {Object} data
 *   @param {string} data.namaOutlet    - wajib
 *   @param {string} [data.kodeOutlet]  - opsional; auto-generate jika kosong
 *   @param {string} [data.timezone]    - default: getConfig('DEFAULT_TIMEZONE')
 *   @param {string} [data.currency]    - default: 'IDR'
 *   @param {string} [data.alamat]
 *   @param {string} [data.telepon]
 *   @param {string} [data.email]
 * @param {Object} session - dari validateRequest()
 * @returns {{ success: boolean, outletId?: string, kodeOutlet?: string }}
 */
function createOutlet(data, session) {
  // Auth
  if (!hasPermission(session.role, ROLES.SUPER_ADMIN)) {
    return failForbidden('Hanya SUPER_ADMIN yang dapat membuat outlet baru.');
  }

  // Validasi
  const validErr = _validateOutletData(data);
  if (validErr) return fail(validErr, 'INVALID_INPUT');

  const namaOutlet  = sanitize(data.namaOutlet);
  const kodeOutlet  = data.kodeOutlet
    ? sanitize(data.kodeOutlet).toUpperCase()
    : _generateKodeOutlet(namaOutlet);
  const timezone    = sanitize(data.timezone || getConfig('DEFAULT_TIMEZONE', 'Asia/Jakarta'));
  const currency    = (data.currency || 'IDR').toUpperCase();

  // Cek duplikat kode
  if (exists(SHEET.OUTLET, 'KODE_OUTLET', kodeOutlet)) {
    return fail('KODE_OUTLET "' + kodeOutlet + '" sudah digunakan.', 'DUPLICATE');
  }

  try {
    const outletId = _generateOutletId();

    const newOutlet = {
      ID_OUTLET    : outletId,
      KODE_OUTLET  : kodeOutlet,
      NAMA_OUTLET  : namaOutlet,
      STATUS       : 'ACTIVE',
      TIMEZONE     : timezone,
      CURRENCY     : currency,
      ALAMAT       : sanitize(data.alamat   || ''),
      TELEPON      : sanitize(data.telepon  || ''),
      EMAIL        : sanitize(data.email    || ''),
    };

    insertRow(SHEET.OUTLET, newOutlet);

    // Init config default untuk outlet baru
    initOutletConfig(outletId);

    log.info('OUTLET', 'CREATE', 'Outlet baru dibuat', {
      outletId, kodeOutlet, namaOutlet,
    }, session);

    return { success: true, outletId, kodeOutlet };

  } catch (e) {
    log.error('OUTLET', 'CREATE', 'Error saat buat outlet', { error: e.message }, session);
    return fail('Terjadi kesalahan saat membuat outlet.', 'SERVER_ERROR');
  }
}


// ─── Read Outlet ─────────────────────────────────────────────

/**
 * Ambil semua outlet.
 * - SUPER_ADMIN: return semua outlet
 * - ADMIN / role lain: return outlet sendiri saja
 *
 * @param {Object} session
 * @returns {{ success: boolean, data?: Object[] }}
 */
function getOutletAll(session) {
  try {
    let outlets;

    if (session.role === ROLES.SUPER_ADMIN) {
      outlets = readAll(SHEET.OUTLET);
    } else {
      // Role lain hanya bisa lihat outlet sendiri
      const own = readOne(SHEET.OUTLET, 'ID_OUTLET', session.outletId);
      outlets = own ? [own] : [];
    }

    // Hapus field sensitif sebelum dikirim ke client (tidak ada di outlet,
    // tapi guard untuk konsistensi pattern)
    return { success: true, data: outlets };

  } catch (e) {
    log.error('OUTLET', 'GET_ALL', 'Error saat ambil daftar outlet', { error: e.message }, session);
    return fail('Terjadi kesalahan saat mengambil data outlet.', 'SERVER_ERROR');
  }
}

/**
 * Ambil satu outlet berdasarkan ID_OUTLET.
 * SUPER_ADMIN bisa akses outlet manapun.
 * ADMIN / role lain hanya bisa akses outlet sendiri.
 *
 * @param {string} idOutlet
 * @param {Object} session
 * @returns {{ success: boolean, data?: Object }}
 */
function getOutletById(idOutlet, session) {
  // Cross-tenant: non-SUPER_ADMIN hanya boleh lihat outlet sendiri
  if (session.role !== ROLES.SUPER_ADMIN && idOutlet !== session.outletId) {
    return failForbidden('Tidak ada akses ke outlet ini.');
  }

  try {
    const outlet = readOne(SHEET.OUTLET, 'ID_OUTLET', idOutlet);
    if (!outlet) return fail('Outlet tidak ditemukan.', 'NOT_FOUND');

    return { success: true, data: outlet };

  } catch (e) {
    log.error('OUTLET', 'GET_BY_ID', 'Error saat ambil outlet', { idOutlet, error: e.message }, session);
    return fail('Terjadi kesalahan saat mengambil data outlet.', 'SERVER_ERROR');
  }
}


// ─── Update Outlet ───────────────────────────────────────────

/**
 * Update data outlet.
 * Hanya SUPER_ADMIN.
 * Field yang bisa diupdate: namaOutlet, timezone, currency, alamat, telepon, email.
 * KODE_OUTLET dan ID_OUTLET tidak bisa diubah.
 *
 * @param {string} idOutlet
 * @param {Object} data - field yang mau diubah (partial update)
 * @param {Object} session
 * @returns {{ success: boolean }}
 */
function updateOutlet(idOutlet, data, session) {
  if (!hasPermission(session.role, ROLES.SUPER_ADMIN)) {
    return failForbidden('Hanya SUPER_ADMIN yang dapat mengubah data outlet.');
  }

  const validErr = _validateOutletData({ namaOutlet: data.namaOutlet || 'placeholder', ...data });
  if (data.namaOutlet !== undefined && !sanitize(data.namaOutlet)) {
    return fail('Nama outlet tidak boleh kosong.', 'INVALID_INPUT');
  }
  if (data.currency && !/^[A-Z]{3}$/.test(data.currency)) {
    return fail('Currency harus 3 huruf kapital (misal: IDR, USD).', 'INVALID_INPUT');
  }

  try {
    const outlet = readOne(SHEET.OUTLET, 'ID_OUTLET', idOutlet);
    if (!outlet) return fail('Outlet tidak ditemukan.', 'NOT_FOUND');

    // Bangun object update — hanya field yang dikirim
    const updateData = {};
    if (data.namaOutlet !== undefined) updateData.NAMA_OUTLET = sanitize(data.namaOutlet);
    if (data.timezone   !== undefined) updateData.TIMEZONE    = sanitize(data.timezone);
    if (data.currency   !== undefined) updateData.CURRENCY    = data.currency.toUpperCase();
    if (data.alamat     !== undefined) updateData.ALAMAT      = sanitize(data.alamat);
    if (data.telepon    !== undefined) updateData.TELEPON     = sanitize(data.telepon);
    if (data.email      !== undefined) updateData.EMAIL       = sanitize(data.email);

    if (Object.keys(updateData).length === 0) {
      return fail('Tidak ada field yang diupdate.', 'INVALID_INPUT');
    }

    const updated = updateRow(SHEET.OUTLET, 'ID_OUTLET', idOutlet, updateData);
    if (!updated) return fail('Outlet tidak ditemukan.', 'NOT_FOUND');

    log.info('OUTLET', 'UPDATE', 'Outlet diupdate', { idOutlet, fields: Object.keys(updateData) }, session);

    return { success: true };

  } catch (e) {
    log.error('OUTLET', 'UPDATE', 'Error saat update outlet', { idOutlet, error: e.message }, session);
    return fail('Terjadi kesalahan saat mengubah outlet.', 'SERVER_ERROR');
  }
}


// ─── Deactivate Outlet ───────────────────────────────────────

/**
 * Nonaktifkan outlet (soft delete — set STATUS = 'INACTIVE').
 * Hanya SUPER_ADMIN.
 * Outlet yang sudah INACTIVE tidak bisa dilogin.
 *
 * @param {string} idOutlet
 * @param {Object} session
 * @returns {{ success: boolean }}
 */
function deactivateOutlet(idOutlet, session) {
  if (!hasPermission(session.role, ROLES.SUPER_ADMIN)) {
    return failForbidden('Hanya SUPER_ADMIN yang dapat menonaktifkan outlet.');
  }

  try {
    const outlet = readOne(SHEET.OUTLET, 'ID_OUTLET', idOutlet);
    if (!outlet) return fail('Outlet tidak ditemukan.', 'NOT_FOUND');

    if (String(outlet.STATUS).toUpperCase() === 'INACTIVE') {
      return fail('Outlet sudah dalam status INACTIVE.', 'NO_CHANGE');
    }

    updateRow(SHEET.OUTLET, 'ID_OUTLET', idOutlet, { STATUS: 'INACTIVE' });

    log.info('OUTLET', 'DEACTIVATE', 'Outlet dinonaktifkan', { idOutlet, namaOutlet: outlet.NAMA_OUTLET }, session);

    return { success: true };

  } catch (e) {
    log.error('OUTLET', 'DEACTIVATE', 'Error saat deactivate outlet', { idOutlet, error: e.message }, session);
    return fail('Terjadi kesalahan saat menonaktifkan outlet.', 'SERVER_ERROR');
  }
}

/**
 * Aktifkan kembali outlet yang INACTIVE.
 * Hanya SUPER_ADMIN.
 *
 * @param {string} idOutlet
 * @param {Object} session
 * @returns {{ success: boolean }}
 */
function activateOutlet(idOutlet, session) {
  if (!hasPermission(session.role, ROLES.SUPER_ADMIN)) {
    return failForbidden('Hanya SUPER_ADMIN yang dapat mengaktifkan outlet.');
  }

  try {
    const outlet = readOne(SHEET.OUTLET, 'ID_OUTLET', idOutlet);
    if (!outlet) return fail('Outlet tidak ditemukan.', 'NOT_FOUND');

    if (String(outlet.STATUS).toUpperCase() === 'ACTIVE') {
      return fail('Outlet sudah dalam status ACTIVE.', 'NO_CHANGE');
    }

    updateRow(SHEET.OUTLET, 'ID_OUTLET', idOutlet, { STATUS: 'ACTIVE' });

    log.info('OUTLET', 'ACTIVATE', 'Outlet diaktifkan kembali', { idOutlet, namaOutlet: outlet.NAMA_OUTLET }, session);

    return { success: true };

  } catch (e) {
    log.error('OUTLET', 'ACTIVATE', 'Error saat activate outlet', { idOutlet, error: e.message }, session);
    return fail('Terjadi kesalahan saat mengaktifkan outlet.', 'SERVER_ERROR');
  }
}


// ─── Init Outlet Config ──────────────────────────────────────

/**
 * Insert baris DEFAULT_OUTLET_CONFIG untuk outlet baru ke MASTER_CONFIG.
 * Dipanggil otomatis dari createOutlet() setelah insertRow berhasil.
 * Skip key yang sudah ada (idempotent — aman dipanggil ulang).
 *
 * @param {string} outletId
 */
function initOutletConfig(outletId) {
  if (!outletId) throw new Error('initOutletConfig: outletId wajib diisi.');

  const existingConfigs = readAll(SHEET.APP_CONFIG, outletId);
  const existingKeys    = existingConfigs.map(r => r.KEY);

  let inserted = 0;
  DEFAULT_OUTLET_CONFIG.forEach(function(configItem) {
    if (existingKeys.includes(configItem.KEY)) return; // skip jika sudah ada

    insertRow(SHEET.APP_CONFIG, {
      KEY       : configItem.KEY,
      VALUE     : configItem.VALUE,
      OUTLET_ID : outletId,
      DESKRIPSI : configItem.DESKRIPSI || '',
    });
    inserted++;
  });

  if (inserted > 0) {
    log.info('OUTLET', 'INIT_CONFIG', 'Default config diinisialisasi untuk outlet baru', {
      outletId,
      keysInserted: inserted,
    });
  }
}


// ─── User Management (scoped to outlet) ──────────────────────

/**
 * Ambil semua user di suatu outlet.
 * SUPER_ADMIN: bisa akses outlet manapun.
 * ADMIN: hanya outlet sendiri.
 *
 * Password hash dan salt TIDAK dikirim ke client.
 *
 * @param {string} outletId
 * @param {Object} session
 * @returns {{ success: boolean, data?: Object[] }}
 */
function getOutletUsers(outletId, session) {
  // Cross-tenant check
  if (session.role !== ROLES.SUPER_ADMIN && outletId !== session.outletId) {
    return failForbidden('Tidak ada akses ke data user outlet ini.');
  }
  if (!hasPermission(session.role, ROLES.ADMIN)) {
    return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat melihat daftar user.');
  }

  try {
    const users = readAll(SHEET.USER, outletId).map(function(u) {
      // Strip field sensitif sebelum kirim ke client
      const safe = Object.assign({}, u);
      delete safe.PASSWORD_HASH;
      delete safe.SALT;
      return safe;
    });

    return { success: true, data: users };

  } catch (e) {
    log.error('OUTLET', 'GET_USERS', 'Error saat ambil users outlet', { outletId, error: e.message }, session);
    return fail('Terjadi kesalahan saat mengambil data user.', 'SERVER_ERROR');
  }
}

/**
 * Nonaktifkan user (soft delete — STATUS = 'INACTIVE').
 * SUPER_ADMIN: bisa nonaktifkan user di outlet manapun.
 * ADMIN: hanya user di outlet sendiri, dan tidak bisa nonaktifkan sesama ADMIN / SUPER_ADMIN.
 *
 * @param {string} userId
 * @param {Object} session
 * @returns {{ success: boolean }}
 */
function deactivateUser(userId, session) {
  if (!hasPermission(session.role, ROLES.ADMIN)) {
    return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat menonaktifkan user.');
  }

  try {
    const user = readOne(SHEET.USER, 'ID_USER', userId);
    if (!user) return fail('User tidak ditemukan.', 'NOT_FOUND');

    // Cross-tenant check untuk ADMIN
    if (session.role === ROLES.ADMIN && user.OUTLET_ID !== session.outletId) {
      return failForbidden('Tidak ada akses ke user outlet lain.');
    }

    // ADMIN tidak bisa nonaktifkan ADMIN atau SUPER_ADMIN lain
    if (session.role === ROLES.ADMIN && hasPermission(user.ROLE, ROLES.ADMIN)) {
      return failForbidden('ADMIN tidak dapat menonaktifkan user dengan role ADMIN atau SUPER_ADMIN.');
    }

    if (String(user.STATUS).toUpperCase() === 'INACTIVE') {
      return fail('User sudah dalam status INACTIVE.', 'NO_CHANGE');
    }

    updateRow(SHEET.USER, 'ID_USER', userId, { STATUS: 'INACTIVE' });

    log.info('OUTLET', 'DEACTIVATE_USER', 'User dinonaktifkan', { userId, username: user.USERNAME }, session);

    return { success: true };

  } catch (e) {
    log.error('OUTLET', 'DEACTIVATE_USER', 'Error saat deactivate user', { userId, error: e.message }, session);
    return fail('Terjadi kesalahan saat menonaktifkan user.', 'SERVER_ERROR');
  }
}
