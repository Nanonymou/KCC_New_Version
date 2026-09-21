// ═══════════════════════════════════════════════════════════════════════════
// konversi.js — Basis pengetahuan satuan & konversi
//
// Tujuan: user tidak perlu menghitung sendiri angka konversi saat menambah
// bahan. Untuk satuan baku (berat & volume) konversinya dihitung OTOMATIS.
// Untuk satuan kemasan yang isinya tidak baku (pack, dus, karung, ikat…)
// angka konversi memang harus diisi manual — tapi pertanyaannya dibuat jelas
// ("1 pack berisi berapa pcs?") supaya tidak membingungkan.
//
// Catatan: sebelumnya saran konversi hanya dipelajari dari bahan yang SUDAH
// ada di database. Begitu database kosong (outlet baru), tidak ada yang bisa
// dipelajari sehingga user harus menebak sendiri. Tabel di bawah membuat
// saran tetap jalan sejak bahan pertama.
// ═══════════════════════════════════════════════════════════════════════════

// dim  : dimensi fisik — hanya satuan sedimensi yang bisa dikonversi otomatis
// base : nilai dalam satuan dasar (berat→gram, volume→ml, hitung→pcs)
const U = (dim, base, label) => ({ dim, base, label });

export const UNIT_INFO = {
  // ── Berat (dasar: gram) ──
  mg:       U("berat", 0.001,   "miligram"),
  gram:     U("berat", 1,       "gram"),
  g:        U("berat", 1,       "gram"),
  gr:       U("berat", 1,       "gram"),
  ons:      U("berat", 100,     "ons"),
  hg:       U("berat", 100,     "ons"),
  pon:      U("berat", 500,     "pon"),
  kg:       U("berat", 1000,    "kilogram"),
  kilo:     U("berat", 1000,    "kilogram"),
  kilogram: U("berat", 1000,    "kilogram"),
  kwintal:  U("berat", 100000,  "kwintal"),
  kuintal:  U("berat", 100000,  "kwintal"),
  ton:      U("berat", 1000000, "ton"),

  // ── Volume (dasar: ml) ──
  ml:       U("volume", 1,    "mililiter"),
  cc:       U("volume", 1,    "cc"),
  mililiter:U("volume", 1,    "mililiter"),
  cl:       U("volume", 10,   "sentiliter"),
  dl:       U("volume", 100,  "desiliter"),
  liter:    U("volume", 1000, "liter"),
  ltr:      U("volume", 1000, "liter"),
  l:        U("volume", 1000, "liter"),
  kubik:    U("volume", 1000000, "meter kubik"),
  m3:       U("volume", 1000000, "meter kubik"),

  // ── Hitungan baku (dasar: pcs) ──
  pcs:      U("hitung", 1,   "pcs"),
  buah:     U("hitung", 1,   "buah"),
  biji:     U("hitung", 1,   "biji"),
  butir:    U("hitung", 1,   "butir"),
  lembar:   U("hitung", 1,   "lembar"),
  potong:   U("hitung", 1,   "potong"),
  batang:   U("hitung", 1,   "batang"),
  siung:    U("hitung", 1,   "siung"),
  tangkai:  U("hitung", 1,   "tangkai"),
  lusin:    U("hitung", 12,  "lusin"),
  kodi:     U("hitung", 20,  "kodi"),
  gross:    U("hitung", 144, "gross"),
  rim:      U("hitung", 500, "rim"),
};

// Satuan kemasan: isinya TIDAK baku, jadi konversinya wajib diisi manual.
export const UNIT_KEMASAN = [
  "pack", "pak", "bungkus", "sachet", "renceng", "dus", "box", "karton",
  "karung", "sak", "zak", "jerigen", "botol", "kaleng", "kotak", "toples",
  "galon", "krat", "peti", "ikat", "papan", "tray", "rak", "keranjang", "bal",
];

// Ditawarkan di dropdown — dikelompokkan supaya mudah dipilih.
export const UNIT_GROUPS = {
  "Berat":   ["kg", "gram", "ons", "mg", "pon", "kwintal", "ton"],
  "Volume":  ["liter", "ml", "cc"],
  "Hitungan":["pcs", "buah", "biji", "butir", "lembar", "potong", "batang", "siung", "lusin", "kodi", "rim"],
  "Kemasan": ["pack", "dus", "box", "karung", "sak", "botol", "kaleng", "jerigen", "ikat", "papan", "renceng", "sachet", "krat", "tray"],
};

export function normalizeUnit(u) {
  return String(u || "").trim().toLowerCase().replace(/\.$/, "");
}

export function isKemasan(u) {
  return UNIT_KEMASAN.includes(normalizeUnit(u));
}

export function unitLabel(u) {
  const n = normalizeUnit(u);
  return UNIT_INFO[n]?.label || u || "";
}

/**
 * Hitung saran konversi untuk pasangan satuan beli → satuan pakai.
 *
 * Mengembalikan:
 *   mode   : "otomatis" | "manual" | "sama" | "kosong"
 *   value  : angka konversi (null kalau harus diisi manual)
 *   pesan  : penjelasan singkat untuk ditampilkan di form
 *   tanya  : kalimat pertanyaan untuk mode manual
 */
export function saranKonversi(satuanBeli, satuanPakai) {
  const b = normalizeUnit(satuanBeli);
  const p = normalizeUnit(satuanPakai);

  if (!b || !p) {
    return { mode: "kosong", value: null, pesan: "Isi satuan beli & satuan pakai dulu.", tanya: null };
  }

  if (b === p) {
    return {
      mode: "sama", value: 1,
      pesan: `Satuan beli dan pakai sama (${b}), jadi konversinya 1.`,
      tanya: null,
    };
  }

  const ib = UNIT_INFO[b];
  const ip = UNIT_INFO[p];

  if (ib && ip && ib.dim === ip.dim) {
    const value = ib.base / ip.base;
    if (value > 0 && isFinite(value)) {
      return {
        mode: "otomatis", value,
        pesan: `1 ${b} = ${formatAngka(value)} ${p} — dihitung otomatis.`,
        tanya: null,
      };
    }
  }

  // Beda dimensi (mis. kg → ml): tidak bisa dihitung tanpa tahu massa jenis.
  if (ib && ip && ib.dim !== ip.dim) {
    return {
      mode: "manual", value: null,
      pesan: `${b} (${ib.dim}) dan ${p} (${ip.dim}) beda jenis ukuran, jadi tidak bisa dihitung otomatis.`,
      tanya: `1 ${b} setara berapa ${p}?`,
    };
  }

  // Salah satu satuan kemasan / tidak dikenal → isinya tidak baku.
  return {
    mode: "manual", value: null,
    pesan: isKemasan(b)
      ? `Isi 1 ${b} tidak baku, jadi perlu diisi sendiri.`
      : `Konversi ${b} → ${p} tidak bisa ditebak otomatis.`,
    tanya: `1 ${b} berisi berapa ${p}?`,
  };
}

export function formatAngka(n) {
  const num = Number(n);
  if (!isFinite(num)) return "-";
  return num.toLocaleString("id-ID", { maximumFractionDigits: 6 });
}
