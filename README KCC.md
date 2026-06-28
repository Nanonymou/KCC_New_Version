# KCC — Kitchen Cost Control

Aplikasi manajemen dapur berbasis **Google Apps Script** yang terintegrasi langsung dengan Google Spreadsheet. Mencakup master data, kalkulasi **HPP & Margin**, manajemen **Resep**, **Inventory FIFO**, **Pembelian**, dan **Dashboard** ringkasan operasional.

---

## Daftar Isi

- [Fitur](#fitur)
- [Arsitektur](#arsitektur)
- [Struktur File](#struktur-file)
- [Prasyarat & Sheet](#prasyarat--sheet)
- [Instalasi](#instalasi)
- [Konfigurasi](#konfigurasi)
- [Cara Penggunaan](#cara-penggunaan)
- [Referensi API](#referensi-api)
- [Format Response](#format-response)
- [Format ID](#format-id)

---

## Fitur

| Modul | Deskripsi |
|---|---|
| **Dashboard** | KPI ringkasan, top margin, stok kritis, pembelian terbaru, alert margin rendah |
| **Bahan Baku** | CRUD master bahan, konversi satuan, harga rata2 otomatis |
| **Produk** | CRUD master produk, harga jual, yield per batch |
| **Supplier** | CRUD master supplier |
| **Resep** | Kelola komposisi bahan per produk, kalkulasi HPP otomatis per item |
| **HPP & Margin** | Kalkulasi HPP per pcs & per batch, margin %, simulasi kenaikan harga |
| **Inventory** | Stok FIFO, kartu stok, stock adjustment, nilai stok |
| **Pembelian** | Catat pembelian bahan, update stok otomatis, void transaksi |

---

## Arsitektur

```
Browser (Web App)
        │
        │  google.script.run
        ▼
┌─────────────────────────────────────────┐
│              Code.gs (API Router)        │
│   apiBahanCreate() → createBahan()       │
│   apiGetDashboardSummary() → ...         │
└───────┬────────────────┬────────────────┘
        │                │
        ▼                ▼
  master.gs         recipe_engine.gs
  Bahan/Produk/     Kalkulasi HPP,
  Supplier/Resep    Simulasi, Margin
        │
        ▼
  inventory_engine.gs ← inventory_api.gs
  FIFO Purchase/        (API wrapper
  Production/Sales      inventory)
        │
        ▼
    service.gs  (layer akses Google Spreadsheet)
        │
        ▼
  Google Spreadsheet (database)
```

**Prinsip:**
- Semua kalkulasi dilakukan di server (`.gs`), **tidak ada** business logic di client (`script.html`)
- `script.html` hanya menangani UI rendering dan memanggil `google.script.run`
- Tidak menggunakan JSX — murni vanilla JavaScript, kompatibel dengan GAS Web App

---

## Struktur File

```
KCC/
├── Code.gs               # Entry point: doGet(), include(), semua API wrapper (api*)
├── config.gs             # Konstanta: CONFIG, SHEET (nama-nama sheet master)
├── utils.gs              # Utilitas: ID generator, format tanggal/rupiah, ok()/fail(), log
├── service.gs            # Layer akses sheet: readAll(), readOne(), insertRow(), updateRow()
├── master.gs             # Business logic Master Data: Bahan, Produk, Supplier, Resep
├── recipe_engine.gs      # Mesin HPP: kalkulasiResep(), hitungDanSimpanHPP(), simulasiResep()
├── dashboard.gs          # Agregasi data untuk Dashboard (HPP + Inventory + Pembelian)
├── inventory_config.gs   # Konstanta Inventory: INV_SHEET, INV_HEADERS
├── inventory_engine.gs   # Mesin Inventory FIFO: Purchase, Production, Sales, Adjustment
├── inventory_api.gs      # API wrapper untuk semua fungsi inventory
├── index.html            # Shell HTML utama: layout, sidebar, navigasi
├── style.html            # CSS aplikasi (dark theme)
└── script.html           # Client-side JavaScript: routing, UI rendering, API calls
```

---

## Prasyarat & Sheet

### Sheet Master Data

Dibuat otomatis saat `setup()` dijalankan:

| Sheet | Kolom Utama | Keterangan |
|---|---|---|
| `BAHAN` | ID_BAHAN, NAMA_BAHAN, KATEGORI, SATUAN_BELI, SATUAN_PAKAI, KONVERSI, HARGA_TERAKHIR, HARGA_RATA2, STOK_MINIMUM, AKTIF | Master bahan baku |
| `PRODUK` | ID_PRODUK, NAMA_PRODUK, KATEGORI, HARGA_JUAL, HPP, YIELD_PCS, AKTIF | Master produk |
| `SUPPLIER` | ID_SUPPLIER, NAMA_SUPPLIER, PIC, TELEPON, ALAMAT, AKTIF | Master supplier |
| `RESEP` | ID_RESEP, ID_PRODUK, ID_BAHAN, JUMLAH, SATUAN, CATATAN | Komposisi resep |
| `LOG` | LEVEL, MODULE, ACTION, MESSAGE, META, TIMESTAMP | Log sistem |

### Sheet Inventory

Dibuat otomatis saat `setupInventory()` dijalankan:

| Sheet | Keterangan |
|---|---|
| `STOCK_CARD` | Kartu stok FIFO — setiap mutasi IN/OUT/ADJUSTMENT dicatat di sini |
| `PURCHASE` | Transaksi pembelian bahan baku |
| `PRODUCTION` | Transaksi produksi (konsumsi bahan otomatis) |
| `SALES` | Transaksi penjualan produk jadi |

---

## Instalasi

### Langkah 1 — Persiapkan Google Spreadsheet

1. Buat Google Spreadsheet baru (atau gunakan yang sudah ada)
2. Catat **Spreadsheet ID** dari URL: `https://docs.google.com/spreadsheets/d/[ID INI]/edit`

### Langkah 2 — Buka Google Apps Script

1. Dari Spreadsheet, klik menu **Extensions → Apps Script**
2. Hapus kode default

### Langkah 3 — Upload Semua File `.gs`

Buat file script untuk setiap file `.gs` berikut (klik **+** → **Script**, beri nama tanpa ekstensi):

| Nama di Editor | File Sumber |
|---|---|
| `Code` | `Code.gs` |
| `config` | `config.gs` |
| `utils` | `utils.gs` |
| `service` | `service.gs` |
| `master` | `master.gs` |
| `recipe_engine` | `recipe_engine.gs` |
| `dashboard` | `dashboard.gs` |
| `inventory_config` | `inventory_config.gs` |
| `inventory_engine` | `inventory_engine.gs` |
| `inventory_api` | `inventory_api.gs` |

### Langkah 4 — Upload File HTML

Buat file HTML (klik **+** → **HTML**):

| Nama di Editor | File Sumber |
|---|---|
| `index` | `index.html` |
| `style` | `style.html` |
| `script` | `script.html` |

### Langkah 5 — Konfigurasi

Edit file `config` di editor, isi Spreadsheet ID Anda:

```javascript
const CONFIG = {
  SPREADSHEET_ID : 'ISI_ID_SPREADSHEET_ANDA_DI_SINI',
  TIMEZONE       : 'Asia/Jakarta',
};
```

### Langkah 6 — Jalankan Setup

Di editor Apps Script:

1. Pilih fungsi `setup` dari dropdown → klik **Run ▶** → izinkan otorisasi Google
2. Cek Spreadsheet — sheet-sheet master akan terbuat otomatis

Lalu jalankan setup inventory:

1. Pilih fungsi `setupInventory` → klik **Run ▶**
2. Sheet `STOCK_CARD`, `PURCHASE`, `PRODUCTION`, `SALES` akan terbuat

### Langkah 7 — Deploy Web App

1. Klik **Deploy → New deployment**
2. Pilih type: **Web app**
3. Atur:
   - **Execute as:** Me
   - **Who has access:** Anyone (atau sesuai kebijakan organisasi)
4. Klik **Deploy** → salin URL yang diberikan
5. Buka URL di browser — aplikasi siap digunakan

> Setiap kali mengubah kode, buat deployment baru (**Deploy → New deployment**) atau perbarui yang ada (**Deploy → Manage deployments → Edit**).

---

## Konfigurasi

### config.gs

```javascript
const CONFIG = {
  SPREADSHEET_ID : 'ID_SPREADSHEET_ANDA',
  TIMEZONE       : 'Asia/Jakarta',
};

const SHEET = {
  BAHAN    : 'BAHAN',
  PRODUK   : 'PRODUK',
  SUPPLIER : 'SUPPLIER',
  RESEP    : 'RESEP',
  LOG      : 'LOG',
};
```

### inventory_config.gs

```javascript
const INV_SHEET = {
  STOCK_CARD : 'STOCK_CARD',
  PURCHASE   : 'PURCHASE',
  PRODUCTION : 'PRODUCTION',
  SALES      : 'SALES',
};
```

---

## Cara Penggunaan

### Dashboard

Halaman pertama saat aplikasi dibuka. Menampilkan:

- **KPI Row 1:** Total bahan aktif · Avg margin seluruh produk · Nilai stok inventory · Total pembelian bulan ini
- **KPI Row 2:** Jumlah produk · Supplier · Item resep · Total alert aktif
- **Top Margin:** 5 produk dengan margin tertinggi + progress bar visual
- **Stok Kritis:** Bahan yang stoknya di bawah minimum
- **Margin Rendah:** Produk dengan margin < 20% (perlu perhatian)
- **Pembelian Terbaru:** 5 transaksi pembelian terakhir

Klik **↻ Refresh** untuk memuat ulang data terbaru dari Spreadsheet.

---

### Master Data

#### Bahan Baku

**Tambah bahan:**
1. Buka **Bahan Baku** dari sidebar
2. Klik **+ Tambah Bahan**
3. Isi form:
   - **Nama Bahan** *(wajib)*
   - **Satuan Beli** — satuan saat membeli, misal `kg`, `dus`, `liter`
   - **Satuan Pakai** — satuan saat dipakai di resep, misal `gram`, `ml`
   - **Konversi** — faktor: 1 satuan beli = N satuan pakai (contoh: 1 kg = 1000 gram → isi `1000`)
   - **Harga Terakhir** *(wajib, > 0)* — harga beli terbaru
   - **Harga Rata2** — diisi otomatis sama dengan Harga Terakhir jika dikosongkan
   - **Stok Minimum** — threshold peringatan stok rendah (default: 0)
4. Klik **Simpan**

> **Konversi penting untuk akurasi HPP.** Jika membeli per kg tapi resep pakai gram, isi konversi = 1000. HPP per gram = Harga Rata2 ÷ 1000.

**Edit bahan:** klik ✏️ di baris tabel
**Nonaktifkan:** klik tombol **Nonaktifkan** — data tidak dihapus, hanya tersembunyi dari filter default

#### Produk

1. Buka **Produk** dari sidebar → klik **+ Tambah Produk**
2. Isi Nama, Kategori, Harga Jual, **Yield PCS** (jumlah porsi/unit per batch resep)
3. HPP akan terisi otomatis setelah resep dibuat dan dihitung

#### Supplier

1. Buka **Supplier** → klik **+ Tambah Supplier**
2. Isi Nama Supplier, PIC, Telepon, Alamat
3. Klik **Simpan**

---

### Resep

1. Buka **Resep** dari sidebar
2. Pilih produk dari dropdown **Pilih Produk**
3. Resep dan kalkulasi HPP ditampilkan otomatis
4. **Tambah bahan:** klik **+ Tambah Bahan** → pilih bahan, isi jumlah dan satuan pakai
5. **Edit bahan:** klik **Edit** di baris yang ingin diubah
6. **Hapus bahan:** klik **Hapus** → konfirmasi

Panel ringkasan menampilkan secara real-time:

| Info | Keterangan |
|---|---|
| **HPP / Batch** | Total biaya satu batch resep |
| **HPP / Pcs** | HPP dibagi yield (biaya per satu porsi/unit) |
| **Harga Jual** | Dari data master produk |
| **Margin** | `(Harga Jual − HPP/Pcs) ÷ Harga Jual × 100%` |

---

### HPP & Margin

1. Buka **HPP & Margin** dari sidebar
2. Tabel menampilkan semua produk beserta HPP, margin rupiah, dan margin %
3. Warna badge margin:

| Warna | Rentang | Arti |
|---|---|---|
| 🟢 Hijau | ≥ 60% | Margin sangat baik |
| 🟡 Kuning | 40–59% | Margin cukup |
| 🟠 Oranye | 20–39% | Perlu perhatian |
| 🔴 Merah | < 20% | Margin rendah, pertimbangkan penyesuaian harga |

4. **Hitung Ulang** (per baris) — recalc HPP satu produk dari resep terkini
5. **⚡ Hitung Ulang Semua** — recalc HPP seluruh produk sekaligus

> Produk yang belum memiliki resep ditampilkan dengan nilai `—` dan tombol **Buat Resep** yang langsung mengarah ke halaman Resep.

---

### Inventory

1. Buka **Inventory** dari sidebar
2. Tabel menampilkan stok terkini semua bahan beserta nilai stok
3. Badge **KRITIS** muncul jika stok di bawah minimum yang ditetapkan
4. **Kartu Stok** — klik untuk melihat riwayat mutasi IN/OUT/ADJ lengkap per bahan
5. **Adj.** (Adjustment) — koreksi stok manual
   - Nilai **positif** = tambah stok (misal: koreksi lebih saat stock opname)
   - Nilai **negatif** = kurangi stok (misal: barang rusak/terbuang)

> Stok diperbarui otomatis setiap ada pembelian atau produksi. Input manual hanya diperlukan untuk koreksi stock opname.

---

### Pembelian

1. Buka **Pembelian** dari sidebar
2. Tabel menampilkan semua transaksi dengan filter berdasarkan bulan
3. **+ Catat Pembelian** — isi form:
   - Pilih bahan
   - Tanggal pembelian
   - Qty beli (dalam satuan beli bahan tersebut)
   - Harga per satuan
   - Supplier *(opsional)*
4. Klik **Simpan** — stok bahan otomatis bertambah, harga rata2 diperbarui
5. **Void** — batalkan transaksi; stok dikembalikan ke kondisi sebelumnya

---

## Referensi API

Semua fungsi dapat dipanggil via `google.script.run` dari client, atau langsung dari Apps Script lain.

### Master Data

| Fungsi | Parameter | Keterangan |
|---|---|---|
| `apiBahanGetAll(allStatus)` | `boolean` | Semua bahan; `true` = termasuk nonaktif |
| `apiBahanGetById(id)` | `string` | Satu bahan by ID |
| `apiBahanCreate(data)` | `Object` | Tambah bahan baru |
| `apiBahanUpdate(id, data)` | `string, Object` | Update bahan |
| `apiBahanDeactivate(id)` | `string` | Nonaktifkan bahan |
| `apiBahanReactivate(id)` | `string` | Aktifkan kembali bahan |
| `apiProdukGetAll(allStatus)` | `boolean` | Semua produk |
| `apiProdukCreate(data)` | `Object` | Tambah produk |
| `apiProdukUpdate(id, data)` | `string, Object` | Update produk |
| `apiResepGetByProduk(idProduk)` | `string` | Item resep satu produk |
| `apiResepAddItem(data)` | `Object` | Tambah item ke resep |
| `apiResepUpdateItem(id, data)` | `string, Object` | Update item resep |
| `apiResepDeleteItem(id)` | `string` | Hapus item resep |
| `apiSupplierGetAll(allStatus)` | `boolean` | Semua supplier |
| `apiSupplierCreate(data)` | `Object` | Tambah supplier |
| `apiSupplierUpdate(id, data)` | `string, Object` | Update supplier |

### HPP & Resep

| Fungsi | Parameter | Keterangan |
|---|---|---|
| `apiKalkulasiResep(idProduk)` | `string` | Hitung HPP satu produk (tidak simpan) |
| `apiHitungDanSimpanHPP(idProduk)` | `string` | Hitung HPP dan simpan ke sheet PRODUK |
| `apiRecalcSemuaHPP()` | — | Recalc HPP semua produk yang punya resep |
| `apiGetResepLengkap(idProduk)` | `string` | Detail resep + kalkulasi biaya per bahan |
| `apiGetRingkasanHPPSemua()` | — | Ringkasan HPP & margin semua produk |
| `apiSimulasiResep(idProduk, overrideHarga, yieldPcs)` | `string, Array, number` | What-if HPP tanpa simpan |

### Dashboard

| Fungsi | Parameter | Keterangan |
|---|---|---|
| `apiGetDashboardSummary()` | — | Ringkasan lengkap: master + HPP + inventory + pembelian |

### Inventory

| Fungsi | Parameter | Keterangan |
|---|---|---|
| `apiInvPurchaseCreate(data)` | `Object` | Catat pembelian & update stok FIFO |
| `apiInvPurchaseVoid(id)` | `string` | Void pembelian, kembalikan stok |
| `apiInvPurchaseGetAll()` | — | Semua transaksi pembelian |
| `apiInvProductionCreate(data)` | `Object` | Catat produksi, kurangi stok FIFO |
| `apiInvProductionVoid(id)` | `string` | Void produksi |
| `apiInvSalesCreate(data)` | `Object` | Catat penjualan |
| `apiInvSalesVoid(id)` | `string` | Void penjualan |
| `apiInvGetStockCard(idBahan)` | `string` | Kartu stok + riwayat mutasi satu bahan |
| `apiInvGetStokSemua()` | — | Stok terkini semua bahan |
| `apiInvGetSummary()` | — | Ringkasan inventory: nilai stok, stok kritis |
| `apiInvGetMovementByRef(ref)` | `string` | Mutasi berdasarkan nomor referensi |
| `apiInvGetMovementByRange(dari, sampai)` | `string, string` | Mutasi dalam rentang tanggal |
| `apiInvAdjustment(data)` | `Object` | Stock adjustment manual |

---

## Contoh Pemanggilan

### Catat Pembelian

```javascript
const result = apiInvPurchaseCreate({
  ID_BAHAN    : 'B001',
  ID_SUPPLIER : 'S001',
  TANGGAL     : '2026-06-26',
  QTY_BELI    : 10,
  SATUAN_BELI : 'kg',
  HARGA_SATUAN: 15000,
  CATATAN     : 'Pembelian rutin minggu ini',
});

if (result.success) Logger.log('OK: ' + result.message);
else Logger.log('ERROR: ' + result.message);
```

### Hitung HPP & Simulasi Kenaikan Harga

```javascript
// Hitung dan simpan HPP satu produk
const hpp = apiHitungDanSimpanHPP('P001');
Logger.log('HPP/pcs: ' + hpp.data.HPP_PER_PCS);

// Simulasi: bagaimana jika harga tepung naik 20%?
const sim = apiSimulasiResep('P001', [
  { ID_BAHAN: 'B002', HARGA_RATA2: 18000 },
], null);
Logger.log('HPP simulasi: ' + sim.data.HPP_PER_PCS);
Logger.log('Kenaikan: ' + sim.data.PERSEN_NAIK + '%');
```

### Cek Stok Kritis

```javascript
const stok = apiInvGetStokSemua();
stok.data.forEach(function(s) {
  if (Number(s.STOK_TERKINI) < Number(s.STOK_MINIMUM)) {
    Logger.log('KRITIS: ' + s.NAMA_BAHAN + ' — sisa ' + s.STOK_TERKINI);
  }
});
```

### Stock Adjustment

```javascript
// Tambah stok (koreksi opname)
apiInvAdjustment({
  ID_BAHAN : 'B001',
  QTY      : 2,
  CATATAN  : 'Koreksi stock opname Juni 2026',
});

// Kurangi stok (barang rusak)
apiInvAdjustment({
  ID_BAHAN : 'B003',
  QTY      : -1.5,
  CATATAN  : 'Bahan kadaluarsa dibuang',
});
```

---

## Format Response

Semua fungsi API mengembalikan object standar:

```javascript
// Sukses
{
  success : true,
  data    : { /* payload */ },
  message : 'Operasi berhasil',
}

// Gagal
{
  success : false,
  data    : null,
  message : 'Penjelasan penyebab kegagalan',
}
```

Selalu cek `result.success` sebelum menggunakan `result.data`.

---

## Format ID

| Prefix | Contoh | Entitas |
|---|---|---|
| `B` + 3 digit | `B001` | Bahan Baku |
| `P` + 3 digit | `P001` | Produk |
| `S` + 3 digit | `S001` | Supplier |
| `R` + 3 digit | `R001` | Item Resep |
| `PUR-YYYYMMDD-NNN` | `PUR-20260626-001` | Pembelian |
| `PRD-YYYYMMDD-NNN` | `PRD-20260626-001` | Produksi |
| `SLS-YYYYMMDD-NNN` | `SLS-20260626-001` | Penjualan |
| `SC-YYYYMMDD-NNN` | `SC-20260626-001` | Kartu Stok |
| `ADJ-YYYYMMDD-NNN` | `ADJ-20260626-001` | Stock Adjustment |

---

## Catatan Penting

- **Konversi satuan** harus diisi dengan benar — memengaruhi akurasi seluruh kalkulasi HPP
- **Yield PCS** pada produk adalah jumlah porsi yang dihasilkan dari satu batch resep
- **Void** tidak menghapus data — transaksi diberi status `VOID` dan stok dikembalikan
- **HPP** di sheet PRODUK diperbarui hanya saat `apiHitungDanSimpanHPP()` atau `apiRecalcSemuaHPP()` dipanggil — bukan real-time otomatis
- Seluruh log aktivitas tersimpan di sheet **LOG** untuk audit trail
- Setiap perubahan kode di Apps Script memerlukan deployment ulang agar aktif di Web App

---

*KCC · Kitchen Cost Control · Google Apps Script Web App*
