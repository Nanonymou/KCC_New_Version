/**
 * LoginPage.jsx
 * Login screen for KCC — futuristic warm-dark aesthetic (glass card, glow
 * orbs, grid overlay, conic brand ring) using the shared theme palette.
 *
 * Extras:
 *   - Pings apiHealth on mount and shows a live server/database status chip.
 *   - When the backend/database is unreachable, offers "Mode Demo": a fully
 *     client-side session over the built-in sample data (AuthContext.loginDemo).
 */

import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { gasRun } from './useGAS';
import { T } from './theme';

function errorMessage(err) {
  const code = err?.code;
  if (code === 'AUTH_FAILED' || code === 'AUTH_REQUIRED' || code === 'INVALID_CREDENTIALS')
    return 'Outlet code atau kredensial salah.';
  if (code === 'OUTLET_INACTIVE') return 'Outlet ini tidak aktif. Hubungi administrator.';
  if (code === 'USER_INACTIVE') return 'Akun Anda tidak aktif. Hubungi administrator.';
  if (code === 'NETWORK_ERROR') return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
  if (code === 'SERVER_ERROR') return err?.message || 'Terjadi kesalahan server. Coba beberapa saat lagi.';
  return err?.message || 'Login gagal. Periksa kembali data Anda.';
}

const SERVER_DOWN_CODES = new Set(['NETWORK_ERROR', 'SERVER_ERROR', 'BAD_RESPONSE']);

export default function LoginPage() {
  const { login, loginDemo } = useAuth();

  const [outletCode, setOutletCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // 'checking' | 'online' | 'offline'
  const [server, setServer] = useState('checking');

  // Probe the backend once on mount so the user immediately knows whether the
  // database is reachable (and whether Mode Demo is the way to go).
  useEffect(() => {
    let alive = true;
    gasRun('apiHealth')
      .then(() => { if (alive) setServer('online'); })
      .catch(() => { if (alive) setServer('offline'); });
    return () => { alive = false; };
  }, []);

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
      if (SERVER_DOWN_CODES.has(err?.code)) setServer('offline');
    } finally {
      setSubmitting(false);
    }
  }

  const showDemo = server === 'offline';

  return (
    <div className="kcc-login-root" style={{
      minHeight: '100vh', position: 'relative', overflow: 'hidden',
      background: `radial-gradient(1100px 560px at 20% -10%, #34322d 0%, ${T.bg} 45%, ${T.bgDeep} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px', fontFamily: T.fontUI, fontSize: 14, color: T.text,
    }}>
      <style>{`
        @keyframes kcc-spin  { to { transform: rotate(360deg); } }
        @keyframes kcc-rise  { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes kcc-ring  { to { transform: rotate(360deg); } }
        @keyframes kcc-float-a { 0%,100% { transform: translate(0,0); } 50% { transform: translate(46px,-34px); } }
        @keyframes kcc-float-b { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-38px,28px); } }
        @keyframes kcc-blink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

        .kcc-orb { position: absolute; border-radius: 50%; filter: blur(90px); pointer-events: none; }
        .kcc-orb-a { width: 460px; height: 460px; top: -100px; left: 10%;
          background: radial-gradient(circle, ${T.primary}59, transparent 70%);
          animation: kcc-float-a 16s ease-in-out infinite; }
        .kcc-orb-b { width: 380px; height: 380px; bottom: -80px; right: 8%;
          background: radial-gradient(circle, ${T.info}30, transparent 70%);
          animation: kcc-float-b 20s ease-in-out infinite; }

        .kcc-grid-overlay { position: absolute; inset: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(236,235,229,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(236,235,229,0.03) 1px, transparent 1px);
          background-size: 44px 44px;
          -webkit-mask-image: radial-gradient(ellipse 72% 62% at 50% 42%, black, transparent);
          mask-image: radial-gradient(ellipse 72% 62% at 50% 42%, black, transparent); }

        .kcc-brand-ring { position: relative; width: 66px; height: 66px; margin: 0 auto 16px; }
        .kcc-brand-ring::before { content: ''; position: absolute; inset: -4px; border-radius: 22px;
          background: conic-gradient(from 0deg, ${T.primary}, transparent 30%, transparent 68%, ${T.primary});
          animation: kcc-ring 6s linear infinite; filter: blur(7px); opacity: .75; }
        .kcc-brand-inner { position: relative; width: 66px; height: 66px; border-radius: 18px;
          display: flex; align-items: center; justify-content: center; font-size: 30px;
          background: linear-gradient(160deg, #37352f, #26251f);
          border: 1px solid ${T.primaryLine}; box-shadow: 0 8px 28px -10px rgba(0,0,0,.7); }

        .kcc-card { position: relative;
          background: rgba(48,47,44,0.72);
          backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
          border: 1px solid rgba(201,100,66,0.22); border-radius: ${T.radiusXl}px;
          box-shadow: 0 26px 68px -18px rgba(0,0,0,.65),
                      inset 0 0 0 1px rgba(255,255,255,.025),
                      0 0 46px -18px rgba(201,100,66,.4);
          padding: 26px 26px 22px; }

        .kcc-input { padding: 11px 13px; border: 1px solid ${T.border}; border-radius: ${T.radiusSm}px;
          font-size: 14px; outline: none; background: rgba(33,31,29,.85); color: ${T.text};
          width: 100%; display: block; transition: border-color .15s, box-shadow .15s; }
        .kcc-input:focus { border-color: ${T.primaryLine}; box-shadow: 0 0 0 3px ${T.primarySoft}, 0 0 18px -6px ${T.primary}66; }

        .kcc-submit { width: 100%; padding: 12px 16px; margin-top: 4px; border: none; cursor: pointer;
          background: linear-gradient(135deg, ${T.primaryHover}, ${T.primary});
          color: #fff; border-radius: ${T.radiusSm}px; font-size: 14.5px; font-weight: 600;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          box-shadow: 0 8px 26px -10px ${T.primary}90;
          transition: filter .18s ease, transform .18s ease, box-shadow .18s ease; }
        .kcc-submit:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px);
          box-shadow: 0 12px 32px -10px ${T.primary}aa; }
        .kcc-submit:disabled { background: ${T.borderStrong}; cursor: not-allowed; box-shadow: none; }

        .kcc-demo-btn { width: 100%; padding: 11px 16px; margin-top: 10px; cursor: pointer;
          background: ${T.warningSoft}; color: ${T.warning};
          border: 1px solid ${T.warning}55; border-radius: ${T.radiusSm}px;
          font-size: 13.5px; font-weight: 600; transition: background .15s, box-shadow .15s; }
        .kcc-demo-btn:hover { background: ${T.warning}26; box-shadow: 0 0 22px -8px ${T.warning}88; }

        .kcc-chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px;
          border-radius: 99px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em;
          border: 1px solid ${T.border}; background: rgba(33,31,29,.6); color: ${T.textMuted}; }
      `}</style>

      <div className="kcc-orb kcc-orb-a" />
      <div className="kcc-orb kcc-orb-b" />
      <div className="kcc-grid-overlay" />

      <div style={{ width: '100%', maxWidth: 412, position: 'relative', animation: 'kcc-rise .55s ease both' }}>

        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div className="kcc-brand-ring"><div className="kcc-brand-inner">🍱</div></div>
          <h1 style={{
            fontFamily: T.fontDisplay, fontSize: 31, fontWeight: 600,
            letterSpacing: '-0.01em', color: T.text, lineHeight: 1.1,
          }}>
            Kitchen Cost Control
          </h1>
          <p style={{ fontSize: 13.5, color: T.textMuted, marginTop: 8 }}>
            Kelola HPP, margin, inventory & analitik dapur Anda.
          </p>

          {/* Live server status */}
          <div style={{ marginTop: 14 }}>
            <span className="kcc-chip">
              <span style={{
                width: 7, height: 7, borderRadius: 99, display: 'inline-block',
                background: server === 'online' ? T.success : server === 'offline' ? T.danger : T.warning,
                boxShadow: server === 'online' ? `0 0 8px ${T.success}` : server === 'offline' ? `0 0 8px ${T.danger}` : 'none',
                animation: server === 'checking' ? 'kcc-blink 1.1s infinite' : 'none',
              }} />
              {server === 'online' ? 'SISTEM TERHUBUNG · DATABASE AKTIF'
                : server === 'offline' ? 'DATABASE OFFLINE · MODE DEMO TERSEDIA'
                : 'MEMERIKSA KONEKSI…'}
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="kcc-card">
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
                onChange={e => setOutletCode(e.target.value)} disabled={submitting} />
            </Field>

            <Field label="Username" htmlFor="kcc-username">
              <input id="kcc-username" className="kcc-input" type="text" autoComplete="username"
                placeholder="Username Anda" value={username}
                onChange={e => setUsername(e.target.value)} disabled={submitting} />
            </Field>

            <Field label="Password" htmlFor="kcc-password" last>
              <input id="kcc-password" className="kcc-input" type="password" autoComplete="current-password"
                placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)} disabled={submitting} />
            </Field>

            <button type="submit" className="kcc-submit" disabled={submitting}>
              {submitting ? (<><span style={spinnerStyle} /> Memproses…</>) : 'Masuk'}
            </button>

            {showDemo && (
              <button type="button" className="kcc-demo-btn" onClick={loginDemo}>
                🛰 Masuk Mode Demo — jelajahi dengan data contoh
              </button>
            )}
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: T.textFaint, marginTop: 18, lineHeight: 1.7 }}>
          Demo: outlet <b style={{ color: T.textMuted }}>OUTLET01</b>–<b style={{ color: T.textMuted }}>OUTLET10</b> · user{' '}
          <b style={{ color: T.textMuted }}>admin</b> · pass <b style={{ color: T.textMuted }}>admin123</b>
        </p>
      </div>

      <style>{`@keyframes kcc-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Field({ label, htmlFor, last, children }) {
  return (
    <div style={{ marginBottom: last ? 20 : 14 }}>
      <label htmlFor={htmlFor} style={{
        fontSize: 11.5, fontWeight: 600, color: T.textMuted,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        display: 'block', marginBottom: 6,
      }}>{label}</label>
      {children}
    </div>
  );
}

const spinnerStyle = {
  display: 'inline-block', width: 14, height: 14,
  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
  borderRadius: '50%', animation: 'kcc-spin .7s linear infinite', flexShrink: 0,
};
