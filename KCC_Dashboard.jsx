import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  STOK_BAHAN,
  PENJUALAN_HARI_INI,
  fetchBahan,
  fetchStok,
  fetchDashboard,
  recalcSemua,
  round2, idr, pct,
} from "./kcc_data_layer";
import { T, marginTone as marginColor } from "./theme";

// DASHBOARD SERVICE — hanya membaca dari Service Layer
// ─────────────────────────────────────────────────────────────
function getDashboardData(bahanList, stokBahan, penjualanHariIni) {
  const produkHPP = recalcSemua(bahanList);
  const bahanMap  = {};
  bahanList.forEach(b => { bahanMap[b.ID_BAHAN] = b; });
  const stokMap = {};
  stokBahan.forEach(s => { stokMap[s.ID_BAHAN] = s; });
  const jualMap = {};
  penjualanHariIni.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });

  // Omzet = SUM(harga_jual * qty)
  const omzet = produkHPP.reduce((sum, p) => {
    const qty = jualMap[p.ID_PRODUK] || 0;
    return sum + p.HARGA_JUAL * qty;
  }, 0);

  // Food Cost (total HPP terjual)
  const totalFoodCost = produkHPP.reduce((sum, p) => {
    const qty = jualMap[p.ID_PRODUK] || 0;
    return sum + p.HPP_PER_PCS * qty;
  }, 0);

  // Food Cost % = totalFoodCost / omzet * 100
  const foodCostPct = omzet > 0 ? round2((totalFoodCost / omzet) * 100) : 0;

  // Profit = omzet - totalFoodCost
  const profit = round2(omzet - totalFoodCost);

  // Margin rata-rata (weighted by omzet)
  const avgMargin = omzet > 0 ? round2((profit / omzet) * 100) : 0;

  // Top Selling (by qty)
  const topSelling = [...produkHPP]
    .map(p => ({ ...p, QTY: jualMap[p.ID_PRODUK] || 0, OMZET: p.HARGA_JUAL * (jualMap[p.ID_PRODUK] || 0) }))
    .sort((a, b) => b.QTY - a.QTY)
    .slice(0, 5);

  // Top Margin (by margin%)
  const topMargin = [...produkHPP]
    .sort((a, b) => b.MARGIN_PCT - a.MARGIN_PCT)
    .slice(0, 5);

  // Produk paling menguntungkan (profit total = margin_rp * qty)
  const topProfit = [...produkHPP]
    .map(p => ({ ...p, QTY: jualMap[p.ID_PRODUK] || 0, TOTAL_PROFIT: p.MARGIN_RP * (jualMap[p.ID_PRODUK] || 0) }))
    .sort((a, b) => b.TOTAL_PROFIT - a.TOTAL_PROFIT)
    .slice(0, 5);

  // Harga bahan naik (dibanding HARGA_SEBELUMNYA)
  const hargaNaik = bahanList
    .map(b => {
      const hargaAwal = b.HARGA_SEBELUMNYA ?? b.HARGA_RATA2;
      const selisih = b.HARGA_RATA2 - hargaAwal;
      const pctNaik = hargaAwal > 0 ? round2((selisih / hargaAwal) * 100) : 0;
      return { ...b, HARGA_AWAL: hargaAwal, SELISIH: selisih, PCT_NAIK: pctNaik };
    })
    .filter(b => b.SELISIH > 0)
    .sort((a, b) => b.PCT_NAIK - a.PCT_NAIK);

  // Stok minimum (stok < min_stok)
  const stokMinimum = bahanList
    .map(b => {
      const s = stokMap[b.ID_BAHAN];
      return s ? { ...b, STOK: s.STOK, MIN_STOK: s.MIN_STOK, RASIO: round2(s.STOK / s.MIN_STOK) } : null;
    })
    .filter(b => b && b.STOK < b.MIN_STOK)
    .sort((a, b) => a.RASIO - b.RASIO);

  return { omzet, totalFoodCost, foodCostPct, profit, avgMargin, topSelling, topMargin, topProfit, hargaNaik, stokMinimum, produkHPP, penjualanHariIni };
}

// ─────────────────────────────────────────────────────────────
// KOMPONEN KECIL
// ─────────────────────────────────────────────────────────────

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: T.radiusLg,
      padding: 20,
      boxShadow: T.shadow,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
      {children}
    </div>
  );
}

function KPICard({ label, value, sub, accent = T.primary, icon }) {
  return (
    <Card style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: accent, opacity: 0.9 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{label}</div>
          <div style={{ fontFamily: T.fontDisplay, fontSize: 27, fontWeight: 600, color: accent, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
          {sub && <div style={{ fontSize: 12, color: T.textFaint, marginTop: 7 }}>{sub}</div>}
        </div>
        {icon && (
          <div style={{
            fontSize: 18, width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: accent + "1e", border: `1px solid ${accent}33`,
          }}>{icon}</div>
        )}
      </div>
    </Card>
  );
}

function BarRow({ label, value, max, color, sub }) {
  const width = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</span>
        <span style={{ fontSize: 12, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>{sub}</span>
      </div>
      <div style={{ height: 6, background: T.surfaceInput, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      color,
      background: color + "22",
      border: `1px solid ${color}44`,
    }}>
      {children}
    </span>
  );
}

function AlertRow({ icon, label, value, sub, accent = T.danger }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 13px",
      borderRadius: T.radiusSm,
      background: accent + "14",
      border: `1px solid ${accent}30`,
      marginBottom: 8,
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: accent, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────
export default function KCCDashboard() {
  const { token } = useAuth();

  const [bahan,     setBahan]     = useState(INITIAL_BAHAN);
  const [stokBahan, setStokBahan] = useState(STOK_BAHAN);
  const [penjualan, setPenjualan] = useState(PENJUALAN_HARI_INI);
  const [fetchDone, setFetchDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchBahan(token),
      fetchStok(token),
      fetchDashboard(token),
    ]).then(([bahanData, stokData, dashData]) => {
      if (bahanData)              setBahan(bahanData);
      if (stokData)               setStokBahan(stokData);
      if (dashData?.penjualan)    setPenjualan(dashData.penjualan);
    }).finally(() => setFetchDone(true));
  }, [token]);

  const data = useMemo(() => getDashboardData(bahan, stokBahan, penjualan), [bahan, stokBahan, penjualan]);

  const {
    omzet, totalFoodCost, foodCostPct, profit, avgMargin,
    topSelling, topMargin, topProfit, hargaNaik, stokMinimum,
  } = data;

  const maxQty    = Math.max(...topSelling.map(p => p.QTY), 1);
  const maxProfit = Math.max(...topProfit.map(p => p.TOTAL_PROFIT), 1);

  return (
    <div>
      <style>{`
        @keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse  { 0%,100% { opacity:1 } 50% { opacity:.3 } }
        .dash-grid { display: grid; gap: 14px; }
        .kpi-grid  { grid-template-columns: repeat(5, 1fr); }
        .mid-grid  { grid-template-columns: 1fr 1fr 1fr; }
        .bot-grid  { grid-template-columns: 1fr 1fr; }
        .card-ani  { animation: fadein 0.4s ease both; }
        @media (max-width: 1024px) {
          .kpi-grid { grid-template-columns: repeat(3, 1fr); }
          .mid-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 680px) {
          .kpi-grid { grid-template-columns: 1fr 1fr; }
          .mid-grid { grid-template-columns: 1fr; }
          .bot-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 400px) {
          .kpi-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* ── Hero header ── */}
        <div style={{ marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.primary, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Ringkasan Operasional
            </div>
            <h1 style={{ fontFamily: T.fontDisplay, fontSize: 28, fontWeight: 600, color: T.text, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
              Dashboard Dapur
            </h1>
          </div>
          <div style={{ fontSize: 12.5, color: T.textFaint, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: fetchDone ? T.success : T.warning, display: "inline-block", animation: fetchDone ? "none" : "pulse 1.2s infinite" }} />
            {fetchDone ? "Data langsung dari database" : "Memuat data…"}
          </div>
        </div>

      {/* ── KPI Row ── */}
        <div className="dash-grid kpi-grid" style={{ marginBottom: 16 }}>
          <div className="card-ani" style={{ animationDelay: "0ms" }}>
            <KPICard
              label="Omzet Hari Ini"
              value={idr(omzet)}
              sub={`${penjualan.reduce((s, j) => s + j.QTY, 0)} porsi terjual`}
              accent={T.primary}
              icon="💰"
            />
          </div>
          <div className="card-ani" style={{ animationDelay: "60ms" }}>
            <KPICard
              label="Food Cost"
              value={pct(foodCostPct)}
              sub={idr(totalFoodCost) + " total bahan"}
              accent={foodCostPct > 40 ? T.danger : foodCostPct > 30 ? T.warning : T.success}
              icon="🧾"
            />
          </div>
          <div className="card-ani" style={{ animationDelay: "120ms" }}>
            <KPICard
              label="Avg Margin"
              value={pct(avgMargin)}
              sub="margin bersih rata-rata"
              accent={marginColor(avgMargin)}
              icon="📊"
            />
          </div>
          <div className="card-ani" style={{ animationDelay: "180ms" }}>
            <KPICard
              label="Profit Bersih"
              value={idr(profit)}
              sub="setelah dikurangi HPP"
              accent={T.success}
              icon="✅"
            />
          </div>
          <div className="card-ani" style={{ animationDelay: "240ms" }}>
            <KPICard
              label="Alert"
              value={`${hargaNaik.length + stokMinimum.length}`}
              sub={`${hargaNaik.length} harga naik · ${stokMinimum.length} stok kritis`}
              accent={hargaNaik.length + stokMinimum.length > 0 ? T.danger : T.success}
              icon="⚠️"
            />
          </div>
        </div>

        {/* ── Middle Row ── */}
        <div className="dash-grid mid-grid" style={{ marginBottom: 16 }}>

          {/* Top Selling */}
          <Card>
            <SectionTitle>🔥 Top Selling</SectionTitle>
            {topSelling.map((p, i) => (
              <BarRow
                key={p.ID_PRODUK}
                label={p.NAMA_PRODUK}
                value={p.QTY}
                max={maxQty}
                color={i === 0 ? T.primary : i === 1 ? T.primaryHover : T.textFaint}
                sub={`${p.QTY} pcs · ${idr(p.OMZET)}`}
              />
            ))}
          </Card>

          {/* Top Margin */}
          <Card>
            <SectionTitle>📈 Top Margin</SectionTitle>
            {topMargin.map((p, i) => (
              <div key={p.ID_PRODUK} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.NAMA_PRODUK}</div>
                    <div style={{ fontSize: 11, color: T.textFaint }}>{p.KATEGORI} · HPP {idr(p.HPP_PER_PCS)}</div>
                  </div>
                  <Badge color={marginColor(p.MARGIN_PCT)}>{pct(p.MARGIN_PCT)}</Badge>
                </div>
                <div style={{ height: 5, background: T.surfaceInput, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(p.MARGIN_PCT, 100)}%`, background: marginColor(p.MARGIN_PCT), borderRadius: 99, transition: "width 0.6s ease" }} />
                </div>
              </div>
            ))}
          </Card>

          {/* Produk Paling Menguntungkan */}
          <Card>
            <SectionTitle>💎 Paling Menguntungkan</SectionTitle>
            {topProfit.map((p, i) => (
              <BarRow
                key={p.ID_PRODUK}
                label={p.NAMA_PRODUK}
                value={p.TOTAL_PROFIT}
                max={maxProfit}
                color={i === 0 ? T.success : i === 1 ? "#a9c46a" : T.textFaint}
                sub={`${p.QTY} pcs · ${idr(p.TOTAL_PROFIT)}`}
              />
            ))}
          </Card>
        </div>

        {/* ── Bottom Row ── */}
        <div className="dash-grid bot-grid">

          {/* Harga Bahan Naik */}
          <Card>
            <SectionTitle>📦 Harga Bahan Naik</SectionTitle>
            {hargaNaik.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: T.textFaint, fontSize: 13 }}>
                ✓ Semua harga bahan masih normal
              </div>
            ) : (
              hargaNaik.map(b => (
                <AlertRow
                  key={b.ID_BAHAN}
                  icon="📦"
                  label={b.NAMA_BAHAN}
                  sub={`${idr(b.HARGA_AWAL)} → ${idr(b.HARGA_RATA2)} / ${b.SATUAN_BELI}`}
                  value={`+${pct(b.PCT_NAIK)}`}
                  accent={T.warning}
                />
              ))
            )}
          </Card>

          {/* Stok Minimum */}
          <Card>
            <SectionTitle>⚠️ Stok Minimum</SectionTitle>
            {stokMinimum.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: T.textFaint, fontSize: 13 }}>
                ✓ Semua stok bahan mencukupi
              </div>
            ) : (
              stokMinimum.map(b => (
                <AlertRow
                  key={b.ID_BAHAN}
                  icon="🔻"
                  label={b.NAMA_BAHAN}
                  sub={`Stok: ${b.STOK} ${b.SATUAN_BELI} · Min: ${b.MIN_STOK} ${b.SATUAN_BELI}`}
                  value={`${Math.round(b.RASIO * 100)}%`}
                  accent={b.RASIO < 0.5 ? T.danger : T.warning}
                />
              ))
            )}
          </Card>
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 22, textAlign: "center", fontSize: 11, color: T.textFaint, letterSpacing: "0.04em" }}>
          KCC · Kitchen Cost Control
        </div>
    </div>
  );
}
