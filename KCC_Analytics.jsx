import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  PRODUK,
  RESEP,
  PENJUALAN_HARI_INI,
  SUPPLIER_DATA,
  fetchBahan,
  fetchProduk,
  fetchResep,
  fetchSupplier,
  fetchDashboard,
  recalcSemua,
  round2, idr, pct, marginColor,
} from "./kcc_data_layer";

// ─── ANALYTICS SERVICE ─────────────────────────────────────────
function getAnalyticsData(bahanList, produkList, resepData, penjualanHariIni, supplierList) {
  const produkHPP = recalcSemua(bahanList, produkList, resepData);
  const jualMap = {};
  penjualanHariIni.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });
  const bahanMap = {};
  bahanList.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

  // ── Omzet & Food Cost ──
  const omzet = produkHPP.reduce((s, p) => s + p.HARGA_JUAL * (jualMap[p.ID_PRODUK] || 0), 0);
  const totalFoodCost = produkHPP.reduce((s, p) => s + p.HPP_PER_PCS * (jualMap[p.ID_PRODUK] || 0), 0);
  const foodCostPct = omzet > 0 ? round2((totalFoodCost / omzet) * 100) : 0;
  const profit = round2(omzet - totalFoodCost);

  // ── Ranking Produk: gabungan qty, margin, profit ──
  const rankingProduk = produkHPP.map(p => {
    const qty = jualMap[p.ID_PRODUK] || 0;
    const totalProfit = round2(p.MARGIN_RP * qty);
    const omzetProduk = round2(p.HARGA_JUAL * qty);
    const foodCostProduk = round2(p.HPP_PER_PCS * qty);
    const fcPct = omzetProduk > 0 ? round2((foodCostProduk / omzetProduk) * 100) : 0;
    // Skor = 0.4*normalisasi_profit + 0.35*normalisasi_margin + 0.25*normalisasi_qty
    return { ...p, QTY: qty, TOTAL_PROFIT: totalProfit, OMZET: omzetProduk, FC_PCT: fcPct };
  });

  const maxProfit = Math.max(...rankingProduk.map(p => p.TOTAL_PROFIT));
  const maxMargin = Math.max(...rankingProduk.map(p => p.MARGIN_PCT));
  const maxQty    = Math.max(...rankingProduk.map(p => p.QTY));

  const rankingFinal = rankingProduk.map(p => ({
    ...p,
    SKOR: round2(
      0.40 * (maxProfit > 0 ? p.TOTAL_PROFIT / maxProfit : 0) * 100 +
      0.35 * (maxMargin > 0 ? p.MARGIN_PCT / maxMargin : 0) * 100 +
      0.25 * (maxQty    > 0 ? p.QTY    / maxQty    : 0) * 100
    ),
  })).sort((a, b) => b.SKOR - a.SKOR);

  // ── Supplier per bahan ──
  const supplierByBahan = {};
  supplierList.forEach(s => {
    if (!supplierByBahan[s.ID_BAHAN]) supplierByBahan[s.ID_BAHAN] = [];
    // Normalize the supplier display name so downstream code that reads
    // NAMA_SUPPLIER never renders "undefined" (source data uses NAMA).
    supplierByBahan[s.ID_BAHAN].push({
      ...s,
      NAMA_SUPPLIER: s.NAMA_SUPPLIER || s.NAMA || s.ID_SUPPLIER || "Supplier",
    });
  });

  // Supplier termurah & termahal per bahan (hanya bahan yang ada suppliernya)
  const supplierSummary = Object.entries(supplierByBahan).map(([idBahan, list]) => {
    const bahan = bahanMap[idBahan];
    const sorted = [...list].sort((a, b) => a.HARGA - b.HARGA);
    const cheapest = sorted[0];
    const priciest = sorted[sorted.length - 1];
    const selisih  = priciest.HARGA - cheapest.HARGA;
    const selisihPct = round2((selisih / cheapest.HARGA) * 100);
    return {
      ID_BAHAN: idBahan,
      NAMA_BAHAN: bahan?.NAMA_BAHAN || idBahan,
      SATUAN_BELI: bahan?.SATUAN_BELI || "",
      HARGA_PAKAI: bahan?.HARGA_RATA2 || 0,
      TERMURAH: cheapest,
      TERMAHAL: priciest,
      SELISIH: selisih,
      SELISIH_PCT: selisihPct,
      ALL: sorted,
    };
  });

  return {
    omzet, totalFoodCost, foodCostPct, profit,
    rankingFinal, supplierSummary,
    produkHPP,
    jualMap,
  };
}

function scoreColor(s) {
  if (s >= 80) return "#7fa86a";
  if (s >= 60) return "#a9c46a";
  if (s >= 40) return "#d99a4e";
  return "#d1685c";
}

// ═══════════════════════════════════════════════════════════════
// SVG CHART COMPONENTS — pure presentational, no data-fetch
// ═══════════════════════════════════════════════════════════════

function LineChart({ series, labels, colors, height = 140, showArea = true, yFormatter = v => v, title }) {
  const W = 480, H = height;
  const PAD = { t: 16, r: 16, b: 28, l: 52 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const allVals = series.flatMap(s => s.data);
  const minV = Math.min(...allVals) * 0.95;
  const maxV = Math.max(...allVals) * 1.05;
  const range = maxV - minV || 1;

  const xStep = labels.length > 1 ? cW / (labels.length - 1) : cW;

  const toX = i => PAD.l + i * xStep;
  const toY = v => PAD.t + cH - ((v - minV) / range) * cH;

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => minV + (range / tickCount) * i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {/* Y grid */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={toY(v)} y2={toY(v)} stroke="#3a3834" strokeWidth="1" />
          <text x={PAD.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#78746b">
            {yFormatter(v)}
          </text>
        </g>
      ))}
      {/* X labels */}
      {labels.map((lb, i) => (
        <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#78746b">{lb}</text>
      ))}
      {/* Series */}
      {series.map((s, si) => {
        const pts = s.data.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
        const pathD = s.data.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(v)}`).join(" ");
        const areaD = `${pathD} L${toX(s.data.length - 1)},${toY(minV)} L${toX(0)},${toY(minV)} Z`;
        const color = colors[si % colors.length];
        return (
          <g key={si}>
            {showArea && (
              <path d={areaD} fill={color} fillOpacity="0.08" />
            )}
            <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.data.map((v, i) => (
              <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill={color} stroke="#1f1e1c" strokeWidth="1.5" />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function BarChart({ data, labels, colors, height = 120, yFormatter = v => v }) {
  const W = 480, H = height;
  const PAD = { t: 10, r: 16, b: 28, l: 52 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const maxV = Math.max(...data) * 1.1 || 1;
  const barW = (cW / data.length) * 0.65;
  const gap   = cW / data.length;

  const toY = v => PAD.t + cH - (v / maxV) * cH;
  const toBarH = v => (v / maxV) * cH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => maxV * f);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={toY(v)} y2={toY(v)} stroke="#3a3834" strokeWidth="1" />
          <text x={PAD.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#78746b">
            {yFormatter(v)}
          </text>
        </g>
      ))}
      {data.map((v, i) => {
        const x = PAD.l + i * gap + (gap - barW) / 2;
        const color = Array.isArray(colors) ? colors[i % colors.length] : colors;
        return (
          <g key={i}>
            <rect x={x} y={toY(v)} width={barW} height={toBarH(v)} rx="3" fill={color} fillOpacity="0.85" />
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#8a857b">
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ value, max = 100, color, size = 80, label, sub }) {
  const r = 28, cx = 40, cy = 40;
  const circ = 2 * Math.PI * r;
  const filled = ((value / max) * circ);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg width={size} height={size} viewBox="0 0 80 80">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#3a3834" strokeWidth="10" />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
        />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="800" fill={color}>
          {value.toFixed(1)}%
        </text>
      </svg>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#ecebe5" }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "#78746b", marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UI KOMPONEN
// ═══════════════════════════════════════════════════════════════
function Card({ children, style = {} }) {
  return (
    <div style={{ background: "#302f2c", border: "1px solid #3a3834", borderRadius: 14, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, accent }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#78746b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
      {accent && <span style={{ display: "inline-block", width: 3, height: 12, background: accent, borderRadius: 2 }} />}
      {children}
    </div>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, color, background: color + "22", border: `1px solid ${color}44` }}>
      {children}
    </span>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8a857b" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: it.color }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "#1f1e1c", borderRadius: 10, padding: 4, flexWrap: "wrap" }}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            border: "none", cursor: "pointer",
            padding: "6px 14px", borderRadius: 7,
            fontSize: 12, fontWeight: 600,
            background: active === t.key ? "#3a3834" : "transparent",
            color: active === t.key ? "#ecebe5" : "#78746b",
            transition: "all 0.15s",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECTION: FOOD COST ANALYTICS
// ═══════════════════════════════════════════════════════════════
function FoodCostAnalytics({ data }) {
  const { omzet, totalFoodCost, foodCostPct, profit, produkHPP, jualMap } = data;

  return (
    <Card>
      <SectionTitle accent="#d99a4e">🧾 Food Cost Analytics</SectionTitle>

      {/* Donut summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <DonutChart
          value={foodCostPct}
          color={foodCostPct > 40 ? "#d1685c" : foodCostPct > 30 ? "#d99a4e" : "#7fa86a"}
          label="Food Cost % Hari Ini"
          sub={`Target ideal: ≤ 30%`}
        />
        <div>
          <div style={{ fontSize: 11, color: "#78746b", marginBottom: 4 }}>Omzet</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#c96442" }}>{idr(omzet)}</div>
          <div style={{ fontSize: 11, color: "#78746b", marginTop: 8, marginBottom: 4 }}>HPP Total</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#d99a4e" }}>{idr(totalFoodCost)}</div>
          <div style={{ fontSize: 11, color: "#78746b", marginTop: 8, marginBottom: 4 }}>Profit Bersih</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#7fa86a" }}>{idr(profit)}</div>
        </div>
      </div>

      {/* Food Cost per produk */}
      <div style={{ borderTop: "1px solid #3a3834", paddingTop: 14 }}>
        <div style={{ fontSize: 11, color: "#615d55", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Food Cost per Produk (Hari Ini)
        </div>
        {produkHPP.map(p => {
          const qty = jualMap[p.ID_PRODUK] || 0;
          const omzetP = p.HARGA_JUAL * qty;
          const hppP   = p.HPP_PER_PCS * qty;
          const fcP    = omzetP > 0 ? round2((hppP / omzetP) * 100) : 0;
          const color  = fcP > 40 ? "#d1685c" : fcP > 30 ? "#d99a4e" : "#7fa86a";
          return (
            <div key={p.ID_PRODUK} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: "#d6d3cb" }}>{p.NAMA_PRODUK}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#78746b", fontFamily: "monospace" }}>
                    {idr(hppP)} / {idr(omzetP)}
                  </span>
                  <Badge color={color}>{pct(fcP)}</Badge>
                </div>
              </div>
              <div style={{ height: 4, background: "#3a3834", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(fcP, 100)}%`, background: color, borderRadius: 99 }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECTION: SUPPLIER ANALYSIS
// ═══════════════════════════════════════════════════════════════
function SupplierAnalysis({ supplierSummary }) {
  const [tab, setTab] = useState("cheapest");

  const bySelisih = [...supplierSummary].sort((a, b) => b.SELISIH - a.SELISIH);

  // Supplier paling sering muncul sebagai termurah
  const cheapestCount = {};
  const priciestCount = {};
  supplierSummary.forEach(s => {
    const murah = s.TERMURAH?.NAMA_SUPPLIER;
    const mahal = s.TERMAHAL?.NAMA_SUPPLIER;
    if (murah) cheapestCount[murah] = (cheapestCount[murah] || 0) + 1;
    if (mahal) priciestCount[mahal] = (priciestCount[mahal] || 0) + 1;
  });
  const cheapestRank = Object.entries(cheapestCount).sort((a, b) => b[1] - a[1]);
  const priciestRank = Object.entries(priciestCount).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <SectionTitle accent="#a98bbf">🏪 Analisis Supplier</SectionTitle>
      <TabBar
        tabs={[
          { key: "cheapest", label: "🟢 Termurah" },
          { key: "priciest", label: "🔴 Termahal" },
          { key: "compare",  label: "📊 Perbandingan" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "cheapest" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#615d55", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Supplier Paling Sering Termurah
              </div>
              {cheapestRank.length === 0 && (
                <div style={{ fontSize: 12, color: "#78746b", padding: "6px 0" }}>Belum ada data supplier.</div>
              )}
              {cheapestRank.map(([nama, count], i) => (
                <div key={nama} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? "#7fa86a" : "#a9a49a" }}>#{i+1}</span>
                    <span style={{ fontSize: 12, color: "#d6d3cb" }}>{nama}</span>
                  </div>
                  <Badge color="#7fa86a">{count} bahan</Badge>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #3a3834", paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: "#615d55", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Harga Termurah per Bahan
              </div>
              {supplierSummary.map(s => (
                <SupplierAlertRow key={s.ID_BAHAN}
                  color="#7fa86a"
                  nama={s.NAMA_BAHAN}
                  supplier={s.TERMURAH.NAMA_SUPPLIER}
                  harga={s.TERMURAH.HARGA}
                  satuan={s.SATUAN_BELI}
                  kota={s.TERMURAH.KOTA}
                />
              ))}
            </div>
          </>
        )}
        {tab === "priciest" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#615d55", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Supplier Paling Sering Termahal
              </div>
              {priciestRank.length === 0 && (
                <div style={{ fontSize: 12, color: "#78746b", padding: "6px 0" }}>Belum ada data supplier.</div>
              )}
              {priciestRank.map(([nama, count], i) => (
                <div key={nama} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? "#d1685c" : "#a9a49a" }}>#{i+1}</span>
                    <span style={{ fontSize: 12, color: "#d6d3cb" }}>{nama}</span>
                  </div>
                  <Badge color="#d1685c">{count} bahan</Badge>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #3a3834", paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: "#615d55", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Harga Termahal per Bahan
              </div>
              {supplierSummary.map(s => (
                <SupplierAlertRow key={s.ID_BAHAN}
                  color="#d1685c"
                  nama={s.NAMA_BAHAN}
                  supplier={s.TERMAHAL.NAMA_SUPPLIER}
                  harga={s.TERMAHAL.HARGA}
                  satuan={s.SATUAN_BELI}
                  kota={s.TERMAHAL.KOTA}
                />
              ))}
            </div>
          </>
        )}
        {tab === "compare" && (
          <>
            <div style={{ fontSize: 11, color: "#615d55", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
              Selisih Harga Termahal vs Termurah
            </div>
            <BarChart
              data={bySelisih.map(s => s.SELISIH)}
              labels={bySelisih.map(s => s.NAMA_BAHAN.split(" ")[0])}
              colors={bySelisih.map(s => s.SELISIH_PCT > 15 ? "#d1685c" : s.SELISIH_PCT > 8 ? "#d99a4e" : "#7fa86a")}
              height={130}
              yFormatter={v => `${(v/1000).toFixed(0)}k`}
            />
            <div style={{ marginTop: 14 }}>
              {bySelisih.map(s => (
                <div key={s.ID_BAHAN} style={{ marginBottom: 10, padding: "10px 12px", background: "#1f1e1c", borderRadius: 8, border: "1px solid #3a3834" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#ecebe5" }}>{s.NAMA_BAHAN}</span>
                    <Badge color={s.SELISIH_PCT > 15 ? "#d1685c" : s.SELISIH_PCT > 8 ? "#d99a4e" : "#7fa86a"}>
                      Selisih {s.SELISIH_PCT.toFixed(0)}%
                    </Badge>
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#615d55", marginBottom: 2 }}>TERMURAH</div>
                      <div style={{ fontSize: 12, color: "#7fa86a", fontWeight: 700 }}>{idr(s.TERMURAH.HARGA)}/{s.SATUAN_BELI}</div>
                      <div style={{ fontSize: 10, color: "#78746b" }}>{s.TERMURAH.NAMA_SUPPLIER}</div>
                    </div>
                    <div style={{ width: 1, background: "#3a3834" }} />
                    <div>
                      <div style={{ fontSize: 10, color: "#615d55", marginBottom: 2 }}>TERMAHAL</div>
                      <div style={{ fontSize: 12, color: "#d1685c", fontWeight: 700 }}>{idr(s.TERMAHAL.HARGA)}/{s.SATUAN_BELI}</div>
                      <div style={{ fontSize: 10, color: "#78746b" }}>{s.TERMAHAL.NAMA_SUPPLIER}</div>
                    </div>
                    <div style={{ width: 1, background: "#3a3834" }} />
                    <div>
                      <div style={{ fontSize: 10, color: "#615d55", marginBottom: 2 }}>HARGA PAKAI</div>
                      <div style={{ fontSize: 12, color: "#a9a49a", fontWeight: 700 }}>{idr(s.HARGA_PAKAI)}/{s.SATUAN_BELI}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function SupplierAlertRow({ color, nama, supplier, harga, satuan, kota }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "8px 10px", borderRadius: 8,
      background: color + "10", border: `1px solid ${color}28`,
      marginBottom: 6,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#ecebe5" }}>{nama}</div>
        <div style={{ fontSize: 10, color: "#78746b" }}>
          {[supplier, kota].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "monospace" }}>
        {idr(harga)}<span style={{ fontSize: 10, fontWeight: 400 }}>/{satuan}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECTION: RANKING PRODUK
// ═══════════════════════════════════════════════════════════════
function RankingProduk({ rankingFinal, jualMap }) {
  const [sortBy, setSortBy] = useState("skor");

  const sorted = [...rankingFinal].sort((a, b) => {
    if (sortBy === "skor")    return b.SKOR - a.SKOR;
    if (sortBy === "margin")  return b.MARGIN_PCT - a.MARGIN_PCT;
    if (sortBy === "profit")  return b.TOTAL_PROFIT - a.TOTAL_PROFIT;
    if (sortBy === "qty")     return b.QTY - a.QTY;
    return 0;
  });

  const medals = ["🥇", "🥈", "🥉"];
  const maxSkor = Math.max(...sorted.map(p => p.SKOR));

  return (
    <Card>
      <SectionTitle accent="#c96442">🏆 Ranking Produk</SectionTitle>

      <div style={{ marginBottom: 14 }}>
        <TabBar
          tabs={[
            { key: "skor",   label: "⭐ Skor Total" },
            { key: "margin", label: "📈 Margin" },
            { key: "profit", label: "💰 Profit" },
            { key: "qty",    label: "🔥 Qty Jual" },
          ]}
          active={sortBy}
          onChange={setSortBy}
        />
      </div>

      {/* Bar chart */}
      <BarChart
        data={sorted.map(p => sortBy === "skor" ? p.SKOR : sortBy === "margin" ? p.MARGIN_PCT : sortBy === "profit" ? p.TOTAL_PROFIT : p.QTY)}
        labels={sorted.map(p => p.NAMA_PRODUK.split(" ")[0])}
        colors={["#c96442", "#6ea3c4", "#7fa86a", "#a98bbf", "#d99a4e"]}
        height={120}
        yFormatter={v => sortBy === "profit" ? `${(v/1000).toFixed(0)}k` : sortBy === "qty" ? `${v}` : `${v.toFixed(0)}`}
      />

      {/* Table detail */}
      <div style={{ marginTop: 14 }}>
        {sorted.map((p, i) => (
          <div key={p.ID_PRODUK} style={{
            display: "grid",
            gridTemplateColumns: "24px 1fr auto",
            gap: 10, alignItems: "center",
            padding: "10px 12px",
            background: i === 0 ? "#c96442" + "10" : "#1f1e1c",
            border: `1px solid ${i === 0 ? "#c96442" + "33" : "#3a3834"}`,
            borderRadius: 8, marginBottom: 6,
          }}>
            <span style={{ fontSize: 16 }}>{medals[i] || `#${i + 1}`}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ecebe5" }}>{p.NAMA_PRODUK}</div>
              <div style={{ fontSize: 10, color: "#78746b", marginTop: 2 }}>
                HPP {idr(p.HPP_PER_PCS)} · Margin {pct(p.MARGIN_PCT)} · Qty {p.QTY} pcs · Profit {idr(p.TOTAL_PROFIT)}
              </div>
              {/* Mini bar skor */}
              <div style={{ marginTop: 5, height: 3, background: "#3a3834", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(p.SKOR / maxSkor) * 100}%`, background: scoreColor(p.SKOR), borderRadius: 99 }} />
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: scoreColor(p.SKOR) }}>{p.SKOR.toFixed(0)}</div>
              <div style={{ fontSize: 10, color: "#615d55" }}>skor</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#3a3834", marginTop: 8 }}>
        Skor = 40% profit + 35% margin + 25% qty. Semua data dari Service Layer.
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN ANALYTICS PAGE
// ═══════════════════════════════════════════════════════════════
export default function KCCAnalytics() {
  const { token } = useAuth();

  const [bahanList,    setBahanList]    = useState(INITIAL_BAHAN);
  const [produkList,   setProdukList]   = useState(PRODUK);
  const [resepData,    setResepData]    = useState(RESEP);
  const [supplierList, setSupplierList] = useState(SUPPLIER_DATA);
  const [penjualan,    setPenjualan]    = useState(PENJUALAN_HARI_INI);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchBahan(token),
      fetchProduk(token),
      fetchResep(token),
      fetchSupplier(token),
      fetchDashboard(token),
    ]).then(([bahanData, produkData, resepDataFetched, supplierData, dashData]) => {
      if (bahanData)           setBahanList(bahanData);
      if (produkData)          setProdukList(produkData);
      if (resepDataFetched)    setResepData(resepDataFetched);
      if (supplierData)        setSupplierList(supplierData);
      if (dashData?.penjualan) setPenjualan(dashData.penjualan);
    });
  }, [token]);

  const data = useMemo(
    () => getAnalyticsData(bahanList, produkList, resepData, penjualan, supplierList),
    [bahanList, produkList, resepData, penjualan, supplierList]
  );

  return (
    <div>
      <style>{`
        @keyframes fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.3 } }
        .ana-grid { display: grid; gap: 16px; animation: fadein 0.4s ease both; }
        .ana-2col { grid-template-columns: 1fr 1fr; }
        .ana-3col { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 1024px) { .ana-2col { grid-template-columns: 1fr; } .ana-3col { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 680px)  { .ana-3col { grid-template-columns: 1fr; } }
      `}</style>

        {/* Row 1 — Food Cost + Supplier */}
        <div className="ana-grid ana-2col" style={{ marginBottom: 16 }}>
          <FoodCostAnalytics data={data} />
          <SupplierAnalysis supplierSummary={data.supplierSummary} />
        </div>

        {/* Row 2 — Ranking Produk (full width) */}
        <div style={{ marginBottom: 16 }}>
          <RankingProduk rankingFinal={data.rankingFinal} jualMap={data.jualMap} />
        </div>

        {/* Footer */}
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: "#3a3834" }}>
          KCC Analytics · Phase 3
        </div>
    </div>
  );
}
