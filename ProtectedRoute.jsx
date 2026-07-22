/**
 * ProtectedRoute.jsx
 * Wraps any content that requires a valid session.
 *
 * Usage in App.jsx:
 *   <ProtectedRoute fallback={<LoginPage />}>
 *     <MainApp />
 *   </ProtectedRoute>
 *
 * Behaviour:
 *   - While loading (validating persisted session): shows a full-screen spinner
 *     that matches the KCC design system.
 *   - If NOT authenticated: renders `fallback` (LoginPage).
 *   - If authenticated: renders `children`.
 *
 * This component intentionally does NOT use react-router so it stays
 * compatible with the GAS single-page deployment (no URL routing).
 */

import { useAuth } from './AuthContext';
import { T } from './theme';

// ─── Inline spinner matching the KCC design system ────────────────────────

function FullScreenSpinner() {
  return (
    <div style={{
      minHeight       : '100vh',
      background      : T.bg,
      display         : 'flex',
      flexDirection   : 'column',
      alignItems      : 'center',
      justifyContent  : 'center',
      gap             : 14,
      color           : T.textMuted,
      fontFamily      : T.fontUI,
      fontSize        : 14,
    }}>
      <div style={{
        width          : 32,
        height         : 32,
        border         : `3px solid ${T.border}`,
        borderTopColor : T.primary,
        borderRadius   : '50%',
        animation      : 'spin .7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span>Memeriksa sesi…</span>
    </div>
  );
}

// ─── ProtectedRoute ───────────────────────────────────────────────────────

/**
 * @param {React.ReactNode} children  - Content to render when authenticated
 * @param {React.ReactNode} fallback  - Content to render when NOT authenticated
 *                                      (typically <LoginPage />)
 */
export default function ProtectedRoute({ children, fallback }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <FullScreenSpinner />;
  }

  if (!isAuthenticated) {
    return fallback ?? null;
  }

  return children;
}
