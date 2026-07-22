/**
 * LoginPage.jsx
 * Login screen for KCC — Claude-inspired warm dark aesthetic.
 *
 * Fields:  Outlet Code · Username · Password  → AuthContext.login()
 * All calls go through AuthContext → useGAS → /api/rpc (Vercel + Postgres).
 */

import { useState } from 'react';
import { useAuth } from './AuthContext';
import { T } from './theme';

function errorMessage(err) {
  const code = err?.code;
  if (code === 'AUTH_FAILED' || code === 'AUTH_REQUIRED' || code === 'INVALID_CREDENTIALS')
    return 'Outlet code atau kredensial salah.';
  if (code === 'OUTLET_INACTIVE') return 'Outlet ini tidak aktif. Hubungi administrator.';
  if (code === 'USER_INACTIVE') return 'Akun Anda tidak aktif. Hubungi administrator.';
  if (code === 'NETWORK_ERROR') return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
  if (code === 'SERVER_ERROR') return 'Terjadi kesalahan server. Coba beberapa saat lagi.';
  return err?.message || 'Login gagal. Periksa kembali data Anda.';
}

export default function LoginPage() {
  const { login } = useAuth();

  const [outletCode, setOutletCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const code = outletCode.trim(), user = username.trim(), pass = password;
    if (!code || !user || !pass) { setError('Semua field wajib diisi.'); return; }
    setSubmitting(true);
    try {
      await login(code, user, pass);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(1200px 600px at 15% -10%, #34322d 0%, ${T.bg} 45%, ${T.bgDeep} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px', fontFamily: T.fontUI, fontSize: 14, color: T.text,
    }}>
      <style>{`
        @keyframes kcc-spin { to { transform: rotate(360deg); } }
        @keyframes kcc-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .kcc-input:focus { border-color: ${T.primaryLine} !important; box-shadow: 0 0 0 3px ${T.primarySoft} !important; }
        .kcc-submit:hover:not(:disabled) { background: ${T.primaryHover} !important; }
      `}</style>

      <div style={{ width: '100%', maxWidth: 408, animation: 'kcc-rise .5s ease both' }}>

        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: 16,
            background: T.primarySoft, border: `1px solid ${T.primaryLine}`,
            fontSize: 28, marginBottom: 14,
          }}>🍱</div>
          <h1 style={{
            fontFamily: T.fontDisplay, fontSize: 30, fontWeight: 600,
            letterSpacing: '-0.01em', color: T.text, lineHeight: 1.1,
          }}>
            Kitchen Cost Control
          </h1>
          <p style={{ fontSize: 13.5, color: T.textMuted, marginTop: 8 }}>
            Kelola HPP, margin, inventory & analitik dapur Anda.
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: T.surface, borderRadius: T.radiusLg,
          border: `1px solid ${T.border}`, boxShadow: T.shadowLg,
          padding: '26px 26px 22px',
        }}>
          {error && (
            <div style={{
              background: T.dangerSoft, color: T.danger,
              border: `1px solid ${T.danger}44`, borderRadius: T.radiusSm,
              padding: '10px 13px', fontSize: 13, marginBottom: 18, lineHeight: 1.5,
            }}>⚠ {error}</div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <Field label="Outlet Code" htmlFor="kcc-outlet">
              <input id="kcc-outlet" className="kcc-input" type="text" autoComplete="organization"
                autoCapitalize="characters" placeholder="Contoh: OUTLET01" value={outletCode}
                onChange={e => setOutletCode(e.target.value)} disabled={submitting} style={inputStyle} />
            </Field>

            <Field label="Username" htmlFor="kcc-username">
              <input id="kcc-username" className="kcc-input" type="text" autoComplete="username"
                placeholder="Username Anda" value={username}
                onChange={e => setUsername(e.target.value)} disabled={submitting} style={inputStyle} />
            </Field>

            <Field label="Password" htmlFor="kcc-password" last>
              <input id="kcc-password" className="kcc-input" type="password" autoComplete="current-password"
                placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)} disabled={submitting} style={inputStyle} />
            </Field>

            <button type="submit" className="kcc-submit" disabled={submitting} style={{
              width: '100%', padding: '11px 16px', marginTop: 4,
              background: submitting ? T.borderStrong : T.primary, color: '#fff',
              border: 'none', borderRadius: T.radiusSm, fontSize: 14.5, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background .18s ease',
            }}>
              {submitting ? (<><span style={spinnerStyle} /> Memproses…</>) : 'Masuk'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: T.textFaint, marginTop: 18, lineHeight: 1.6 }}>
          Demo: outlet <b style={{ color: T.textMuted }}>OUTLET01</b> · user{' '}
          <b style={{ color: T.textMuted }}>admin</b> · pass <b style={{ color: T.textMuted }}>admin123</b>
        </p>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, last, children }) {
  return (
    <div style={{ marginBottom: last ? 20 : 14 }}>
      <label htmlFor={htmlFor} style={{
        fontSize: 11.5, fontWeight: 600, color: T.textMuted,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        display: 'block', marginBottom: 6,
      }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: '10px 12px', border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
  fontSize: 14, outline: 'none', background: T.surfaceInput, color: T.text,
  width: '100%', display: 'block', transition: 'border-color .15s, box-shadow .15s',
};

const spinnerStyle = {
  display: 'inline-block', width: 14, height: 14,
  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
  borderRadius: '50%', animation: 'kcc-spin .7s linear infinite', flexShrink: 0,
};
