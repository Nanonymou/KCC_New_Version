import { useState } from "react";
import KCCDashboard            from "./KCC_Dashboard";
import HPPEngine               from "./hpp_engine";
import KCCAnalytics            from "./KCC_Analytics";
import KCCRecommendationEngine from "./KCC_RecommendationEngine";
import ResepManager            from "./ResepManager";
import InventoryManager        from "./InventoryManager";
import PembelianManager        from "./PembelianManager";
import { useAuth }             from "./AuthContext";

const TABS = [
  { id: "dashboard",   labelFull: "📊 Dashboard",    labelShort: "Dashboard",   component: KCCDashboard },
  { id: "resep",       labelFull: "📋 Resep",         labelShort: "Resep",       component: ResepManager },
  { id: "hpp",         labelFull: "🧮 HPP & Margin",  labelShort: "HPP",         component: HPPEngine },
  { id: "inventory",   labelFull: "📦 Inventory",     labelShort: "Inventory",   component: InventoryManager },
  { id: "pembelian",   labelFull: "🛒 Pembelian",     labelShort: "Pembelian",   component: PembelianManager },
  { id: "analytics",  labelFull: "📈 Analitik",       labelShort: "Analitik",    component: KCCAnalytics },
  { id: "rekomendasi", labelFull: "💡 Rekomendasi",   labelShort: "Rekomendasi", component: KCCRecommendationEngine },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const { currentUser, logout }   = useAuth();
  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component ?? KCCDashboard;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#e2e8f0",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontSize: 14,
    }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d1117; }
        .kcc-nav::-webkit-scrollbar { height: 0; }
        @media (min-width: 768px) {
          .tab-label-short { display: none !important; }
          .tab-label-full  { display: inline !important; }
        }
      `}</style>

      {/* ── Top Nav ── */}
      <nav style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "#0d1117",
        borderBottom: "1px solid #1e2840",
        display: "flex",
        alignItems: "stretch",
        overflowX: "auto",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }} className="kcc-nav">

        {/* Brand */}
        <div style={{
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          fontSize: 15,
          fontWeight: 800,
          color: "#f97316",
          letterSpacing: "-0.02em",
          flexShrink: 0,
          borderRight: "1px solid #1e2840",
        }}>
          KCC
        </div>

        {/* Tabs */}
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "0 14px",
              height: 48,
              fontSize: 13,
              fontWeight: activeTab === t.id ? 600 : 500,
              color: activeTab === t.id ? "#f97316" : "#64748b",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${activeTab === t.id ? "#f97316" : "transparent"}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            <span className="tab-label-full"  style={{ display: "none" }}>{t.labelFull}</span>
            <span className="tab-label-short">{t.labelShort}</span>
          </button>
        ))}

        {/* ── User info + Logout (pushed to right) ── */}
        <div style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
          flexShrink: 0,
          borderLeft: "1px solid #1e2840",
        }}>
          {currentUser && (
            <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
              {currentUser.username}
              <span style={{
                marginLeft: 6,
                fontSize: 10,
                background: "#1e2840",
                color: "#94a3b8",
                borderRadius: 4,
                padding: "2px 6px",
              }}>
                {currentUser.role}
              </span>
            </span>
          )}
          <button
            onClick={logout}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              color: "#94a3b8",
              background: "transparent",
              border: "1px solid #1e2840",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#f97316"; e.currentTarget.style.borderColor = "#f97316"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "#1e2840"; }}
          >
            Keluar
          </button>
        </div>
      </nav>

      {/* ── Page Content ── */}
      <div style={{
        maxWidth: 1300,
        margin: "0 auto",
        padding: "20px 16px 48px",
      }}>
        <ActiveComponent />
      </div>
    </div>
  );
}
