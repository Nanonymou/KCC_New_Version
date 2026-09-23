// ═══════════════════════════════════════════════════════════════════════════
// DashboardStok.jsx — rekap nilai Rp Transaksi Harian (modul Inventory Harian
// retail). Membaca apiDashboardStok, yang memakai view yang sama dengan
// Transaksi Harian lalu menghitung nilai Rp per kolom mutasi (Price × Qty).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { fetchDashboardStok, MOVEMENT_COLUMNS, ITEM_SECTIONS, idr } from "./kcc_data_layer";
import { TextInput, Select } from "./FormKit";
import { T } from "./theme";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Card({ children, style = {} }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, ...style }}>{children}</div>;
}

export default function DashboardStok() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [section, setSection] = useState("all");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const data = await fetchDashboardStok(token, date, { section, query });
    if (data) setResult(data);
    setLoading(false);
  }, [token, date, section, query]);

  useEffect(() => { reload(); }, [reload]);

  const summary = result?.summary;
  const rows = result?.rows || [];
  const counts = result?.counts || { total: 0, shown: 0 };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
          📊 Dashboard Stok
        </div>
        <div style={{ fontSize: 13, color: T.textFaint, marginTop: 4 }}>
          Rekap nilai Rp Transaksi Harian per tanggal
        </div>
      </div>

      {/* Filter bar */}
      <Card style={{ marginBottom: 16, padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{
              padding: "8px 10px", fontSize: 13, background: T.surfaceInput, color: T.text,
              border: `1px solid ${T.border}`, borderRadius: T.radiusSm, outline: "none",
            }}
          />
          <Select value={section} onChange={(e) => setSection(e.target.value)} style={{ width: 220 }}>
            <option value="all">Semua Section</option>
            {ITEM_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <TextInput
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari Item Code / Description / Brand…" style={{ flex: 1, minWidth: 200 }}
          />
          <span style={{ fontSize: 12, color: T.textFaint, whiteSpace: "nowrap" }}>
            {counts.shown} dari {counts.total} item
          </span>
        </div>
      </Card>

      {loading || !summary ? (
        <Card><div style={{ color: T.textFaint }}>Memuat…</div></Card>
      ) : (
        <>
          {/* KPI */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Total Masuk", value: idr(summary.totalIn), accent: T.success, icon: "⬇️" },
              { label: "Total Keluar", value: idr(summary.totalOut), accent: T.danger, icon: "⬆️" },
              { label: "Selisih (Masuk − Keluar)", value: idr(summary.balanceValue), accent: T.info, icon: "⚖️" },
              { label: "Total Nilai Stok", value: idr(summary.totalStockValue), accent: T.primary, icon: "💰" },
            ].map((k) => (
              <Card key={k.label}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 11, color: T.textFaint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: k.accent, letterSpacing: "-0.02em" }}>{k.value}</div>
                  </div>
                  <div style={{ fontSize: 18, opacity: 0.6 }}>{k.icon}</div>
                </div>
              </Card>
            ))}
          </div>

          {/* Nilai per kolom mutasi */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>
              Nilai Rp per Kolom Mutasi (Price × Qty)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {MOVEMENT_COLUMNS.map((c) => (
                      <th key={c.key} style={thCol}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {MOVEMENT_COLUMNS.map((c) => (
                      <td key={c.key} style={tdCol}>{idr(summary.perColumn[c.key] || 0)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Detail per item */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 0", fontSize: 13, fontWeight: 700, color: T.text }}>
              Detail per Item ({rows.length})
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thCol}>Item Code</th>
                    <th style={thCol}>Description</th>
                    <th style={thCol}>Section</th>
                    <th style={{ ...thCol, textAlign: "right" }}>Balance</th>
                    <th style={{ ...thCol, textAlign: "right" }}>Price</th>
                    <th style={{ ...thCol, textAlign: "right" }}>Nilai Stok</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td style={tdCol} colSpan={6}>Tidak ada item yang cocok filter.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.ID_ITEM}>
                      <td style={{ ...tdCol, fontWeight: 600 }}>{r.ITEM_CODE}</td>
                      <td style={tdCol}>{r.DESCRIPTION}</td>
                      <td style={tdCol}>{r.SECTION}</td>
                      <td style={{ ...tdCol, textAlign: "right" }}>{r.BALANCE}</td>
                      <td style={{ ...tdCol, textAlign: "right" }}>{idr(r.PRICE)}</td>
                      <td style={{ ...tdCol, textAlign: "right", fontWeight: 600 }}>{idr(r.BALANCE * r.PRICE)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

const thCol = {
  padding: "9px 12px", textAlign: "left", fontSize: 11, color: T.textFaint,
  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
  borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap",
};
const tdCol = { padding: "10px 12px", borderBottom: `1px solid ${T.borderSoft}` };
