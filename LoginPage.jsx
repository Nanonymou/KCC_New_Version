/**
 * LoginPage.jsx
 * Login screen for KCC Enterprise.
 *
 * Fields:
 *   - Outlet Code  (maps to outletCode → auth.gs login())
 *   - Username     (maps to username)
 *   - Password     (maps to password)
 *
 * Design: matches existing KCC style.html tokens
 * (--c-primary, --c-accent, --c-danger, card, btn, form-control, etc.)
 *
 * No fake/mock data. All calls go through AuthContext → useGAS → GAS.
 */

import { useState } from 'react';
import { useAuth } from './AuthContext';

// ─── Error code → human-readable message ──────────────────────────────────
// Mirrors error codes from auth.gs
function errorMessage(err) {
  const code = err?.code;
  if (code === 'AUTH_REQUIRED' || code === 'INVALID_CREDENTIALS') {
    return 'Outlet code atau kredensial salah.';
  }
  if (code === 'OUTLET_INACTIVE') {
    return 'Outlet ini tidak aktif. Hubungi administrator.';
  }
  if (code === 'USER_INACTIVE') {
    return 'Akun Anda tidak aktif. Hubungi administrator.';
  }
  if (code === 'SERVER_ERROR') {
    return 'Terjadi kesalahan server. Coba beberapa saat lagi.';
  }
  // Fallback to the error message itself or a generic string
  return err?.message || 'Login gagal. Periksa kembali data Anda.';
}

// ─── Component ────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login } = useAuth();

  const [outletCode, setOutletCode] = useState('');
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const code = outletCode.trim();
    const user = username.trim();
    const pass = password;

    if (!code || !user || !pass) {
      setError('Semua field wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      await login(code, user, pass);
      // On success AuthContext updates state → ProtectedRoute renders the app
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight      : '100vh',
      background     : 'var(--c-bg, #f5f6fa)',
      display        : 'flex',
      alignItems     : 'center',
      justifyContent : 'center',
      padding        : '24px 16px',
      fontFamily     : "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontSize       : 14,
    }}>

      {/* ── Card ── */}
      <div style={{
        background   : 'var(--c-surface, #fff)',
        borderRadius : 'var(--radius, 8px)',
        boxShadow    : 'var(--shadow-md, 0 4px 16px rgba(0,0,0,.12))',
        border       : '1px solid var(--c-border, #dde1ea)',
        width        : '100%',
        maxWidth     : 400,
        overflow     : 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          background  : 'var(--c-primary, #1e3a5f)',
          color       : '#fff',
          padding     : '28px 28px 24px',
          textAlign   : 'center',
        }}>
          <div style={{
            fontSize     : 28,
            fontWeight   : 800,
            letterSpacing: '-0.02em',
            color        : 'var(--c-accent, #e8a020)',
            lineHeight   : 1,
          }}>
            KCC
          </div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
            Kitchen Cost Control Enterprise
          </div>
        </div>

        {/* ── Form body ── */}
        <div style={{ padding: '28px 28px 24px' }}>
          <h2 style={{
            fontSize    : 16,
            fontWeight  : 700,
            color       : 'var(--c-primary, #1e3a5f)',
            marginBottom: 20,
          }}>
            Masuk ke Akun Anda
          </h2>

          {/* Error banner */}
          {error && (
            <div style={{
              background   : 'var(--c-danger-bg, #fdecea)',
              color        : 'var(--c-danger, #d64045)',
              border       : '1px solid #f5c0c0',
              borderRadius : 'var(--radius, 8px)',
              padding      : '10px 14px',
              fontSize     : 13,
              marginBottom : 18,
              lineHeight   : 1.5,
            }}>
              ⚠ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>

            {/* Outlet Code */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label
                htmlFor="kcc-outlet-code"
                style={{
                  fontSize      : 12,
                  fontWeight    : 600,
                  color         : 'var(--c-muted, #6b7280)',
                  textTransform : 'uppercase',
                  letterSpacing : '0.03em',
                  display       : 'block',
                  marginBottom  : 5,
                }}
              >
                Outlet Code <span style={{ color: 'var(--c-danger, #d64045)' }}>*</span>
              </label>
              <input
                id="kcc-outlet-code"
                type="text"
                autoComplete="organization"
                autoCapitalize="characters"
                placeholder="Contoh: OUTLET01"
                value={outletCode}
                onChange={e => setOutletCode(e.target.value)}
                disabled={submitting}
                style={inputStyle}
              />
            </div>

            {/* Username */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label
                htmlFor="kcc-username"
                style={{
                  fontSize      : 12,
                  fontWeight    : 600,
                  color         : 'var(--c-muted, #6b7280)',
                  textTransform : 'uppercase',
                  letterSpacing : '0.03em',
                  display       : 'block',
                  marginBottom  : 5,
                }}
              >
                Username <span style={{ color: 'var(--c-danger, #d64045)' }}>*</span>
              </label>
              <input
                id="kcc-username"
                type="text"
                autoComplete="username"
                placeholder="Username Anda"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={submitting}
                style={inputStyle}
              />
            </div>

            {/* Password */}
            <div className="form-group" style={{ marginBottom: 24 }}>
              <label
                htmlFor="kcc-password"
                style={{
                  fontSize      : 12,
                  fontWeight    : 600,
                  color         : 'var(--c-muted, #6b7280)',
                  textTransform : 'uppercase',
                  letterSpacing : '0.03em',
                  display       : 'block',
                  marginBottom  : 5,
                }}
              >
                Password <span style={{ color: 'var(--c-danger, #d64045)' }}>*</span>
              </label>
              <input
                id="kcc-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={submitting}
                style={inputStyle}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width         : '100%',
                padding       : '10px 16px',
                background    : submitting
                  ? 'var(--c-muted, #6b7280)'
                  : 'var(--c-primary, #1e3a5f)',
                color         : '#fff',
                border        : 'none',
                borderRadius  : 'var(--radius, 8px)',
                fontSize      : 14,
                fontWeight    : 600,
                cursor        : submitting ? 'not-allowed' : 'pointer',
                display       : 'flex',
                alignItems    : 'center',
                justifyContent: 'center',
                gap           : 8,
                transition    : 'background 0.18s ease',
              }}
            >
              {submitting ? (
                <>
                  <span style={spinnerStyle} />
                  Memproses…
                </>
              ) : (
                'Masuk'
              )}
            </button>

          </form>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding    : '12px 28px',
          borderTop  : '1px solid var(--c-border, #dde1ea)',
          fontSize   : 11,
          color      : 'var(--c-muted, #6b7280)',
          textAlign  : 'center',
        }}>
          Hubungi administrator jika Anda lupa kata sandi.
        </div>
      </div>

      {/* Spinner keyframes */}
      <style>{`
        @keyframes kcc-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── Shared style objects ──────────────────────────────────────────────────

const inputStyle = {
  padding      : '8px 10px',
  border       : '1px solid var(--c-border, #dde1ea)',
  borderRadius : 'var(--radius, 8px)',
  fontSize     : 13,
  outline      : 'none',
  background   : '#fff',
  color        : 'var(--c-text, #1a1d23)',
  width        : '100%',
  display      : 'block',
};

const spinnerStyle = {
  display        : 'inline-block',
  width          : 14,
  height         : 14,
  border         : '2px solid rgba(255,255,255,0.4)',
  borderTopColor : '#fff',
  borderRadius   : '50%',
  animation      : 'kcc-spin .7s linear infinite',
  flexShrink     : 0,
};
