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
  createSupplier,
  createBahan,
  deactivateBahan,
  round2, idr,
} from "./kcc_data_layer";
import { Modal, Field, TextInput, Select, Button, FormError, Toast } from "./FormKit";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Satuan pembelian yang umum dipakai — bahan bisa dibeli dalam satuan lain
// dari satuan stoknya (mis. stok dalam kg tapi beli per pack/gram/ikat).
const UNIT_OPTIONS = ["kg", "gram", "ons", "ltr", "ml", "pack", "pcs", "dus", "karung", "ikat", "papan"];
const CUSTOM_UNIT = "__lainnya__";
const NEW_SUPPLIER = "__new__";
const NEW_BAHAN = "__new_bahan__";

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
          onSupplierCreated={reload}
          onBahanChanged={reload}
        />
      )}
      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

// ─── Add Purchase modal ──────────────────────────────────────────────────────
function AddPurchaseModal({ token, bahanList, supplierList, onClose, onDone, onSupplierCreated, onBahanChanged }) {
  // Bahan yang dibuat dalam sesi modal ini, supaya langsung terpilih tanpa
  // menunggu reload penuh; bahan yang dihapus (nonaktifkan) disembunyikan
  // dari pilihan dengan menandainya lokal, walau baru benar-benar hilang
  // dari daftar master setelah onBahanChanged (reload) selesai.
  const [extraBahan, setExtraBahan]       = useState([]);
  const [removedBahanIds, setRemovedBahanIds] = useState([]);
  const activeBahanList = useMemo(
    () => [...bahanList, ...extraBahan].filter(b => b.AKTIF !== false && !removedBahanIds.includes(b.ID_BAHAN)),
    [bahanList, extraBahan, removedBahanIds]
  );

  const [idBahan, setIdBahan]       = useState(activeBahanList[0]?.ID_BAHAN || "");
  const [idSupplier, setIdSupplier] = useState("");
  const [tanggal, setTanggal]       = useState(todayStr());
  const [qty, setQty]               = useState("");
  const [harga, setHarga]           = useState("");
  const [status, setStatus]         = useState("Diterima");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  const bahan     = activeBahanList.find(b => b.ID_BAHAN === idBahan);
  const baseUnit  = bahan?.SATUAN_BELI || "";

  // ── Tambah bahan baru (inline) ──────────────────────────────────────────
  const [addingBahan, setAddingBahan]   = useState(false);
  const [savingBahan, setSavingBahan]   = useState(false);
  const [bahanError, setBahanError]     = useState(null);
  const [newBahan, setNewBahan] = useState({
    NAMA_BAHAN: "", SATUAN_BELI: "kg", SATUAN_PAKAI: "gram", KONVERSI: "1000", HARGA_RATA2: "",
  });

  // ── Hapus (nonaktifkan) bahan dari daftar ───────────────────────────────
  const [deletingBahan, setDeletingBahan] = useState(false);

  async function saveNewBahan() {
    setBahanError(null);
    if (!newBahan.NAMA_BAHAN.trim())          return setBahanError("Nama bahan wajib diisi.");
    if (!newBahan.SATUAN_BELI.trim())         return setBahanError("Satuan beli wajib diisi.");
    setSavingBahan(true);
    try {
      const payload = {
        NAMA_BAHAN:   newBahan.NAMA_BAHAN.trim(),
        SATUAN_BELI:  newBahan.SATUAN_BELI.trim(),
        SATUAN_PAKAI: newBahan.SATUAN_PAKAI.trim() || newBahan.SATUAN_BELI.trim(),
        KONVERSI:     Number(newBahan.KONVERSI) || 1,
        HARGA_RATA2:  Number(newBahan.HARGA_RATA2) || 0,
      };
      const res = await createBahan(token, payload);
      const newId = res?.data?.ID_BAHAN;
      if (!newId) throw new Error("Server tidak mengembalikan ID bahan.");
      setExtraBahan(prev => [...prev, { ID_BAHAN: newId, AKTIF: true, ...payload }]);
      setIdBahan(newId);
      setAddingBahan(false);
      setNewBahan({ NAMA_BAHAN: "", SATUAN_BELI: "kg", SATUAN_PAKAI: "gram", KONVERSI: "1000", HARGA_RATA2: "" });
      onBahanChanged?.(); // sinkronkan daftar master di background, tidak menutup modal
    } catch (e) {
      setBahanError(e.message || "Gagal menyimpan bahan.");
    } finally {
      setSavingBahan(false);
    }
  }

  async function handleDeleteBahan() {
    if (!bahan) return;
    if (!window.confirm(`Hapus "${bahan.NAMA_BAHAN}" dari daftar bahan? Bahan hanya disembunyikan (dinonaktifkan), riwayat pembelian lama tetap aman.`)) return;
    setDeletingBahan(true);
    try {
      await deactivateBahan(token, bahan.ID_BAHAN);
      setRemovedBahanIds(prev => [...prev, bahan.ID_BAHAN]);
      const next = activeBahanList.find(b => b.ID_BAHAN !== bahan.ID_BAHAN);
      setIdBahan(next?.ID_BAHAN || "");
      onBahanChanged?.(); // sinkronkan daftar master di background
    } catch (e) {
      window.alert("Gagal menghapus bahan: " + (e.message || "kesalahan server"));
    } finally {
      setDeletingBahan(false);
    }
  }

  // Satuan pembelian aktual (bisa beda dari satuan stok bahan, mis. beli per
  // pack padahal stoknya dihitung per kg). Reset ke satuan dasar tiap ganti bahan.
  const [unit, setUnit]           = useState(baseUnit || "kg");
  const [customUnit, setCustomUnit] = useState("");
  const [konversi, setKonversi]   = useState(""); // 1 unit pembelian = ? satuan dasar

  // Supplier baru yang dibuat dalam sesi modal ini, supaya langsung bisa
  // dipakai tanpa menunggu reload penuh dari server.
  const [extraSuppliers, setExtraSuppliers] = useState([]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierError, setSupplierError]   = useState(null);
  const [newSupplier, setNewSupplier] = useState({
    NAMA: "", TELP: "", SATUAN: baseUnit || "kg", HARGA: "", LEAD_TIME: "0", RATING: "5",
  });

  const allSuppliers = useMemo(() => [...supplierList, ...extraSuppliers], [supplierList, extraSuppliers]);

  // Suppliers that carry the chosen bahan (fallback: all suppliers).
  const bahanSuppliers = allSuppliers.filter(s => s.ID_BAHAN === idBahan);
  const supplierOptions = bahanSuppliers.length ? bahanSuppliers : allSuppliers;

  // Default supplier + auto-fill price + reset satuan when bahan changes.
  useEffect(() => {
    const first = supplierOptions[0];
    setIdSupplier(first?.ID_SUPPLIER || "");
    if (first && !harga) setHarga(String(first.HARGA));
    setUnit(baseUnit || "kg");
    setKonversi("");
    setCustomUnit("");
    setAddingSupplier(false);
    setAddingBahan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idBahan]);

  const onPickSupplier = (val) => {
    if (val === NEW_SUPPLIER) {
      setAddingSupplier(true);
      setSupplierError(null);
      setNewSupplier(s => ({ ...s, SATUAN: (unit === CUSTOM_UNIT ? customUnit : unit) || baseUnit || "kg" }));
      return;
    }
    setAddingSupplier(false);
    setIdSupplier(val);
    const sup = allSuppliers.find(s => s.ID_SUPPLIER === val);
    if (sup) setHarga(String(sup.HARGA));
  };

  async function saveNewSupplier() {
    setSupplierError(null);
    if (!newSupplier.NAMA.trim())          return setSupplierError("Nama supplier wajib diisi.");
    if (!(Number(newSupplier.HARGA) > 0))  return setSupplierError("Harga wajib diisi.");
    setSavingSupplier(true);
    try {
      const payload = {
        NAMA:      newSupplier.NAMA.trim(),
        ID_BAHAN:  idBahan,
        HARGA:     Number(newSupplier.HARGA),
        SATUAN:    newSupplier.SATUAN.trim() || baseUnit || "kg",
        LEAD_TIME: Number(newSupplier.LEAD_TIME) || 0,
        RATING:    Number(newSupplier.RATING) || 0,
        TELP:      newSupplier.TELP.trim(),
      };
      const res = await createSupplier(token, payload);
      const newId = res?.data?.ID_SUPPLIER;
      if (!newId) throw new Error("Server tidak mengembalikan ID supplier.");
      setExtraSuppliers(prev => [...prev, { ID_SUPPLIER: newId, ...payload }]);
      setIdSupplier(newId);
      setHarga(String(payload.HARGA));
      setAddingSupplier(false);
      setNewSupplier({ NAMA: "", TELP: "", SATUAN: baseUnit || "kg", HARGA: "", LEAD_TIME: "0", RATING: "5" });
      onSupplierCreated?.(); // sinkronkan daftar master di background, tidak menutup modal
    } catch (e) {
      setSupplierError(e.message || "Gagal menyimpan supplier.");
    } finally {
      setSavingSupplier(false);
    }
  }

  const effectiveUnit = unit === CUSTOM_UNIT ? customUnit.trim() : unit;
  const unitIsBase     = !!baseUnit && effectiveUnit === baseUnit;
  const qtyNum    = Number(qty) || 0;
  const hargaNum  = Number(harga) || 0;
  const konversiNum = Number(konversi) || 0;
  const total     = round2(qtyNum * hargaNum); // total yang benar-benar dibayar, tidak berubah oleh konversi satuan
  // Qty & harga per satuan dasar bahan — inilah yang dicatat ke stok/HPP.
  const qtyBase   = unitIsBase ? qtyNum   : round2(qtyNum * konversiNum);
  const hargaBase = unitIsBase ? hargaNum : (konversiNum > 0 ? round2(hargaNum / konversiNum) : 0);

  async function submit() {
    setError(null);
    if (!idBahan)                    return setError("Pilih bahan.");
    if (addingBahan)                 return setError("Selesaikan atau batalkan dulu penambahan bahan baru.");
    if (addingSupplier)              return setError("Selesaikan atau batalkan dulu penambahan supplier baru.");
    if (!(qtyNum > 0))               return setError("Qty harus lebih dari 0.");
    if (!(hargaNum > 0))             return setError("Harga beli harus lebih dari 0.");
    if (unit === CUSTOM_UNIT && !customUnit.trim())
      return setError("Isi nama satuan (mis. karung, botol, lusin).");
    if (!unitIsBase && !(konversiNum > 0))
      return setError(`Isi konversi: 1 ${effectiveUnit || "satuan"} = berapa ${baseUnit || "satuan stok"}.`);
    setSaving(true);
    try {
      const res = await createPurchase(token, {
        ID_BAHAN: idBahan, ID_SUPPLIER: idSupplier || null, TANGGAL: tanggal,
        QTY: qtyBase, HARGA_BELI: hargaBase, TOTAL: total, STATUS: status,
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <Select
              value={addingBahan ? NEW_BAHAN : idBahan}
              onChange={e => {
                const v = e.target.value;
                if (v === NEW_BAHAN) { setAddingBahan(true); setBahanError(null); return; }
                setAddingBahan(false);
                setIdBahan(v);
              }}
            >
              {activeBahanList.map(b => <option key={b.ID_BAHAN} value={b.ID_BAHAN}>{b.NAMA_BAHAN}</option>)}
              <option value={NEW_BAHAN}>➕ Tambah bahan baru…</option>
            </Select>
          </div>
          {!addingBahan && bahan && (
            <button
              type="button"
              title="Hapus bahan ini dari daftar"
              onClick={handleDeleteBahan}
              disabled={deletingBahan}
              style={{
                flexShrink: 0, width: 38, height: 38, borderRadius: 8,
                color: "#d1685c", background: "rgba(209,104,92,0.10)",
                border: "1px solid rgba(209,104,92,0.35)",
                cursor: deletingBahan ? "wait" : "pointer", fontSize: 15,
              }}
            >
              {deletingBahan ? "…" : "🗑"}
            </button>
          )}
        </div>
      </Field>

      {addingBahan && (
        <div style={{
          marginBottom: 14, padding: 14, borderRadius: 10,
          background: "#26251f", border: "1px solid #3a3834",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#c96442", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Bahan Baru
          </div>
          <FormError>{bahanError}</FormError>
          <Field label="Nama Bahan">
            <TextInput value={newBahan.NAMA_BAHAN} onChange={e => setNewBahan(s => ({ ...s, NAMA_BAHAN: e.target.value }))} placeholder="mis. Daging Sapi" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Satuan Beli" hint="Satuan dasar untuk stok, mis. kg / ltr">
              <TextInput value={newBahan.SATUAN_BELI} onChange={e => setNewBahan(s => ({ ...s, SATUAN_BELI: e.target.value }))} placeholder="kg" />
            </Field>
            <Field label="Satuan Pakai" hint="Satuan dipakai di resep, mis. gram / ml">
              <TextInput value={newBahan.SATUAN_PAKAI} onChange={e => setNewBahan(s => ({ ...s, SATUAN_PAKAI: e.target.value }))} placeholder="gram" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Konversi" hint={`1 ${newBahan.SATUAN_BELI || "satuan beli"} = ? ${newBahan.SATUAN_PAKAI || "satuan pakai"}`}>
              <TextInput type="number" min="0" step="any" value={newBahan.KONVERSI} onChange={e => setNewBahan(s => ({ ...s, KONVERSI: e.target.value }))} placeholder="1000" />
            </Field>
            <Field label="Harga Awal (opsional)">
              <TextInput type="number" min="0" step="any" value={newBahan.HARGA_RATA2} onChange={e => setNewBahan(s => ({ ...s, HARGA_RATA2: e.target.value }))} placeholder="0" />
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => { setAddingBahan(false); setIdBahan(activeBahanList[0]?.ID_BAHAN || ""); }}>Batal</Button>
            <Button onClick={saveNewBahan} loading={savingBahan}>Simpan Bahan</Button>
          </div>
        </div>
      )}

      <Field label="Supplier" hint={supplierOptions.length === 0 ? "Belum ada supplier untuk bahan ini — tambahkan lewat menu di bawah" : undefined}>
        <Select value={addingSupplier ? NEW_SUPPLIER : idSupplier} onChange={e => onPickSupplier(e.target.value)}>
          <option value="">— tanpa supplier —</option>
          {supplierOptions.map(s => <option key={s.ID_SUPPLIER} value={s.ID_SUPPLIER}>{s.NAMA} · {idr(s.HARGA)}/{s.SATUAN}</option>)}
          <option value={NEW_SUPPLIER}>➕ Tambah supplier baru…</option>
        </Select>
      </Field>

      {addingSupplier && (
        <div style={{
          marginBottom: 14, padding: 14, borderRadius: 10,
          background: "#26251f", border: "1px solid #3a3834",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#c96442", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Supplier Baru
          </div>
          <FormError>{supplierError}</FormError>
          <Field label="Nama Supplier">
            <TextInput value={newSupplier.NAMA} onChange={e => setNewSupplier(s => ({ ...s, NAMA: e.target.value }))} placeholder="mis. Toko Sumber Rejeki" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Harga">
              <TextInput type="number" min="0" step="any" value={newSupplier.HARGA} onChange={e => setNewSupplier(s => ({ ...s, HARGA: e.target.value }))} placeholder="0" />
            </Field>
            <Field label="Satuan Harga">
              <TextInput value={newSupplier.SATUAN} onChange={e => setNewSupplier(s => ({ ...s, SATUAN: e.target.value }))} placeholder="kg / pack / ltr" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Lead Time (hari)">
              <TextInput type="number" min="0" step="1" value={newSupplier.LEAD_TIME} onChange={e => setNewSupplier(s => ({ ...s, LEAD_TIME: e.target.value }))} />
            </Field>
            <Field label="Rating (0–5)">
              <TextInput type="number" min="0" max="5" step="0.1" value={newSupplier.RATING} onChange={e => setNewSupplier(s => ({ ...s, RATING: e.target.value }))} />
            </Field>
          </div>
          <Field label="Telepon (opsional)">
            <TextInput value={newSupplier.TELP} onChange={e => setNewSupplier(s => ({ ...s, TELP: e.target.value }))} placeholder="021-xxxxxxx" />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => { setAddingSupplier(false); setIdSupplier(""); }}>Batal</Button>
            <Button onClick={saveNewSupplier} loading={savingSupplier}>Simpan Supplier</Button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Qty">
          <TextInput type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Satuan Beli">
          <Select value={unit} onChange={e => setUnit(e.target.value)}>
            {[...new Set([baseUnit, ...UNIT_OPTIONS].filter(Boolean))].map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
            <option value={CUSTOM_UNIT}>Lainnya…</option>
          </Select>
        </Field>
      </div>

      {unit === CUSTOM_UNIT && (
        <Field label="Nama Satuan Lainnya">
          <TextInput value={customUnit} onChange={e => setCustomUnit(e.target.value)} placeholder="mis. karung, botol, lusin" />
        </Field>
      )}

      {!unitIsBase && (
        <Field
          label={`Konversi ke satuan stok (1 ${effectiveUnit || "satuan"} = ? ${baseUnit || "satuan stok"})`}
          hint="Dipakai untuk menghitung penambahan stok & harga per satuan dasar bahan."
        >
          <TextInput type="number" min="0" step="any" value={konversi} onChange={e => setKonversi(e.target.value)} placeholder="mis. 0.25" />
        </Field>
      )}

      <Field label={`Harga Beli / ${effectiveUnit || baseUnit || "satuan"}`}>
        <TextInput type="number" min="0" step="any" value={harga} onChange={e => setHarga(e.target.value)} placeholder="0" />
      </Field>

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

      {!unitIsBase && konversiNum > 0 && qtyNum > 0 && (
        <div style={{ fontSize: 11.5, color: "#8a857b", marginTop: -6, marginBottom: 10 }}>
          Akan tercatat ke stok: <b style={{ color: "#a9a49a" }}>{qtyBase} {baseUnit}</b>
          {" "}· harga {idr(hargaBase)}/{baseUnit}
        </div>
      )}

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
