import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  PRODUK,
  RESEP,
  fetchBahan,
  fetchProduk,
  fetchResep,
  recalcSemua,
  round2, idr, pct, marginColor,
} from "./kcc_data_layer";

// ─── Shared Styles ────────────────────────────────────────────
const S = {
  card: {
    background: "#161927",
    border: "1px solid #1e2840",
    borderRadius: 14,
    padding: 20,
  },
  label: {
    fontSize: 11, fontWeight: 700, color: "#475569",
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12,
  },
  th: {
    padding: "9px 12px", textAlign: "left", fontSize: 11,
    color: "#475569", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.05em", borderBottom: "1px solid #1e2840",
  },
  td: {
    padding: "11px 12px", fontSize: 13,
    borderBottom: "1px solid #1e2840", verticalAlign: "middle",
    color: "#e2e8f0",
  },
  badge: (color) => ({
    display: "inline-block", padding: "2px 9px", borderRadius: 20,
    fontSize: 11, fontWeight: 700, color,
    background: color + "22", border: `1px solid ${color}44`,
  }),
};

function Card({ children, style = {} }) {
  return <div style={{ ...S.card, ...style }}>{children}</div>;
}

export default function ResepManager() {
  const { token } = useAuth();

  const [bahanList,  setBahanList]  = useState(INITIAL_BAHAN);
  const [produkList, setProdukList] = useState(PRODUK);
  const [resepData,  setResepData]  = useState(RESEP);
  const [searchQ,    setSearchQ]    = useState("");

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchBahan(token),
      fetchProduk(token),
      fetchResep(token),
    ]).then(([bahanData, produkData, resepRes]) => {
      if (bahanData)  setBahanList(bahanData);
      if (produkData) setProdukList(produkData);
      if (resepRes)   setResepData(resepRes);
    });
  }, [token]);

  const [selectedProduk, setSelectedProduk] = useState(null);

  // Set default selection once produkList is available
  const activeProdukId = selectedProduk ?? produkList[0]?.ID_PRODUK ?? null;

  const bahanMap = useMemo(() => {
    const m = {};
    bahanList.forEach(b => { m[b.ID_BAHAN] = b; });
    return m;
  }, [bahanList]);

  const produkHPP = useMemo(() => recalcSemua(bahanList, produkList, resepData), [bahanList, produkList, resepData]);
  const hppMap = useMemo(() => {
    const m = {};
    produkHPP.forEach(p => { m[p.ID_PRODUK] = p; });
    return m;
  }, [produkHPP]);

  const resepProduk = useMemo(() =>
    resepData.filter(r => r.ID_PRODUK === activeProdukId),
    [resepData, activeProdukId]
  );

  const selected    = produkList.find(p => p.ID_PRODUK === activeProdukId);
  const selectedHPP = hppMap[activeProdukId];

  const filteredProduk = produkList.filter(p =>
    p.NAMA_PRODUK.toLowerCase().includes(searchQ.toLowerCase()) ||
    p.KATEGORI.toLowerCase().includes(searchQ.toLowerCase())
  );

  const totalBiayaResep = selectedHPP?.HPP_PER_BATCH ?? 0;

  return (
    <div>
      <style>{`
        .resep-row:hover { background: rgba(249,115,22,0.04) !important; }
        .produk-item:hover { background: rgba(249,115,22,0.06) !important; cursor: pointer; }
        .produk-item.active { background: rgba(249,115,22,0.10) !important; border-left: 3px solid #f97316 !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
          📋 Manajemen Resep
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
          Komposisi bahan & biaya per produk
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" }}>

        {/* Left: Daftar Produk */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1e2840" }}>
            <div style={S.label}>Produk ({produkList.length})</div>
            <input
              type="text"
              placeholder="Cari produk..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              style={{
                width: "100%", background: "#0f1117", border: "1px solid #334155",
                borderRadius: 8, padding: "7px 10px", color: "#f1f5f9",
                fontSize: 13, outline: "none",
              }}
            />
          </div>
          {filteredProduk.map(p => {
            const hpp = hppMap[p.ID_PRODUK];
            const isActive = p.ID_PRODUK === activeProdukId;
            return (
              <div
                key={p.ID_PRODUK}
                className={`produk-item${isActive ? " active" : ""}`}
                onClick={() => setSelectedProduk(p.ID_PRODUK)}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #1e2840",
                  borderLeft: isActive ? "3px solid #f97316" : "3px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: "#f1f5f9" }}>{p.NAMA_PRODUK}</div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                  {p.KATEGORI} · {idr(p.HARGA_JUAL)}
                </div>
                {hpp && (
                  <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={S.badge(marginColor(hpp.MARGIN_PCT))}>{pct(hpp.MARGIN_PCT)}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>HPP {idr(hpp.HPP_PER_PCS)}</span>
                  </div>
                )}
              </div>
            );
          })}
          {filteredProduk.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#334155", fontSize: 13 }}>
              Produk tidak ditemukan
            </div>
          )}
        </Card>

        {/* Right: Detail Resep */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* KPI Bar */}
          {selected && selectedHPP && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Harga Jual", value: idr(selected.HARGA_JUAL), accent: "#f97316" },
                { label: "HPP / Pcs",  value: idr(selectedHPP.HPP_PER_PCS), accent: "#94a3b8" },
                { label: "Margin",     value: pct(selectedHPP.MARGIN_PCT), accent: marginColor(selectedHPP.MARGIN_PCT) },
                { label: "Margin Rp",  value: idr(selectedHPP.MARGIN_RP), accent: "#22c55e" },
              ].map(k => (
                <Card key={k.label}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.accent, letterSpacing: "-0.02em" }}>{k.value}</div>
                </Card>
              ))}
            </div>
          )}

          {/* Resep Table */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e2840", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={S.label}>Komposisi Resep</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>
                  {selected?.NAMA_PRODUK} — yield {selected?.YIELD_PCS} pcs/batch
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Total Biaya Batch</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#f97316" }}>{idr(totalBiayaResep)}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Bahan", "Jumlah", "Satuan", "Harga/kg", "Biaya"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedHPP?.DETAIL.map((d, i) => {
                  const pctBiaya = totalBiayaResep > 0 ? round2((d.BIAYA_BAHAN / totalBiayaResep) * 100) : 0;
                  return (
                    <tr key={d.ID_BAHAN} className="resep-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>{d.NAMA_BAHAN}</div>
                      </td>
                      <td style={S.td}>{d.JUMLAH}</td>
                      <td style={S.td}>{d.SATUAN_PAKAI}</td>
                      <td style={{ ...S.td, fontFamily: "monospace" }}>{idr(d.HARGA_RATA2)}</td>
                      <td style={S.td}>
                        <div style={{ fontFamily: "monospace", fontWeight: 600 }}>{idr(d.BIAYA_BAHAN)}</div>
                        <div style={{ marginTop: 3, height: 3, background: "#1e2840", borderRadius: 99, overflow: "hidden", width: 80 }}>
                          <div style={{ height: "100%", width: `${pctBiaya}%`, background: "#f97316", borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#475569", marginTop: 1 }}>{pctBiaya}%</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ ...S.td, fontWeight: 700, color: "#94a3b8" }}>Total Biaya per Batch</td>
                  <td style={{ ...S.td, fontWeight: 800, color: "#f97316", fontFamily: "monospace" }}>{idr(totalBiayaResep)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {/* Pie/Bar biaya bahan */}
          <Card>
            <div style={S.label}>Proporsi Biaya Bahan</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedHPP?.DETAIL.map(d => {
                const pctBiaya = totalBiayaResep > 0 ? round2((d.BIAYA_BAHAN / totalBiayaResep) * 100) : 0;
                const colors = ["#f97316","#fb923c","#fbbf24","#22c55e","#3b82f6","#8b5cf6","#ec4899","#94a3b8"];
                const colorIdx = selectedHPP.DETAIL.indexOf(d);
                const color = colors[colorIdx % colors.length];
                return (
                  <div key={d.ID_BAHAN}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>{d.NAMA_BAHAN}</span>
                      <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>
                        {idr(d.BIAYA_BAHAN)} · {pctBiaya}%
                      </span>
                    </div>
                    <div style={{ height: 5, background: "#1e2840", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pctBiaya}%`, background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
