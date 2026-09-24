// ═══════════════════════════════════════════════════════════════════════════
// DailyStockManager.jsx — "Transaksi Harian".
//
// Item yang tampil di sini LANGSUNG dari bahan (Inventory) yang sudah ada —
// tidak ada katalog/master data terpisah. Menampilkan SEMUA bahan aktif untuk
// satu tanggal: yang sudah pernah disimpan hari itu (PERSISTED=true) tampil
// dengan mutasi tersimpan; yang belum tampil sebagai baris kosong dengan
// Beg. Balance otomatis dari Balance hari sebelumnya. Balance dihitung ulang
// LIVE di sini untuk pratinjau, tapi nilai yang benar-benar disimpan selalu
// dihitung ulang oleh server saat apiDailyStockSave.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { fetchDailyStockView, saveDailyStock, MOVEMENT_COLUMNS } from "./kcc_data_layer";
import { Button, TextInput, Toast } from "./FormKit";
import { T } from "./theme";

const EDITABLE_COLUMNS = MOVEMENT_COLUMNS.filter((c) => c.editable);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function computeBalance(row) {
  let out = 0;
  for (const c of EDITABLE_COLUMNS) if (c.key !== "RECEIVING") out += Number(row[c.key]) || 0;
  const receiving = Number(row.RECEIVING) || 0;
  return (Number(row.BEG_BALANCE) || 0) + receiving - out;
}

export default function DailyStockManager() {
  const { token, isDemo } = useAuth();
  const canWrite = !isDemo;

  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState([]);      // server view, keyed by ID_BAHAN
  const [edits, setEdits] = useState({});    // { [ID_BAHAN]: { RECEIVING, REGULAR, ... } }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [toast, setToast] = useState("");
  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const data = await fetchDailyStockView(token, date);
    if (data) {
      setRows(data);
      // Re-seed local edits dari server view setiap kali tanggal berubah
      // (atau reload manual) — ketikan yang belum disimpan sengaja dibuang,
      // sama seperti pindah halaman tanpa menyimpan.
      const next = {};
      data.forEach((r) => {
        next[r.ID_BAHAN] = {};
        EDITABLE_COLUMNS.forEach((c) => { next[r.ID_BAHAN][c.key] = r[c.key]; });
      });
      setEdits(next);
    }
    setLoading(false);
  }, [token, date]);

  useEffect(() => { reload(); }, [reload]);

  function setCell(idBahan, key, value) {
    setEdits((prev) => ({ ...prev, [idBahan]: { ...prev[idBahan], [key]: value } }));
  }

  // Filter pencarian by nama bahan — daftar bahan sendiri sudah datang dari
  // Inventory (tidak ada Section, karena bahan tidak punya field itu).
  const displayRows = useMemo(() => {
    if (!searchQ.trim()) return rows;
    const q = searchQ.trim().toLowerCase();
    return rows.filter((r) => r.NAMA.toLowerCase().includes(q));
  }, [rows, searchQ]);

  const savedCount = rows.filter((r) => r.PERSISTED).length;

  async function handleSave() {
    setSaving(true);
    try {
      const entries = rows.map((r) => {
        const e = edits[r.ID_BAHAN] || {};
        const out = { ID_BAHAN: r.ID_BAHAN };
        EDITABLE_COLUMNS.forEach((c) => { out[c.key] = Number(e[c.key]) || 0; });
        return out;
      });
      const res = await saveDailyStock(token, date, entries);
      await reload();
      flashToast(`Tersimpan: ${res?.data?.created ?? 0} baru, ${res?.data?.revised ?? 0} revisi`);
    } catch (e) {
      window.alert("Gagal menyimpan transaksi harian: " + (e.message || "kesalahan server"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
            🧾 Transaksi Harian
          </div>
          <div style={{ fontSize: 13, color: T.textFaint, marginTop: 4 }}>
            {loading ? "Memuat…" : `${savedCount} dari ${rows.length} bahan sudah tercatat untuk tanggal ini`}
          </div>
        </div>
        {canWrite ? (
          <Button onClick={handleSave} loading={saving}>💾 Simpan Transaksi Harian</Button>
        ) : (
          <span style={{ fontSize: 11.5, color: T.textFaint }}>
            {isDemo ? "Mode demo — hanya lihat" : "Login diperlukan untuk input"}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div style={{
        marginBottom: 14, padding: "12px 16px", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14,
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
      }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Tanggal
        </label>
        <input
          type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{
            padding: "8px 10px", fontSize: 13, background: T.surfaceInput, color: T.text,
            border: `1px solid ${T.border}`, borderRadius: T.radiusSm, outline: "none",
          }}
        />
        <TextInput
          value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Cari nama bahan…" style={{ flex: 1, minWidth: 200 }}
        />
        <span style={{ fontSize: 12, color: T.textFaint, whiteSpace: "nowrap" }}>
          {displayRows.length} dari {rows.length} bahan
        </span>
      </div>

      {rows.length === 0 && !loading && (
        <div style={{
          marginBottom: 14, padding: "12px 16px", background: T.surfaceAlt,
          border: `1px solid ${T.borderSoft}`, borderRadius: 12, fontSize: 12.5, color: T.textMuted,
        }}>
          Belum ada bahan aktif di Inventory. Tambahkan bahan dulu lewat tab <strong>Inventory</strong>,
          bahan tersebut otomatis muncul di sini.
        </div>
      )}

      {/* Table */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thSticky}>Bahan</th>
                {MOVEMENT_COLUMNS.map((c) => (
                  <th key={c.key} style={{ ...th, textAlign: "right", minWidth: 78 }}>{c.label}</th>
                ))}
                <th style={{ ...th, textAlign: "right", minWidth: 90 }}>Balance</th>
                <th style={{ ...th, textAlign: "center" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={td} colSpan={13}>Memuat…</td></tr>
              ) : displayRows.length === 0 ? (
                <tr><td style={{ ...td, color: T.textFaint }} colSpan={13}>Tidak ada bahan yang cocok pencarian.</td></tr>
              ) : displayRows.map((r) => {
                const e = edits[r.ID_BAHAN] || {};
                const previewRow = { BEG_BALANCE: r.BEG_BALANCE, ...e };
                const balance = computeBalance(previewRow);
                return (
                  <tr key={r.ID_BAHAN}>
                    <td style={tdSticky}>
                      <div style={{ fontWeight: 600, color: T.text }}>{r.NAMA}</div>
                      <div style={{ fontSize: 11, color: T.textFaint }}>{r.SATUAN || "—"}</div>
                    </td>
                    {MOVEMENT_COLUMNS.map((c) => (
                      <td key={c.key} style={{ ...td, textAlign: "right" }}>
                        {c.editable ? (
                          <input
                            type="number" min="0" step="1" disabled={!canWrite}
                            value={e[c.key] ?? 0}
                            onChange={(ev) => setCell(r.ID_BAHAN, c.key, ev.target.value)}
                            style={cellInput}
                          />
                        ) : (
                          <span style={{ color: T.textFaint }}>{r.BEG_BALANCE}</span>
                        )}
                      </td>
                    ))}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: balance < 0 ? T.danger : T.text }}>
                      {balance}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {r.PERSISTED ? (
                        <span style={badge(T.success)}>Tersimpan</span>
                      ) : (
                        <span style={badge(T.textFaint)}>Belum</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: T.textFaint }}>
        Beg. Balance otomatis mengikuti Balance tanggal sebelumnya — tidak bisa diedit manual.
        Balance di sini hanya pratinjau; nilai final dihitung ulang server saat disimpan.
      </div>

      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

const th = {
  padding: "9px 10px", textAlign: "left", fontSize: 10.5, color: T.textFaint,
  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap",
};
const thSticky = { ...th, position: "sticky", left: 0, background: T.surface, zIndex: 1, minWidth: 180 };
const td = { padding: "8px 10px", borderBottom: `1px solid ${T.borderSoft}`, verticalAlign: "middle" };
const tdSticky = { ...td, position: "sticky", left: 0, background: T.surface, zIndex: 1 };
const cellInput = {
  width: 64, padding: "5px 6px", fontSize: 12.5, textAlign: "right",
  background: T.surfaceInput, color: T.text, border: `1px solid ${T.border}`,
  borderRadius: 6, outline: "none",
};
function badge(color) {
  return {
    fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
    background: `${color}22`, color,
  };
}
