// ═══════════════════════════════════════════════════════════════════════════
// PenjualanManager.jsx — "Penjualan Harian".
//
// Fitur ini SEBELUMNYA TIDAK ADA di UI: backend (apiInvSalesCreate) sudah
// tersedia sejak awal, tapi tidak ada satu pun komponen yang memanggilnya —
// jadi tabel `penjualan` selalu kosong, dan itu sebabnya Dashboard
// (Omzet Hari Ini, Top Selling, Paling Menguntungkan) selalu menunjukkan 0.
// Halaman ini mengisi kekosongan itu: kasir/admin mencatat qty terjual per
// produk per hari, hasilnya langsung dipakai Dashboard.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { fetchProduk, fetchSalesList, recordSale, deleteSale, filterAktif, idr } from "./kcc_data_layer";
import { Button, TextInput, Select, Toast } from "./FormKit";
import { T } from "./theme";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function PenjualanManager() {
  const { token, role, isDemo } = useAuth();
  const canAdd = !isDemo; // backend: minimum KASIR — role asli di app ini (KASIR/ADMIN/SUPER_ADMIN) semuanya lolos
  const canDelete = !isDemo && (role === "ADMIN" || role === "SUPER_ADMIN");

  const [date, setDate] = useState(todayISO());
  const [produkList, setProdukList] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedProduk, setSelectedProduk] = useState("");
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState("");
  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [prd, sl] = await Promise.all([fetchProduk(token), fetchSalesList(token, date)]);
    if (prd) setProdukList(prd);
    if (sl) setSales(sl);
    setLoading(false);
  }, [token, date]);

  useEffect(() => { reload(); }, [reload]);

  const produkAktif = useMemo(
    () => [...filterAktif(produkList)].sort((a, b) => a.NAMA_PRODUK.localeCompare(b.NAMA_PRODUK)),
    [produkList]
  );
  const produkMap = useMemo(() => {
    const m = {};
    produkList.forEach((p) => { m[p.ID_PRODUK] = p; });
    return m;
  }, [produkList]);

  useEffect(() => {
    if (!selectedProduk && produkAktif.length > 0) setSelectedProduk(produkAktif[0].ID_PRODUK);
  }, [produkAktif, selectedProduk]);

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalOmzet = 0;
    for (const row of sales) {
      const p = produkMap[row.ID_PRODUK];
      totalQty += row.QTY;
      totalOmzet += row.QTY * (p?.HARGA_JUAL || 0);
    }
    return { totalQty, totalOmzet };
  }, [sales, produkMap]);

  async function handleAdd() {
    if (!selectedProduk) return window.alert("Pilih produk dulu.");
    const n = Number(qty);
    if (!(n > 0)) return window.alert("Qty harus lebih dari 0.");
    setSaving(true);
    try {
      await recordSale(token, { ID_PRODUK: selectedProduk, QTY: n, TANGGAL: date });
      setQty("");
      await reload();
      flashToast(`Tercatat: ${n} × ${produkMap[selectedProduk]?.NAMA_PRODUK || selectedProduk}`);
    } catch (e) {
      window.alert("Gagal mencatat penjualan: " + (e.message || "kesalahan server"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Hapus catatan ${row.QTY} × "${produkMap[row.ID_PRODUK]?.NAMA_PRODUK || row.ID_PRODUK}"?`)) return;
    setBusyId(row.ID);
    try {
      await deleteSale(token, row.ID);
      await reload();
      flashToast("Catatan penjualan dihapus");
    } catch (e) {
      window.alert("Gagal menghapus: " + (e.message || "kesalahan server"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
          🧾 Penjualan Harian
        </div>
        <div style={{ fontSize: 13, color: T.textFaint, marginTop: 4 }}>
          Catat qty terjual per produk — datanya langsung dipakai Dashboard (Omzet, Top Selling, Paling Menguntungkan)
        </div>
      </div>

      {/* Tanggal + form tambah */}
      <div style={{
        marginBottom: 16, padding: 16, background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>Tanggal</label>
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{
                display: "block", padding: "8px 10px", fontSize: 13, background: T.surfaceInput, color: T.text,
                border: `1px solid ${T.border}`, borderRadius: T.radiusSm, outline: "none",
              }}
            />
          </div>

          {canAdd && (
            <>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={labelStyle}>Produk</label>
                <Select value={selectedProduk} onChange={(e) => setSelectedProduk(e.target.value)}>
                  {produkAktif.length === 0 ? (
                    <option value="">Belum ada produk aktif</option>
                  ) : produkAktif.map((p) => (
                    <option key={p.ID_PRODUK} value={p.ID_PRODUK}>
                      {p.NAMA_PRODUK} — {idr(p.HARGA_JUAL)}
                    </option>
                  ))}
                </Select>
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Qty</label>
                <TextInput
                  type="number" min="1" step="1" value={qty}
                  onChange={(e) => setQty(e.target.value)} placeholder="0"
                />
              </div>
              <Button onClick={handleAdd} loading={saving} disabled={produkAktif.length === 0}>
                ＋ Catat Penjualan
              </Button>
            </>
          )}
        </div>
        {!canAdd && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: T.textFaint }}>
            {isDemo ? "Mode demo — hanya lihat" : "Login diperlukan untuk mencatat penjualan"}
          </div>
        )}
        {canAdd && produkAktif.length === 0 && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: T.textFaint }}>
            Belum ada produk aktif. Tambahkan dulu lewat tab <strong>Resep</strong> / <strong>HPP & Margin</strong>.
          </div>
        )}
      </div>

      {/* Ringkasan hari ini */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <SummaryCard label="Total Qty Terjual" value={totals.totalQty} accent={T.info} />
        <SummaryCard label="Total Omzet" value={idr(totals.totalOmzet)} accent={T.success} />
      </div>

      {/* Tabel transaksi hari itu */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>ID Transaksi</th>
                <th style={th}>Produk</th>
                <th style={{ ...th, textAlign: "right" }}>Qty</th>
                <th style={{ ...th, textAlign: "right" }}>Omzet</th>
                {canDelete && <th style={{ ...th, textAlign: "right" }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={td} colSpan={5}>Memuat…</td></tr>
              ) : sales.length === 0 ? (
                <tr><td style={{ ...td, color: T.textFaint }} colSpan={5}>Belum ada penjualan tercatat untuk tanggal ini.</td></tr>
              ) : sales.map((row) => {
                const p = produkMap[row.ID_PRODUK];
                const omzetRow = row.QTY * (p?.HARGA_JUAL || 0);
                return (
                  <tr key={row.ID}>
                    <td style={{ ...td, color: T.textFaint, fontFamily: "monospace", fontSize: 11.5 }}>{row.ID_TRANSAKSI || "—"}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{p?.NAMA_PRODUK || row.ID_PRODUK}</td>
                    <td style={{ ...td, textAlign: "right" }}>{row.QTY}</td>
                    <td style={{ ...td, textAlign: "right" }}>{idr(omzetRow)}</td>
                    {canDelete && (
                      <td style={{ ...td, textAlign: "right" }}>
                        <button
                          onClick={() => handleDelete(row)} disabled={busyId === row.ID}
                          style={{ background: "none", border: "none", color: T.danger, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                        >Hapus</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 11, color: T.textFaint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 11, fontWeight: 600, color: T.textMuted,
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
};
const th = {
  padding: "9px 12px", textAlign: "left", fontSize: 11, color: T.textFaint,
  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
  borderBottom: `1px solid ${T.borderSoft}`,
};
const td = { padding: "10px 12px", borderBottom: `1px solid ${T.borderSoft}` };
