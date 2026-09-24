// ═══════════════════════════════════════════════════════════════════════════
// api/_lib/db.js
// Postgres connection (Vercel Postgres / Neon) + schema provisioning + seeding.
//
// Uses @vercel/postgres. It reads the connection string from the standard
// environment variables that Vercel injects when you attach a Postgres store:
//   POSTGRES_URL            (pooled, used at runtime — recommended)
//   POSTGRES_URL_NON_POOLING
// Locally, copy .env.example to .env and set POSTGRES_URL.
//
// Schema + seed are provisioned lazily & idempotently on the first request
// (ensureReady) so the app is turn-key: attach a DB in Vercel, deploy, done.
// ═══════════════════════════════════════════════════════════════════════════

import { sql, db } from '@vercel/postgres';
import crypto from 'node:crypto';
import { SEED, OUTLETS, USER_TEMPLATE } from './seed.js';

// Advisory-lock key that serializes provisioning across concurrent cold starts.
const PROVISION_LOCK = 727274;

export { sql, db };

// ─── Password hashing (Node built-in scrypt — no external dependency) ───────

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  // constant-time comparison
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Schema provisioning (idempotent) ───────────────────────────────────────

let readyPromise = null;

export function ensureReady() {
  if (!readyPromise) {
    readyPromise = provision().catch((err) => {
      readyPromise = null; // clear cache so the next request can retry
      throw err;
    });
  }
  return readyPromise;
}

async function provision() {
  // Hold a session-level advisory lock so two concurrent cold starts cannot
  // both pass the "outlets" emptiness guard and double-insert seed rows. The
  // second waiter proceeds only after the first finishes, by which point the
  // outlet exists and seedIfEmpty() short-circuits.
  const client = await db.connect();
  try {
    await client.sql`SELECT pg_advisory_lock(${PROVISION_LOCK})`;
    await createSchema();
    await seedIfEmpty();
  } finally {
    try { await client.sql`SELECT pg_advisory_unlock(${PROVISION_LOCK})`; } catch { /* ignore */ }
    client.release();
  }
}

async function createSchema() {
  await sql`CREATE TABLE IF NOT EXISTS outlets (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE
  );`;

  await sql`CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    outlet_id     TEXT NOT NULL REFERENCES outlets(id),
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'STAFF',
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (outlet_id, username)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
  );`;

  await sql`CREATE TABLE IF NOT EXISTS bahan (
    id               TEXT NOT NULL,
    outlet_id        TEXT NOT NULL REFERENCES outlets(id),
    nama             TEXT NOT NULL,
    satuan_beli      TEXT,
    satuan_pakai     TEXT,
    konversi         NUMERIC NOT NULL DEFAULT 1,
    harga_rata2      NUMERIC NOT NULL DEFAULT 0,
    harga_sebelumnya NUMERIC NOT NULL DEFAULT 0,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (outlet_id, id)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS produk (
    id          TEXT NOT NULL,
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    nama        TEXT NOT NULL,
    kategori    TEXT,
    harga_jual  NUMERIC NOT NULL DEFAULT 0,
    yield_pcs   NUMERIC NOT NULL DEFAULT 1,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (outlet_id, id)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS resep (
    id          SERIAL PRIMARY KEY,
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    id_produk   TEXT NOT NULL,
    id_bahan    TEXT NOT NULL,
    jumlah      NUMERIC NOT NULL DEFAULT 0
  );`;

  await sql`CREATE TABLE IF NOT EXISTS supplier (
    id          TEXT NOT NULL,
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    nama        TEXT NOT NULL,
    id_bahan    TEXT,
    harga       NUMERIC NOT NULL DEFAULT 0,
    satuan      TEXT,
    lead_time   NUMERIC NOT NULL DEFAULT 0,
    rating      NUMERIC NOT NULL DEFAULT 0,
    telp        TEXT,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (outlet_id, id)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS pembelian (
    id_po       TEXT NOT NULL,
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    tanggal     DATE NOT NULL DEFAULT CURRENT_DATE,
    id_bahan    TEXT,
    id_supplier TEXT,
    qty         NUMERIC NOT NULL DEFAULT 0,
    harga_beli  NUMERIC NOT NULL DEFAULT 0,
    total       NUMERIC NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'Pending',
    PRIMARY KEY (outlet_id, id_po)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS stok (
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    id_bahan    TEXT NOT NULL,
    stok        NUMERIC NOT NULL DEFAULT 0,
    min_stok    NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (outlet_id, id_bahan)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS penjualan (
    id            SERIAL PRIMARY KEY,
    outlet_id     TEXT NOT NULL REFERENCES outlets(id),
    id_transaksi  TEXT,
    id_produk     TEXT NOT NULL,
    qty           NUMERIC NOT NULL DEFAULT 0,
    tanggal       DATE NOT NULL DEFAULT CURRENT_DATE
  );`;
  // Migrate already-provisioned databases that predate id_transaksi.
  await sql`ALTER TABLE penjualan ADD COLUMN IF NOT EXISTS id_transaksi TEXT;`;

  // Stock movement ledger — every adjustment/purchase/sale that changes stock
  // records a dated movement id (ADJ/PO/PJ-YYYYMMDD-NNN) for a full audit trail.
  await sql`CREATE TABLE IF NOT EXISTS stok_movements (
    id_transaksi TEXT NOT NULL,
    outlet_id    TEXT NOT NULL REFERENCES outlets(id),
    tanggal      DATE NOT NULL DEFAULT CURRENT_DATE,
    id_bahan     TEXT NOT NULL,
    jenis        TEXT NOT NULL,           -- ADJUST | PURCHASE | SALE
    qty          NUMERIC NOT NULL DEFAULT 0,
    stok_akhir   NUMERIC,
    catatan      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (outlet_id, id_transaksi)
  );`;

  await sql`CREATE TABLE IF NOT EXISTS app_config (
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    key         TEXT NOT NULL,
    value       TEXT,
    PRIMARY KEY (outlet_id, key)
  );`;

  // Per-outlet atomic counters. Used for date-scoped daily sequences
  // (name = "po:YYYYMMDD", "pj:YYYYMMDD", "adj:YYYYMMDD") so ids reset per day.
  await sql`CREATE TABLE IF NOT EXISTS counters (
    outlet_id   TEXT NOT NULL REFERENCES outlets(id),
    name        TEXT NOT NULL,
    value       BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (outlet_id, name)
  );`;

  // ─── Modul baru: Transaksi Harian & Dashboard Stok ─────────────────────────
  // TIDAK ada tabel master item terpisah — sumber item langsung dari `bahan`
  // (tabel Inventory yang sudah ada di atas). daily_stock hanya menyimpan
  // mutasi harian per (outlet, tanggal, bahan), 1 baris per kombinasi itu.

  // Migrasi self-healing dari revisi sebelumnya: kalau instalasi ini pernah
  // menjalankan skema lama (daily_stock berkolom item_id + FK ke
  // master_items), CREATE TABLE IF NOT EXISTS di bawah tidak akan membuat
  // ulang tabelnya — jadi kolom id_bahan yang dipakai kode saat ini tidak
  // akan pernah ada. Deteksi kondisi itu lewat information_schema (query ini
  // aman & selalu mengembalikan 0 baris kalau daily_stock belum pernah ada
  // sama sekali) dan drop tabel lama supaya dibuat ulang dengan struktur
  // baru. Aman dijalankan tiap cold start: setelah migrasi pertama sukses,
  // kolom item_id sudah tidak ada lagi sehingga blok ini jadi no-op.
  const { rows: legacyCols } = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'daily_stock' AND column_name = 'item_id';
  `;
  if (legacyCols.length > 0) {
    await sql`DROP TABLE IF EXISTS daily_stock CASCADE;`;
  }
  // Tabel master_items dari revisi sebelumnya sudah tidak dipakai sama sekali.
  await sql`DROP TABLE IF EXISTS master_items CASCADE;`;

  await sql`CREATE TABLE IF NOT EXISTS daily_stock (
    id           SERIAL PRIMARY KEY,
    outlet_id    TEXT NOT NULL REFERENCES outlets(id),
    record_date  DATE NOT NULL,
    id_bahan     TEXT NOT NULL,

    -- Kolom mutasi (qty per jalur masuk/keluar).
    beg_balance  NUMERIC NOT NULL DEFAULT 0,
    receiving    NUMERIC NOT NULL DEFAULT 0,
    regular      NUMERIC NOT NULL DEFAULT 0,
    snack        NUMERIC NOT NULL DEFAULT 0,
    backcharge   NUMERIC NOT NULL DEFAULT 0,
    hkl          NUMERIC NOT NULL DEFAULT 0,
    event        NUMERIC NOT NULL DEFAULT 0,
    ent          NUMERIC NOT NULL DEFAULT 0,
    to_qty       NUMERIC NOT NULL DEFAULT 0,
    spoil        NUMERIC NOT NULL DEFAULT 0,

    -- Derived: beg_balance + receiving − (regular+snack+backcharge+hkl+event+ent+to_qty+spoil).
    -- Disimpan (bukan dihitung on-the-fly) supaya dashboard/report tinggal SELECT.
    balance      NUMERIC NOT NULL DEFAULT 0,

    created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (outlet_id, id_bahan) REFERENCES bahan (outlet_id, id) ON DELETE RESTRICT,
    -- Satu baris per bahan per outlet per tanggal — mencegah entri ganda di hari yang sama.
    UNIQUE (outlet_id, record_date, id_bahan)
  );`;
  // Pola akses utama: semua baris 1 outlet pada 1 tanggal (halaman transaksi harian).
  await sql`CREATE INDEX IF NOT EXISTS idx_daily_stock_outlet_date
    ON daily_stock (outlet_id, record_date);`;
  // Riwayat pergerakan 1 bahan lintas tanggal (kartu stok per bahan).
  await sql`CREATE INDEX IF NOT EXISTS idx_daily_stock_bahan
    ON daily_stock (outlet_id, id_bahan);`;
}

// ─── Seeding (only if the first outlet does not yet exist) ───────────────────
//
// All 10 outlets are seeded with one batched multi-row INSERT per table, so
// first-request provisioning stays a handful of round trips instead of ~900.
// Runs under the provisioning advisory lock, so it cannot interleave with a
// concurrent cold start.

async function batchInsert(table, cols, rows, conflictClause = '') {
  if (rows.length === 0) return;
  const params = [];
  const values = rows
    .map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`)
    .join(',');
  await sql.query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values} ${conflictClause};`,
    params,
  );
}

async function seedIfEmpty() {
  const { rows } = await sql`SELECT 1 FROM outlets WHERE id = ${OUTLETS[0].id} LIMIT 1;`;
  if (rows.length > 0) return; // already seeded

  const today = new Date().toISOString().slice(0, 10);

  await batchInsert(
    'outlets', ['id', 'code', 'name', 'active'],
    OUTLETS.map((o) => [o.id, o.code, o.name, true]),
    'ON CONFLICT (id) DO NOTHING',
  );

  const userRows = [];
  OUTLETS.forEach((o, i) => {
    for (const t of USER_TEMPLATE) {
      const { salt, hash } = hashPassword(t.password);
      const role = i === 0 && t.roleFirst ? t.roleFirst : t.role;
      userRows.push([`U${o.id.slice(3)}${t.key}`, o.id, t.username, hash, salt, role, true]);
    }
  });
  await batchInsert(
    'users', ['id', 'outlet_id', 'username', 'password_hash', 'salt', 'role', 'active'],
    userRows, 'ON CONFLICT (id) DO NOTHING',
  );

  await batchInsert(
    'bahan', ['id', 'outlet_id', 'nama', 'satuan_beli', 'satuan_pakai', 'konversi', 'harga_rata2', 'harga_sebelumnya', 'active'],
    OUTLETS.flatMap((o) => SEED.bahan.map((b) =>
      [b.ID_BAHAN, o.id, b.NAMA_BAHAN, b.SATUAN_BELI, b.SATUAN_PAKAI, b.KONVERSI, b.HARGA_RATA2, b.HARGA_SEBELUMNYA, true])),
    'ON CONFLICT (outlet_id, id) DO NOTHING',
  );

  await batchInsert(
    'produk', ['id', 'outlet_id', 'nama', 'kategori', 'harga_jual', 'yield_pcs', 'active'],
    OUTLETS.flatMap((o) => SEED.produk.map((p) =>
      [p.ID_PRODUK, o.id, p.NAMA_PRODUK, p.KATEGORI, p.HARGA_JUAL, p.YIELD_PCS, true])),
    'ON CONFLICT (outlet_id, id) DO NOTHING',
  );

  await batchInsert(
    'resep', ['outlet_id', 'id_produk', 'id_bahan', 'jumlah'],
    OUTLETS.flatMap((o) => SEED.resep.map((r) => [o.id, r.ID_PRODUK, r.ID_BAHAN, r.JUMLAH])),
  );

  await batchInsert(
    'supplier', ['id', 'outlet_id', 'nama', 'id_bahan', 'harga', 'satuan', 'lead_time', 'rating', 'telp', 'active'],
    OUTLETS.flatMap((o) => SEED.supplier.map((s) =>
      [s.ID_SUPPLIER, o.id, s.NAMA, s.ID_BAHAN, s.HARGA, s.SATUAN, s.LEAD_TIME, s.RATING, s.TELP, true])),
    'ON CONFLICT (outlet_id, id) DO NOTHING',
  );

  await batchInsert(
    'pembelian', ['id_po', 'outlet_id', 'tanggal', 'id_bahan', 'id_supplier', 'qty', 'harga_beli', 'total', 'status'],
    OUTLETS.flatMap((o) => SEED.pembelian.map((p) =>
      [p.ID_PO, o.id, p.TANGGAL, p.ID_BAHAN, p.ID_SUPPLIER, p.QTY, p.HARGA_BELI, p.TOTAL, p.STATUS])),
    'ON CONFLICT (outlet_id, id_po) DO NOTHING',
  );

  await batchInsert(
    'stok', ['outlet_id', 'id_bahan', 'stok', 'min_stok'],
    OUTLETS.flatMap((o) => SEED.stok.map((s) => [o.id, s.ID_BAHAN, s.STOK, s.MIN_STOK])),
    'ON CONFLICT (outlet_id, id_bahan) DO NOTHING',
  );

  await batchInsert(
    'penjualan', ['outlet_id', 'id_produk', 'qty', 'tanggal'],
    OUTLETS.flatMap((o) => SEED.penjualan.map((j) => [o.id, j.ID_PRODUK, j.QTY, today])),
  );

  // Seed each outlet's per-day PO counters (po:YYYYMMDD) up to the number of
  // seeded POs on that date, so a new PO on a seeded date continues the daily
  // sequence instead of colliding with seed rows.
  const poPerDay = {};
  SEED.pembelian.forEach((p) => {
    const compact = p.TANGGAL.replace(/-/g, '');
    poPerDay[compact] = (poPerDay[compact] || 0) + 1;
  });
  const counterRows = [];
  OUTLETS.forEach((o) => {
    for (const [compact, count] of Object.entries(poPerDay)) {
      counterRows.push([o.id, `po:${compact}`, count]);
    }
  });
  await batchInsert(
    'counters', ['outlet_id', 'name', 'value'],
    counterRows, 'ON CONFLICT (outlet_id, name) DO NOTHING',
  );
}
