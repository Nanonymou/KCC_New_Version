// ═══════════════════════════════════════════════════════════════════════════
// DailyStockManager.jsx — "Transaksi Harian" (modul Inventory Harian retail).
//
// Menampilkan SEMUA item aktif untuk satu tanggal: item yang sudah pernah
// disimpan hari itu (PERSISTED=true) tampil dengan mutasi tersimpan; yang
// belum tampil sebagai baris kosong dengan Beg. Balance otomatis dari Balance
// hari sebelumnya. Balance dihitung ulang LIVE di sini untuk pratinjau, tapi
// nilai yang benar-benar disimpan selalu dihitung ulang oleh server saat
// apiDailyStockSave — client tidak pernah dipercaya untuk Beg. Balance/Balance.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { fetchDailyStockView, saveDailyStock, MOVEMENT_COLUMNS, idr } from "./kcc_data_layer";
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
  const [rows, setRows] = useState([]);      // server view, keyed by ID_ITEM
  const [edits, setEdits] = useState({});    // { [ID_ITEM]: { RECEIVING, REGULAR, ... } }
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
      // Re-seed local edits from the server view every time the date changes
      // (or on manual reload) — any unsaved typing is intentionally discarded,
      // same as navigating away without saving.
      const next = {};
      data.forEach((r) => {
        next[r.ID_ITEM] = {};
        EDITABLE_COLUMNS.forEach((c) => { next[r.ID_ITEM][c.key] = r[c.key]; });
      });
      setEdits(next);
    }
    setLoading(false);
  }, [token, date]);

  useEffect(() => { reload(); }, [reload]);

  function setCell(itemId, key, value) {
    setEdits((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [key]: value } }));
  }

  const displayRows = useMemo(() => {
    let list = rows;
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      list = list.filter((r) =>
        r.ITEM_CODE.toLowerCase().includes(q) ||
        r.DESCRIPTION.toLowerCase().includes(q) ||
        (r.BRAND || "").toLowerCase().includes(q));
    }
    return list;
  }, [rows, searchQ]);

  const savedCount = rows.filter((r) => r.PERSISTED).length;

  async function handleSave() {
    setSaving(true);
    try {
      const entries = rows.map((r) => {
        const e = edits[r.ID_ITEM] || {};
        const out = { ID_ITEM: r.ID_ITEM };
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
            {loading ? "Memuat…" : `${savedCount} dari ${rows.length} item sudah tercatat untuk tanggal ini`}
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
          placeholder="Cari Item Code / Description / Brand…" style={{ flex: 1, minWidth: 200 }}
        />
      </div>

      {/* Table */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thSticky}>Item</th>
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
                <tr><td style={{ ...td, color: T.textFaint }} colSpan={13}>Tidak ada item aktif. Tambahkan dulu lewat Master Item.</td></tr>
              ) : displayRows.map((r) => {
                const e = edits[r.ID_ITEM] || {};
                const previewRow = { BEG_BALANCE: r.BEG_BALANCE, ...e };
                const balance = computeBalance(previewRow);
                return (
                  <tr key={r.ID_ITEM}>
                    <td style={tdSticky}>
                      <div style={{ fontWeight: 600, color: T.text }}>{r.ITEM_CODE}</div>
                      <div style={{ fontSize: 11, color: T.textFaint }}>{r.DESCRIPTION}</div>
                    </td>
                    {MOVEMENT_COLUMNS.map((c) => (
                      <td key={c.key} style={{ ...td, textAlign: "right" }}>
                        {c.editable ? (
                          <input
                            type="number" min="0" step="1" disabled={!canWrite}
                            value={e[c.key] ?? 0}
                            onChange={(ev) => setCell(r.ID_ITEM, c.key, ev.target.value)}
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
