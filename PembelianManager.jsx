import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  STOK_BAHAN,
  SUPPLIER_DATA,
  PEMBELIAN_DATA,
  fetchBahan,
  fetchStok,
  fetchSupplier,
  fetchPembelian,
  round2, idr,
} from "./kcc_data_layer";

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
  },
};

function Card({ children, style = {} }) {
  return <div style={{ ...S.card, ...style }}>{children}</div>;
}

const STATUS_COLOR = {
  Diterima: "#22c55e",
  Pending:  "#f59e0b",
  Batal:    "#ef4444",
};

export default function PembelianManager() {
  const { token } = useAuth();

  const [filterStatus, setFilterStatus] = useState("Semua");
  const [searchQ, setSearchQ]           = useState("");
  const [activeTab, setActiveTab]       = useState("histori"); // histori | supplier | reorder

  const [bahanList,    setBahanList]    = useState(INITIAL_BAHAN);
  const [stokBahan,    setStokBahan]    = useState(STOK_BAHAN);
  const [supplierList, setSupplierList] = useState(SUPPLIER_DATA);
  const [pembelianList, setPembelianList] = useState(PEMBELIAN_DATA);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchBahan(token),
      fetchStok(token),
      fetchSupplier(token),
      fetchPembelian(token),
    ]).then(([bahanData, stokData, supplierData, pembelianData]) => {
      if (bahanData)    setBahanList(bahanData);
      if (stokData)     setStokBahan(stokData);
      if (supplierData) setSupplierList(supplierData);
      if (pembelianData) setPembelianList(pembelianData);
    });
  }, [token]);

  const bahanMap = useMemo(() => {
    const m = {};
    bahanList.forEach(b => { m[b.ID_BAHAN] = b; });
    return m;
  }, [bahanList]);

  const supplierMap = useMemo(() => {
    const m = {};
    supplierList.forEach(s => { m[s.ID_SUPPLIER] = s; });
    return m;
  }, [supplierList]);

  const stokMap = useMemo(() => {
    const m = {};
    stokBahan.forEach(s => { m[s.ID_BAHAN] = s; });
    return m;
  }, [stokBahan]);

  // Enriched pembelian rows
  const pembelianRows = useMemo(() =>
    pembelianList.map(p => ({
      ...p,
      BAHAN:    bahanMap[p.ID_BAHAN],
      SUPPLIER: supplierMap[p.ID_SUPPLIER],
    })),
    [pembelianList, bahanMap, supplierMap]
  );

  const filtered = useMemo(() => {
    let rows = pembelianRows;
    if (filterStatus !== "Semua") rows = rows.filter(r => r.STATUS === filterStatus);
    if (searchQ) rows = rows.filter(r =>
      r.BAHAN?.NAMA_BAHAN?.toLowerCase().includes(searchQ.toLowerCase()) ||
      r.SUPPLIER?.NAMA?.toLowerCase().includes(searchQ.toLowerCase()) ||
      r.ID_PO?.toLowerCase().includes(searchQ.toLowerCase())
    );
    return rows.sort((a, b) => b.TANGGAL.localeCompare(a.TANGGAL));
  }, [pembelianRows, filterStatus, searchQ]);

  // KPI
  const totalBelanja   = pembelianRows.reduce((s, r) => s + r.TOTAL, 0);
  const totalDiterima  = pembelianRows.filter(r => r.STATUS === "Diterima").reduce((s, r) => s + r.TOTAL, 0);
  const totalPending   = pembelianRows.filter(r => r.STATUS === "Pending").reduce((s, r) => s + r.TOTAL, 0);
  const jmlTransaksi   = pembelianRows.length;

  // Supplier summary
  const supplierSummary = useMemo(() => {
    const map = {};
    pembelianRows.forEach(r => {
      const sId = r.ID_SUPPLIER;
      if (!map[sId]) map[sId] = { supplier: r.SUPPLIER, total: 0, transaksi: 0 };
      map[sId].total     += r.TOTAL;
      map[sId].transaksi += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [pembelianRows]);

  // Reorder recommendations (stok < min)
  const reorderList = useMemo(() =>
    stokBahan
      .filter(s => s.STOK < s.MIN_STOK)
      .map(s => {
        const bahan = bahanMap[s.ID_BAHAN];
        const kebutuhan = round2(s.MIN_STOK * 1.5 - s.STOK); // pesan sampai 1.5x min
        // Supplier termurah untuk bahan ini
        const suppliers = supplierList.filter(sup => sup.ID_BAHAN === s.ID_BAHAN)
          .sort((a, b) => a.HARGA - b.HARGA);
        const best = suppliers[0];
        const estimasiHarga = best ? round2(kebutuhan * best.HARGA) : null;
        return { ...s, BAHAN: bahan, KEBUTUHAN: kebutuhan, BEST_SUPPLIER: best, ESTIMASI_HARGA: estimasiHarga };
      }),
    [stokBahan, bahanMap, supplierList]
  );

  const tabStyle = (active) => ({
    padding: "8px 16px", fontSize: 13, fontWeight: active ? 600 : 500,
    color: active ? "#f97316" : "#64748b",
    background: "none", border: "none",
    borderBottom: `2px solid ${active ? "#f97316" : "transparent"}`,
    cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
  });

  return (
    <div>
      <style>{`
        .po-row:hover { background: rgba(249,115,22,0.04) !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
          🛒 Manajemen Pembelian
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
          Histori PO, supplier & rekomendasi reorder
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Total Transaksi", value: jmlTransaksi, accent: "#f97316", icon: "📄" },
          { label: "Total Belanja",   value: idr(totalBelanja), accent: "#94a3b8", icon: "💳" },
          { label: "Sudah Diterima",  value: idr(totalDiterima), accent: "#22c55e", icon: "✅" },
          { label: "Pending",         value: idr(totalPending), accent: "#f59e0b", icon: "⏳" },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: k.label === "Total Transaksi" ? 28 : 18, fontWeight: 800, color: k.accent, letterSpacing: "-0.02em" }}>{k.value}</div>
              </div>
              <div style={{ fontSize: 20, opacity: 0.6 }}>{k.icon}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e2840", marginBottom: 14 }}>
        <button style={tabStyle(activeTab === "histori")}  onClick={() => setActiveTab("histori")}>📄 Histori PO</button>
        <button style={tabStyle(activeTab === "supplier")} onClick={() => setActiveTab("supplier")}>🚚 Supplier</button>
        <button style={tabStyle(activeTab === "reorder")}  onClick={() => setActiveTab("reorder")}>
          🔁 Reorder
          {reorderList.length > 0 && (
            <span style={{
              marginLeft: 6, background: "#ef4444", color: "#fff",
              borderRadius: 99, fontSize: 10, fontWeight: 800,
              padding: "1px 5px",
            }}>{reorderList.length}</span>
          )}
        </button>
      </div>

      {/* ── TAB: Histori PO ── */}
      {activeTab === "histori" && (
        <div>
          <Card style={{ marginBottom: 12, padding: "12px 16px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="🔍 Cari PO / bahan / supplier..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                style={{
                  background: "#0f1117", border: "1px solid #334155",
                  borderRadius: 8, padding: "7px 12px", color: "#f1f5f9",
                  fontSize: 13, outline: "none", width: 240,
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {["Semua", "Diterima", "Pending", "Batal"].map(s => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", border: "1px solid",
                      borderColor: filterStatus === s ? (STATUS_COLOR[s] || "#f97316") : "#1e2840",
                      background: filterStatus === s ? ((STATUS_COLOR[s] || "#f97316") + "22") : "transparent",
                      color: filterStatus === s ? (STATUS_COLOR[s] || "#f97316") : "#64748b",
                      transition: "all 0.15s",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
                {filtered.length} transaksi
              </div>
            </div>
          </Card>

          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["No. PO", "Tanggal", "Bahan", "Supplier", "Qty", "Harga/Satuan", "Total", "Status"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const statusColor = STATUS_COLOR[r.STATUS] || "#64748b";
                  return (
                    <tr key={r.ID_PO} className="po-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#f97316", fontWeight: 700 }}>{r.ID_PO}</td>
                      <td style={{ ...S.td, color: "#94a3b8" }}>{r.TANGGAL}</td>
                      <td style={{ ...S.td, fontWeight: 600, color: "#f1f5f9" }}>
                        {r.BAHAN?.NAMA_BAHAN || r.ID_BAHAN}
                      </td>
                      <td style={{ ...S.td, color: "#94a3b8" }}>
                        {r.SUPPLIER?.NAMA || r.ID_SUPPLIER}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace" }}>
                        {r.QTY} {r.BAHAN?.SATUAN_BELI || ""}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#94a3b8" }}>
                        {idr(r.HARGA_BELI)}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: "#e2e8f0" }}>
                        {idr(r.TOTAL)}
                      </td>
                      <td style={S.td}>
                        <span style={{
                          display: "inline-block", padding: "3px 10px", borderRadius: 20,
                          fontSize: 11, fontWeight: 700, color: statusColor,
                          background: statusColor + "22", border: `1px solid ${statusColor}44`,
                        }}>
                          {r.STATUS}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "#334155", fontSize: 13 }}>
                Tidak ada transaksi
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── TAB: Supplier ── */}
      {activeTab === "supplier" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Supplier Spending */}
          <Card>
            <div style={S.label}>Pengeluaran per Supplier</div>
            {supplierSummary.map(s => {
              const maxTotal = supplierSummary[0]?.total || 1;
              const pct = Math.min((s.total / maxTotal) * 100, 100);
              return (
                <div key={s.supplier?.ID_SUPPLIER} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>
                      {s.supplier?.NAMA || "Unknown"}
                    </span>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>
                      {s.transaksi}x · {idr(s.total)}
                    </span>
                  </div>
                  <div style={{ height: 5, background: "#1e2840", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "#f97316", borderRadius: 99, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Daftar Supplier */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e2840" }}>
              <div style={S.label}>Daftar Supplier ({supplierList.length})</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Supplier", "Bahan", "Harga/Satuan", "Lead Time", "Rating"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supplierList.map((s, i) => {
                  const bahan = bahanMap[s.ID_BAHAN];
                  const stars = "★".repeat(Math.round(s.RATING)) + "☆".repeat(5 - Math.round(s.RATING));
                  return (
                    <tr key={s.ID_SUPPLIER} className="po-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td style={{ ...S.td, fontWeight: 600, color: "#f1f5f9" }}>
                        {s.NAMA}
                        <div style={{ fontSize: 11, color: "#475569", fontWeight: 400 }}>{s.TELP}</div>
                      </td>
                      <td style={{ ...S.td, color: "#94a3b8" }}>{bahan?.NAMA_BAHAN || s.ID_BAHAN}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#e2e8f0" }}>
                        {idr(s.HARGA)} / {s.SATUAN}
                      </td>
                      <td style={{ ...S.td, color: "#94a3b8" }}>
                        {s.LEAD_TIME === 0 ? "Langsung" : `${s.LEAD_TIME} hari`}
                      </td>
                      <td style={{ ...S.td }}>
                        <span style={{ color: "#f59e0b", letterSpacing: 1 }}>{stars}</span>
                        <span style={{ color: "#64748b", fontSize: 11, marginLeft: 4 }}>{s.RATING}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ── TAB: Reorder ── */}
      {activeTab === "reorder" && (
        <div>
          {reorderList.length === 0 ? (
            <Card style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#22c55e" }}>Semua stok mencukupi</div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>Tidak ada bahan yang perlu reorder saat ini</div>
            </Card>
          ) : (
            <div>
              <div style={{ marginBottom: 12, fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
                ⚠️ {reorderList.length} bahan memerlukan pembelian segera
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {reorderList.map(r => {
                  const { color: stokColor } = r.STOK < r.MIN_STOK * 0.5
                    ? { color: "#ef4444" } : { color: "#f59e0b" };
                  return (
                    <Card key={r.ID_BAHAN} style={{ border: `1px solid ${stokColor}33`, background: stokColor + "08" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>
                            {r.BAHAN?.NAMA_BAHAN}
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            Stok saat ini: <span style={{ color: stokColor, fontWeight: 700 }}>{r.STOK} {r.BAHAN?.SATUAN_BELI}</span>
                            {" "}· Min: {r.MIN_STOK} {r.BAHAN?.SATUAN_BELI}
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                            Rekomendasi pesan: <span style={{ color: "#f97316", fontWeight: 700 }}>{r.KEBUTUHAN} {r.BAHAN?.SATUAN_BELI}</span>
                          </div>
                        </div>
                        {r.BEST_SUPPLIER && (
                          <div style={{
                            background: "#0f1117", borderRadius: 10, padding: "10px 14px",
                            border: "1px solid #1e2840", minWidth: 200,
                          }}>
                            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                              Supplier Terbaik
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{r.BEST_SUPPLIER.NAMA}</div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                              {idr(r.BEST_SUPPLIER.HARGA)} / {r.BEST_SUPPLIER.SATUAN}
                              {" "}· Lead time {r.BEST_SUPPLIER.LEAD_TIME === 0 ? "Langsung" : `${r.BEST_SUPPLIER.LEAD_TIME} hari`}
                            </div>
                            {r.ESTIMASI_HARGA && (
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#22c55e", marginTop: 4 }}>
                                Estimasi: {idr(r.ESTIMASI_HARGA)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
