/**
 * AuthContext.jsx
 * Manages authentication state for KCC Enterprise.
 *
 * Provides:
 *   - currentUser   : { userId, username, role, outletName } | null
 *   - outletId      : string | null   (active outlet for all API calls)
 *   - role          : string | null   (SUPER_ADMIN | ADMIN | KASIR | STAFF | VIEWER)
 *   - token         : string | null   (session token; sent with every GAS call)
 *   - loading       : boolean         (true while checking persisted session on mount)
 *   - login(outletCode, username, password) → Promise<void>
 *   - logout()      → Promise<void>
 *   - switchOutlet(outletId) → void   (SUPER_ADMIN only)
 *
 * Session is persisted in sessionStorage so a browser-tab refresh keeps the
 * user logged in, but closing the tab/window clears it automatically.
 * (GAS session token is the source-of-truth TTL; sessionStorage is just
 * a convenience cache so we don't force re-login on every page load.)
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { gasRun } from './useGAS';

// ─── Storage helpers ──────────────────────────────────────────────────────

const STORAGE_KEY = 'kcc_session';

// ─── Demo mode ────────────────────────────────────────────────────────────
// A fully client-side session used when the backend/database is unreachable
// (e.g. Vercel Postgres not attached yet). All fetch helpers fail gracefully
// and components fall back to the built-in sample data, so the whole app is
// browsable without a server.
export const DEMO_TOKEN = 'demo-local';

const DEMO_SESSION = {
  userId: 'DEMO',
  username: 'demo',
  role: 'SUPER_ADMIN',
  outletId: 'DEMO',
  outletName: 'Mode Demo',
};

function persistSession(data) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage not available (e.g. iframe restrictions)
  }
}

function readPersistedSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPersistedSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Context ──────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

// ─── Provider ─────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const [token,       setToken]       = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [outletId,    setOutletId]    = useState(null);
  const [role,        setRole]        = useState(null);
  // loading = true while we validate a persisted session on first mount
  const [loading,     setLoading]     = useState(true);

  // ── Restore persisted session on mount ──────────────────────────────────
  useEffect(() => {
    const stored = readPersistedSession();
    if (!stored?.token) {
      setLoading(false);
      return;
    }

    // Demo sessions are purely local — no server round trip to validate.
    if (stored.token === DEMO_TOKEN) {
      _applySession(DEMO_TOKEN, stored.session || DEMO_SESSION);
      setLoading(false);
      return;
    }

    // Validate token against GAS (it may have expired while the tab was closed)
    gasRun('apiValidateSession', { token: stored.token })
      .then((res) => {
        if (res?.success && res.session) {
          _applySession(stored.token, res.session);
        } else {
          clearPersistedSession();
        }
      })
      .catch(() => {
        // Token invalid or GAS unreachable — force re-login
        clearPersistedSession();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Internal helper: apply a validated session to all state slices ───────
  function _applySession(tok, session) {
    /*
     * Expected session shape from auth.gs:
     * {
     *   userId, username, role,
     *   outletId, outletName,
     *   loginAt
     * }
     */
    setToken(tok);
    setCurrentUser({
      userId:     session.userId,
      username:   session.username,
      role:       session.role,
      outletName: session.outletName,
    });
    setOutletId(session.outletId);
    setRole(session.role);

    persistSession({ token: tok, session });
  }

  // ── login ────────────────────────────────────────────────────────────────
  const login = useCallback(async (outletCode, username, password) => {
    // gasRun rejects on success:false so errors bubble up to LoginPage
    const res = await gasRun('apiLogin', { outletCode, username, password });
    /*
     * Expected success response from auth.gs apiLogin:
     * { success: true, token: '...', session: { userId, username, role, outletId, outletName, loginAt } }
     */
    if (!res?.token || !res?.session) {
      throw new Error('Respons login tidak valid dari server.');
    }
    _applySession(res.token, res.session);
  }, []);

  // ── loginDemo ────────────────────────────────────────────────────────────
  // Enter a client-side demo session (no backend). Available from LoginPage
  // when the server/database is unreachable.
  const loginDemo = useCallback(() => {
    _applySession(DEMO_TOKEN, { ...DEMO_SESSION, loginAt: new Date().toISOString() });
  }, []);

  // ── logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const currentToken = token;
    // Clear local state immediately so UI responds fast
    setToken(null);
    setCurrentUser(null);
    setOutletId(null);
    setRole(null);
    clearPersistedSession();

    if (currentToken && currentToken !== DEMO_TOKEN) {
      // Fire-and-forget — the server invalidates the session
      gasRun('apiLogout', { token: currentToken }).catch(() => {
        // Non-critical: local state already cleared
      });
    }
  }, [token]);

  // ── switchOutlet (SUPER_ADMIN only) ──────────────────────────────────────
  const switchOutlet = useCallback((newOutletId) => {
    if (role !== 'SUPER_ADMIN') return;
    setOutletId(newOutletId);
    // Update persisted session so a refresh keeps the switch
    const stored = readPersistedSession();
    if (stored) {
      stored.session = { ...stored.session, outletId: newOutletId };
      persistSession(stored);
    }
  }, [role]);

  // ── Context value ────────────────────────────────────────────────────────
  const value = {
    token,
    currentUser,
    outletId,
    role,
    loading,
    login,
    loginDemo,
    logout,
    switchOutlet,
    isAuthenticated: !!token,
    isDemo: token === DEMO_TOKEN,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────

/**
 * useAuth()
 * Must be used inside <AuthProvider>.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

export default AuthContext;
