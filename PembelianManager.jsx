import { useState, useMemo, useEffect, useCallback } from "react";
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
  createPurchase,
  voidPurchase,
  round2, idr,
} from "./kcc_data_layer";
import { Modal, Field, TextInput, Select, Button, FormError, Toast } from "./FormKit";

const todayStr = () => new Date().toISOString().slice(0, 10);

const S = {
  card: {
    background: "#302f2c",
    border: "1px solid #3a3834",
    borderRadius: 14,
    padding: 20,
  },
  label: {
    fontSize: 11, fontWeight: 700, color: "#78746b",
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12,
  },
  th: {
    padding: "9px 12px", textAlign: "left", fontSize: 11,
    color: "#78746b", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.05em", borderBottom: "1px solid #3a3834",
  },
  td: {
    padding: "11px 12px", fontSize: 13,
    borderBottom: "1px solid #3a3834", verticalAlign: "middle",
  },
};

function Card({ children, style = {} }) {
  return <div style={{ ...S.card, ...style }}>{children}</div>;
}

const STATUS_COLOR = {
  Diterima: "#7fa86a",
  Pending:  "#d99a4e",
  Batal:    "#d1685c",
};

export default function PembelianManager() {
  const { token, role, isDemo } = useAuth();
  const canWrite = !isDemo && (role === "ADMIN" || role === "SUPER_ADMIN");

  const [filterStatus, setFilterStatus] = useState("Semua");
  const [searchQ, setSearchQ]           = useState("");
  const [activeTab, setActiveTab]       = useState("histori"); // histori | supplier | reorder

  const [bahanList,    setBahanList]    = useState(INITIAL_BAHAN);
  const [stokBahan,    setStokBahan]    = useState(STOK_BAHAN);
  const [supplierList, setSupplierList] = useState(SUPPLIER_DATA);
  const [pembelianList, setPembelianList] = useState(PEMBELIAN_DATA);

  // Mutation UI state
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast]     = useState("");
  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const reload = useCallback(async () => {
    if (!token) return;
    const [bahanData, stokData, supplierData, pembelianData] = await Promise.all([
      fetchBahan(token), fetchStok(token), fetchSupplier(token), fetchPembelian(token),
    ]);
    if (bahanData)     setBahanList(bahanData);
    if (stokData)      setStokBahan(stokData);
    if (supplierData)  setSupplierList(supplierData);
    if (pembelianData) setPembelianList(pembelianData);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const [voidingId, setVoidingId] = useState(null);
  async function handleVoid(id) {
    if (!window.confirm(`Batalkan pembelian ${id}? Stok yang sudah masuk akan dikembalikan.`)) return;
    setVoidingId(id);
    try {
      await voidPurchase(token, id);
      await reload();
      flashToast(`Pembelian ${id} dibatalkan`);
    } catch (e) {
      window.alert("Gagal membatalkan: " + (e.message || "kesalahan server"));
    } finally {
      setVoidingId(null);
    }
  }

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
    color: active ? "#c96442" : "#8a857b",
    background: "none", border: "none",
    borderBottom: `2px solid ${active ? "#c96442" : "transparent"}`,
    cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
  });

  return (
    <div>
      <style>{`
        .po-row:hover { background: rgba(201,100,66,0.04) !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#ecebe5", letterSpacing: "-0.02em" }}>
          🛒 Manajemen Pembelian
        </div>
        <div style={{ fontSize: 13, color: "#78746b", marginTop: 4 }}>
          Histori PO, supplier & rekomendasi reorder
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Total Transaksi", value: jmlTransaksi, accent: "#c96442", icon: "📄" },
          { label: "Total Belanja",   value: idr(totalBelanja), accent: "#a9a49a", icon: "💳" },
          { label: "Sudah Diterima",  value: idr(totalDiterima), accent: "#7fa86a", icon: "✅" },
          { label: "Pending",         value: idr(totalPending), accent: "#d99a4e", icon: "⏳" },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, color: "#8a857b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: k.label === "Total Transaksi" ? 28 : 18, fontWeight: 800, color: k.accent, letterSpacing: "-0.02em" }}>{k.value}</div>
              </div>
              <div style={{ fontSize: 20, opacity: 0.6 }}>{k.icon}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #3a3834", marginBottom: 14 }}>
        <button style={tabStyle(activeTab === "histori")}  onClick={() => setActiveTab("histori")}>📄 Histori PO</button>
        <button style={tabStyle(activeTab === "supplier")} onClick={() => setActiveTab("supplier")}>🚚 Supplier</button>
        <button style={tabStyle(activeTab === "reorder")}  onClick={() => setActiveTab("reorder")}>
          🔁 Reorder
          {reorderList.length > 0 && (
            <span style={{
              marginLeft: 6, background: "#d1685c", color: "#fff",
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
                  background: "#1f1e1c", border: "1px solid #615d55",
                  borderRadius: 8, padding: "7px 12px", color: "#ecebe5",
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
                      borderColor: filterStatus === s ? (STATUS_COLOR[s] || "#c96442") : "#3a3834",
                      background: filterStatus === s ? ((STATUS_COLOR[s] || "#c96442") + "22") : "transparent",
                      color: filterStatus === s ? (STATUS_COLOR[s] || "#c96442") : "#8a857b",
                      transition: "all 0.15s",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#8a857b" }}>{filtered.length} transaksi</span>
                {canWrite ? (
                  <Button onClick={() => setShowAdd(true)}>＋ Tambah Pembelian</Button>
                ) : (
                  <span style={{ fontSize: 11.5, color: "#615d55" }}>
                    {isDemo ? "Mode demo — hanya lihat" : "Perlu akses admin untuk input"}
                  </span>
                )}
              </div>
            </div>
          </Card>

          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["No. PO", "Tanggal", "Bahan", "Supplier", "Qty", "Harga/Satuan", "Total", "Status", ...(canWrite ? ["Aksi"] : [])].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const statusColor = STATUS_COLOR[r.STATUS] || "#8a857b";
                  return (
                    <tr key={r.ID_PO} className="po-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#c96442", fontWeight: 700 }}>{r.ID_PO}</td>
                      <td style={{ ...S.td, color: "#a9a49a" }}>{r.TANGGAL}</td>
                      <td style={{ ...S.td, fontWeight: 600, color: "#ecebe5" }}>
                        {r.BAHAN?.NAMA_BAHAN || r.ID_BAHAN}
                      </td>
                      <td style={{ ...S.td, color: "#a9a49a" }}>
                        {r.SUPPLIER?.NAMA || r.ID_SUPPLIER}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace" }}>
                        {r.QTY} {r.BAHAN?.SATUAN_BELI || ""}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#a9a49a" }}>
                        {idr(r.HARGA_BELI)}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: "#ecebe5" }}>
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
                      {canWrite && (
                        <td style={S.td}>
                          {r.STATUS !== "Void" && r.STATUS !== "Batal" ? (
                            <button
                              onClick={() => handleVoid(r.ID_PO)}
                              disabled={voidingId === r.ID_PO}
                              style={{
                                padding: "4px 10px", fontSize: 11.5, fontWeight: 600,
                                color: "#d1685c", background: "rgba(209,104,92,0.10)",
                                border: "1px solid rgba(209,104,92,0.35)", borderRadius: 6,
                                cursor: voidingId === r.ID_PO ? "wait" : "pointer",
                              }}
                            >
                              {voidingId === r.ID_PO ? "…" : "Batalkan"}
                            </button>
                          ) : <span style={{ color: "#615d55" }}>—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "#615d55", fontSize: 13 }}>
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#ecebe5" }}>
                      {s.supplier?.NAMA || "Unknown"}
                    </span>
                    <span style={{ fontSize: 12, color: "#a9a49a", fontFamily: "monospace" }}>
                      {s.transaksi}x · {idr(s.total)}
                    </span>
                  </div>
                  <div style={{ height: 5, background: "#3a3834", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "#c96442", borderRadius: 99, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Daftar Supplier */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #3a3834" }}>
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
                      <td style={{ ...S.td, fontWeight: 600, color: "#ecebe5" }}>
                        {s.NAMA}
                        <div style={{ fontSize: 11, color: "#78746b", fontWeight: 400 }}>{s.TELP}</div>
                      </td>
                      <td style={{ ...S.td, color: "#a9a49a" }}>{bahan?.NAMA_BAHAN || s.ID_BAHAN}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#ecebe5" }}>
                        {idr(s.HARGA)} / {s.SATUAN}
                      </td>
                      <td style={{ ...S.td, color: "#a9a49a" }}>
                        {s.LEAD_TIME === 0 ? "Langsung" : `${s.LEAD_TIME} hari`}
                      </td>
                      <td style={{ ...S.td }}>
                        <span style={{ color: "#d99a4e", letterSpacing: 1 }}>{stars}</span>
                        <span style={{ color: "#8a857b", fontSize: 11, marginLeft: 4 }}>{s.RATING}</span>
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
              <div style={{ fontSize: 16, fontWeight: 700, color: "#7fa86a" }}>Semua stok mencukupi</div>
              <div style={{ fontSize: 13, color: "#78746b", marginTop: 6 }}>Tidak ada bahan yang perlu reorder saat ini</div>
            </Card>
          ) : (
            <div>
              <div style={{ marginBottom: 12, fontSize: 13, color: "#d99a4e", fontWeight: 600 }}>
                ⚠️ {reorderList.length} bahan memerlukan pembelian segera
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {reorderList.map(r => {
                  const { color: stokColor } = r.STOK < r.MIN_STOK * 0.5
                    ? { color: "#d1685c" } : { color: "#d99a4e" };
                  return (
                    <Card key={r.ID_BAHAN} style={{ border: `1px solid ${stokColor}33`, background: stokColor + "08" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#ecebe5", marginBottom: 4 }}>
                            {r.BAHAN?.NAMA_BAHAN}
                          </div>
                          <div style={{ fontSize: 12, color: "#8a857b" }}>
                            Stok saat ini: <span style={{ color: stokColor, fontWeight: 700 }}>{r.STOK} {r.BAHAN?.SATUAN_BELI}</span>
                            {" "}· Min: {r.MIN_STOK} {r.BAHAN?.SATUAN_BELI}
                          </div>
                          <div style={{ fontSize: 12, color: "#8a857b", marginTop: 2 }}>
                            Rekomendasi pesan: <span style={{ color: "#c96442", fontWeight: 700 }}>{r.KEBUTUHAN} {r.BAHAN?.SATUAN_BELI}</span>
                          </div>
                        </div>
                        {r.BEST_SUPPLIER && (
                          <div style={{
                            background: "#1f1e1c", borderRadius: 10, padding: "10px 14px",
                            border: "1px solid #3a3834", minWidth: 200,
                          }}>
                            <div style={{ fontSize: 11, color: "#78746b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                              Supplier Terbaik
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#ecebe5" }}>{r.BEST_SUPPLIER.NAMA}</div>
                            <div style={{ fontSize: 12, color: "#8a857b", marginTop: 2 }}>
                              {idr(r.BEST_SUPPLIER.HARGA)} / {r.BEST_SUPPLIER.SATUAN}
                              {" "}· Lead time {r.BEST_SUPPLIER.LEAD_TIME === 0 ? "Langsung" : `${r.BEST_SUPPLIER.LEAD_TIME} hari`}
                            </div>
                            {r.ESTIMASI_HARGA && (
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#7fa86a", marginTop: 4 }}>
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

      {showAdd && (
        <AddPurchaseModal
          token={token}
          bahanList={bahanList}
          supplierList={supplierList}
          onClose={() => setShowAdd(false)}
          onDone={async (id) => { setShowAdd(false); await reload(); flashToast(`Pembelian ${id} tersimpan`); }}
        />
      )}
      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

// ─── Add Purchase modal ──────────────────────────────────────────────────────
function AddPurchaseModal({ token, bahanList, supplierList, onClose, onDone }) {
  const [idBahan, setIdBahan]       = useState(bahanList[0]?.ID_BAHAN || "");
  const [idSupplier, setIdSupplier] = useState("");
  const [tanggal, setTanggal]       = useState(todayStr());
  const [qty, setQty]               = useState("");
  const [harga, setHarga]           = useState("");
  const [status, setStatus]         = useState("Diterima");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  // Suppliers that carry the chosen bahan (fallback: all suppliers).
  const bahanSuppliers = supplierList.filter(s => s.ID_BAHAN === idBahan);
  const supplierOptions = bahanSuppliers.length ? bahanSuppliers : supplierList;

  // Default supplier + auto-fill price when bahan changes.
  useEffect(() => {
    const first = supplierOptions[0];
    setIdSupplier(first?.ID_SUPPLIER || "");
    if (first && !harga) setHarga(String(first.HARGA));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idBahan]);

  const onPickSupplier = (sid) => {
    setIdSupplier(sid);
    const sup = supplierList.find(s => s.ID_SUPPLIER === sid);
    if (sup) setHarga(String(sup.HARGA));
  };

  const bahan = bahanList.find(b => b.ID_BAHAN === idBahan);
  const total = (Number(qty) || 0) * (Number(harga) || 0);

  async function submit() {
    setError(null);
    if (!idBahan)              return setError("Pilih bahan.");
    if (!(Number(qty) > 0))    return setError("Qty harus lebih dari 0.");
    if (!(Number(harga) > 0))  return setError("Harga beli harus lebih dari 0.");
    setSaving(true);
    try {
      const res = await createPurchase(token, {
        ID_BAHAN: idBahan, ID_SUPPLIER: idSupplier || null, TANGGAL: tanggal,
        QTY: Number(qty), HARGA_BELI: Number(harga), TOTAL: total, STATUS: status,
      });
      onDone(res?.data?.ID_PO || "");
    } catch (e) {
      setError(e.message || "Gagal menyimpan pembelian.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Tambah Pembelian"
      subtitle="Catat pembelian bahan — stok bertambah otomatis jika status Diterima"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>Simpan Pembelian</Button>
      </>}
    >
      <FormError>{error}</FormError>
      <Field label="Bahan">
        <Select value={idBahan} onChange={e => setIdBahan(e.target.value)}>
          {bahanList.map(b => <option key={b.ID_BAHAN} value={b.ID_BAHAN}>{b.NAMA_BAHAN}</option>)}
        </Select>
      </Field>
      <Field label="Supplier" hint={supplierOptions.length === 0 ? "Belum ada supplier untuk bahan ini" : undefined}>
        <Select value={idSupplier} onChange={e => onPickSupplier(e.target.value)}>
          <option value="">— tanpa supplier —</option>
          {supplierOptions.map(s => <option key={s.ID_SUPPLIER} value={s.ID_SUPPLIER}>{s.NAMA} · {idr(s.HARGA)}/{s.SATUAN}</option>)}
        </Select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={`Qty (${bahan?.SATUAN_BELI || "satuan"})`}>
          <TextInput type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Harga Beli / satuan">
          <TextInput type="number" min="0" step="any" value={harga} onChange={e => setHarga(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Tanggal">
          <TextInput type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="Diterima">Diterima (stok bertambah)</option>
            <option value="Pending">Pending</option>
          </Select>
        </Field>
      </div>
      <div style={{
        marginTop: 4, padding: "10px 13px", borderRadius: 8,
        background: "rgba(201,100,66,0.10)", border: "1px solid rgba(201,100,66,0.28)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 12.5, color: "#a9a49a" }}>Total</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#c96442", fontFamily: "monospace" }}>{idr(total)}</span>
      </div>
    </Modal>
  );
}
