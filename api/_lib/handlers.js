// ═══════════════════════════════════════════════════════════════════════════
// api/_lib/handlers.js
// All api* action handlers (the Postgres replacement for the .gs modules).
//
// Response conventions (kept identical to the old GAS layer so the frontend
// needs no shape changes):
//   • Read endpoints  → { success: true, data: [...] | {...} }
//   • Auth endpoints  → { success: true, token, session }
//   • Failures        → { success: false, code, message }  (client rejects)
//
// Every data endpoint is scoped to the caller's outlet via requireSession().
// ═══════════════════════════════════════════════════════════════════════════

import { sql, db } from './db.js';
import { login, logout, validateSession, requireSession, requireRole } from './auth.js';

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const ok = (data) => ({ success: true, data });

// ─── Mappers (NUMERIC comes back from pg as string → coerce to Number) ──────

const mapBahan = (r) => ({
  ID_BAHAN: r.id, NAMA_BAHAN: r.nama,
  SATUAN_BELI: r.satuan_beli, SATUAN_PAKAI: r.satuan_pakai,
  KONVERSI: num(r.konversi), HARGA_RATA2: num(r.harga_rata2),
  HARGA_SEBELUMNYA: num(r.harga_sebelumnya), AKTIF: r.active,
});
const mapProduk = (r) => ({
  ID_PRODUK: r.id, NAMA_PRODUK: r.nama, KATEGORI: r.kategori,
  HARGA_JUAL: num(r.harga_jual), YIELD_PCS: num(r.yield_pcs), AKTIF: r.active,
});
const mapResep = (r) => ({ ID_PRODUK: r.id_produk, ID_BAHAN: r.id_bahan, JUMLAH: num(r.jumlah) });
const mapSupplier = (r) => ({
  ID_SUPPLIER: r.id, NAMA: r.nama, ID_BAHAN: r.id_bahan, HARGA: num(r.harga),
  SATUAN: r.satuan, LEAD_TIME: num(r.lead_time), RATING: num(r.rating), TELP: r.telp, AKTIF: r.active,
});
const mapPembelian = (r) => ({
  ID_PO: r.id_po,
  TANGGAL: r.tanggal instanceof Date ? r.tanggal.toISOString().slice(0, 10) : String(r.tanggal).slice(0, 10),
  ID_BAHAN: r.id_bahan, ID_SUPPLIER: r.id_supplier, QTY: num(r.qty),
  HARGA_BELI: num(r.harga_beli), TOTAL: num(r.total), STATUS: r.status,
});
const mapStok = (r) => ({ ID_BAHAN: r.id_bahan, STOK: num(r.stok), MIN_STOK: num(r.min_stok) });

// ─── Auth ───────────────────────────────────────────────────────────────────

const authHandlers = {
  apiLogin:           (p) => login(p),
  apiLogout:          (p) => logout(p),
  apiValidateSession: (p) => validateSession(p),
};

// ─── Master data: read ───────────────────────────────────────────────────────

async function apiGetBahanAll(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM bahan WHERE outlet_id = ${s.outletId} ORDER BY id;`;
  return ok(rows.map(mapBahan));
}
async function apiGetProdukAll(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM produk WHERE outlet_id = ${s.outletId} ORDER BY id;`;
  return ok(rows.map(mapProduk));
}
async function apiGetResepAll(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM resep WHERE outlet_id = ${s.outletId} ORDER BY id_produk, id_bahan;`;
  return ok(rows.map(mapResep));
}
async function apiGetSupplierAll(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM supplier WHERE outlet_id = ${s.outletId} ORDER BY id;`;
  return ok(rows.map(mapSupplier));
}
async function apiInvPurchaseAll(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM pembelian WHERE outlet_id = ${s.outletId} ORDER BY tanggal DESC, id_po DESC;`;
  return ok(rows.map(mapPembelian));
}
async function apiInvStokSemua(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM stok WHERE outlet_id = ${s.outletId} ORDER BY id_bahan;`;
  return ok(rows.map(mapStok));
}

// ─── Dashboard summary ───────────────────────────────────────────────────────

async function apiGetDashboardSummary(p) {
  const s = await requireSession(p);
  const [{ rows: penj }, { rows: bhn }, { rows: stk }, { rows: prd }, { rows: beli }] = await Promise.all([
    sql`SELECT id_produk, SUM(qty) AS qty FROM penjualan WHERE outlet_id = ${s.outletId} GROUP BY id_produk;`,
    sql`SELECT COUNT(*)::int AS c FROM bahan WHERE outlet_id = ${s.outletId} AND active;`,
    sql`SELECT COUNT(*)::int AS c FROM stok WHERE outlet_id = ${s.outletId} AND stok < min_stok;`,
    sql`SELECT COUNT(*)::int AS c FROM produk WHERE outlet_id = ${s.outletId} AND active;`,
    sql`SELECT COALESCE(SUM(total),0) AS t, COUNT(*)::int AS c
        FROM pembelian WHERE outlet_id = ${s.outletId}
        AND date_trunc('month', tanggal) = date_trunc('month', CURRENT_DATE);`,
  ]);

  return ok({
    penjualan: penj.map((r) => ({ ID_PRODUK: r.id_produk, QTY: num(r.qty) })),
    totalBahan: bhn[0]?.c ?? 0,
    totalProduk: prd[0]?.c ?? 0,
    stokMinimumCount: stk[0]?.c ?? 0,
    totalPembelianBulanIni: num(beli[0]?.t),
    jumlahTransaksiPembelian: beli[0]?.c ?? 0,
  });
}

// ─── Master data: create / update / (de)activate ─────────────────────────────

async function apiBahanCreate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO bahan (id, outlet_id, nama, satuan_beli, satuan_pakai, konversi, harga_rata2, harga_sebelumnya, active)
            VALUES (${b.ID_BAHAN}, ${s.outletId}, ${b.NAMA_BAHAN}, ${b.SATUAN_BELI}, ${b.SATUAN_PAKAI},
                    ${num(b.KONVERSI) || 1}, ${num(b.HARGA_RATA2)}, ${num(b.HARGA_SEBELUMNYA ?? b.HARGA_RATA2)}, TRUE);`;
  return ok({ ID_BAHAN: b.ID_BAHAN });
}
async function apiBahanUpdate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`UPDATE bahan SET nama=${b.NAMA_BAHAN}, satuan_beli=${b.SATUAN_BELI}, satuan_pakai=${b.SATUAN_PAKAI},
            konversi=${num(b.KONVERSI) || 1},
            harga_sebelumnya = CASE WHEN ${num(b.HARGA_RATA2)} <> harga_rata2 THEN harga_rata2 ELSE harga_sebelumnya END,
            harga_rata2=${num(b.HARGA_RATA2)}
            WHERE outlet_id=${s.outletId} AND id=${b.ID_BAHAN};`;
  return ok({ ID_BAHAN: b.ID_BAHAN });
}
async function apiBahanDeactivate(p) {
  const s = await requireSession(p);
  await sql`UPDATE bahan SET active=FALSE WHERE outlet_id=${s.outletId} AND id=${p.ID_BAHAN || p.id};`;
  return ok({ ID_BAHAN: p.ID_BAHAN || p.id });
}
async function apiBahanReactivate(p) {
  const s = await requireSession(p);
  await sql`UPDATE bahan SET active=TRUE WHERE outlet_id=${s.outletId} AND id=${p.ID_BAHAN || p.id};`;
  return ok({ ID_BAHAN: p.ID_BAHAN || p.id });
}

async function apiProdukCreate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO produk (id, outlet_id, nama, kategori, harga_jual, yield_pcs, active)
            VALUES (${b.ID_PRODUK}, ${s.outletId}, ${b.NAMA_PRODUK}, ${b.KATEGORI}, ${num(b.HARGA_JUAL)}, ${num(b.YIELD_PCS) || 1}, TRUE);`;
  return ok({ ID_PRODUK: b.ID_PRODUK });
}
async function apiProdukUpdate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`UPDATE produk SET nama=${b.NAMA_PRODUK}, kategori=${b.KATEGORI}, harga_jual=${num(b.HARGA_JUAL)}, yield_pcs=${num(b.YIELD_PCS) || 1}
            WHERE outlet_id=${s.outletId} AND id=${b.ID_PRODUK};`;
  return ok({ ID_PRODUK: b.ID_PRODUK });
}
async function apiProdukDeactivate(p) {
  const s = await requireSession(p);
  await sql`UPDATE produk SET active=FALSE WHERE outlet_id=${s.outletId} AND id=${p.ID_PRODUK || p.id};`;
  return ok({ ID_PRODUK: p.ID_PRODUK || p.id });
}
async function apiProdukReactivate(p) {
  const s = await requireSession(p);
  await sql`UPDATE produk SET active=TRUE WHERE outlet_id=${s.outletId} AND id=${p.ID_PRODUK || p.id};`;
  return ok({ ID_PRODUK: p.ID_PRODUK || p.id });
}

async function apiSupplierCreate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO supplier (id, outlet_id, nama, id_bahan, harga, satuan, lead_time, rating, telp, active)
            VALUES (${b.ID_SUPPLIER}, ${s.outletId}, ${b.NAMA}, ${b.ID_BAHAN}, ${num(b.HARGA)}, ${b.SATUAN},
                    ${num(b.LEAD_TIME)}, ${num(b.RATING)}, ${b.TELP}, TRUE);`;
  return ok({ ID_SUPPLIER: b.ID_SUPPLIER });
}
async function apiSupplierUpdate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`UPDATE supplier SET nama=${b.NAMA}, id_bahan=${b.ID_BAHAN}, harga=${num(b.HARGA)}, satuan=${b.SATUAN},
            lead_time=${num(b.LEAD_TIME)}, rating=${num(b.RATING)}, telp=${b.TELP}
            WHERE outlet_id=${s.outletId} AND id=${b.ID_SUPPLIER};`;
  return ok({ ID_SUPPLIER: b.ID_SUPPLIER });
}
async function apiSupplierDeactivate(p) {
  const s = await requireSession(p);
  await sql`UPDATE supplier SET active=FALSE WHERE outlet_id=${s.outletId} AND id=${p.ID_SUPPLIER || p.id};`;
  return ok({ ID_SUPPLIER: p.ID_SUPPLIER || p.id });
}
async function apiSupplierReactivate(p) {
  const s = await requireSession(p);
  await sql`UPDATE supplier SET active=TRUE WHERE outlet_id=${s.outletId} AND id=${p.ID_SUPPLIER || p.id};`;
  return ok({ ID_SUPPLIER: p.ID_SUPPLIER || p.id });
}

// ─── Recipe items ────────────────────────────────────────────────────────────

async function apiResepGetByProduk(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT * FROM resep WHERE outlet_id=${s.outletId} AND id_produk=${p.ID_PRODUK || p.id} ORDER BY id_bahan;`;
  return ok(rows.map(mapResep));
}
async function apiResepAddItem(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO resep (outlet_id, id_produk, id_bahan, jumlah)
            VALUES (${s.outletId}, ${b.ID_PRODUK}, ${b.ID_BAHAN}, ${num(b.JUMLAH)});`;
  return ok({ ID_PRODUK: b.ID_PRODUK, ID_BAHAN: b.ID_BAHAN });
}
async function apiResepUpdateItem(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`UPDATE resep SET jumlah=${num(b.JUMLAH)}
            WHERE outlet_id=${s.outletId} AND id_produk=${b.ID_PRODUK} AND id_bahan=${b.ID_BAHAN};`;
  return ok({ ID_PRODUK: b.ID_PRODUK, ID_BAHAN: b.ID_BAHAN });
}
async function apiResepDeleteItem(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`DELETE FROM resep WHERE outlet_id=${s.outletId} AND id_produk=${b.ID_PRODUK} AND id_bahan=${b.ID_BAHAN};`;
  return ok({ ID_PRODUK: b.ID_PRODUK, ID_BAHAN: b.ID_BAHAN });
}

// ─── Inventory: purchases, sales, stock adjustment ───────────────────────────

async function apiInvPurchaseCreate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  const qty = num(b.QTY), harga = num(b.HARGA_BELI);
  const total = num(b.TOTAL) || qty * harga;
  const status = b.STATUS || 'Diterima';
  const tanggal = b.TANGGAL || new Date().toISOString().slice(0, 10);

  // PO id allocation, the purchase insert, and the stock update run in one
  // transaction with an atomic per-outlet counter, so concurrent requests can
  // neither pick the same id_po nor leave a purchase committed without its
  // matching stock change.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    let id = b.ID_PO;
    if (!id) {
      const { rows } = await client.sql`
        INSERT INTO counters (outlet_id, name, value) VALUES (${s.outletId}, 'pembelian', 1)
        ON CONFLICT (outlet_id, name) DO UPDATE SET value = counters.value + 1
        RETURNING value;`;
      id = `PO${String(rows[0].value).padStart(3, '0')}`;
    }
    await client.sql`INSERT INTO pembelian (id_po, outlet_id, tanggal, id_bahan, id_supplier, qty, harga_beli, total, status)
              VALUES (${id}, ${s.outletId}, ${tanggal}, ${b.ID_BAHAN}, ${b.ID_SUPPLIER}, ${qty}, ${harga}, ${total}, ${status});`;
    if (status === 'Diterima') {
      await client.sql`INSERT INTO stok (outlet_id, id_bahan, stok, min_stok)
                VALUES (${s.outletId}, ${b.ID_BAHAN}, ${qty}, 0)
                ON CONFLICT (outlet_id, id_bahan) DO UPDATE SET stok = stok.stok + ${qty};`;
    }
    await client.sql`COMMIT`;
    return ok({ ID_PO: id });
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
async function apiInvPurchaseVoid(p) {
  const s = await requireSession(p);
  const id = p.ID_PO || p.id;
  // Status flip + stock reversal run in one transaction so a mid-flight
  // failure can never leave a voided purchase whose stock was not reversed.
  // The status='Diterima' guard in the WHERE also makes a double-void unable
  // to decrement stock twice.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    const { rows } = await client.sql`
      UPDATE pembelian SET status='Void'
      WHERE outlet_id=${s.outletId} AND id_po=${id} AND status='Diterima'
      RETURNING id_bahan, qty;`;
    if (rows[0]) {
      await client.sql`UPDATE stok SET stok = stok - ${num(rows[0].qty)}
                WHERE outlet_id=${s.outletId} AND id_bahan=${rows[0].id_bahan};`;
    } else {
      // Not received (or already void) — just mark it void without touching stock.
      await client.sql`UPDATE pembelian SET status='Void' WHERE outlet_id=${s.outletId} AND id_po=${id};`;
    }
    await client.sql`COMMIT`;
    return ok({ ID_PO: id });
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
async function apiInvSalesCreate(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO penjualan (outlet_id, id_produk, qty, tanggal)
            VALUES (${s.outletId}, ${b.ID_PRODUK}, ${num(b.QTY)}, ${b.TANGGAL || new Date().toISOString().slice(0, 10)});`;
  return ok({ ID_PRODUK: b.ID_PRODUK });
}
async function apiInvAdjustment(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO stok (outlet_id, id_bahan, stok, min_stok)
            VALUES (${s.outletId}, ${b.ID_BAHAN}, ${num(b.STOK)}, ${num(b.MIN_STOK)})
            ON CONFLICT (outlet_id, id_bahan)
            DO UPDATE SET stok=${num(b.STOK)}, min_stok=${num(b.MIN_STOK)};`;
  return ok({ ID_BAHAN: b.ID_BAHAN });
}

// ─── HPP (computed server-side for parity with the client engine) ────────────

async function apiGetRingkasanHPPSemua(p) {
  const s = await requireSession(p);
  const [{ rows: produk }, { rows: bahan }, { rows: resep }] = await Promise.all([
    sql`SELECT * FROM produk WHERE outlet_id=${s.outletId} AND active ORDER BY id;`,
    sql`SELECT * FROM bahan WHERE outlet_id=${s.outletId};`,
    sql`SELECT * FROM resep WHERE outlet_id=${s.outletId};`,
  ]);
  const bMap = Object.fromEntries(bahan.map((b) => [b.id, b]));
  const summary = produk.map((prod) => {
    const items = resep.filter((r) => r.id_produk === prod.id);
    let biaya = 0;
    for (const it of items) {
      const b = bMap[it.id_bahan];
      if (!b) continue;
      const perPakai = num(b.konversi) > 0 ? num(b.harga_rata2) / num(b.konversi) : 0;
      biaya += num(it.jumlah) * perPakai;
    }
    const yieldPcs = num(prod.yield_pcs) || 1;
    const hppPcs = yieldPcs > 0 ? biaya / yieldPcs : 0;
    const jual = num(prod.harga_jual);
    return {
      ID_PRODUK: prod.id, NAMA_PRODUK: prod.nama, KATEGORI: prod.kategori,
      HARGA_JUAL: jual, YIELD_PCS: yieldPcs,
      HPP_PER_BATCH: Math.round(biaya * 100) / 100,
      HPP_PER_PCS: Math.round(hppPcs * 100) / 100,
      MARGIN_PCT: jual > 0 ? Math.round(((jual - hppPcs) / jual) * 10000) / 100 : 0,
      MARGIN_RP: Math.round((jual - hppPcs) * 100) / 100,
    };
  });
  return ok(summary);
}

// ─── App config ──────────────────────────────────────────────────────────────

async function apiGetAppConfig(p) {
  const s = await requireSession(p);
  const { rows } = await sql`SELECT key, value FROM app_config WHERE outlet_id=${s.outletId};`;
  return ok(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}
async function apiSetAppConfig(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  await sql`INSERT INTO app_config (outlet_id, key, value) VALUES (${s.outletId}, ${b.key}, ${b.value})
            ON CONFLICT (outlet_id, key) DO UPDATE SET value=${b.value};`;
  return ok({ key: b.key });
}

// ─── Health / diagnostics (no auth) ──────────────────────────────────────────
// GET /api/rpc?action=apiHealth — verifies the database is attached AND fully
// provisioned: reports outlet/user counts so a deploy can be checked with one
// URL after attaching Vercel Postgres.

async function apiHealth() {
  const [{ rows: t }, { rows: o }, { rows: u }, { rows: s }] = await Promise.all([
    sql`SELECT NOW() AS now;`,
    sql`SELECT COUNT(*)::int AS c FROM outlets WHERE active;`,
    sql`SELECT COUNT(*)::int AS c FROM users WHERE active;`,
    sql`SELECT COUNT(*)::int AS c FROM sessions WHERE expires_at > NOW();`,
  ]);
  return ok({
    status: 'ok',
    db: 'connected',
    now: t[0].now,
    outlets: o[0].c,
    users: u[0].c,
    activeSessions: s[0].c,
    seeded: o[0].c > 0,
  });
}

// ─── Registry ────────────────────────────────────────────────────────────────

// Minimum role required per privileged action. Anything not listed only needs
// a valid session (enforced by requireSession inside the handler).
const ROLE_REQUIRED = {
  // master-data & recipe writes, purchase create/void, adjustment, config
  apiBahanCreate: 'ADMIN', apiBahanUpdate: 'ADMIN', apiBahanDeactivate: 'ADMIN', apiBahanReactivate: 'ADMIN',
  apiProdukCreate: 'ADMIN', apiProdukUpdate: 'ADMIN', apiProdukDeactivate: 'ADMIN', apiProdukReactivate: 'ADMIN',
  apiSupplierCreate: 'ADMIN', apiSupplierUpdate: 'ADMIN', apiSupplierDeactivate: 'ADMIN', apiSupplierReactivate: 'ADMIN',
  apiResepAddItem: 'ADMIN', apiResepUpdateItem: 'ADMIN', apiResepDeleteItem: 'ADMIN',
  apiInvPurchaseCreate: 'ADMIN', apiInvPurchaseVoid: 'ADMIN', apiInvAdjustment: 'ADMIN',
  apiSetAppConfig: 'ADMIN',
  // cashier-level: recording sales
  apiInvSalesCreate: 'KASIR',
};

// Wrap a handler so it enforces its minimum role (after authenticating the
// session) before running. Reads and auth endpoints pass through unwrapped.
function guard(name, fn) {
  const minRole = ROLE_REQUIRED[name];
  if (!minRole) return fn;
  return async (p) => {
    const s = await requireSession(p);
    requireRole(s, minRole);
    return fn(p);
  };
}

const RAW_HANDLERS = {
  ...authHandlers,
  apiHealth,
  // reads
  apiGetBahanAll, apiGetProdukAll, apiGetResepAll, apiGetSupplierAll,
  apiInvPurchaseAll, apiInvStokSemua, apiGetDashboardSummary,
  apiResepGetByProduk, apiGetRingkasanHPPSemua, apiGetAppConfig,
  // master writes
  apiBahanCreate, apiBahanUpdate, apiBahanDeactivate, apiBahanReactivate,
  apiProdukCreate, apiProdukUpdate, apiProdukDeactivate, apiProdukReactivate,
  apiSupplierCreate, apiSupplierUpdate, apiSupplierDeactivate, apiSupplierReactivate,
  // recipe writes
  apiResepAddItem, apiResepUpdateItem, apiResepDeleteItem,
  // inventory writes
  apiInvPurchaseCreate, apiInvPurchaseVoid, apiInvSalesCreate, apiInvAdjustment,
  // config
  apiSetAppConfig,
};

// Apply per-action role guards (reads/auth pass through untouched).
export const HANDLERS = Object.fromEntries(
  Object.entries(RAW_HANDLERS).map(([name, fn]) => [name, guard(name, fn)]),
);
