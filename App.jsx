import { useState } from "react";
import KCCDashboard            from "./KCC_Dashboard";
import HPPEngine               from "./hpp_engine";
import KCCAnalytics            from "./KCC_Analytics";
import KCCRecommendationEngine from "./KCC_RecommendationEngine";
import ResepManager            from "./ResepManager";
import InventoryManager        from "./InventoryManager";
import PembelianManager        from "./PembelianManager";
import { useAuth }             from "./AuthContext";
import { T }                   from "./theme";

const TABS = [
  { id: "dashboard",   icon: "📊", label: "Dashboard",   component: KCCDashboard },
  { id: "resep",       icon: "📋", label: "Resep",       component: ResepManager },
  { id: "hpp",         icon: "🧮", label: "HPP & Margin", component: HPPEngine },
  { id: "inventory",   icon: "📦", label: "Inventory",   component: InventoryManager },
  { id: "pembelian",   icon: "🛒", label: "Pembelian",   component: PembelianManager },
  { id: "analytics",   icon: "📈", label: "Analitik",    component: KCCAnalytics },
  { id: "rekomendasi", icon: "💡", label: "Rekomendasi", component: KCCRecommendationEngine },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const { currentUser, logout, isDemo } = useAuth();
  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component ?? KCCDashboard;

  return (
    <div style={{
      minHeight: "100vh", color: T.text,
      background: `radial-gradient(900px 380px at 50% -140px, rgba(201,100,66,0.07), transparent), ${T.bg}`,
      fontFamily: T.fontUI, fontSize: 14,
    }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.bg}; }
        .kcc-nav::-webkit-scrollbar { height: 0; }
        .kcc-tab { transition: color .15s, background .15s, text-shadow .15s; }
        .kcc-tab:hover { color: ${T.text} !important; }
        .kcc-tab-active { text-shadow: 0 0 14px ${T.primary}66; }
        .kcc-logout:hover { color: ${T.primary} !important; border-color: ${T.primaryLine} !important; }
        @keyframes kcc-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Futuristic accent hairline across the very top */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 2, zIndex: 200,
        background: `linear-gradient(90deg, transparent, ${T.primary}, ${T.primaryHover}, transparent)`,
        opacity: 0.85, pointerEvents: "none",
      }} />

      {/* ── Top Nav ── */}
      <nav className="kcc-nav" style={{
        position: "sticky", top: 0, zIndex: 100,
        background: `${T.bgDeep}f2`, backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${T.borderSoft}`,
        display: "flex", alignItems: "stretch",
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {/* Brand */}
        <div style={{
          padding: "0 18px", display: "flex", alignItems: "center", gap: 9,
          flexShrink: 0, borderRight: `1px solid ${T.borderSoft}`,
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8,
            background: T.primarySoft, border: `1px solid ${T.primaryLine}`, fontSize: 15,
          }}>🍱</span>
          <span style={{
            fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600,
            color: T.text, letterSpacing: "-0.01em",
          }}>KCC</span>
        </div>

        {/* Tabs */}
        {TABS.map(t => {
          const active = activeTab === t.id;
          return (
            <button key={t.id} className={`kcc-tab${active ? " kcc-tab-active" : ""}`} onClick={() => setActiveTab(t.id)} style={{
              padding: "0 15px", height: 52, fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              color: active ? T.primary : T.textMuted,
              background: active ? T.primarySoft : "none",
              border: "none",
              borderBottom: `2px solid ${active ? T.primary : "transparent"}`,
              cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}

        {/* User + Logout */}
        <div style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 12,
          padding: "0 16px", flexShrink: 0, borderLeft: `1px solid ${T.borderSoft}`,
        }}>
          {isDemo && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
              background: T.warningSoft, color: T.warning,
              border: `1px solid ${T.warning}55`,
              borderRadius: 5, padding: "3px 8px", whiteSpace: "nowrap",
            }}>DEMO</span>
          )}
          {currentUser && (
            <span style={{ fontSize: 12.5, color: T.textMuted, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7 }}>
              {currentUser.username}
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.03em",
                background: T.surfaceAlt, color: T.textMuted,
                borderRadius: 5, padding: "3px 7px",
              }}>{currentUser.role}</span>
            </span>
          )}
          <button className="kcc-logout" onClick={logout} style={{
            padding: "6px 13px", fontSize: 12.5, fontWeight: 500, color: T.textMuted,
            background: "transparent", border: `1px solid ${T.border}`,
            borderRadius: T.radiusSm, cursor: "pointer", whiteSpace: "nowrap",
            transition: "color .15s, border-color .15s",
          }}>Keluar</button>
        </div>
      </nav>

      {/* ── Page Content ── */}
      <div key={activeTab} style={{
        maxWidth: 1320, margin: "0 auto", padding: "24px 18px 56px",
        animation: "kcc-fade .35s ease both",
      }}>
        <ActiveComponent />
      </div>
    </div>
  );
}
