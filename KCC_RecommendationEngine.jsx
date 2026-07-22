import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  PRODUK,
  PENJUALAN_HARI_INI,
  STOK_BAHAN,
  SUPPLIER_DATA,
  THRESHOLDS,
  fetchBahan,
  fetchStok,
  fetchSupplier,
  fetchDashboard,
  recalcSemua,
  hitungFoodCostHariIni,
  round2, idr, pct,
} from "./kcc_data_layer";


// ═══════════════════════════════════════════════════════════════════════════
// ██████████████████████████████████████████████████████████████████████████
//
//   RECOMMENDATION ENGINE — PURE RULE-BASED, MODULAR
//   Setiap modul berdiri sendiri: input → output tanpa shared state
//
// ██████████████████████████████████████████████████████████████████████████
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tipe rekomendasi:
 *   priority: "KRITIS" | "PERINGATAN" | "SARAN" | "OK"
 *   category: string — nama modul pemicu
 *   action:   string — tindakan yang direkomendasikan
 *   detail:   string — penjelasan konteks
 *   data:     object — data mentah untuk referensi
 */

// ─────────────────────────────────────────────────────────────────────────
// MODUL 1 — MARGIN RULE
// Trigger: margin produk < TARGET atau < KRITIS
// Action : Sarankan kenaikan harga jual atau efisiensi bahan
// ─────────────────────────────────────────────────────────────────────────
function runMarginRules(produkHPP) {
  const recs = [];

  produkHPP.forEach(p => {
    const margin = p.MARGIN_PCT;

    if (margin < THRESHOLDS.MARGIN_KRITIS_PCT) {
      // Rule 1a — Margin KRITIS (< 30%)
      const hargaMinimum = Math.ceil(p.HPP_PER_PCS / (1 - THRESHOLDS.MARGIN_TARGET_PCT / 100));
      const selisih      = hargaMinimum - p.HARGA_JUAL;
      recs.push({
        id:       `MARGIN-KRITIS-${p.ID_PRODUK}`,
        priority: "KRITIS",
        category: "Margin Produk",
        icon:     "📉",
        produk:   p.NAMA_PRODUK,
        action:   `Naikkan harga jual ${p.NAMA_PRODUK} minimal ${idr(selisih)} → menjadi ${idr(hargaMinimum)}`,
        detail:   `Margin saat ini ${pct(margin)} — jauh di bawah target ${pct(THRESHOLDS.MARGIN_TARGET_PCT)}. HPP per pcs ${idr(p.HPP_PER_PCS)}, harga jual saat ini ${idr(p.HARGA_JUAL)}.`,
        data:     { margin, hpp: p.HPP_PER_PCS, hargaJual: p.HARGA_JUAL, hargaMinimum },
      });

    } else if (margin < THRESHOLDS.MARGIN_TARGET_PCT) {
      // Rule 1b — Margin DI BAWAH TARGET (< 50%)
      const hargaIdeal = Math.ceil(p.HPP_PER_PCS / (1 - THRESHOLDS.MARGIN_TARGET_PCT / 100));
      recs.push({
        id:       `MARGIN-RENDAH-${p.ID_PRODUK}`,
        priority: "PERINGATAN",
        category: "Margin Produk",
        icon:     "⚠️",
        produk:   p.NAMA_PRODUK,
        action:   `Pertimbangkan kenaikan harga ${p.NAMA_PRODUK} ke ${idr(hargaIdeal)} untuk mencapai target margin`,
        detail:   `Margin ${pct(margin)} belum mencapai target ${pct(THRESHOLDS.MARGIN_TARGET_PCT)}. Selisih HPP vs harga jual: ${idr(p.MARGIN_RP)}/pcs.`,
        data:     { margin, hpp: p.HPP_PER_PCS, hargaJual: p.HARGA_JUAL, hargaIdeal },
      });
    }
    // margin >= TARGET → tidak ada rekomendasi (OK)
  });

  return recs;
}

// ─────────────────────────────────────────────────────────────────────────
// MODUL 2 — STOK MINIMUM RULE
// Trigger: stok bahan < MIN_STOK (kritis) atau mendekati min (peringatan)
// Action : Sarankan pembelian segera atau reorder
// ─────────────────────────────────────────────────────────────────────────
function runStokRules(bahanList, stokList) {
  const recs    = [];
  const bahanMap = {};
  bahanList.forEach(b => { bahanMap[b.ID_BAHAN] = b; });

  stokList.forEach(s => {
    const bahan  = bahanMap[s.ID_BAHAN];
    if (!bahan) return;
    const rasio  = s.MIN_STOK > 0 ? s.STOK / s.MIN_STOK : 999;
    const selisih = Math.max(0, s.MIN_STOK - s.STOK);

    if (rasio < THRESHOLDS.STOK_KRITIS_RASIO) {
      // Rule 2a — STOK HABIS / DI BAWAH MINIMUM
      recs.push({
        id:       `STOK-KRITIS-${s.ID_BAHAN}`,
        priority: "KRITIS",
        category: "Stok Bahan",
        icon:     "🚨",
        produk:   bahan.NAMA_BAHAN,
        action:   `Beli segera ${bahan.NAMA_BAHAN} — tambah minimal ${(selisih * 2).toFixed(1)} ${bahan.SATUAN_BELI} hari ini`,
        detail:   `Stok ${s.STOK} ${bahan.SATUAN_BELI} sudah DI BAWAH minimum ${s.MIN_STOK} ${bahan.SATUAN_BELI}. Produksi bisa terhenti.`,
        data:     { stok: s.STOK, minStok: s.MIN_STOK, rasio: round2(rasio), selisih },
      });

    } else if (rasio < THRESHOLDS.STOK_AMAN_RASIO) {
      // Rule 2b — STOK MENDEKATI MINIMUM
      recs.push({
        id:       `STOK-RENDAH-${s.ID_BAHAN}`,
        priority: "PERINGATAN",
        category: "Stok Bahan",
        icon:     "📦",
        produk:   bahan.NAMA_BAHAN,
        action:   `Jadwalkan pembelian ${bahan.NAMA_BAHAN} dalam 1–2 hari ke depan`,
        detail:   `Stok ${s.STOK} ${bahan.SATUAN_BELI} mendekati batas minimum ${s.MIN_STOK} ${bahan.SATUAN_BELI} (rasio ${pct(rasio * 100)}).`,
        data:     { stok: s.STOK, minStok: s.MIN_STOK, rasio: round2(rasio) },
      });
    }
    // rasio >= AMAN_RASIO → tidak ada rekomendasi
  });

  return recs;
}

// ─────────────────────────────────────────────────────────────────────────
// MODUL 3 — HARGA SUPPLIER RULE
// Trigger: harga bahan naik > threshold vs harga sebelumnya
// Action : Sarankan supplier alternatif dengan harga lebih murah
// ─────────────────────────────────────────────────────────────────────────
function runSupplierRules(bahanList, supplierList) {
  const recs = [];

  bahanList.forEach(bahan => {
    const hargaSekarang     = bahan.HARGA_RATA2;
    const hargaSebelumnya   = bahan.HARGA_SEBELUMNYA || hargaSekarang;
    const kenaikanPct       = hargaSebelumnya > 0
      ? round2(((hargaSekarang - hargaSebelumnya) / hargaSebelumnya) * 100)
      : 0;

    if (kenaikanPct < THRESHOLDS.HARGA_NAIK_MIN_PCT) return; // tidak naik signifikan

    // Cari supplier alternatif yang lebih murah dari harga saat ini
    const supplierBahan = supplierList
      .filter(s => s.ID_BAHAN === bahan.ID_BAHAN)
      .sort((a, b) => a.HARGA - b.HARGA);

    const supplierTermurah = supplierBahan[0] || null;
    const adaAlternatifLebihMurah =
      supplierTermurah && supplierTermurah.HARGA < hargaSekarang;

    const priority = kenaikanPct >= THRESHOLDS.HARGA_NAIK_KRITIS_PCT ? "KRITIS" : "PERINGATAN";

    if (adaAlternatifLebihMurah) {
      // Rule 3a — HARGA NAIK, ADA ALTERNATIF LEBIH MURAH
      const hemat = hargaSekarang - supplierTermurah.HARGA;
      recs.push({
        id:       `SUPPLIER-GANTI-${bahan.ID_BAHAN}`,
        priority,
        category: "Harga Supplier",
        icon:     "🔄",
        produk:   bahan.NAMA_BAHAN,
        action:   `Ganti ke ${supplierTermurah.NAMA_SUPPLIER} (${supplierTermurah.KOTA}) — hemat ${idr(hemat)}/kg`,
        detail:   `Harga ${bahan.NAMA_BAHAN} naik ${pct(kenaikanPct)} (${idr(hargaSebelumnya)} → ${idr(hargaSekarang)}). ${supplierTermurah.NAMA_SUPPLIER} menawarkan ${idr(supplierTermurah.HARGA)}/kg.`,
        data:     { kenaikanPct, hargaSekarang, hargaSebelumnya, supplierTermurah, hemat },
      });
    } else {
      // Rule 3b — HARGA NAIK, BELUM ADA ALTERNATIF YANG LEBIH MURAH
      recs.push({
        id:       `SUPPLIER-NAIK-${bahan.ID_BAHAN}`,
        priority: "PERINGATAN",
        category: "Harga Supplier",
        icon:     "📈",
        produk:   bahan.NAMA_BAHAN,
        action:   `Negosiasikan harga ${bahan.NAMA_BAHAN} dengan supplier saat ini atau cari supplier baru`,
        detail:   `Harga naik ${pct(kenaikanPct)} (${idr(hargaSebelumnya)} → ${idr(hargaSekarang)}). Belum ada supplier alternatif yang lebih murah di database.`,
        data:     { kenaikanPct, hargaSekarang, hargaSebelumnya },
      });
    }
  });

  return recs;
}

// ─────────────────────────────────────────────────────────────────────────
// MODUL 4 — FOOD COST RULE
// Trigger: food cost hari ini > TARGET atau > KRITIS
// Action : Warning dashboard + rekomendasi menu atau efisiensi
// ─────────────────────────────────────────────────────────────────────────
function runFoodCostRules(foodCostPct, produkHPP) {
  const recs = [];

  if (foodCostPct > THRESHOLDS.FOOD_COST_KRITIS_PCT) {
    // Rule 4a — FOOD COST KRITIS
    // Sub-rule: identifikasi produk kontributor terbesar
    const jualMap = {};
    PENJUALAN_HARI_INI.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });

    const kontributor = produkHPP
      .map(p => {
        const qty = jualMap[p.ID_PRODUK] || 0;
        return {
          nama:       p.NAMA_PRODUK,
          foodCostPcs: round2(p.HPP_PER_PCS / p.HARGA_JUAL * 100),
          totalHPP:   p.HPP_PER_PCS * qty,
        };
      })
      .sort((a, b) => b.foodCostPcs - a.foodCostPcs);

    const terburuk = kontributor[0];

    recs.push({
      id:       "FOODCOST-KRITIS",
      priority: "KRITIS",
      category: "Food Cost",
      icon:     "🔥",
      produk:   "Semua Produk",
      action:   `DARURAT: Food Cost ${pct(foodCostPct)} — kurangi porsi bahan mahal atau stop promo produk ${terburuk?.nama}`,
      detail:   `Food Cost hari ini ${pct(foodCostPct)} melampaui batas kritis ${pct(THRESHOLDS.FOOD_COST_KRITIS_PCT)}. Produk dengan food cost tertinggi: ${terburuk?.nama} (${pct(terburuk?.foodCostPcs)}).`,
      data:     { foodCostPct, target: THRESHOLDS.FOOD_COST_KRITIS_PCT, kontributor },
    });

  } else if (foodCostPct > THRESHOLDS.FOOD_COST_TARGET_PCT) {
    // Rule 4b — FOOD COST DI ATAS TARGET
    const selisih = round2(foodCostPct - THRESHOLDS.FOOD_COST_TARGET_PCT);
    recs.push({
      id:       "FOODCOST-TINGGI",
      priority: "PERINGATAN",
      category: "Food Cost",
      icon:     "⚡",
      produk:   "Semua Produk",
      action:   `Periksa efisiensi resep — Food Cost perlu diturunkan ${pct(selisih)} untuk mencapai target`,
      detail:   `Food Cost hari ini ${pct(foodCostPct)}, melebihi target ${pct(THRESHOLDS.FOOD_COST_TARGET_PCT)}. Tinjau penggunaan bahan mahal atau sesuaikan porsi resep.`,
      data:     { foodCostPct, target: THRESHOLDS.FOOD_COST_TARGET_PCT, selisih },
    });
  }
  // food cost <= TARGET → aman, tidak ada rekomendasi

  return recs;
}

// ─────────────────────────────────────────────────────────────────────────
// MODUL 5 — PRODUK TIDAK MENGUNTUNGKAN RULE
// Trigger: produk dengan margin OK tapi volume sangat rendah
// Action : Saran promosi atau review menu
// ─────────────────────────────────────────────────────────────────────────
function runProdukRules(produkHPP) {
  const recs = [];
  const jualMap = {};
  PENJUALAN_HARI_INI.forEach(j => { jualMap[j.ID_PRODUK] = j.QTY; });

  const totalQty = PENJUALAN_HARI_INI.reduce((s, j) => s + j.QTY, 0);
  const avgQty   = totalQty / PENJUALAN_HARI_INI.length;

  produkHPP.forEach(p => {
    const qty        = jualMap[p.ID_PRODUK] || 0;
    const shareQty   = totalQty > 0 ? (qty / totalQty) * 100 : 0;
    const totalProfit = p.MARGIN_RP * qty;

    // Rule 5a — Volume sangat rendah padahal margin bagus
    if (qty < avgQty * 0.5 && p.MARGIN_PCT >= THRESHOLDS.MARGIN_TARGET_PCT) {
      recs.push({
        id:       `PRODUK-VOL-RENDAH-${p.ID_PRODUK}`,
        priority: "SARAN",
        category: "Performa Produk",
        icon:     "💡",
        produk:   p.NAMA_PRODUK,
        action:   `Promosikan ${p.NAMA_PRODUK} — margin tinggi (${pct(p.MARGIN_PCT)}) tapi volume hanya ${qty} pcs (${pct(shareQty)} dari total)`,
        detail:   `Produk ini menghasilkan profit ${idr(totalProfit)}/hari dengan margin baik. Volume rendah berarti potensi profit belum teroptimalkan.`,
        data:     { qty, avgQty: round2(avgQty), shareQty: round2(shareQty), marginPct: p.MARGIN_PCT, totalProfit },
      });
    }

    // Rule 5b — Margin sangat rendah DAN volume tinggi (double problem)
    if (qty > avgQty * 1.3 && p.MARGIN_PCT < THRESHOLDS.MARGIN_KRITIS_PCT) {
      recs.push({
        id:       `PRODUK-LARIS-RUGI-${p.ID_PRODUK}`,
        priority: "KRITIS",
        category: "Performa Produk",
        icon:     "❗",
        produk:   p.NAMA_PRODUK,
        action:   `${p.NAMA_PRODUK} laris tapi margin KRITIS — naikkan harga SEGERA atau kerjakan ulang resepnya`,
        detail:   `Produk terjual ${qty} pcs (${pct(shareQty)} dari total) tapi margin hanya ${pct(p.MARGIN_PCT)}. Makin banyak terjual, kerugian makin besar.`,
        data:     { qty, avgQty: round2(avgQty), marginPct: p.MARGIN_PCT },
      });
    }
  });

  return recs;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE ENGINE ORCHESTRATOR
// Menjalankan semua modul dan mengagregasikan hasilnya
// ═══════════════════════════════════════════════════════════════════════════
const PRIORITY_ORDER = { KRITIS: 0, PERINGATAN: 1, SARAN: 2, OK: 3 };

function runAllRules(bahanList = INITIAL_BAHAN, stokList = STOK_BAHAN, supplierList = SUPPLIER_DATA) {
  const produkHPP    = recalcSemua(bahanList);
  const foodCostPct  = hitungFoodCostHariIni(produkHPP);

  // Jalankan semua modul
  const semua = [
    ...runFoodCostRules(foodCostPct, produkHPP),   // Food Cost — prioritas pertama
    ...runMarginRules(produkHPP),                  // Margin per produk
    ...runStokRules(bahanList, stokList),           // Stok minimum
    ...runSupplierRules(bahanList, supplierList),   // Harga supplier naik
    ...runProdukRules(produkHPP),                  // Volume vs margin
  ];

  // Sort berdasarkan prioritas
  semua.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    return pa - pb;
  });

  return {
    rekomendasi:  semua,
    summary: {
      total:      semua.length,
      kritis:     semua.filter(r => r.priority === "KRITIS").length,
      peringatan: semua.filter(r => r.priority === "PERINGATAN").length,
      saran:      semua.filter(r => r.priority === "SARAN").length,
      foodCostPct,
      produkHPP,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

const PRIORITY_CONFIG = {
  KRITIS:     { color: "#d1685c", bg: "#2a1d1a", border: "#d1685c33", badge: "#d1685c", label: "KRITIS"     },
  PERINGATAN: { color: "#d99a4e", bg: "#2a241c", border: "#d99a4e33", badge: "#d99a4e", label: "PERINGATAN" },
  SARAN:      { color: "#6ea3c4", bg: "#211f1d", border: "#6ea3c433", badge: "#6ea3c4", label: "SARAN"      },
  OK:         { color: "#7fa86a", bg: "#22271f", border: "#7fa86a33", badge: "#7fa86a", label: "OK"         },
};

function Badge({ priority }) {
  const c = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.OK;
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
      color: c.badge, background: c.badge + "20",
      border: `1px solid ${c.badge}44`,
      padding: "2px 7px", borderRadius: 99,
      textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      {c.label}
    </span>
  );
}

function SummaryCard({ label, value, color, icon }) {
  return (
    <div style={{
      background: "#211f1d", border: `1px solid ${color}33`,
      borderRadius: 12, padding: "14px 18px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8a857b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

function RekomendasiCard({ rec, index }) {
  const [expanded, setExpanded] = useState(false);
  const c = PRIORITY_CONFIG[rec.priority] || PRIORITY_CONFIG.OK;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: expanded ? c.bg : "#1f1e1c",
        border: `1px solid ${expanded ? c.color + "44" : "#3a3834"}`,
        borderLeft: `3px solid ${c.color}`,
        borderRadius: 10, padding: "14px 16px",
        cursor: "pointer", transition: "all 0.2s ease",
        marginBottom: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{rec.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <Badge priority={rec.priority} />
            <span style={{ fontSize: 10, color: "#78746b", background: "#302f2c", padding: "2px 7px", borderRadius: 99, border: "1px solid #3a3834" }}>
              {rec.category}
            </span>
            <span style={{ fontSize: 10, color: "#8a857b" }}>{rec.produk}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#ecebe5", lineHeight: 1.45 }}>
            {rec.action}
          </div>
        </div>
        <span style={{ fontSize: 12, color: "#615d55", flexShrink: 0, marginTop: 2 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: `1px solid ${c.color}22`,
          fontSize: 12, color: "#a9a49a", lineHeight: 1.6,
        }}>
          {rec.detail}
        </div>
      )}
    </div>
  );
}

function FoodCostGauge({ value }) {
  const target = THRESHOLDS.FOOD_COST_TARGET_PCT;
  const kritis = THRESHOLDS.FOOD_COST_KRITIS_PCT;
  const max    = 50;
  const pctPos = Math.min(value / max * 100, 100);
  const color  = value > kritis ? "#d1685c" : value > target ? "#d99a4e" : "#7fa86a";
  const label  = value > kritis ? "DARURAT" : value > target ? "TINGGI" : "AMAN";

  return (
    <div style={{ background: "#211f1d", border: "1px solid #3a3834", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "#8a857b", textTransform: "uppercase", letterSpacing: "0.06em" }}>Food Cost Hari Ini</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, background: color + "20", padding: "2px 8px", borderRadius: 99 }}>{label}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, marginBottom: 10, fontVariantNumeric: "tabular-nums" }}>
        {pct(value)}
      </div>
      {/* Bar gauge */}
      <div style={{ height: 8, background: "#3a3834", borderRadius: 99, overflow: "hidden", position: "relative" }}>
        <div style={{ height: "100%", width: `${pctPos}%`, background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
        {/* Target marker */}
        <div style={{ position: "absolute", top: 0, left: `${target / max * 100}%`, width: 2, height: "100%", background: "#7fa86a88" }} />
        <div style={{ position: "absolute", top: 0, left: `${kritis / max * 100}%`, width: 2, height: "100%", background: "#d1685c88" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "#615d55" }}>
        <span>0%</span>
        <span style={{ color: "#7fa86a88" }}>Target {pct(target)}</span>
        <span style={{ color: "#d1685c88" }}>Kritis {pct(kritis)}</span>
        <span>{pct(max)}</span>
      </div>
    </div>
  );
}

function RuleModuleList({ recs, filter }) {
  const filtered = filter === "SEMUA" ? recs : recs.filter(r => r.priority === filter);
  if (filtered.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#615d55" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
        <div style={{ fontSize: 13 }}>Tidak ada rekomendasi untuk kategori ini</div>
      </div>
    );
  }
  return filtered.map((rec, i) => <RekomendasiCard key={rec.id} rec={rec} index={i} />);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function KCCRecommendationEngine() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState("SEMUA");

  const [bahanList,    setBahanList]    = useState(INITIAL_BAHAN);
  const [stokList,     setStokList]     = useState(STOK_BAHAN);
  const [supplierList, setSupplierList] = useState(SUPPLIER_DATA);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchBahan(token),
      fetchStok(token),
      fetchSupplier(token),
      fetchDashboard(token),
    ]).then(([bahanData, stokData, supplierData]) => {
      if (bahanData)    setBahanList(bahanData);
      if (stokData)     setStokList(stokData);
      if (supplierData) setSupplierList(supplierData);
    });
  }, [token]);

  const { rekomendasi, summary } = useMemo(
    () => runAllRules(bahanList, stokList, supplierList),
    [bahanList, stokList, supplierList]
  );

  const tabs = [
    { key: "SEMUA",     label: `Semua (${summary.total})`,             color: "#a9a49a" },
    { key: "KRITIS",    label: `🔴 Kritis (${summary.kritis})`,        color: "#d1685c" },
    { key: "PERINGATAN",label: `🟡 Peringatan (${summary.peringatan})`,color: "#d99a4e" },
    { key: "SARAN",     label: `🔵 Saran (${summary.saran})`,          color: "#6ea3c4" },
  ];

  return (
    <div>
      <style>{`
        @keyframes fadein { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.3} }
        .rec-grid { display:grid; gap:12px; animation:fadein 0.35s ease both; }
        .rec-4col { grid-template-columns:repeat(4,1fr); }
        @media(max-width:900px){ .rec-4col{ grid-template-columns:repeat(2,1fr); } }
        @media(max-width:540px){ .rec-4col{ grid-template-columns:1fr 1fr; } }
      `}</style>

      {/* Alert kritis — tampil di atas konten jika ada masalah */}
      {summary.kritis > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
          background: "rgba(209,104,92,0.1)", border: "1px solid rgba(209,104,92,0.3)",
          borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#dd8078", fontWeight: 600,
        }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#d1685c", animation: "pulse 1s infinite" }} />
          {summary.kritis} masalah kritis perlu tindakan segera
        </div>
      )}

        {/* ── SUMMARY CARDS ── */}
        <div className="rec-grid rec-4col" style={{ marginBottom: 20 }}>
          <SummaryCard label="Total Rekomendasi" value={summary.total}      color="#a9a49a" icon="📋" />
          <SummaryCard label="Kritis"             value={summary.kritis}     color="#d1685c" icon="🚨" />
          <SummaryCard label="Peringatan"         value={summary.peringatan} color="#d99a4e" icon="⚠️" />
          <SummaryCard label="Saran"              value={summary.saran}      color="#6ea3c4" icon="💡" />
        </div>

        {/* ── FOOD COST GAUGE ── */}
        <div style={{ marginBottom: 20 }}>
          <FoodCostGauge value={summary.foodCostPct} />
        </div>

        {/* ── RULE MODULES INFO ── */}
        <div style={{
          background: "#211f1d", border: "1px solid #3a3834",
          borderRadius: 12, padding: "14px 18px", marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#78746b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Modul Rule Engine Aktif
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              { icon: "📉", label: "Margin Produk",     desc: `< ${THRESHOLDS.MARGIN_TARGET_PCT}% target` },
              { icon: "📦", label: "Stok Minimum",      desc: "stok < min stok" },
              { icon: "🔄", label: "Harga Supplier",    desc: `naik > ${THRESHOLDS.HARGA_NAIK_MIN_PCT}%` },
              { icon: "🔥", label: "Food Cost",         desc: `> ${THRESHOLDS.FOOD_COST_TARGET_PCT}% target` },
              { icon: "💡", label: "Performa Produk",   desc: "volume vs margin" },
            ].map(m => (
              <div key={m.label} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "#1f1e1c", border: "1px solid #3a3834",
                borderRadius: 8, padding: "6px 10px", fontSize: 11,
              }}>
                <span>{m.icon}</span>
                <span style={{ color: "#ecebe5", fontWeight: 600 }}>{m.label}</span>
                <span style={{ color: "#615d55" }}>— {m.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── FILTER TABS ── */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: 600,
                borderRadius: 8, border: "1px solid",
                cursor: "pointer", transition: "all 0.15s",
                background:   activeTab === t.key ? t.color + "20" : "#211f1d",
                color:        activeTab === t.key ? t.color         : "#78746b",
                borderColor:  activeTab === t.key ? t.color + "55"  : "#3a3834",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── RECOMMENDATION LIST ── */}
        <div style={{ animation: "fadein 0.3s ease both" }}>
          <RuleModuleList recs={rekomendasi} filter={activeTab} />
        </div>

        {/* ── FOOTER ── */}
        <div style={{ marginTop: 24, padding: "16px 0", borderTop: "1px solid #3a3834", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "#615d55" }}>
            Rule-Based · Tidak menggunakan AI
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#615d55" }}>
            <span>Margin target: {THRESHOLDS.MARGIN_TARGET_PCT}%</span>
            <span>Food cost target: {THRESHOLDS.FOOD_COST_TARGET_PCT}%</span>
            <span>Kenaikan supplier: ≥{THRESHOLDS.HARGA_NAIK_MIN_PCT}%</span>
          </div>
        </div>
    </div>
  );
}
