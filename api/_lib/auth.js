// ═══════════════════════════════════════════════════════════════════════════
// api/_lib/auth.js
// Session-based auth backed by Postgres (replaces the GAS auth.gs layer).
// ═══════════════════════════════════════════════════════════════════════════

import { sql, verifyPassword, newToken, hashPassword } from './db.js';

const SESSION_TTL_HOURS = 12;

// Dummy credentials used to equalize password-verification cost for unknown
// users, closing a username-enumeration timing side channel.
const { salt: DUMMY_SALT, hash: DUMMY_HASH } = hashPassword('kcc-dummy-password');

/** Login: { outletCode, username, password } → { token, session } */
export async function login({ outletCode, username, password }) {
  if (!outletCode || !username || !password) {
    return { success: false, code: 'BAD_REQUEST', message: 'Outlet, username, dan password wajib diisi.' };
  }

  const { rows } = await sql`
    SELECT u.id, u.username, u.password_hash, u.salt, u.role, u.active,
           o.id AS outlet_id, o.name AS outlet_name, o.active AS outlet_active
    FROM users u
    JOIN outlets o ON o.id = u.outlet_id
    WHERE o.code = ${String(outletCode).trim()}
      AND u.username = ${String(username).trim()}
    LIMIT 1;`;

  const user = rows[0];

  // Always run a password verification (even for unknown users, with dummy
  // material) so response latency does not reveal whether the account exists.
  const okPassword = user
    ? verifyPassword(password, user.salt, user.password_hash)
    : verifyPassword(password, DUMMY_SALT, DUMMY_HASH);

  if (!user || !okPassword) {
    return { success: false, code: 'AUTH_FAILED', message: 'Kombinasi outlet/username/password salah.' };
  }
  if (!user.outlet_active) {
    return { success: false, code: 'OUTLET_INACTIVE', message: 'Outlet ini tidak aktif. Hubungi administrator.' };
  }
  if (!user.active) {
    return { success: false, code: 'USER_INACTIVE', message: 'Akun Anda tidak aktif. Hubungi administrator.' };
  }

  const token = newToken();
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${user.id}, ${expires});`;

  return {
    success: true,
    token,
    session: {
      userId:     user.id,
      username:   user.username,
      role:       user.role,
      outletId:   user.outlet_id,
      outletName: user.outlet_name,
      loginAt:    new Date().toISOString(),
    },
  };
}

/** Validate a token → { success, session } */
export async function validateSession({ token }) {
  const session = await getSession(token);
  if (!session) return { success: false, code: 'INVALID_SESSION', message: 'Sesi tidak valid atau kedaluwarsa.' };
  return { success: true, session };
}

/** Logout: delete the session row. Always succeeds. */
export async function logout({ token }) {
  if (token) await sql`DELETE FROM sessions WHERE token = ${token};`;
  return { success: true };
}

/**
 * Internal: resolve a token to a live session object, or null.
 * Also lazily prunes the row if expired.
 */
export async function getSession(token) {
  if (!token) return null;
  const { rows } = await sql`
    SELECT s.token, s.expires_at,
           u.id AS user_id, u.username, u.role,
           o.id AS outlet_id, o.name AS outlet_name
    FROM sessions s
    JOIN users u   ON u.id = s.user_id
    JOIN outlets o ON o.id = u.outlet_id
    WHERE s.token = ${token}
    LIMIT 1;`;

  const r = rows[0];
  if (!r) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) {
    await sql`DELETE FROM sessions WHERE token = ${token};`;
    return null;
  }
  return {
    userId:     r.user_id,
    username:   r.username,
    role:       r.role,
    outletId:   r.outlet_id,
    outletName: r.outlet_name,
  };
}

/** Guard used by data handlers — throws if the caller has no valid session. */
export async function requireSession(params) {
  const session = await getSession(params?.token);
  if (!session) {
    const err = new Error('Sesi tidak valid atau kedaluwarsa. Silakan login ulang.');
    err.code = 'INVALID_SESSION';
    throw err;
  }
  return session;
}
