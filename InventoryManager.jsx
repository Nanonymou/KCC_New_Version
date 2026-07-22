import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  STOK_BAHAN,
  RESEP,
  PENJUALAN_HARI_INI,
  fetchBahan,
  fetchStok,
  fetchResep,
  fetchDashboard,
  createBahan,
  adjustStok,
  round2, idr,
} from "./kcc_data_layer";
import { Modal, Field, TextInput, Select, Button, FormError, Toast } from "./FormKit";

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

function statusStok(stok, minStok) {
  const rasio = minStok > 0 ? stok / minStok : 99;
  if (rasio < 0.5) return { label: "Kritis",  color: "#d1685c" };
  if (rasio < 1.0) return { label: "Rendah",  color: "#d99a4e" };
  if (rasio < 1.5) return { label: "Cukup",   color: "#a9c46a" };
  return               { label: "Aman",    color: "#7fa86a" };
}

export default function InventoryManager() {
  const { token, role, isDemo } = useAuth();
  const canWrite = !isDemo && (role === "ADMIN" || role === "SUPER_ADMIN");

  const [filterStatus, setFilterStatus] = useState("Semua");
  const [searchQ, setSearchQ] = useState("");
  const [sortBy, setSortBy]   = useState("status"); // status | nama | stok | nilai

  const [bahanList,    setBahanList]    = useState(INITIAL_BAHAN);
  const [stokBahan,    setStokBahan]    = useState(STOK_BAHAN);
  const [resepData,    setResepData]    = useState(RESEP);
  const [penjualan,    setPenjualan]    = useState(PENJUALAN_HARI_INI);

  const [showAdd, setShowAdd]   = useState(false);
  const [adjustRow, setAdjustRow] = useState(null); // bahan row being adjusted
  const [toast, setToast]       = useState("");
  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const reload = useCallback(async () => {
    if (!token) return;
    const [bahanData, stokData, resepRes, dashData] = await Promise.all([
      fetchBahan(token), fetchStok(token), fetchResep(token), fetchDashboard(token),
    ]);
    if (bahanData)           setBahanList(bahanData);
    if (stokData)            setStokBahan(stokData);
    if (resepRes)            setResepData(resepRes);
    if (dashData?.penjualan) setPenjualan(dashData.penjualan);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const bahanMap = useMemo(() => {
    const m = {};
    bahanList.forEach(b => { m[b.ID_BAHAN] = b; });
    return m;
  }, [bahanList]);

  const stokMap = useMemo(() => {
    const m = {};
    stokBahan.forEach(s => { m[s.ID_BAHAN] = s; });
    return m;
  }, [stokBahan]);

  // Hitung kebutuhan harian dari penjualan & resep
  const kebutuhanHarian = useMemo(() => {
    const kebutuhan = {};
    const jualMap = {};
    penjualan.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });

    resepData.forEach(r => {
      const qty = jualMap[r.ID_PRODUK] || 0;
      const bahan = bahanMap[r.ID_BAHAN];
      if (!bahan) return;
      const konversi = bahan.KONVERSI || 1;
      const kebutuhanDalamSatuanBeli = (r.JUMLAH * qty) / konversi;
      kebutuhan[r.ID_BAHAN] = round2((kebutuhan[r.ID_BAHAN] || 0) + kebutuhanDalamSatuanBeli);
    });
    return kebutuhan;
  }, [bahanMap, resepData, penjualan]);

  const inventoryRows = useMemo(() => {
    return bahanList.map(b => {
      const stok  = stokMap[b.ID_BAHAN];
      const s     = stok?.STOK    ?? 0;
      const min   = stok?.MIN_STOK ?? 0;
      const sts   = statusStok(s, min);
      const nilaiStok   = round2(s * b.HARGA_RATA2);
      const kebHarian   = kebutuhanHarian[b.ID_BAHAN] || 0;
      const hariTahan   = kebHarian > 0 ? round2(s / kebHarian) : null;
      const rasio       = min > 0 ? round2(s / min) : 99;
      return { ...b, STOK: s, MIN_STOK: min, STATUS: sts, NILAI_STOK: nilaiStok, KEB_HARIAN: kebHarian, HARI_TAHAN: hariTahan, RASIO: rasio };
    });
  }, [bahanList, stokMap, kebutuhanHarian]);

  const filtered = useMemo(() => {
    let rows = inventoryRows;
    if (filterStatus !== "Semua") rows = rows.filter(r => r.STATUS.label === filterStatus);
    if (searchQ) rows = rows.filter(r => r.NAMA_BAHAN.toLowerCase().includes(searchQ.toLowerCase()));
    return [...rows].sort((a, b) => {
      if (sortBy === "nama")   return a.NAMA_BAHAN.localeCompare(b.NAMA_BAHAN);
      if (sortBy === "stok")   return b.STOK - a.STOK;
      if (sortBy === "nilai")  return b.NILAI_STOK - a.NILAI_STOK;
      // default: status (kritis dulu)
      const order = { Kritis: 0, Rendah: 1, Cukup: 2, Aman: 3 };
      return (order[a.STATUS.label] ?? 9) - (order[b.STATUS.label] ?? 9);
    });
  }, [inventoryRows, filterStatus, searchQ, sortBy]);

  // KPI
  const kritis  = inventoryRows.filter(r => r.STATUS.label === "Kritis").length;
  const rendah  = inventoryRows.filter(r => r.STATUS.label === "Rendah").length;
  const totalNilai = inventoryRows.reduce((s, r) => s + r.NILAI_STOK, 0);

  const statusFilters = ["Semua", "Kritis", "Rendah", "Cukup", "Aman"];
  const statusColor   = { Kritis: "#d1685c", Rendah: "#d99a4e", Cukup: "#a9c46a", Aman: "#7fa86a", Semua: "#8a857b" };

  return (
    <div>
      <style>{`
        .inv-row:hover { background: rgba(201,100,66,0.04) !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#ecebe5", letterSpacing: "-0.02em" }}>
            📦 Inventory Bahan Baku
          </div>
          <div style={{ fontSize: 13, color: "#78746b", marginTop: 4 }}>
            Stok real-time, nilai persediaan & ketahanan bahan
          </div>
        </div>
        {canWrite ? (
          <Button onClick={() => setShowAdd(true)}>＋ Tambah Bahan</Button>
        ) : (
          <span style={{ fontSize: 11.5, color: "#615d55" }}>
            {isDemo ? "Mode demo — hanya lihat" : "Perlu akses admin untuk input"}
          </span>
        )}
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Total Bahan", value: bahanList.length, accent: "#c96442", icon: "📦" },
          { label: "Stok Kritis", value: kritis, accent: "#d1685c", icon: "🔴" },
          { label: "Stok Rendah", value: rendah, accent: "#d99a4e", icon: "🟡" },
          { label: "Nilai Stok", value: idr(totalNilai), accent: "#7fa86a", icon: "💰" },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, color: "#8a857b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: k.accent, letterSpacing: "-0.02em" }}>{k.value}</div>
              </div>
              <div style={{ fontSize: 20, opacity: 0.6 }}>{k.icon}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter & Search Bar */}
      <Card style={{ marginBottom: 14, padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="🔍 Cari bahan..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            style={{
              background: "#1f1e1c", border: "1px solid #615d55",
              borderRadius: 8, padding: "7px 12px", color: "#ecebe5",
              fontSize: 13, outline: "none", width: 200,
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {statusFilters.map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", border: "1px solid",
                  borderColor: filterStatus === s ? statusColor[s] : "#3a3834",
                  background: filterStatus === s ? statusColor[s] + "22" : "transparent",
                  color: filterStatus === s ? statusColor[s] : "#8a857b",
                  transition: "all 0.15s",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#8a857b" }}>Sort:</span>
            {[["status","Status"],["nama","Nama"],["stok","Stok"],["nilai","Nilai"]].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setSortBy(v)}
                style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  cursor: "pointer", border: "1px solid",
                  borderColor: sortBy === v ? "#c96442" : "#3a3834",
                  background: sortBy === v ? "rgba(201,100,66,0.12)" : "transparent",
                  color: sortBy === v ? "#c96442" : "#8a857b",
                  transition: "all 0.15s",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Bahan", "Stok", "Min Stok", "Rasio", "Kebutuhan/Hari", "Tahan", "Nilai Stok", "Status", ...(canWrite ? ["Aksi"] : [])].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => {
              const { label, color } = b.STATUS;
              const rasio = b.RASIO >= 99 ? "—" : b.RASIO.toFixed(2) + "x";
              return (
                <tr key={b.ID_BAHAN} className="inv-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                  <td style={{ ...S.td, fontWeight: 600, color: "#ecebe5" }}>
                    {b.NAMA_BAHAN}
                    <div style={{ fontSize: 11, color: "#78746b", fontWeight: 400 }}>{b.ID_BAHAN}</div>
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>
                    <span style={{ fontWeight: 700, color: color }}>{b.STOK}</span>
                    <span style={{ color: "#78746b" }}> {b.SATUAN_BELI}</span>
                  </td>
                  <td style={{ ...S.td, color: "#8a857b", fontFamily: "monospace" }}>
                    {b.MIN_STOK} {b.SATUAN_BELI}
                  </td>
                  <td style={{ ...S.td, color: color, fontWeight: 700, fontFamily: "monospace" }}>
                    {rasio}
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: "#a9a49a" }}>
                    {b.KEB_HARIAN > 0 ? `${b.KEB_HARIAN} ${b.SATUAN_BELI}` : "—"}
                  </td>
                  <td style={{ ...S.td }}>
                    {b.HARI_TAHAN !== null ? (
                      <span style={{ color: b.HARI_TAHAN < 1 ? "#d1685c" : b.HARI_TAHAN < 2 ? "#d99a4e" : "#7fa86a", fontWeight: 700 }}>
                        {b.HARI_TAHAN.toFixed(1)} hari
                      </span>
                    ) : <span style={{ color: "#615d55" }}>—</span>}
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: "#ecebe5" }}>
                    {idr(b.NILAI_STOK)}
                  </td>
                  <td style={S.td}>
                    <span style={{
                      display: "inline-block", padding: "3px 10px", borderRadius: 20,
                      fontSize: 11, fontWeight: 700, color,
                      background: color + "22", border: `1px solid ${color}44`,
                    }}>
                      {label}
                    </span>
                  </td>
                  {canWrite && (
                    <td style={S.td}>
                      <button
                        onClick={() => setAdjustRow(b)}
                        style={{
                          padding: "4px 10px", fontSize: 11.5, fontWeight: 600,
                          color: "#c96442", background: "rgba(201,100,66,0.10)",
                          border: "1px solid rgba(201,100,66,0.32)", borderRadius: 6, cursor: "pointer",
                        }}
                      >Sesuaikan</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "#615d55", fontSize: 13 }}>
            Tidak ada data yang sesuai filter
          </div>
        )}
      </Card>

      {/* Grafik ketahanan stok */}
      <Card style={{ marginTop: 14 }}>
        <div style={S.label}>Ketahanan Stok per Bahan (hari)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {inventoryRows
            .filter(b => b.HARI_TAHAN !== null)
            .sort((a, b) => (a.HARI_TAHAN ?? 0) - (b.HARI_TAHAN ?? 0))
            .map(b => {
              const maxHari = 7;
              const width = Math.min(((b.HARI_TAHAN ?? 0) / maxHari) * 100, 100);
              const color = (b.HARI_TAHAN ?? 0) < 1 ? "#d1685c" : (b.HARI_TAHAN ?? 0) < 2 ? "#d99a4e" : "#7fa86a";
              return (
                <div key={b.ID_BAHAN}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: "#ecebe5", fontWeight: 500 }}>{b.NAMA_BAHAN}</span>
                    <span style={{ fontSize: 12, color, fontWeight: 700 }}>{b.HARI_TAHAN?.toFixed(1)} hari</span>
                  </div>
                  <div style={{ height: 5, background: "#3a3834", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${width}%`, background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
        </div>
      </Card>

      {showAdd && (
        <AddBahanModal
          token={token}
          onClose={() => setShowAdd(false)}
          onDone={async (nama) => { setShowAdd(false); await reload(); flashToast(`Bahan "${nama}" ditambahkan`); }}
        />
      )}
      {adjustRow && (
        <AdjustStokModal
          token={token}
          row={adjustRow}
          stok={stokMap[adjustRow.ID_BAHAN]}
          onClose={() => setAdjustRow(null)}
          onDone={async () => { const n = adjustRow.NAMA_BAHAN; setAdjustRow(null); await reload(); flashToast(`Stok "${n}" diperbarui`); }}
        />
      )}
      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

// ─── Add Bahan modal ─────────────────────────────────────────────────────────
function AddBahanModal({ token, onClose, onDone }) {
  const [nama, setNama]           = useState("");
  const [satuanBeli, setSatuanBeli]   = useState("kg");
  const [satuanPakai, setSatuanPakai] = useState("gram");
  const [konversi, setKonversi]   = useState("1000");
  const [harga, setHarga]         = useState("");
  const [stok, setStok]           = useState("");
  const [minStok, setMinStok]     = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);

  async function submit() {
    setError(null);
    if (!nama.trim())          return setError("Nama bahan wajib diisi.");
    if (!(Number(harga) > 0))  return setError("Harga rata-rata harus lebih dari 0.");
    setSaving(true);
    try {
      // Bahan + opening stock are created atomically in one backend call, so a
      // failed retry can never create a duplicate bahan.
      await createBahan(token, {
        NAMA_BAHAN: nama.trim(), SATUAN_BELI: satuanBeli.trim(), SATUAN_PAKAI: satuanPakai.trim(),
        KONVERSI: Number(konversi) || 1, HARGA_RATA2: Number(harga),
        STOK: Number(stok) || 0, MIN_STOK: Number(minStok) || 0,
      });
      onDone(nama.trim());
    } catch (e) {
      setError(e.message || "Gagal menambah bahan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Tambah Bahan Baku"
      subtitle="ID bahan dibuat otomatis"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>Simpan Bahan</Button>
      </>}
    >
      <FormError>{error}</FormError>
      <Field label="Nama Bahan">
        <TextInput value={nama} onChange={e => setNama(e.target.value)} placeholder="Contoh: Daging Sapi" autoFocus />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Satuan Beli"><TextInput value={satuanBeli} onChange={e => setSatuanBeli(e.target.value)} placeholder="kg" /></Field>
        <Field label="Satuan Pakai"><TextInput value={satuanPakai} onChange={e => setSatuanPakai(e.target.value)} placeholder="gram" /></Field>
        <Field label="Konversi" hint="1 satuan beli = ? satuan pakai"><TextInput type="number" min="1" step="any" value={konversi} onChange={e => setKonversi(e.target.value)} /></Field>
      </div>
      <Field label="Harga Rata-rata / satuan beli">
        <TextInput type="number" min="0" step="any" value={harga} onChange={e => setHarga(e.target.value)} placeholder="0" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Stok Awal (opsional)"><TextInput type="number" min="0" step="any" value={stok} onChange={e => setStok(e.target.value)} placeholder="0" /></Field>
        <Field label="Stok Minimum (opsional)"><TextInput type="number" min="0" step="any" value={minStok} onChange={e => setMinStok(e.target.value)} placeholder="0" /></Field>
      </div>
    </Modal>
  );
}

// ─── Adjust Stok modal ───────────────────────────────────────────────────────
function AdjustStokModal({ token, row, stok, onClose, onDone }) {
  const [nilai, setNilai]     = useState(String(stok?.STOK ?? 0));
  const [minVal, setMinVal]   = useState(String(stok?.MIN_STOK ?? 0));
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await adjustStok(token, {
        ID_BAHAN: row.ID_BAHAN, STOK: Number(nilai) || 0, MIN_STOK: Number(minVal) || 0,
      });
      onDone();
    } catch (e) {
      setError(e.message || "Gagal menyesuaikan stok.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Sesuaikan Stok — ${row.NAMA_BAHAN}`}
      subtitle="Set nilai stok fisik & batas minimum"
      width={400}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>Simpan</Button>
      </>}
    >
      <FormError>{error}</FormError>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={`Stok (${row.SATUAN_BELI})`}>
          <TextInput type="number" min="0" step="any" value={nilai} onChange={e => setNilai(e.target.value)} autoFocus />
        </Field>
        <Field label={`Min Stok (${row.SATUAN_BELI})`}>
          <TextInput type="number" min="0" step="any" value={minVal} onChange={e => setMinVal(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
