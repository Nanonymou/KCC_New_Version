// ═══════════════════════════════════════════════════════════════════════════
// KonversiInput.jsx
// Komponen bersama untuk mengisi Satuan Beli / Satuan Pakai / Konversi.
//
// Perilaku:
//  • Satuan dipilih dari dropdown bertingkat (Berat / Volume / Hitungan /
//    Kemasan) + satuan yang sudah pernah dipakai, tapi tetap boleh diketik
//    bebas kalau satuannya tidak ada di daftar.
//  • Untuk satuan baku sedimensi (kg→gram, liter→ml, lusin→pcs, …) angka
//    konversi DIHITUNG OTOMATIS dan field-nya dikunci; ada tombol kecil untuk
//    mengubahnya manual kalau memang perlu.
//  • Untuk satuan kemasan (pack, dus, karung…) konversi wajib manual, tapi
//    labelnya berubah jadi pertanyaan konkret: "1 pack berisi berapa pcs?"
//  • Selalu ada pratinjau: "1 kg = 1.000 gram · harga per gram Rp …" supaya
//    user bisa langsung lihat apakah angkanya masuk akal.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { Field, TextInput, Select } from "./FormKit";
import { UNIT_GROUPS, saranKonversi, formatAngka, normalizeUnit } from "./konversi";

// ─── Kalkulator kemasan bertingkat ──────────────────────────────────────────
// Untuk kasus seperti "1 bungkus = 5 pack, 1 pack = 55 lembar" — user tidak
// perlu mengalikan sendiri (5 × 55). Tiap baris = "1 [unit sebelumnya] =
// [qty] [unit]"; unit baris terakhir selalu satuan pakai (dikunci), unit
// baris lain bebas diketik (nama kemasan antara, mis. "pack", "dus").
function TingkatKalkulator({ satuanBeli, satuanPakai, onApply, onClose }) {
  const [steps, setSteps] = useState([{ unit: satuanPakai, qty: "" }]);

  // Baris terakhir selalu mengarah ke satuan pakai — sinkronkan kalau
  // satuan pakai berubah selagi kalkulator terbuka.
  useEffect(() => {
    setSteps(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], unit: satuanPakai };
      return next;
    });
  }, [satuanPakai]);

  const chain = [satuanBeli, ...steps.map(s => s.unit || "?")];
  const qtys  = steps.map(s => Number(s.qty));
  const semuaTerisi = qtys.every(q => q > 0);
  const total = semuaTerisi ? qtys.reduce((a, b) => a * b, 1) : null;

  function addLevel() {
    setSteps(prev => {
      const withoutLast = prev.slice(0, -1);
      const last = prev[prev.length - 1];
      return [...withoutLast, { unit: "", qty: "" }, { ...last, unit: satuanPakai }];
    });
  }
  function removeLevel(i) {
    setSteps(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i));
  }
  function updateStep(i, patch) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  return (
    <div style={{
      marginTop: -6, marginBottom: 14, padding: 12, borderRadius: 10,
      background: "rgba(201,100,66,0.05)", border: "1px solid rgba(201,100,66,0.25)",
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#d99a4e", marginBottom: 8 }}>
        🧮 Hitung dari tingkatan kemasan
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((step, i) => {
          const fromUnit = chain[i];
          const isLast = i === steps.length - 1;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "#a9a49a", whiteSpace: "nowrap" }}>
                1 <b>{fromUnit || "?"}</b> =
              </span>
              <div style={{ width: 80 }}>
                <TextInput
                  type="number" min="0" step="any" value={step.qty}
                  onChange={e => updateStep(i, { qty: e.target.value })}
                  placeholder="jumlah"
                />
              </div>
              {isLast ? (
                <span style={{ fontSize: 12.5, color: "#a9a49a" }}>{satuanPakai || "satuan pakai"}</span>
              ) : (
                <div style={{ width: 110 }}>
                  <TextInput
                    value={step.unit}
                    onChange={e => updateStep(i, { unit: e.target.value })}
                    placeholder="mis. pack"
                  />
                </div>
              )}
              {steps.length > 1 && (
                <button type="button" onClick={() => removeLevel(i)}
                  style={{ background: "none", border: "none", color: "#8a857b", cursor: "pointer", fontSize: 13, padding: "2px 4px" }}
                >✕</button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={addLevel}
          style={{
            fontSize: 11.5, fontWeight: 600, color: "#8a857b", background: "none",
            border: "1px dashed #4a453d", borderRadius: 6, padding: "4px 9px", cursor: "pointer",
          }}
        >+ Tambah tingkat kemasan</button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={onClose}
            style={{ fontSize: 11.5, color: "#8a857b", background: "none", border: "none", cursor: "pointer" }}
          >Batal</button>
          <button
            type="button"
            disabled={!total}
            onClick={() => onApply(total)}
            style={{
              fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7,
              color: total ? "#fff" : "#615d55",
              background: total ? "#c96442" : "rgba(255,255,255,0.05)",
              border: "none", cursor: total ? "pointer" : "not-allowed",
            }}
          >Gunakan {total ? `(${formatAngka(total)} ${satuanPakai})` : ""}</button>
        </div>
      </div>

      {qtys.length > 1 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#615d55" }}>
          1 {satuanBeli} = {chain.slice(0, -1).map((u, i) => `${qtys[i] || "?"} ${chain[i + 1] || "?"}`).join(" × ")}
          {total ? ` = ${formatAngka(total)} ${satuanPakai}` : ""}
        </div>
      )}
    </div>
  );
}

function UnitPicker({ value, onChange, extraUnits = [], placeholder }) {
  const CUSTOM = "__custom__";
  const known = useMemo(() => new Set(Object.values(UNIT_GROUPS).flat()), []);
  const extras = useMemo(
    () => [...new Set(extraUnits.map(normalizeUnit).filter(u => u && !known.has(u)))].sort(),
    [extraUnits, known]
  );
  const isCustom = value !== "" && !known.has(normalizeUnit(value)) && !extras.includes(normalizeUnit(value));

  return (
    <>
      <Select
        value={isCustom ? CUSTOM : normalizeUnit(value)}
        onChange={e => onChange(e.target.value === CUSTOM ? "" : e.target.value)}
      >
        <option value="">— pilih satuan —</option>
        {Object.entries(UNIT_GROUPS).map(([grup, units]) => (
          <optgroup key={grup} label={grup}>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </optgroup>
        ))}
        {extras.length > 0 && (
          <optgroup label="Pernah dipakai">
            {extras.map(u => <option key={u} value={u}>{u}</option>)}
          </optgroup>
        )}
        <option value={CUSTOM}>Satuan lain (ketik sendiri)…</option>
      </Select>
      {isCustom && (
        <div style={{ marginTop: 6 }}>
          <TextInput value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus />
        </div>
      )}
    </>
  );
}

export default function KonversiInput({
  satuanBeli, setSatuanBeli,
  satuanPakai, setSatuanPakai,
  konversi, setKonversi,
  manual, setManual,           // true = user memaksa isi konversi sendiri
  harga,                       // opsional, untuk pratinjau harga per satuan pakai
  unitOptions = { beli: [], pakai: [] },
}) {
  const [showCalc, setShowCalc] = useState(false);
  const saran = useMemo(() => saranKonversi(satuanBeli, satuanPakai), [satuanBeli, satuanPakai]);
  const otomatis = (saran.mode === "otomatis" || saran.mode === "sama") && !manual;

  // Begitu pasangan satuan menghasilkan konversi pasti, isi otomatis.
  useEffect(() => {
    if (!otomatis) return;
    if (saran.value != null && String(saran.value) !== String(konversi)) {
      setKonversi(String(saran.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otomatis, saran.value]);

  const konvNum = Number(konversi);
  const hargaNum = Number(harga);
  const hargaPerPakai = konvNum > 0 && hargaNum > 0 ? hargaNum / konvNum : null;

  const bisaPreview = satuanBeli && satuanPakai && konvNum > 0;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Satuan Beli" hint="Satuan saat membeli dari supplier">
          <UnitPicker
            value={satuanBeli} onChange={setSatuanBeli}
            extraUnits={unitOptions.beli} placeholder="mis. karung"
          />
        </Field>
        <Field label="Satuan Pakai" hint="Satuan saat dipakai di resep">
          <UnitPicker
            value={satuanPakai} onChange={setSatuanPakai}
            extraUnits={unitOptions.pakai} placeholder="mis. lembar"
          />
        </Field>
      </div>

      <Field
        label={otomatis ? "Konversi (otomatis)" : (saran.tanya || "Konversi")}
        hint={saran.pesan}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <TextInput
              type="number" min="0" step="any" value={konversi}
              disabled={otomatis}
              onChange={e => setKonversi(e.target.value)}
              placeholder={saran.mode === "manual" ? "isi angkanya" : "1"}
              style={otomatis ? { opacity: 0.75, cursor: "not-allowed" } : undefined}
            />
          </div>
          {(saran.mode === "otomatis" || saran.mode === "sama") && (
            <button
              type="button"
              onClick={() => setManual(!manual)}
              style={{
                flexShrink: 0, padding: "8px 11px", fontSize: 11.5, fontWeight: 600,
                color: manual ? "#c96442" : "#8a857b",
                background: manual ? "rgba(201,100,66,0.12)" : "transparent",
                border: "1px solid " + (manual ? "#c96442" : "#3a3834"),
                borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >{manual ? "Pakai otomatis" : "Ubah manual"}</button>
          )}
        </div>
      </Field>

      {/* Untuk satuan kemasan tanpa acuan baku (mis. "1 bungkus berisi 5
          pack, 1 pack berisi 55 lembar") — bantu hitung bertingkat, jangan
          suruh user mengalikan sendiri. */}
      {saran.mode === "manual" && satuanBeli && satuanPakai && !showCalc && (
        <button
          type="button"
          onClick={() => setShowCalc(true)}
          style={{
            display: "block", marginTop: -8, marginBottom: 14, fontSize: 12, fontWeight: 600,
            color: "#d99a4e", background: "none", border: "none", cursor: "pointer", padding: 0,
            textDecoration: "underline", textUnderlineOffset: 3,
          }}
        >🧮 Tidak tahu isinya langsung? Hitung dari tingkatan kemasan</button>
      )}
      {saran.mode === "manual" && showCalc && (
        <TingkatKalkulator
          satuanBeli={satuanBeli}
          satuanPakai={satuanPakai}
          onClose={() => setShowCalc(false)}
          onApply={(total) => {
            setKonversi(String(total));
            setManual(true);
            setShowCalc(false);
          }}
        />
      )}

      {bisaPreview && (
        <div style={{
          marginTop: -6, marginBottom: 14, padding: "9px 12px", borderRadius: 8,
          background: "rgba(110,163,196,0.08)", border: "1px solid rgba(110,163,196,0.28)",
          fontSize: 12, color: "#9dbdd4", lineHeight: 1.6,
        }}>
          <div>
            📐 1 <b>{satuanBeli}</b> = <b>{formatAngka(konvNum)} {satuanPakai}</b>
          </div>
          {hargaPerPakai != null && (
            <div>
              💰 Harga per {satuanPakai}: <b>Rp {formatAngka(Math.round(hargaPerPakai * 100) / 100)}</b>
              {" "}— inilah angka yang dipakai menghitung HPP resep.
            </div>
          )}
        </div>
      )}
    </>
  );
}
