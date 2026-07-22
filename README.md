# KCC — Kitchen Cost Control

Aplikasi manajemen dapur: master data, **HPP & Margin**, **Resep**, **Inventory**,
**Pembelian**, **Dashboard**, **Analitik**, dan **Rekomendasi**.

> **v2** — dimigrasikan dari Google Apps Script + Google Sheets ke arsitektur
> **Vercel** (React + Vite frontend, Serverless Functions) dengan database
> **Vercel Postgres (Neon)**. UI direstyle mengikuti estetika hangat ala Claude.

---

## Arsitektur

```
┌─────────────────────┐     POST /api/rpc      ┌──────────────────────┐
│  React + Vite (SPA)  │ ─────{action,params}─▶ │  Serverless Function │
│  dist/ (static)      │ ◀──{success,data,...}─ │  api/rpc.js          │
└─────────────────────┘                         └──────────┬───────────┘
                                                            │ @vercel/postgres
                                                   ┌────────▼─────────┐
                                                   │ Vercel Postgres  │
                                                   │ (Neon)           │
                                                   └──────────────────┘
```

- **Frontend** — `*.jsx` di root, di-bundle Vite ke `dist/`. Semua panggilan data
  lewat `useGAS.js` → `gasRun(action, params)` → `fetch('/api/rpc')`.
- **Backend** — satu Serverless Function `api/rpc.js` mendispatch ke handler di
  `api/_lib/handlers.js` (34 action: auth, master, resep, inventory, dashboard, config).
- **Database** — schema + seed di-provision otomatis & idempoten saat request
  pertama (`api/_lib/db.js` → `ensureReady()`), jadi cukup attach DB lalu deploy.

## Struktur file

| Path | Peran |
|---|---|
| `index.html`, `main.jsx` | Entry Vite |
| `App.jsx`, `LoginPage.jsx`, `ProtectedRoute.jsx`, `AuthContext.jsx` | Shell & auth |
| `KCC_Dashboard.jsx`, `hpp_engine.jsx`, `ResepManager.jsx`, … | Modul UI |
| `kcc_data_layer.jsx` | Fetch helpers + engine (HPP/analitik) client-side |
| `useGAS.js` | HTTP client ke `/api/rpc` |
| `theme.js` | Design tokens (palet Claude) |
| `api/rpc.js` | Serverless entry (dispatcher) |
| `api/_lib/db.js` | Koneksi Postgres + schema + seed |
| `api/_lib/auth.js` | Login/session (scrypt) |
| `api/_lib/handlers.js` | Semua handler action |
| `api/_lib/seed.js` | Data awal |
| `legacy-gas/` | Kode Google Apps Script lama (referensi, tidak dipakai) |

## Deploy ke Vercel

1. **Import repo** ini di [vercel.com/new](https://vercel.com/new). Vercel mendeteksi
   framework **Vite** otomatis (`vercel.json` sudah disertakan).
2. **Buat database**: tab **Storage → Create Database → Postgres** (Neon), lalu
   **Connect** ke project. Vercel menyuntikkan `POSTGRES_URL` otomatis.
3. **Deploy**. Saat request pertama, tabel dibuat & di-seed otomatis.
4. **Login** dengan kredensial demo di bawah, lalu ganti password di produksi.

### Kredensial demo (seed) — 10 site

Seed otomatis membuat **10 outlet** (`OUTLET01` … `OUTLET10`), masing-masing
dengan data master lengkap dan dua akun:

| Outlet | Username | Password | Role |
|---|---|---|---|
| `OUTLET01`–`OUTLET10` | `admin` | `admin123` | SUPER_ADMIN (OUTLET01) / ADMIN |
| `OUTLET01`–`OUTLET10` | `kasir` | `kasir123` | KASIR |

Setiap outlet terisolasi penuh (semua tabel di-scope `outlet_id`), sesi login
independen per user, dan penomoran PO memakai counter atomik per outlet — aman
dipakai beberapa akun bersamaan hingga 10 site.

> ⚠️ **Ganti kredensial ini sebelum produksi** (edit `api/_lib/seed.js` sebelum
> deploy pertama, atau update baris di tabel `users`).

### Mode Demo (tanpa database)

Jika database belum di-attach (`POSTGRES_URL` kosong), halaman login mendeteksi
server offline dan menampilkan tombol **"Masuk Mode Demo"** — seluruh aplikasi
dapat dijelajahi dengan data contoh sepenuhnya di sisi client, tanpa backend.

## Pengembangan lokal

```bash
npm install
cp .env.example .env        # isi POSTGRES_URL (Neon/Vercel Postgres)
npm run dev                 # frontend di http://localhost:3000
```

Untuk menjalankan Serverless Functions secara lokal, gunakan **Vercel CLI**:

```bash
npm i -g vercel
vercel dev                  # menyajikan frontend + /api/rpc bersamaan
```

Cek koneksi DB: `GET /api/rpc?action=apiHealth`.

## Catatan migrasi

- Kontrak response dijaga identik (`{ success, data | token | session, message, code }`)
  sehingga komponen frontend tidak perlu berubah.
- Engine berat (HPP, analitik, rekomendasi) berjalan **client-side** dari data yang
  di-fetch; endpoint `apiGetRingkasanHPPSemua` juga menyediakan perhitungan server-side.
- Restyle UI (`theme.js`) menyeluruh pada shell, login, dan dashboard. Modul lain
  tetap fungsional dan dapat direstyle bertahap dengan token yang sama.
