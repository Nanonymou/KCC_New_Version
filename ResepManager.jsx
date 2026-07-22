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
  recalcSemua,
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
            <div style={S.label}>Produk ({produkList.length})</div>
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
        </Card>

        {/* Right: Detail Resep */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* KPI Bar */}
          {selected && selectedHPP && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Harga Jual", value: idr(selected.HARGA_JUAL), accent: "#c96442" },
                { label: "HPP / Pcs",  value: idr(selectedHPP.HPP_PER_PCS), accent: "#a9a49a" },
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
                  {selected?.NAMA_PRODUK} — yield {selected?.YIELD_PCS} pcs/batch
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#8a857b" }}>Total Biaya Batch</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#c96442" }}>{idr(totalBiayaResep)}</div>
                </div>
                {canWrite && selected && (
                  <Button onClick={() => setShowAddItem(true)}>＋ Tambah Bahan</Button>
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
          bahanList={bahanList}
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
          item={editItem}
          onClose={() => setEditItem(null)}
          onDone={async (nama) => { setEditItem(null); await reload(); flashToast(`Jumlah "${nama}" diperbarui`); }}
        />
      )}
      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

// ─── Add Produk modal ────────────────────────────────────────────────────────
function AddProdukModal({ token, onClose, onDone }) {
  const [nama, setNama]       = useState("");
  const [kategori, setKategori] = useState("Main Course");
  const [harga, setHarga]     = useState("");
  const [yieldPcs, setYieldPcs] = useState("1");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  async function submit() {
    setError(null);
    if (!nama.trim())            return setError("Nama produk wajib diisi.");
    if (!(Number(harga) > 0))    return setError("Harga jual harus lebih dari 0.");
    if (!(Number(yieldPcs) > 0)) return setError("Yield harus lebih dari 0.");
    setSaving(true);
    try {
      const res = await createProduk(token, {
        NAMA_PRODUK: nama.trim(), KATEGORI: kategori.trim() || "Lainnya",
        HARGA_JUAL: Number(harga), YIELD_PCS: Number(yieldPcs),
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
        <TextInput value={nama} onChange={e => setNama(e.target.value)} placeholder="Contoh: Sate Ayam" autoFocus />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Kategori"><TextInput value={kategori} onChange={e => setKategori(e.target.value)} placeholder="Main Course" /></Field>
        <Field label="Yield (pcs / batch)"><TextInput type="number" min="1" step="any" value={yieldPcs} onChange={e => setYieldPcs(e.target.value)} /></Field>
      </div>
      <Field label="Harga Jual / pcs">
        <TextInput type="number" min="0" step="any" value={harga} onChange={e => setHarga(e.target.value)} placeholder="0" />
      </Field>
    </Modal>
  );
}

// ─── Add / Edit Resep item modal ─────────────────────────────────────────────
function ResepItemModal({ token, mode, idProduk, produkNama, bahanList = [], existingIds = [], item, onClose, onDone }) {
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
      <Field label={`Jumlah (${satuan || "satuan pakai"})`} hint="Jumlah pemakaian per batch resep">
        <TextInput type="number" min="0" step="any" value={jumlah} onChange={e => setJumlah(e.target.value)} placeholder="0" autoFocus disabled={!isEdit && available.length === 0} />
      </Field>
    </Modal>
  );
}
