import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  PRODUK,
  RESEP,
  fetchBahan,
  fetchProduk,
  fetchResep,
  addResepItem,
  updateResepItem,
  deleteResepItem,
  createProduk,
  updateProduk,
  deactivateProduk,
  reactivateProduk,
  recalcSemua,
  filterAktif,
  round2, idr, pct, marginColor,
} from "./kcc_data_layer";
import { Modal, Field, TextInput, Select, Button, FormError, Toast } from "./FormKit";

// ─── Shared Styles ────────────────────────────────────────────
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
    color: "#ecebe5",
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
  const { token, role, isDemo } = useAuth();
  const canWrite = !isDemo && (role === "ADMIN" || role === "SUPER_ADMIN");

  const [bahanList,  setBahanList]  = useState(INITIAL_BAHAN);
  const [produkList, setProdukList] = useState(PRODUK);
  const [resepData,  setResepData]  = useState(RESEP);
  const [searchQ,    setSearchQ]    = useState("");

  const [showAddProduk, setShowAddProduk] = useState(false);
  const [showAddItem, setShowAddItem]     = useState(false);
  const [editItem, setEditItem]           = useState(null);
  const [toast, setToast]                 = useState("");
  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const reload = useCallback(async () => {
    if (!token) return;
    const [bahanData, produkData, resepRes] = await Promise.all([
      fetchBahan(token), fetchProduk(token), fetchResep(token),
    ]);
    if (bahanData)  setBahanList(bahanData);
    if (produkData) setProdukList(produkData);
    if (resepRes)   setResepData(resepRes);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const [selectedProduk, setSelectedProduk] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [deletingProdukId, setDeletingProdukId] = useState(null);
  const [showInactiveProduk, setShowInactiveProduk] = useState(false);
  const [editProduk, setEditProduk] = useState(null); // produk sedang diedit (nama/kategori/harga/mode)

  async function handleDeleteItem(idProduk, idBahan, nama) {
    if (deletingKey === idBahan) return; // already in flight
    if (!window.confirm(`Hapus "${nama}" dari resep?`)) return;
    setDeletingKey(idBahan);
    try {
      await deleteResepItem(token, { ID_PRODUK: idProduk, ID_BAHAN: idBahan });
      await reload();
      flashToast(`"${nama}" dihapus dari resep`);
    } catch (e) {
      window.alert("Gagal menghapus: " + (e.message || "kesalahan server"));
    } finally {
      setDeletingKey(null);
    }
  }

  // Hapus (nonaktifkan) seluruh resep/produk — bukan cuma satu bahan.
  // Produk hanya disembunyikan, bukan dihapus permanen, supaya riwayat
  // penjualan lama & data HPP historis tetap aman. Bisa dipulihkan lagi
  // lewat "Produk Nonaktif".
  async function handleDeleteProduk(p) {
    if (!window.confirm(`Hapus resep "${p.NAMA_PRODUK}"? Produk & seluruh komposisi resepnya hanya disembunyikan (dinonaktifkan) — bisa dipulihkan lagi lewat "Produk Nonaktif".`)) return;
    setDeletingProdukId(p.ID_PRODUK);
    try {
      await deactivateProduk(token, p.ID_PRODUK);
      if (selectedProduk === p.ID_PRODUK) setSelectedProduk(null);
      await reload();
      flashToast(`Resep "${p.NAMA_PRODUK}" dihapus`);
    } catch (e) {
      window.alert("Gagal menghapus resep: " + (e.message || "kesalahan server"));
    } finally {
      setDeletingProdukId(null);
    }
  }

  async function handleReactivateProduk(p) {
    setDeletingProdukId(p.ID_PRODUK);
    try {
      await reactivateProduk(token, p.ID_PRODUK);
      await reload();
      flashToast(`Resep "${p.NAMA_PRODUK}" diaktifkan kembali`);
    } catch (e) {
      window.alert("Gagal mengaktifkan resep: " + (e.message || "kesalahan server"));
    } finally {
      setDeletingProdukId(null);
    }
  }

  // Produk yang dihapus disimpan sebagai nonaktif (active=false) — daftar
  // & pemilihan produk aktif selalu memakai yang aktif saja.
  const activeProdukList   = useMemo(() => produkList.filter(p => p.AKTIF !== false), [produkList]);
  const inactiveProdukList = useMemo(() => produkList.filter(p => p.AKTIF === false), [produkList]);

  // Set default selection once produkList is available
  const activeProdukId = selectedProduk ?? activeProdukList[0]?.ID_PRODUK ?? null;

  const bahanMap = useMemo(() => {
    const m = {};
    bahanList.forEach(b => { m[b.ID_BAHAN] = b; });
    return m;
  }, [bahanList]);

  // Bahan yang sudah dihapus tidak boleh muncul lagi di pilihan "Tambah Bahan".
  const activeBahanList = useMemo(() => filterAktif(bahanList), [bahanList]);

  const produkHPP = useMemo(() => recalcSemua(filterAktif(bahanList), activeProdukList, resepData), [bahanList, activeProdukList, resepData]);
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

  const filteredProduk = activeProdukList.filter(p =>
    p.NAMA_PRODUK.toLowerCase().includes(searchQ.toLowerCase()) ||
    p.KATEGORI.toLowerCase().includes(searchQ.toLowerCase())
  );

  const totalBiayaResep = selectedHPP?.HPP_PER_BATCH ?? 0;

  return (
    <div>
      <style>{`
        .resep-row:hover { background: rgba(201,100,66,0.04) !important; }
        .produk-item:hover { background: rgba(201,100,66,0.06) !important; cursor: pointer; }
        .produk-item.active { background: rgba(201,100,66,0.10) !important; border-left: 3px solid #c96442 !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#ecebe5", letterSpacing: "-0.02em" }}>
          📋 Manajemen Resep
        </div>
        <div style={{ fontSize: 13, color: "#78746b", marginTop: 4 }}>
          Komposisi bahan & biaya per produk
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" }}>

        {/* Left: Daftar Produk */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #3a3834" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={S.label}>Produk ({activeProdukList.length})</div>
              {inactiveProdukList.length > 0 && (
                <button
                  onClick={() => setShowInactiveProduk(v => !v)}
                  style={{
                    fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                    color: showInactiveProduk ? "#c96442" : "#78746b",
                    background: "transparent", border: "none", padding: 0,
                    textDecoration: "underline", textUnderlineOffset: 2,
                  }}
                >
                  🗑 Nonaktif ({inactiveProdukList.length})
                </button>
              )}
            </div>
            <input
              type="text"
              placeholder="Cari produk..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              style={{
                width: "100%", background: "#1f1e1c", border: "1px solid #615d55",
                borderRadius: 8, padding: "7px 10px", color: "#ecebe5",
                fontSize: 13, outline: "none",
              }}
            />
            {canWrite && (
              <Button onClick={() => setShowAddProduk(true)} style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>
                ＋ Produk Baru
              </Button>
            )}
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
                  borderBottom: "1px solid #3a3834",
                  borderLeft: isActive ? "3px solid #c96442" : "3px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: "#ecebe5" }}>{p.NAMA_PRODUK}</div>
                <div style={{ fontSize: 11, color: "#78746b", marginTop: 2 }}>
                  {p.KATEGORI} · {idr(p.HARGA_JUAL)}
                </div>
                {hpp && (
                  <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={S.badge(marginColor(hpp.MARGIN_PCT))}>{pct(hpp.MARGIN_PCT)}</span>
                    <span style={{ fontSize: 11, color: "#8a857b" }}>HPP {idr(hpp.HPP_PER_PCS)}</span>
                  </div>
                )}
              </div>
            );
          })}
          {filteredProduk.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#615d55", fontSize: 13 }}>
              Produk tidak ditemukan
            </div>
          )}
          {showInactiveProduk && inactiveProdukList.length > 0 && (
            <div style={{ borderTop: "1px solid #3a3834" }}>
              <div style={{ padding: "10px 16px 4px", fontSize: 10.5, fontWeight: 700, color: "#615d55", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Produk Nonaktif
              </div>
              {inactiveProdukList.map(p => (
                <div key={p.ID_PRODUK} style={{
                  padding: "10px 16px", borderBottom: "1px solid #3a3834",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#8a857b" }}>{p.NAMA_PRODUK}</div>
                    <div style={{ fontSize: 11, color: "#615d55", marginTop: 2 }}>{p.KATEGORI}</div>
                  </div>
                  {canWrite && (
                    <button
                      onClick={() => handleReactivateProduk(p)}
                      disabled={deletingProdukId === p.ID_PRODUK}
                      style={{
                        flexShrink: 0, padding: "4px 9px", fontSize: 11, fontWeight: 600,
                        color: "#7fa86a", background: "rgba(127,168,106,0.10)",
                        border: "1px solid rgba(127,168,106,0.32)", borderRadius: 6,
                        cursor: deletingProdukId === p.ID_PRODUK ? "default" : "pointer",
                        opacity: deletingProdukId === p.ID_PRODUK ? 0.6 : 1,
                      }}
                    >Aktifkan</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Right: Detail Resep */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* KPI Bar */}
          {selected && selectedHPP && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Harga Jual", value: idr(selected.HARGA_JUAL), accent: "#c96442" },
                { label: "HPP / Porsi",  value: idr(selectedHPP.HPP_PER_PCS), accent: "#a9a49a" },
                { label: "Margin",     value: pct(selectedHPP.MARGIN_PCT), accent: marginColor(selectedHPP.MARGIN_PCT) },
                { label: "Margin Rp",  value: idr(selectedHPP.MARGIN_RP), accent: "#7fa86a" },
              ].map(k => (
                <Card key={k.label}>
                  <div style={{ fontSize: 11, color: "#8a857b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.accent, letterSpacing: "-0.02em" }}>{k.value}</div>
                </Card>
              ))}
            </div>
          )}

          {/* Resep Table */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #3a3834", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={S.label}>Komposisi Resep</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#ecebe5" }}>
                  {selected?.NAMA_PRODUK} — {Number(selected?.YIELD_PCS) > 1
                    ? `1 batch = ${selected.YIELD_PCS} porsi`
                    : "dihitung per porsi"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#8a857b" }}>
                    {Number(selected?.YIELD_PCS) > 1 ? "Total Biaya Batch" : "Total Biaya per Porsi"}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#c96442" }}>{idr(totalBiayaResep)}</div>
                </div>
                {canWrite && selected && (
                  <>
                    <Button onClick={() => setShowAddItem(true)}>＋ Tambah Bahan</Button>
                    <button
                      onClick={() => setEditProduk(selected)}
                      title="Ubah nama, harga, atau cara hitung resep"
                      style={{
                        padding: "8px 14px", fontSize: 13, fontWeight: 600,
                        color: "#8a857b", background: "rgba(138,133,123,0.10)",
                        border: "1px solid rgba(138,133,123,0.32)", borderRadius: 8, cursor: "pointer",
                      }}
                    >✏️ Edit</button>
                    <button
                      onClick={() => handleDeleteProduk(selected)}
                      disabled={deletingProdukId === selected.ID_PRODUK}
                      title="Hapus resep ini"
                      style={{
                        padding: "8px 14px", fontSize: 13, fontWeight: 600,
                        color: "#d1685c", background: "rgba(209,104,92,0.10)",
                        border: "1px solid rgba(209,104,92,0.32)", borderRadius: 8,
                        cursor: deletingProdukId === selected.ID_PRODUK ? "wait" : "pointer",
                        opacity: deletingProdukId === selected.ID_PRODUK ? 0.6 : 1,
                      }}
                    >{deletingProdukId === selected.ID_PRODUK ? "…" : "🗑 Hapus Resep"}</button>
                  </>
                )}
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Bahan", "Jumlah", "Satuan", "Harga/kg", "Biaya", ...(canWrite ? ["Aksi"] : [])].map(h => (
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
                        <div style={{ marginTop: 3, height: 3, background: "#3a3834", borderRadius: 99, overflow: "hidden", width: 80 }}>
                          <div style={{ height: "100%", width: `${pctBiaya}%`, background: "#c96442", borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#78746b", marginTop: 1 }}>{pctBiaya}%</div>
                      </td>
                      {canWrite && (
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => setEditItem({ ID_BAHAN: d.ID_BAHAN, NAMA_BAHAN: d.NAMA_BAHAN, JUMLAH: d.JUMLAH, SATUAN_PAKAI: d.SATUAN_PAKAI })}
                              title="Ubah jumlah"
                              style={{ padding: "4px 9px", fontSize: 11.5, fontWeight: 600, color: "#c96442", background: "rgba(201,100,66,0.10)", border: "1px solid rgba(201,100,66,0.32)", borderRadius: 6, cursor: "pointer" }}
                            >Ubah</button>
                            <button
                              onClick={() => handleDeleteItem(activeProdukId, d.ID_BAHAN, d.NAMA_BAHAN)}
                              disabled={deletingKey === d.ID_BAHAN}
                              title="Hapus dari resep"
                              style={{ padding: "4px 9px", fontSize: 11.5, fontWeight: 600, color: "#d1685c", background: "rgba(209,104,92,0.10)", border: "1px solid rgba(209,104,92,0.32)", borderRadius: 6, cursor: deletingKey === d.ID_BAHAN ? "wait" : "pointer", opacity: deletingKey === d.ID_BAHAN ? 0.6 : 1 }}
                            >{deletingKey === d.ID_BAHAN ? "…" : "Hapus"}</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ ...S.td, fontWeight: 700, color: "#a9a49a" }}>Total Biaya per Batch</td>
                  <td style={{ ...S.td, fontWeight: 800, color: "#c96442", fontFamily: "monospace" }}>{idr(totalBiayaResep)}</td>
                  {canWrite && <td style={S.td} />}
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
                const colors = ["#c96442","#d97757","#e0b060","#7fa86a","#6ea3c4","#9a86c4","#cf8aa2","#a9a49a"];
                const colorIdx = selectedHPP.DETAIL.indexOf(d);
                const color = colors[colorIdx % colors.length];
                return (
                  <div key={d.ID_BAHAN}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, color: "#ecebe5", fontWeight: 500 }}>{d.NAMA_BAHAN}</span>
                      <span style={{ fontSize: 12, color: "#8a857b", fontFamily: "monospace" }}>
                        {idr(d.BIAYA_BAHAN)} · {pctBiaya}%
                      </span>
                    </div>
                    <div style={{ height: 5, background: "#3a3834", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pctBiaya}%`, background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {showAddProduk && (
        <AddProdukModal
          token={token}
          onClose={() => setShowAddProduk(false)}
          onDone={async (id, nama) => { setShowAddProduk(false); await reload(); if (id) setSelectedProduk(id); flashToast(`Produk "${nama}" dibuat`); }}
        />
      )}
      {showAddItem && selected && (
        <ResepItemModal
          token={token}
          mode="add"
          idProduk={activeProdukId}
          produkNama={selected.NAMA_PRODUK}
          yieldPcs={selected.YIELD_PCS}
          bahanList={activeBahanList}
          existingIds={resepProduk.map(r => r.ID_BAHAN)}
          onClose={() => setShowAddItem(false)}
          onDone={async (nama) => { setShowAddItem(false); await reload(); flashToast(`"${nama}" ditambahkan ke resep`); }}
        />
      )}
      {editItem && (
        <ResepItemModal
          token={token}
          mode="edit"
          idProduk={activeProdukId}
          produkNama={selected?.NAMA_PRODUK}
          yieldPcs={selected?.YIELD_PCS}
          item={editItem}
          onClose={() => setEditItem(null)}
          onDone={async (nama) => { setEditItem(null); await reload(); flashToast(`Jumlah "${nama}" diperbarui`); }}
        />
      )}
      {editProduk && (
        <EditProdukModal
          token={token}
          row={editProduk}
          onClose={() => setEditProduk(null)}
          onDone={async () => { const n = editProduk.NAMA_PRODUK; setEditProduk(null); await reload(); flashToast(`Produk "${n}" diperbarui`); }}
        />
      )}
      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

// ─── Add Produk modal ────────────────────────────────────────────────────────
// Dua cara mengisi resep, supaya jumlah bahan bisa diisi langsung sesuai
// cara orang biasa berpikir tentang resepnya:
//  • "porsi"  — Yield dikunci 1. Jumlah bahan yang diisi di "Tambah Bahan"
//    LANGSUNG jadi jumlah per porsi (mis. 4 lembar kulit dimsum = 1 porsi).
//    Tidak perlu hitung apa-apa, HPP per porsi = total biaya bahan.
//  • "batch"  — resep diisi untuk SATU KALI PRODUKSI yang menghasilkan
//    beberapa porsi sekaligus (mis. adonan untuk 20 porsi). Jumlah bahan
//    diisi untuk keseluruhan batch, lalu sistem otomatis membaginya dengan
//    Yield untuk mendapatkan HPP per porsi.
function ModePorsiToggle({ mode, setMode }) {
  const opt = (val, title, desc) => (
    <button
      type="button"
      onClick={() => setMode(val)}
      style={{
        flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 8, cursor: "pointer",
        background: mode === val ? "rgba(201,100,66,0.10)" : "transparent",
        border: "1px solid " + (mode === val ? "#c96442" : "#3a3834"),
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: mode === val ? "#c96442" : "#a9a49a" }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "#8a857b", marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
  return (
    <Field label="Cara Hitung Resep">
      <div style={{ display: "flex", gap: 8 }}>
        {opt("porsi", "Per Porsi", "Jumlah bahan diisi langsung untuk 1 porsi. Contoh: 4 lembar kulit dimsum.")}
        {opt("batch", "Per Batch", "Resep untuk beberapa porsi sekaligus, dibagi otomatis. Contoh: adonan untuk 20 porsi.")}
      </div>
    </Field>
  );
}

function AddProdukModal({ token, onClose, onDone }) {
  const [nama, setNama]       = useState("");
  const [kategori, setKategori] = useState("Main Course");
  const [harga, setHarga]     = useState("");
  const [mode, setMode]       = useState("porsi"); // "porsi" | "batch"
  const [yieldPcs, setYieldPcs] = useState("1");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  const yieldEfektif = mode === "porsi" ? 1 : Number(yieldPcs);

  async function submit() {
    setError(null);
    if (!nama.trim())               return setError("Nama produk wajib diisi.");
    if (!(Number(harga) > 0))       return setError("Harga jual harus lebih dari 0.");
    if (!(yieldEfektif > 0))        return setError("Yield (jumlah porsi per batch) harus lebih dari 0.");
    setSaving(true);
    try {
      const res = await createProduk(token, {
        NAMA_PRODUK: nama.trim(), KATEGORI: kategori.trim() || "Lainnya",
        HARGA_JUAL: Number(harga), YIELD_PCS: yieldEfektif,
      });
      onDone(res?.data?.ID_PRODUK, nama.trim());
    } catch (e) {
      setError(e.message || "Gagal membuat produk.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Produk Baru"
      subtitle="ID produk dibuat otomatis · resep dapat diisi setelahnya"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>Simpan Produk</Button>
      </>}
    >
      <FormError>{error}</FormError>
      <Field label="Nama Produk">
        <TextInput value={nama} onChange={e => setNama(e.target.value)} placeholder="Contoh: Dimsum Ayam" autoFocus />
      </Field>
      <Field label="Kategori"><TextInput value={kategori} onChange={e => setKategori(e.target.value)} placeholder="Main Course" /></Field>

      <ModePorsiToggle mode={mode} setMode={setMode} />

      {mode === "batch" && (
        <Field label="1 Batch Menghasilkan Berapa Porsi?" hint="Jumlah bahan di 'Tambah Bahan' nanti diisi untuk satu kali produksi ini">
          <TextInput type="number" min="1" step="any" value={yieldPcs} onChange={e => setYieldPcs(e.target.value)} placeholder="20" />
        </Field>
      )}

      <Field label="Harga Jual / porsi">
        <TextInput type="number" min="0" step="any" value={harga} onChange={e => setHarga(e.target.value)} placeholder="0" />
      </Field>
    </Modal>
  );
}

// ─── Edit Produk modal ────────────────────────────────────────────────────────
// Menyesuaikan produk yang sudah ada: nama, kategori, harga jual, dan cara
// hitung resepnya (per porsi / per batch) kalau ternyata pilihan awal keliru.
function EditProdukModal({ token, row, onClose, onDone }) {
  const [nama, setNama]         = useState(row.NAMA_PRODUK || "");
  const [kategori, setKategori] = useState(row.KATEGORI || "");
  const [harga, setHarga]       = useState(String(row.HARGA_JUAL ?? "0"));
  const [mode, setMode]         = useState(Number(row.YIELD_PCS) > 1 ? "batch" : "porsi");
  const [yieldPcs, setYieldPcs] = useState(String(row.YIELD_PCS ?? "1"));
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  const yieldEfektif = mode === "porsi" ? 1 : Number(yieldPcs);

  async function submit() {
    setError(null);
    if (!nama.trim())         return setError("Nama produk wajib diisi.");
    if (!(Number(harga) > 0)) return setError("Harga jual harus lebih dari 0.");
    if (!(yieldEfektif > 0))  return setError("Yield (jumlah porsi per batch) harus lebih dari 0.");
    setSaving(true);
    try {
      await updateProduk(token, {
        ID_PRODUK: row.ID_PRODUK, NAMA_PRODUK: nama.trim(), KATEGORI: kategori.trim() || "Lainnya",
        HARGA_JUAL: Number(harga), YIELD_PCS: yieldEfektif,
      });
      onDone();
    } catch (e) {
      setError(e.message || "Gagal menyimpan perubahan produk.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit Produk — ${row.NAMA_PRODUK}`}
      subtitle="Nama, kategori, harga jual & cara hitung resep"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>Simpan Perubahan</Button>
      </>}
    >
      <FormError>{error}</FormError>
      <Field label="Nama Produk">
        <TextInput value={nama} onChange={e => setNama(e.target.value)} autoFocus />
      </Field>
      <Field label="Kategori"><TextInput value={kategori} onChange={e => setKategori(e.target.value)} /></Field>

      <ModePorsiToggle mode={mode} setMode={setMode} />

      {mode === "batch" && (
        <Field label="1 Batch Menghasilkan Berapa Porsi?" hint="Ganti mode akan mengubah cara HPP dihitung, tapi jumlah bahan di resep tidak otomatis ikut berubah — periksa kembali jumlah bahannya kalau baru pindah mode">
          <TextInput type="number" min="1" step="any" value={yieldPcs} onChange={e => setYieldPcs(e.target.value)} />
        </Field>
      )}

      <Field label="Harga Jual / porsi">
        <TextInput type="number" min="0" step="any" value={harga} onChange={e => setHarga(e.target.value)} placeholder="0" />
      </Field>
    </Modal>
  );
}

// ─── Add / Edit Resep item modal ─────────────────────────────────────────────
function ResepItemModal({ token, mode, idProduk, produkNama, yieldPcs = 1, bahanList = [], existingIds = [], item, onClose, onDone }) {
  const isEdit = mode === "edit";
  const available = bahanList.filter(b => !existingIds.includes(b.ID_BAHAN));
  const [idBahan, setIdBahan] = useState(isEdit ? item.ID_BAHAN : (available[0]?.ID_BAHAN || ""));
  const [jumlah, setJumlah]   = useState(isEdit ? String(item.JUMLAH) : "");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  const satuan = isEdit ? item.SATUAN_PAKAI : (bahanList.find(b => b.ID_BAHAN === idBahan)?.SATUAN_PAKAI || "");
  const nama   = isEdit ? item.NAMA_BAHAN : (bahanList.find(b => b.ID_BAHAN === idBahan)?.NAMA_BAHAN || "");

  async function submit() {
    setError(null);
    if (!idBahan)            return setError("Pilih bahan.");
    if (!(Number(jumlah) > 0)) return setError("Jumlah harus lebih dari 0.");
    setSaving(true);
    try {
      const payload = { ID_PRODUK: idProduk, ID_BAHAN: idBahan, JUMLAH: Number(jumlah) };
      if (isEdit) await updateResepItem(token, payload);
      else        await addResepItem(token, payload);
      onDone(nama);
    } catch (e) {
      setError(e.message || "Gagal menyimpan item resep.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? `Ubah Jumlah — ${item.NAMA_BAHAN}` : "Tambah Bahan ke Resep"}
      subtitle={produkNama}
      width={420}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>{isEdit ? "Simpan" : "Tambahkan"}</Button>
      </>}
    >
      <FormError>{error}</FormError>
      {!isEdit && (
        available.length === 0 ? (
          <div style={{ fontSize: 13, color: "#d99a4e" }}>Semua bahan sudah ada di resep ini.</div>
        ) : (
          <Field label="Bahan">
            <Select value={idBahan} onChange={e => setIdBahan(e.target.value)}>
              {available.map(b => <option key={b.ID_BAHAN} value={b.ID_BAHAN}>{b.NAMA_BAHAN}</option>)}
            </Select>
          </Field>
        )
      )}
      <Field
        label={`Jumlah (${satuan || "satuan pakai"})`}
        hint={Number(yieldPcs) > 1
          ? `Jumlah untuk satu batch (menghasilkan ${yieldPcs} porsi) — otomatis dibagi ${yieldPcs} saat menghitung HPP per porsi`
          : "Jumlah untuk 1 porsi"}
      >
        <TextInput type="number" min="0" step="any" value={jumlah} onChange={e => setJumlah(e.target.value)} placeholder="0" autoFocus disabled={!isEdit && available.length === 0} />
      </Field>
    </Modal>
  );
}
