import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  INITIAL_BAHAN,
  PRODUK,
  SIMULASI_SKENARIO,
  fetchBahan,
  fetchProduk,
  recalcSemua,
  round2,
  idr, pct, marginColor,
} from "./kcc_data_layer";

export default function HPPEngine() {
  const { token } = useAuth();
  const [bahan, setBahan]           = useState(INITIAL_BAHAN);
  const [produkList, setProdukList] = useState(PRODUK);
  const [produkHPP, setProdukHPP]   = useState(() => recalcSemua(INITIAL_BAHAN));
  const [selectedProduk, setSelectedProduk] = useState(null);
  const [log, setLog]               = useState([]);
  const [simAktif, setSimAktif]     = useState(null);
  const [simBahan, setSimBahan]     = useState(null);  // harga bahan saat simulasi
  const [simHPP, setSimHPP]         = useState(null);  // hasil HPP simulasi
  const [tab, setTab]               = useState("dashboard"); // dashboard | hpp | detail | simulasi
  const [editHarga, setEditHarga]   = useState(null);
  const [editVal, setEditVal]       = useState("");
  const prevHPPRef                  = useRef({});

  // ── Live data fetch on mount (GAS) ──────────────────────────
  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchBahan(token),
      fetchProduk(token),
    ]).then(([bahanData, produkData]) => {
      if (bahanData)  setBahan(bahanData);
      if (produkData) setProdukList(produkData);
    });
  }, [token]);

  // ── REACTIVE: setiap bahan berubah → recalc otomatis ──
  useEffect(() => {
    const hasil = recalcSemua(bahan);

    // Deteksi perubahan untuk log
    hasil.forEach(p => {
      const prev = prevHPPRef.current[p.ID_PRODUK];
      if (prev && prev.HPP_PER_PCS !== p.HPP_PER_PCS) {
        const selisih = p.HPP_PER_PCS - prev.HPP_PER_PCS;
        const persen  = prev.HPP_PER_PCS > 0
          ? ((selisih / prev.HPP_PER_PCS) * 100).toFixed(1)
          : "—";
        addLog(
          selisih > 0 ? "naik" : "turun",
          `${p.NAMA_PRODUK}: HPP ${selisih > 0 ? "naik" : "turun"} ${Math.abs(persen)}% → ${idr(p.HPP_PER_PCS)}/pcs | margin ${pct(p.MARGIN_PCT)}`
        );
      }
    });

    prevHPPRef.current = {};
    hasil.forEach(p => { prevHPPRef.current[p.ID_PRODUK] = p; });
    setProdukHPP(hasil);
  }, [bahan]);

  // ── Simulasi: hitung tanpa simpan ──
  useEffect(() => {
    if (!simBahan) { setSimHPP(null); return; }
    setSimHPP(recalcSemua(simBahan));
  }, [simBahan]);

  const addLog = useCallback((tipe, pesan) => {
    const ts = new Date().toLocaleTimeString("id-ID");
    setLog(prev => [{ ts, tipe, pesan, id: Date.now() + Math.random() }, ...prev].slice(0, 40));
  }, []);

  // ── Update harga satu bahan → engine langsung jalan ──
  const updateHargaBahan = (idBahan, hargaBaru) => {
    const h = Number(hargaBaru);
    if (isNaN(h) || h <= 0) return;
    setBahan(prev => {
      const updated = prev.map(b =>
        b.ID_BAHAN === idBahan ? { ...b, HARGA_RATA2: h } : b
      );
      const bObj = updated.find(b => b.ID_BAHAN === idBahan);
      addLog("update", `Harga ${bObj?.NAMA_BAHAN} diubah → ${idr(h)}/${bObj?.SATUAN_BELI}`);
      return updated;
    });
  };

  // ── Jalankan skenario simulasi ──
  const jalankanSimulasi = (skenario) => {
    setSimAktif(skenario.id);
    const simB = bahan.map(b => {
      const ov = skenario.perubahan.find(p => p.ID_BAHAN === b.ID_BAHAN);
      if (!ov) return b;
      const hargaBaru = ov.reset
        ? INITIAL_BAHAN.find(ib => ib.ID_BAHAN === b.ID_BAHAN)?.HARGA_RATA2 ?? b.HARGA_RATA2
        : round2(b.HARGA_RATA2 * ov.faktor);
      return { ...b, HARGA_RATA2: hargaBaru };
    });
    setSimBahan(simB);
    addLog("sim", `Simulasi: "${skenario.label}" — ${skenario.desc}`);
  };

  // ── Terapkan simulasi ke data nyata ──
  const terapkanSimulasi = () => {
    if (!simBahan) return;
    setBahan(simBahan);
    addLog("apply", `Simulasi diterapkan ke data aktual`);
    setSimAktif(null);
    setSimBahan(null);
    setTab("dashboard");
  };

  const resetSimulasi = () => {
    setSimAktif(null);
    setSimBahan(null);
    setSimHPP(null);
  };

  // ── Statistik dashboard ──
  const avgMargin = produkHPP.length > 0
    ? round2(produkHPP.reduce((s, p) => s + p.MARGIN_PCT, 0) / produkHPP.length)
    : 0;
  const produkKritis = produkHPP.filter(p => p.MARGIN_PCT < 20);
  const produkSehat  = produkHPP.filter(p => p.MARGIN_PCT >= 50);

  const selectedDetail = selectedProduk
    ? produkHPP.find(p => p.ID_PRODUK === selectedProduk)
    : null;

  // ─────────────────────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────────────────────
  const S = {
    navBtn: (active) => ({
      padding: "10px 14px",
      fontSize: 13, fontWeight: active ? 600 : 400,
      color: active ? "#c96442" : "#8a857b",
      background: "none", border: "none", cursor: "pointer",
      borderBottom: active ? "2px solid #c96442" : "2px solid transparent",
      transition: "all 0.15s", whiteSpace: "nowrap",
    }),
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
    grid3: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 },
    card: {
      background: "#2b2926", border: "1px solid #3a3834", borderRadius: 12,
      padding: 20,
    },
    cardTitle: { fontSize: 12, color: "#8a857b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 },
    bigNum: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "#ecebe5" },
    sub: { fontSize: 12, color: "#78746b", marginTop: 4 },
    table: { width: "100%", borderCollapse: "collapse" },
    th: { padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#78746b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #3a3834" },
    td: { padding: "11px 12px", fontSize: 13, borderBottom: "1px solid #2b2926", verticalAlign: "middle" },
    badge: (color) => ({
      display: "inline-block", padding: "2px 8px", borderRadius: 20,
      fontSize: 11, fontWeight: 700, color,
      background: color + "20", border: `1px solid ${color}40`,
    }),
    btn: (variant = "primary") => ({
      padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
      cursor: "pointer", transition: "all 0.15s",
      background: variant === "primary" ? "#c96442"
                : variant === "success" ? "#7fa86a"
                : variant === "ghost"   ? "transparent"
                : "#3a3834",
      color: variant === "ghost" ? "#8a857b" : "#fff",
      border: variant === "ghost" ? "1px solid #3a3834" : "none",
    }),
    logItem: (tipe) => ({
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: "7px 12px", borderRadius: 6, marginBottom: 4,
      background: tipe === "naik" ? "rgba(209,104,92,0.07)"
                : tipe === "turun" ? "rgba(127,168,106,0.07)"
                : tipe === "sim"  ? "rgba(169,139,191,0.07)"
                : tipe === "apply"? "rgba(201,100,66,0.10)"
                : "rgba(255,255,255,0.03)",
      border: `1px solid ${
        tipe === "naik" ? "rgba(209,104,92,0.15)"
        : tipe === "turun" ? "rgba(127,168,106,0.15)"
        : tipe === "sim"  ? "rgba(169,139,191,0.15)"
        : tipe === "apply"? "rgba(201,100,66,0.2)"
        : "rgba(255,255,255,0.05)"
      }`,
    }),
    simCard: (aktif) => ({
      background: aktif ? "rgba(201,100,66,0.08)" : "#2b2926",
      border: `1px solid ${aktif ? "#c96442" : "#3a3834"}`,
      borderRadius: 12, padding: 16, cursor: "pointer",
      transition: "all 0.2s",
    }),
    input: {
      background: "#1f1e1c", border: "1px solid #615d55",
      borderRadius: 6, padding: "5px 8px",
      color: "#ecebe5", fontSize: 13, width: 100,
      outline: "none",
    },
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER TABS
  // ─────────────────────────────────────────────────────────────

  const TabDashboard = () => (
    <div>
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes slide-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .hover-row:hover { background: rgba(201,100,66,0.04) !important; }
        .sim-card:hover { border-color: #c96442 !important; background: rgba(201,100,66,0.06) !important; }
        .btn-hover:hover { opacity: 0.85; }
        .margin-bar { height: 4px; border-radius: 2px; transition: width 0.6s ease; }
      `}</style>

      {/* KPI Row */}
      <div style={{ ...S.grid4, marginBottom: 20 }}>
        <div style={S.card}>
          <div style={S.cardTitle}>Rata-rata Margin</div>
          <div style={{ ...S.bigNum, color: marginColor(avgMargin) }}>{pct(avgMargin)}</div>
          <div style={S.sub}>{produkHPP.length} produk aktif</div>
        </div>
        <div style={S.card}>
          <div style={S.cardTitle}>Produk Kritis</div>
          <div style={{ ...S.bigNum, color: produkKritis.length > 0 ? "#d1685c" : "#7fa86a" }}>
            {produkKritis.length}
          </div>
          <div style={S.sub}>margin &lt; 20%</div>
        </div>
        <div style={S.card}>
          <div style={S.cardTitle}>Produk Sehat</div>
          <div style={{ ...S.bigNum, color: "#7fa86a" }}>{produkSehat.length}</div>
          <div style={S.sub}>margin ≥ 50%</div>
        </div>
        <div style={S.card}>
          <div style={S.cardTitle}>Total Bahan</div>
          <div style={S.bigNum}>{bahan.length}</div>
          <div style={S.sub}>bahan baku aktif</div>
        </div>
      </div>

      <div style={S.grid2}>
        {/* Tabel produk */}
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Overview Produk</div>
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Produk</th>
                <th style={{ ...S.th, textAlign: "right" }}>HPP/pcs</th>
                <th style={{ ...S.th, textAlign: "right" }}>Harga Jual</th>
                <th style={{ ...S.th, textAlign: "right" }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {produkHPP.map(p => (
                <tr key={p.ID_PRODUK} className="hover-row"
                  style={{ cursor: "pointer" }}
                  onClick={() => { setSelectedProduk(p.ID_PRODUK); setTab("detail"); }}
                >
                  <td style={S.td}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.NAMA_PRODUK}</div>
                    <div style={{ fontSize: 11, color: "#78746b" }}>{p.KATEGORI}</div>
                  </td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: "#a9a49a" }}>
                    {idr(p.HPP_PER_PCS)}
                  </td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>
                    {idr(p.HARGA_JUAL)}
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <span style={S.badge(marginColor(p.MARGIN_PCT))}>{pct(p.MARGIN_PCT)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Activity log */}
        <div style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Activity Log</div>
          {log.length === 0 ? (
            <div style={{ color: "#615d55", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
              Engine siap. Ubah harga bahan untuk memulai.
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {log.map(l => (
                <div key={l.id} style={{ ...S.logItem(l.tipe), animation: "slide-in 0.2s ease" }}>
                  <span style={{ fontSize: 10, color: "#78746b", minWidth: 56, paddingTop: 1 }}>{l.ts}</span>
                  <span style={{
                    fontSize: 13, color:
                      l.tipe === "naik"  ? "#e0a59f"
                    : l.tipe === "turun" ? "#a9c46a"
                    : l.tipe === "sim"   ? "#b4b0d4"
                    : l.tipe === "apply" ? "#e0a08a"
                    : "#a9a49a"
                  }}>{l.pesan}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const TabHPP = () => (
    <div style={S.card}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
        Harga Bahan Baku — Edit untuk Recalc Otomatis
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Bahan</th>
            <th style={S.th}>Satuan Beli</th>
            <th style={S.th}>Satuan Pakai</th>
            <th style={S.th}>Konversi</th>
            <th style={{ ...S.th, textAlign: "right" }}>Harga/Satuan Beli</th>
            <th style={{ ...S.th, textAlign: "right" }}>Harga/Satuan Pakai</th>
            <th style={{ ...S.th, textAlign: "center" }}>Edit</th>
          </tr>
        </thead>
        <tbody>
          {bahan.map(b => {
            const isEditing = editHarga === b.ID_BAHAN;
            const hargaPerPakai = round2(b.HARGA_RATA2 / b.KONVERSI);
            const isChanged = b.HARGA_RATA2 !== INITIAL_BAHAN.find(ib => ib.ID_BAHAN === b.ID_BAHAN)?.HARGA_RATA2;
            return (
              <tr key={b.ID_BAHAN} className="hover-row">
                <td style={S.td}>
                  <span style={{ fontWeight: 600 }}>{b.NAMA_BAHAN}</span>
                  {isChanged && <span style={{ ...S.badge("#c96442"), marginLeft: 8 }}>✎</span>}
                </td>
                <td style={S.td}>{b.SATUAN_BELI}</td>
                <td style={S.td}>{b.SATUAN_PAKAI}</td>
                <td style={{ ...S.td, color: "#78746b" }}>1:{b.KONVERSI}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>
                  {isEditing ? (
                    <input
                      style={S.input}
                      value={editVal}
                      autoFocus
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          updateHargaBahan(b.ID_BAHAN, editVal);
                          setEditHarga(null);
                        }
                        if (e.key === "Escape") setEditHarga(null);
                      }}
                    />
                  ) : (
                    <span style={{ color: isChanged ? "#d97757" : "#a9a49a" }}>
                      {idr(b.HARGA_RATA2)}
                    </span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "right", color: "#78746b", fontFamily: "monospace" }}>
                  {idr(hargaPerPakai)}/{b.SATUAN_PAKAI}
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {isEditing ? (
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      <button className="btn-hover" style={S.btn("success")}
                        onClick={() => { updateHargaBahan(b.ID_BAHAN, editVal); setEditHarga(null); }}>
                        ✓
                      </button>
                      <button className="btn-hover" style={S.btn("ghost")}
                        onClick={() => setEditHarga(null)}>✕</button>
                    </div>
                  ) : (
                    <button className="btn-hover" style={{ ...S.btn("ghost"), fontSize: 12, padding: "5px 10px" }}
                      onClick={() => { setEditHarga(b.ID_BAHAN); setEditVal(String(b.HARGA_RATA2)); }}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <button className="btn-hover" style={S.btn("ghost")}
          onClick={() => { setBahan(INITIAL_BAHAN); addLog("update", "Semua harga direset ke nilai awal"); }}>
          ↺ Reset Harga
        </button>
      </div>
    </div>
  );

  const TabDetail = () => {
    if (!selectedDetail) return (
      <div style={{ ...S.card, textAlign: "center", padding: "40px 0", color: "#615d55" }}>
        Pilih produk dari tab Dashboard untuk melihat detail HPP.
      </div>
    );
    const p = selectedDetail;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <select
            style={{ ...S.input, width: "auto" }}
            value={selectedProduk || ""}
            onChange={e => setSelectedProduk(e.target.value)}
          >
            {produkList.map(pr => (
              <option key={pr.ID_PRODUK} value={pr.ID_PRODUK}>{pr.NAMA_PRODUK}</option>
            ))}
          </select>
        </div>

        <div style={{ ...S.grid4, marginBottom: 20 }}>
          {[
            { label: "HPP/pcs",    val: idr(p.HPP_PER_PCS),  sub: `Batch: ${idr(p.HPP_PER_BATCH)}` },
            { label: "Harga Jual", val: idr(p.HARGA_JUAL),   sub: `Yield: ${p.YIELD_PCS} pcs` },
            { label: "Margin %",   val: pct(p.MARGIN_PCT),    sub: `${idr(p.MARGIN_RP)}/pcs`, color: marginColor(p.MARGIN_PCT) },
            { label: "Jml Bahan",  val: p.DETAIL.length,      sub: "bahan dalam resep" },
          ].map((kpi, i) => (
            <div key={i} style={S.card}>
              <div style={S.cardTitle}>{kpi.label}</div>
              <div style={{ ...S.bigNum, ...(kpi.color ? { color: kpi.color } : {}) }}>{kpi.val}</div>
              <div style={S.sub}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
            Breakdown Bahan — {p.NAMA_PRODUK}
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Bahan</th>
                <th style={{ ...S.th, textAlign: "right" }}>Jumlah</th>
                <th style={{ ...S.th, textAlign: "right" }}>Harga/Satuan Pakai</th>
                <th style={{ ...S.th, textAlign: "right" }}>Biaya</th>
                <th style={{ ...S.th, textAlign: "right" }}>% dari HPP</th>
              </tr>
            </thead>
            <tbody>
              {p.DETAIL.sort((a, b) => b.BIAYA_BAHAN - a.BIAYA_BAHAN).map(d => {
                const pct_hpp = p.HPP_PER_BATCH > 0
                  ? round2((d.BIAYA_BAHAN / p.HPP_PER_BATCH) * 100)
                  : 0;
                return (
                  <tr key={d.ID_BAHAN} className="hover-row">
                    <td style={S.td}>{d.NAMA_BAHAN}</td>
                    <td style={{ ...S.td, textAlign: "right", color: "#8a857b" }}>
                      {d.JUMLAH} {d.SATUAN_PAKAI}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: "#8a857b" }}>
                      {idr(d.HARGA_PER_SATUAN_PAKAI)}/{d.SATUAN_PAKAI}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                      {idr(d.BIAYA_BAHAN)}
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <div style={{ width: 60, background: "#3a3834", borderRadius: 2, overflow: "hidden" }}>
                          <div className="margin-bar" style={{ width: `${pct_hpp}%`, background: "#c96442" }} />
                        </div>
                        <span style={{ color: "#a9a49a", fontSize: 12 }}>{pct_hpp}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...S.td, fontWeight: 700, color: "#ecebe5" }} colSpan={3}>Total HPP (1 batch)</td>
                <td style={{ ...S.td, textAlign: "right", fontWeight: 800, color: "#c96442", fontFamily: "monospace" }}>
                  {idr(p.HPP_PER_BATCH)}
                </td>
                <td style={S.td} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const TabSimulasi = () => (
    <div>
      <div style={{ ...S.card, marginBottom: 20, borderColor: "#413f3a", background: "rgba(65,63,58,0.3)" }}>
        <div style={{ fontSize: 13, color: "#9fc4d4" }}>
          💡 Simulasi tidak mengubah data aktual. Setelah puas, klik <b>Terapkan</b> untuk menyimpan.
        </div>
      </div>

      {/* Skenario buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        {SIMULASI_SKENARIO.map(s => (
          <div key={s.id} className="sim-card"
            style={S.simCard(simAktif === s.id)}
            onClick={() => jalankanSimulasi(s)}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ecebe5", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: "#8a857b" }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Hasil simulasi */}
      {simHPP && (
        <div style={{ animation: "slide-in 0.3s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Hasil Simulasi vs Aktual</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-hover" style={S.btn("success")} onClick={terapkanSimulasi}>
                ✓ Terapkan ke Data
              </button>
              <button className="btn-hover" style={S.btn("ghost")} onClick={resetSimulasi}>
                Batalkan
              </button>
            </div>
          </div>

          <div style={S.card}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Produk</th>
                  <th style={{ ...S.th, textAlign: "right" }}>HPP Aktual</th>
                  <th style={{ ...S.th, textAlign: "right" }}>HPP Simulasi</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Selisih</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Margin Aktual</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Margin Simulasi</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {simHPP.map(sim => {
                  const aktual  = produkHPP.find(p => p.ID_PRODUK === sim.ID_PRODUK);
                  const selisih = round2(sim.HPP_PER_PCS - (aktual?.HPP_PER_PCS || 0));
                  const pctNaik = aktual?.HPP_PER_PCS > 0
                    ? round2((selisih / aktual.HPP_PER_PCS) * 100)
                    : 0;
                  return (
                    <tr key={sim.ID_PRODUK} className="hover-row">
                      <td style={S.td}><span style={{ fontWeight: 600 }}>{sim.NAMA_PRODUK}</span></td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: "#8a857b" }}>
                        {idr(aktual?.HPP_PER_PCS || 0)}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                        {idr(sim.HPP_PER_PCS)}
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        {selisih !== 0 && (
                          <span style={{ color: selisih > 0 ? "#e0a59f" : "#a9c46a", fontFamily: "monospace" }}>
                            {selisih > 0 ? "+" : ""}{idr(selisih)}
                            <span style={{ fontSize: 11, marginLeft: 4 }}>
                              ({selisih > 0 ? "+" : ""}{pctNaik}%)
                            </span>
                          </span>
                        )}
                        {selisih === 0 && <span style={{ color: "#78746b" }}>—</span>}
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <span style={S.badge(marginColor(aktual?.MARGIN_PCT || 0))}>
                          {pct(aktual?.MARGIN_PCT || 0)}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <span style={S.badge(marginColor(sim.MARGIN_PCT))}>
                          {pct(sim.MARGIN_PCT)}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        {sim.MARGIN_PCT < 20
                          ? <span style={S.badge("#d1685c")}>⚠ Kritis</span>
                          : sim.MARGIN_PCT < 35
                          ? <span style={S.badge("#d99a4e")}>Waspada</span>
                          : <span style={S.badge("#7fa86a")}>Aman</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!simHPP && (
        <div style={{ ...S.card, textAlign: "center", padding: "48px 0", color: "#615d55" }}>
          Pilih skenario di atas untuk memulai simulasi.
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER UTAMA
  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes slide-in  { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .hover-row:hover { background: rgba(201,100,66,0.04) !important; cursor: pointer; }
        .sim-card:hover  { border-color: #c96442 !important; background: rgba(201,100,66,0.06) !important; }
        .btn-hover:hover { opacity: 0.85; }
        .margin-bar      { height: 4px; border-radius: 2px; transition: width 0.6s ease; }
        select option    { background: #2b2926; color: #ecebe5; }
      `}</style>

      {/* Sub-nav khusus HPP Engine */}
      <div style={{ display: "flex", gap: 4, padding: "8px 0 16px", borderBottom: "1px solid #3a3834", marginBottom: 20, overflowX: "auto" }}>
        {[
          { key: "dashboard", label: "Overview" },
          { key: "hpp",       label: "Harga Bahan" },
          { key: "detail",    label: "Detail Resep" },
          { key: "simulasi",  label: "Simulasi" },
        ].map(t => (
          <button key={t.key} style={S.navBtn(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
          background: "rgba(127,168,106,0.1)", border: "1px solid rgba(127,168,106,0.25)",
          borderRadius: 20, padding: "4px 10px", fontSize: 11, color: "#8fb47a", fontWeight: 600, whiteSpace: "nowrap" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7fa86a", animation: "pulse-dot 1.5s infinite" }} />
          Engine Aktif
        </div>
      </div>

      {/* Body */}
      <div>
        {tab === "dashboard" && <TabDashboard />}
        {tab === "hpp"       && <TabHPP />}
        {tab === "detail"    && <TabDetail />}
        {tab === "simulasi"  && <TabSimulasi />}
      </div>
    </div>
  );
}
