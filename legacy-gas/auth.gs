// ============================================================
// auth.gs — Authentication & Session Management
// KCC Enterprise v3.0 — M04
//
// File baru (tidak ada di V1). Menangani:
//   - Login dengan outlet code + username + password
//   - Session token via CacheService.getUserCache()
//   - validateRequest() — wajib dipanggil di setiap API handler
//   - Logout + refresh session
//   - createUser / updateUserPassword
//
// Dependensi: config.gs (M01), utils.gs (M02), service.gs (M03)
//
// Security rules:
//   - Password tidak pernah di-log (writeLog() sudah strip otomatis)
//   - Token tidak pernah di-log (hanya 8 char prefix)
//   - Stack trace tidak pernah dikirim ke client
//   - validateRequest() THROW, bukan return fail() — agar caller tidak perlu cek return value
// ============================================================


// ─── Internal Session Helpers ────────────────────────────────

/**
 * Buat cache key untuk session token.
 * Prefix SESSION.TOKEN_PREFIX dari config.gs (default: 'KCC_SESSION_').
 * @param {string} token
 * @returns {string}
 */
function _sessionKey(token) {
  return SESSION.TOKEN_PREFIX + token;
}

/**
 * Ambil data session dari CacheService.getUserCache().
 * Return null jika tidak ada atau sudah expired.
 * @param {string} token
 * @returns {Object|null}
 */
function _getSession(token) {
  try {
    const raw = CacheService.getUserCache().get(_sessionKey(token));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('_getSession error:', e.message);
    return null;
  }
}

/**
 * Simpan session ke CacheService.getUserCache() dengan TTL dari SESSION.TTL_SECONDS.
 * @param {string} token
 * @param {Object} sessionData
 */
function _saveSession(token, sessionData) {
  try {
    CacheService.getUserCache().put(
      _sessionKey(token),
      JSON.stringify(sessionData),
      SESSION.TTL_SECONDS
    );
  } catch (e) {
    // Jika gagal simpan session → login gagal secara efektif
    throw new Error('Gagal menyimpan session: ' + e.message);
  }
}

/**
 * Hapus session dari CacheService.
 * @param {string} token
 */
function _deleteSession(token) {
  try {
    CacheService.getUserCache().remove(_sessionKey(token));
  } catch (e) {
    console.warn('_deleteSession error:', e.message);
    // Tidak throw — sesi mungkin memang sudah expired
  }
}

/**
 * Ambil 8 karakter pertama token untuk keperluan logging (bukan token utuh).
 * @param {string} token
 * @returns {string}
 */
function _tokenPrefix(token) {
  return token ? String(token).substring(0, 8) + '...' : '[null]';
}


// ─── Login ───────────────────────────────────────────────────

/**
 * Login user.
 *
 * Flow:
 *   1. Cari outlet aktif by KODE_OUTLET
 *   2. Cari user aktif by USERNAME + OUTLET_ID
 *   3. verifyPassword() — constant-time compare
 *   4. Generate token, simpan session ke CacheService
 *   5. Log event LOGIN
 *   6. Return session info (tanpa token di log)
 *
 * @param {string} outletCode  - KODE_OUTLET (misal 'OUTLET01')
 * @param {string} username    - USERNAME user
 * @param {string} password    - password plain text
 * @returns {{ success: boolean, token?: string, role?: string,
 *             outletId?: string, outletName?: string, username?: string,
 *             message?: string }}
 */
function login(outletCode, username, password) {
  // Input guard
  const cleanCode     = sanitize(outletCode);
  const cleanUsername = sanitize(username);

  if (!cleanCode || !cleanUsername || !password) {
    return fail('Outlet code, username, dan password wajib diisi.', 'INVALID_INPUT');
  }

  try {
    // 1. Cari outlet
    const outlet = readOne(SHEET.OUTLET, 'KODE_OUTLET', cleanCode);
    if (!outlet) {
      log.warn('AUTH', 'LOGIN', 'Outlet tidak ditemukan', { outletCode: cleanCode });
      return fail('Outlet code atau kredensial salah.', 'AUTH_FAILED');
    }
    if (String(outlet.STATUS).toUpperCase() !== 'ACTIVE') {
      log.warn('AUTH', 'LOGIN', 'Outlet tidak aktif', { outletCode: cleanCode });
      return fail('Outlet tidak aktif.', 'OUTLET_INACTIVE');
    }

    const outletId = outlet.ID_OUTLET;

    // 2. Cari user — scope ke outlet ini (cross-tenant safety)
    const user = readOne(SHEET.USER, 'USERNAME', cleanUsername, outletId);
    if (!user) {
      log.warn('AUTH', 'LOGIN', 'User tidak ditemukan', { username: cleanUsername, outletId });
      return fail('Outlet code atau kredensial salah.', 'AUTH_FAILED');
    }
    if (String(user.STATUS).toUpperCase() !== 'ACTIVE') {
      log.warn('AUTH', 'LOGIN', 'User tidak aktif', { username: cleanUsername, outletId });
      return fail('Akun user tidak aktif.', 'USER_INACTIVE');
    }

    // 3. Verifikasi password
    const passwordValid = verifyPassword(password, user.SALT, user.PASSWORD_HASH);
    if (!passwordValid) {
      log.warn('AUTH', 'LOGIN', 'Password salah', { username: cleanUsername, outletId });
      return fail('Outlet code atau kredensial salah.', 'AUTH_FAILED');
    }

    // 4. Generate session token dan simpan
    const token = generateToken();
    const sessionData = {
      token      : token,
      userId     : user.ID_USER,
      username   : user.USERNAME,
      role       : user.ROLE,
      outletId   : outletId,
      outletName : outlet.NAMA_OUTLET,
      loginAt    : now(),
    };
    _saveSession(token, sessionData);

    // 5. Log event (password tidak di-log — writeLog() strip otomatis)
    log.info('AUTH', 'LOGIN', 'Login berhasil', {
      tokenPrefix: _tokenPrefix(token),
    }, sessionData);

    // 6. Return — token dikirim ke client, tidak pernah di-log lagi
    return {
      success    : true,
      token      : token,
      role       : user.ROLE,
      outletId   : outletId,
      outletName : outlet.NAMA_OUTLET,
      username   : user.USERNAME,
    };

  } catch (e) {
    log.error('AUTH', 'LOGIN', 'Error saat login', { error: e.message });
    // Stack trace tidak pernah dikirim ke client
    return fail('Terjadi kesalahan saat login. Coba lagi.', 'SERVER_ERROR');
  }
}


// ─── Validate Request ─────────────────────────────────────────

/**
 * Validasi session token dari setiap API request.
 * WAJIB dipanggil di awal setiap handler sebelum logic apapun.
 *
 * Jika valid → return session object (userId, role, outletId, dll.)
 * Jika tidak valid → THROW object { code: 'AUTH_REQUIRED' }
 *   (caller tidak perlu cek return value — langsung pakai atau kena throw)
 *
 * @param {string} token
 * @returns {{ userId: string, username: string, role: string,
 *             outletId: string, outletName: string, loginAt: string }}
 * @throws {{ code: 'AUTH_REQUIRED', message: string }}
 */
function validateRequest(token) {
  if (!token) {
    throw { code: 'AUTH_REQUIRED', message: 'Token tidak ditemukan.' };
  }

  const session = _getSession(token);
  if (!session) {
    // Session expired atau tidak valid
    throw { code: 'AUTH_REQUIRED', message: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.' };
  }

  // Pastikan field wajib ada (guard terhadap data session korup)
  if (!session.userId || !session.role || !session.outletId) {
    log.warn('AUTH', 'VALIDATE', 'Session data korup', { tokenPrefix: _tokenPrefix(token) });
    _deleteSession(token); // hapus sesi rusak
    throw { code: 'AUTH_REQUIRED', message: 'Data sesi tidak valid. Silakan login kembali.' };
  }

  return session;
}


// ─── Logout ──────────────────────────────────────────────────

/**
 * Logout — hapus session dari CacheService.
 * @param {string} token
 * @returns {{ success: boolean }}
 */
function logout(token) {
  if (!token) return fail('Token tidak ditemukan.', 'INVALID_INPUT');

  try {
    const session = _getSession(token);
    _deleteSession(token);

    if (session) {
      log.info('AUTH', 'LOGOUT', 'Logout berhasil', {
        tokenPrefix: _tokenPrefix(token),
      }, session);
    }

    return { success: true };
  } catch (e) {
    log.error('AUTH', 'LOGOUT', 'Error saat logout', { error: e.message });
    return fail('Terjadi kesalahan saat logout.', 'SERVER_ERROR');
  }
}


// ─── Refresh Session ─────────────────────────────────────────

/**
 * Perpanjang TTL session (sliding expiry).
 * Dipanggil dari frontend secara periodik jika user masih aktif.
 *
 * @param {string} token
 * @returns {{ success: boolean, expiresIn?: number }}
 */
function refreshSession(token) {
  if (!token) return fail('Token tidak ditemukan.', 'INVALID_INPUT');

  try {
    const session = _getSession(token);
    if (!session) {
      return fail('Sesi tidak valid atau sudah berakhir.', 'AUTH_REQUIRED');
    }

    // Re-save dengan TTL penuh dari sekarang (sliding window)
    _saveSession(token, session);

    return {
      success   : true,
      expiresIn : SESSION.TTL_SECONDS,
    };
  } catch (e) {
    log.error('AUTH', 'REFRESH', 'Error saat refresh session', { error: e.message });
    return fail('Terjadi kesalahan saat refresh sesi.', 'SERVER_ERROR');
  }
}


// ─── User Management ─────────────────────────────────────────

/**
 * Buat user baru.
 * Aturan:
 *   - SUPER_ADMIN: bisa buat user di outlet manapun
 *   - ADMIN: hanya bisa buat user di outlet sendiri, role KASIR atau STAFF saja
 *   - Role lain: tidak boleh
 *
 * @param {Object} data - { username, password, role, outletId, namaLengkap, email? }
 * @param {Object} requestingSession - session object dari validateRequest()
 * @returns {{ success: boolean, userId?: string }}
 */
function createUser(data, requestingSession) {
  const callerRole     = requestingSession.role;
  const callerOutletId = requestingSession.outletId;
  const callerUserId   = requestingSession.userId;

  // Otorisasi
  if (!hasPermission(callerRole, ROLES.ADMIN)) {
    log.warn('AUTH', 'CREATE_USER', 'Tidak punya izin buat user', {
      callerRole, callerUserId,
    });
    return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat membuat user baru.');
  }

  // ADMIN hanya boleh buat user di outlet sendiri
  const targetOutletId = data.outletId || callerOutletId;
  if (callerRole === ROLES.ADMIN && targetOutletId !== callerOutletId) {
    return failForbidden('ADMIN hanya dapat membuat user di outlet sendiri.');
  }

  // ADMIN tidak boleh buat user dengan role lebih tinggi dari dirinya
  if (callerRole === ROLES.ADMIN && hasPermission(data.role, ROLES.ADMIN)) {
    return failForbidden('ADMIN tidak dapat membuat user dengan role ADMIN atau SUPER_ADMIN.');
  }

  // Validasi input
  const username = sanitize(data.username);
  if (!username || !data.password || !data.role || !targetOutletId) {
    return fail('Field username, password, role, dan outletId wajib diisi.', 'INVALID_INPUT');
  }
  if (!ROLE_LEVEL[data.role]) {
    return fail('Role tidak valid: ' + data.role, 'INVALID_INPUT');
  }

  // Cek duplikat username di outlet yang sama
  if (exists(SHEET.USER, 'USERNAME', username, targetOutletId)) {
    return fail('Username sudah digunakan di outlet ini.', 'DUPLICATE');
  }

  try {
    const salt         = generateSalt();
    const passwordHash = hashPassword(data.password, salt);
    const userId       = generateTxId('USR', readAll(SHEET.USER).map(u => u.ID_USER));

    const newUser = {
      ID_USER       : userId,
      OUTLET_ID     : targetOutletId,
      USERNAME      : username,
      PASSWORD_HASH : passwordHash,
      SALT          : salt,
      ROLE          : data.role,
      NAMA_LENGKAP  : sanitize(data.namaLengkap || ''),
      EMAIL         : sanitize(data.email || ''),
      STATUS        : 'ACTIVE',
    };

    insertRow(SHEET.USER, newUser);

    log.info('AUTH', 'CREATE_USER', 'User baru dibuat', {
      userId,
      username,
      role      : data.role,
      outletId  : targetOutletId,
    }, requestingSession);

    return { success: true, userId };

  } catch (e) {
    log.error('AUTH', 'CREATE_USER', 'Error saat buat user', { error: e.message }, requestingSession);
    return fail('Terjadi kesalahan saat membuat user.', 'SERVER_ERROR');
  }
}

/**
 * Update password user.
 * User bisa ganti password sendiri. SUPER_ADMIN bisa reset password user manapun.
 *
 * @param {string} targetUserId - ID_USER yang passwordnya mau diganti
 * @param {string} newPassword
 * @param {Object} requestingSession
 * @param {string} [currentPassword] - wajib jika user ganti password sendiri (bukan SUPER_ADMIN)
 * @returns {{ success: boolean }}
 */
function updateUserPassword(targetUserId, newPassword, requestingSession, currentPassword) {
  const callerRole   = requestingSession.role;
  const callerUserId = requestingSession.userId;
  const isSelf       = callerUserId === targetUserId;
  const isSuperAdmin = callerRole === ROLES.SUPER_ADMIN;

  // Hanya diri sendiri atau SUPER_ADMIN
  if (!isSelf && !isSuperAdmin) {
    return failForbidden('Tidak ada izin untuk mengubah password user lain.');
  }

  if (!newPassword || String(newPassword).length < 8) {
    return fail('Password baru minimal 8 karakter.', 'INVALID_INPUT');
  }

  try {
    // Ambil data user (tanpa outletId — SUPER_ADMIN bisa akses lintas outlet)
    const user = readOne(SHEET.USER, 'ID_USER', targetUserId);
    if (!user) return fail('User tidak ditemukan.', 'NOT_FOUND');

    // Jika ganti password sendiri (bukan SUPER_ADMIN), verifikasi password lama
    if (isSelf && !isSuperAdmin) {
      if (!currentPassword) {
        return fail('Password lama wajib diisi.', 'INVALID_INPUT');
      }
      if (!verifyPassword(currentPassword, user.SALT, user.PASSWORD_HASH)) {
        return fail('Password lama tidak sesuai.', 'AUTH_FAILED');
      }
    }

    const newSalt         = generateSalt();
    const newPasswordHash = hashPassword(newPassword, newSalt);

    updateRow(SHEET.USER, 'ID_USER', targetUserId, {
      PASSWORD_HASH : newPasswordHash,
      SALT          : newSalt,
    });

    log.info('AUTH', 'UPDATE_PASSWORD', 'Password diubah', {
      targetUserId,
      changedBy : callerUserId,
    }, requestingSession);

    return { success: true };

  } catch (e) {
    log.error('AUTH', 'UPDATE_PASSWORD', 'Error saat update password', { error: e.message });
    return fail('Terjadi kesalahan saat mengubah password.', 'SERVER_ERROR');
  }
}
