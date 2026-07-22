/**
 * FormKit.jsx — small themed building blocks for data-entry modals shared by
 * the Inventory / Pembelian / Resep managers. Keeps all write-form styling in
 * one place so the managers stay focused on their own logic.
 */

import { useEffect } from "react";
import { T } from "./theme";

// ─── Modal ────────────────────────────────────────────────────────────────
export function Modal({ title, subtitle, onClose, children, footer, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(15,14,13,0.62)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 16px 16px", overflowY: "auto",
      }}
    >
      <style>{`@keyframes kcc-modal-in { from { opacity:0; transform: translateY(10px) scale(.99);} to {opacity:1; transform:none;} }`}</style>
      <div style={{
        width: "100%", maxWidth: width, background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: T.radiusLg,
        boxShadow: T.shadowLg, animation: "kcc-modal-in .2s ease both",
      }}>
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid ${T.borderSoft}`,
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
        }}>
          <div>
            <div style={{ fontFamily: T.fontDisplay, fontSize: 18, fontWeight: 600, color: T.text }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Tutup" style={{
            background: "none", border: "none", color: T.textMuted, fontSize: 22,
            lineHeight: 1, cursor: "pointer", padding: 0, marginTop: -2,
          }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
        {footer && (
          <div style={{
            padding: "14px 20px", borderTop: `1px solid ${T.borderSoft}`,
            display: "flex", justifyContent: "flex-end", gap: 10,
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

// ─── Fields ─────────────────────────────────────────────────────────────────
const fieldWrap = { marginBottom: 14 };
const labelStyle = {
  fontSize: 11.5, fontWeight: 600, color: T.textMuted,
  letterSpacing: "0.04em", textTransform: "uppercase",
  display: "block", marginBottom: 6,
};
const controlStyle = {
  width: "100%", padding: "9px 11px", fontSize: 14, outline: "none",
  background: T.surfaceInput, color: T.text,
  border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
  transition: "border-color .15s, box-shadow .15s",
};

export function Field({ label, hint, children }) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      style={{ ...controlStyle, ...(props.style || {}) }}
      onFocus={(e) => { e.target.style.borderColor = T.primaryLine; e.target.style.boxShadow = `0 0 0 3px ${T.primarySoft}`; props.onFocus?.(e); }}
      onBlur={(e) => { e.target.style.borderColor = T.border; e.target.style.boxShadow = "none"; props.onBlur?.(e); }}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      style={{ ...controlStyle, cursor: "pointer", ...(props.style || {}) }}
      onFocus={(e) => { e.target.style.borderColor = T.primaryLine; e.target.style.boxShadow = `0 0 0 3px ${T.primarySoft}`; }}
      onBlur={(e) => { e.target.style.borderColor = T.border; e.target.style.boxShadow = "none"; }}
    >
      {children}
    </select>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────
export function Button({ variant = "primary", loading, children, ...props }) {
  const base = {
    padding: "9px 16px", fontSize: 13.5, fontWeight: 600, borderRadius: T.radiusSm,
    cursor: props.disabled || loading ? "not-allowed" : "pointer",
    display: "inline-flex", alignItems: "center", gap: 7, transition: "filter .15s, background .15s",
    opacity: props.disabled ? 0.55 : 1, border: "none",
  };
  const variants = {
    primary: { background: T.primary, color: "#fff" },
    success: { background: T.success, color: "#1b2016" },
    danger:  { background: T.dangerSoft, color: T.danger, border: `1px solid ${T.danger}55` },
    ghost:   { background: "transparent", color: T.textMuted, border: `1px solid ${T.border}` },
  };
  return (
    <button {...props} disabled={props.disabled || loading}
      style={{ ...base, ...variants[variant], ...(props.style || {}) }}
      onMouseEnter={(e) => { if (!props.disabled && !loading) e.currentTarget.style.filter = "brightness(1.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
    >
      {loading && <span style={{
        width: 13, height: 13, border: "2px solid rgba(255,255,255,.45)", borderTopColor: "#fff",
        borderRadius: "50%", display: "inline-block", animation: "kcc-spin .7s linear infinite",
      }} />}
      {children}
      <style>{`@keyframes kcc-spin { to { transform: rotate(360deg);} }`}</style>
    </button>
  );
}

export function FormError({ children }) {
  if (!children) return null;
  return (
    <div role="alert" style={{
      background: T.dangerSoft, color: T.danger, border: `1px solid ${T.danger}44`,
      borderRadius: T.radiusSm, padding: "9px 12px", fontSize: 12.5, marginBottom: 14, lineHeight: 1.5,
    }}>⚠ {children}</div>
  );
}

// Small toast for success feedback after a mutation.
export function Toast({ show, children }) {
  if (!show) return null;
  return (
    <div style={{
      position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 600,
      background: T.successSoft, color: T.success, border: `1px solid ${T.success}55`,
      borderRadius: 99, padding: "9px 18px", fontSize: 13, fontWeight: 600,
      boxShadow: T.shadowMd, animation: "kcc-modal-in .2s ease both",
    }}>✓ {children}</div>
  );
}
