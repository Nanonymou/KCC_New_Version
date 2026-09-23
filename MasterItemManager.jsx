// ═══════════════════════════════════════════════════════════════════════════
// MasterItemManager.jsx — CRUD katalog Master Item (modul Inventory Harian
// retail). Terpisah dari InventoryManager.jsx (Bahan/Stok F&B) — item di sini
// dipakai oleh Transaksi Harian & Dashboard Stok.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  fetchMasterItems, createMasterItem, updateMasterItem,
  deactivateMasterItem, reactivateMasterItem, ITEM_SECTIONS, idr,
} from "./kcc_data_layer";
import { Modal, Field, TextInput, Select, Button, FormError, Toast } from "./FormKit";
import { T } from "./theme";

const S = {
  card: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20 },
  th: {
    padding: "9px 12px", textAlign: "left", fontSize: 11, color: T.textFaint,
    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
    borderBottom: `1px solid ${T.borderSoft}`,
  },
  td: { padding: "11px 12px", fontSize: 13, borderBottom: `1px solid ${T.borderSoft}`, verticalAlign: "middle" },
};

function Card({ children, style = {} }) {
  return <div style={{ ...S.card, ...style }}>{children}</div>;
}

export default function MasterItemManager() {
  const { token, role, isDemo } = useAuth();
  const canWrite = !isDemo && (role === "ADMIN" || role === "SUPER_ADMIN");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("Semua");
  const [searchQ, setSearchQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState("");
  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const data = await fetchMasterItems(token);
    if (data) setItems(data);
    setLoading(false);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const activeItems = useMemo(() => items.filter((i) => i.AKTIF !== false), [items]);
  const inactiveItems = useMemo(() => items.filter((i) => i.AKTIF === false), [items]);

  const filtered = useMemo(() => {
    const pool = showInactive ? inactiveItems : activeItems;
    let rows = pool;
    if (section !== "Semua") rows = rows.filter((r) => r.SECTION === section);
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.ITEM_CODE.toLowerCase().includes(q) ||
        r.DESCRIPTION.toLowerCase().includes(q) ||
        (r.BRAND || "").toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => a.ITEM_CODE.localeCompare(b.ITEM_CODE));
  }, [showInactive, activeItems, inactiveItems, section, searchQ]);

  async function handleDeactivate(item) {
    if (!window.confirm(`Nonaktifkan item "${item.ITEM_CODE} — ${item.DESCRIPTION}"? Riwayat transaksi harian lama tetap aman dan bisa dipulihkan lagi.`)) return;
    setBusyId(item.ID_ITEM);
    try {
      await deactivateMasterItem(token, item.ID_ITEM);
      await reload();
      flashToast(`Item "${item.ITEM_CODE}" dinonaktifkan`);
    } catch (e) {
      window.alert("Gagal menonaktifkan item: " + (e.message || "kesalahan server"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReactivate(item) {
    setBusyId(item.ID_ITEM);
    try {
      await reactivateMasterItem(token, item.ID_ITEM);
      await reload();
      flashToast(`Item "${item.ITEM_CODE}" diaktifkan kembali`);
    } catch (e) {
      window.alert("Gagal mengaktifkan item: " + (e.message || "kesalahan server"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
            🏷️ Master Item
          </div>
          <div style={{ fontSize: 13, color: T.textFaint, marginTop: 4 }}>
            Katalog barang — dipakai di Transaksi Harian & Dashboard Stok
          </div>
        </div>
        {canWrite ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {inactiveItems.length > 0 && (
              <button
                onClick={() => setShowInactive((v) => !v)}
                style={{
                  padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer",
                  color: showInactive ? T.primary : T.textFaint,
                  background: showInactive ? T.primarySoft : "transparent",
                  border: `1px solid ${showInactive ? T.primary : T.borderSoft}`,
                }}
              >
                🗑 Item Nonaktif ({inactiveItems.length})
              </button>
            )}
            <Button onClick={() => setShowAdd(true)}>＋ Tambah Item</Button>
          </div>
        ) : (
          <span style={{ fontSize: 11.5, color: T.textFaint }}>
            {isDemo ? "Mode demo — hanya lihat" : "Perlu akses admin untuk input"}
          </span>
        )}
      </div>

      {/* Filter & Search */}
      <Card style={{ marginBottom: 14, padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Select value={section} onChange={(e) => setSection(e.target.value)} style={{ width: 220 }}>
            <option value="Semua">Semua Section</option>
            {ITEM_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <TextInput
            value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Cari Item Code / Description / Brand…" style={{ flex: 1, minWidth: 200 }}
          />
          <span style={{ fontSize: 12, color: T.textFaint, whiteSpace: "nowrap" }}>
            {filtered.length} item {showInactive ? "nonaktif" : "aktif"}
          </span>
        </div>
      </Card>

      {/* Table */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={S.th}>Item Code</th>
                <th style={S.th}>Description</th>
                <th style={S.th}>Brand</th>
                <th style={S.th}>Size</th>
                <th style={S.th}>Unit</th>
                <th style={{ ...S.th, textAlign: "right" }}>Price</th>
                <th style={S.th}>Section</th>
                {canWrite && <th style={{ ...S.th, textAlign: "right" }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={S.td} colSpan={8}>Memuat…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td style={{ ...S.td, color: T.textFaint }} colSpan={8}>Tidak ada item.</td></tr>
              ) : filtered.map((item) => (
                <tr key={item.ID_ITEM} className="mi-row">
                  <td style={{ ...S.td, fontWeight: 600 }}>{item.ITEM_CODE}</td>
                  <td style={S.td}>{item.DESCRIPTION}</td>
                  <td style={{ ...S.td, color: T.textMuted }}>{item.BRAND || "—"}</td>
                  <td style={{ ...S.td, color: T.textMuted }}>{item.SIZE || "—"}</td>
                  <td style={{ ...S.td, color: T.textMuted }}>{item.UNIT || "—"}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>{idr(item.PRICE)}</td>
                  <td style={S.td}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                      background: T.surfaceAlt, color: T.textMuted,
                    }}>{item.SECTION}</span>
                  </td>
                  {canWrite && (
                    <td style={{ ...S.td, textAlign: "right" }}>
                      {item.AKTIF !== false ? (
                        <>
                          <button onClick={() => setEditRow(item)} style={linkBtn(T.info)}>Edit</button>
                          <button
                            onClick={() => handleDeactivate(item)} disabled={busyId === item.ID_ITEM}
                            style={linkBtn(T.danger)}
                          >Hapus</button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleReactivate(item)} disabled={busyId === item.ID_ITEM}
                          style={linkBtn(T.success)}
                        >Aktifkan</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showAdd && (
        <ItemFormModal
          token={token} items={items} onClose={() => setShowAdd(false)}
          onDone={(code) => { setShowAdd(false); reload(); flashToast(`Item "${code}" ditambahkan`); }}
        />
      )}
      {editRow && (
        <ItemFormModal
          token={token} items={items} row={editRow} onClose={() => setEditRow(null)}
          onDone={(code) => { setEditRow(null); reload(); flashToast(`Item "${code}" diperbarui`); }}
        />
      )}

      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

function linkBtn(color) {
  return {
    background: "none", border: "none", color, fontSize: 12, fontWeight: 600,
    cursor: "pointer", padding: "4px 8px", marginLeft: 4,
  };
}

// ─── Add/Edit modal ─────────────────────────────────────────────────────────

function ItemFormModal({ token, row, onClose, onDone }) {
  const isEdit = !!row;
  const [itemCode, setItemCode] = useState(row?.ITEM_CODE || "");
  const [description, setDescription] = useState(row?.DESCRIPTION || "");
  const [brand, setBrand] = useState(row?.BRAND || "");
  const [size, setSize] = useState(row?.SIZE || "");
  const [unit, setUnit] = useState(row?.UNIT || "");
  const [price, setPrice] = useState(row?.PRICE != null ? String(row.PRICE) : "");
  const [section, setSection] = useState(row?.SECTION || ITEM_SECTIONS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    if (!itemCode.trim()) return setError("Item Code wajib diisi.");
    if (!description.trim()) return setError("Description wajib diisi.");
    if (!(Number(price) >= 0)) return setError("Price harus berupa angka ≥ 0.");
    setSaving(true);
    try {
      const payload = {
        ITEM_CODE: itemCode.trim(), DESCRIPTION: description.trim(),
        BRAND: brand.trim() || null, SIZE: size.trim() || null, UNIT: unit.trim() || null,
        PRICE: Number(price) || 0, SECTION: section,
      };
      if (isEdit) {
        await updateMasterItem(token, { ...payload, ID_ITEM: row.ID_ITEM });
      } else {
        await createMasterItem(token, payload);
      }
      onDone(itemCode.trim());
    } catch (e) {
      setError(e.message || "Gagal menyimpan item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Edit Master Item" : "Tambah Master Item"}
      subtitle={isEdit ? row.ID_ITEM : "ID item dibuat otomatis"}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button onClick={submit} loading={saving}>{isEdit ? "Simpan Perubahan" : "Simpan Item"}</Button>
      </>}
    >
      <FormError>{error}</FormError>
      <Field label="Item Code">
        <TextInput value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="Contoh: BEV-001" autoFocus />
      </Field>
      <Field label="Description">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contoh: Air Mineral 600ml" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Brand (opsional)"><TextInput value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Size (opsional)"><TextInput value={size} onChange={(e) => setSize(e.target.value)} placeholder="600ml" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Unit (opsional)"><TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs / box" /></Field>
        <Field label="Price"><TextInput type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" /></Field>
      </div>
      <Field label="Section">
        <Select value={section} onChange={(e) => setSection(e.target.value)}>
          {ITEM_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}
