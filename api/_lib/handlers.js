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
    // PO yang sudah dibatalkan (status='Void') tidak dihitung sebagai
    // belanja — kalau ikut dijumlah, total belanja jadi lebih besar dari
    // yang sebenarnya dikeluarkan.
    sql`SELECT COALESCE(SUM(total),0) AS t, COUNT(*)::int AS c
        FROM pembelian WHERE outlet_id = ${s.outletId} AND status != 'Void'
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
  const provided = b.ID_BAHAN && String(b.ID_BAHAN).trim();
  // Optional opening stock is written in the SAME transaction as the bahan, so
  // a retry after a partial failure can never leave a bahan without its stock
  // (or create a duplicate). The id is retried on a unique collision.
  const setStock = b.STOK != null || b.MIN_STOK != null;
  const client = await db.connect();
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const id = provided || await genId(s.outletId, 'bahan', 'B');
      try {
        await client.sql`BEGIN`;
        await client.sql`INSERT INTO bahan (id, outlet_id, nama, satuan_beli, satuan_pakai, konversi, harga_rata2, harga_sebelumnya, active)
                  VALUES (${id}, ${s.outletId}, ${b.NAMA_BAHAN}, ${b.SATUAN_BELI}, ${b.SATUAN_PAKAI},
                          ${num(b.KONVERSI) || 1}, ${num(b.HARGA_RATA2)}, ${num(b.HARGA_SEBELUMNYA ?? b.HARGA_RATA2)}, TRUE);`;
        if (setStock) {
          await client.sql`INSERT INTO stok (outlet_id, id_bahan, stok, min_stok)
                    VALUES (${s.outletId}, ${id}, ${num(b.STOK)}, ${num(b.MIN_STOK)})
                    ON CONFLICT (outlet_id, id_bahan) DO UPDATE SET stok=${num(b.STOK)}, min_stok=${num(b.MIN_STOK)};`;
        }
        await client.sql`COMMIT`;
        return ok({ ID_BAHAN: id });
      } catch (e) {
        try { await client.sql`ROLLBACK`; } catch { /* ignore */ }
        if (e?.code === '23505' && !provided && attempt < 5) continue; // id race — regen & retry
        throw e;
      }
    }
  } finally {
    client.release();
  }
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
  const id = await insertWithGenId(s.outletId, 'produk', 'P', b.ID_PRODUK, (id) =>
    sql`INSERT INTO produk (id, outlet_id, nama, kategori, harga_jual, yield_pcs, active)
        VALUES (${id}, ${s.outletId}, ${b.NAMA_PRODUK}, ${b.KATEGORI}, ${num(b.HARGA_JUAL)}, ${num(b.YIELD_PCS) || 1}, TRUE);`);
  return ok({ ID_PRODUK: id });
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
  const id = await insertWithGenId(s.outletId, 'supplier', 'S', b.ID_SUPPLIER, (id) =>
    sql`INSERT INTO supplier (id, outlet_id, nama, id_bahan, harga, satuan, lead_time, rating, telp, active)
        VALUES (${id}, ${s.outletId}, ${b.NAMA}, ${b.ID_BAHAN}, ${num(b.HARGA)}, ${b.SATUAN},
                ${num(b.LEAD_TIME)}, ${num(b.RATING)}, ${b.TELP}, TRUE);`);
  return ok({ ID_SUPPLIER: id });
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

  // PO id (date-based PO-YYYYMMDD-NNN), the purchase insert, the stock update
  // and the movement-ledger row all run in one transaction with an atomic
  // per-day counter, so concurrent requests can neither pick the same id_po nor
  // leave a purchase committed without its matching stock change.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    const id = (b.ID_PO && String(b.ID_PO).trim()) || await genDatedId(client, s.outletId, 'PO', tanggal);
    await client.sql`INSERT INTO pembelian (id_po, outlet_id, tanggal, id_bahan, id_supplier, qty, harga_beli, total, status)
              VALUES (${id}, ${s.outletId}, ${tanggal}, ${b.ID_BAHAN}, ${b.ID_SUPPLIER}, ${qty}, ${harga}, ${total}, ${status});`;
    if (status === 'Diterima') {
      const { rows } = await client.sql`INSERT INTO stok (outlet_id, id_bahan, stok, min_stok)
                VALUES (${s.outletId}, ${b.ID_BAHAN}, ${qty}, 0)
                ON CONFLICT (outlet_id, id_bahan) DO UPDATE SET stok = stok.stok + ${qty}
                RETURNING stok;`;
      await client.sql`INSERT INTO stok_movements (id_transaksi, outlet_id, tanggal, id_bahan, jenis, qty, stok_akhir)
                VALUES (${id}, ${s.outletId}, ${tanggal}, ${b.ID_BAHAN}, 'PURCHASE', ${qty}, ${num(rows[0].stok)})
                ON CONFLICT (outlet_id, id_transaksi) DO NOTHING;`;
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
// Hapus permanen satu baris pembelian. Hanya boleh untuk PO yang statusnya
// sudah 'Void' — stok sudah dikembalikan saat void, jadi hapus di sini
// murni membuang catatan lama, tidak menyentuh stok lagi. PO yang masih
// 'Diterima'/'Pending' TIDAK bisa langsung dihapus (harus dibatalkan/void
// dulu), supaya histori pembelian yang masih berlaku tidak pernah hilang
// tanpa sengaja.
async function apiInvPurchaseDelete(p) {
  const s = await requireSession(p);
  const id = p.ID_PO || p.id;
  const { rows } = await sql`
    DELETE FROM pembelian
    WHERE outlet_id=${s.outletId} AND id_po=${id} AND status='Void'
    RETURNING id_po;`;
  if (!rows[0]) {
    const err = new Error('PO tidak ditemukan atau belum dibatalkan (void) — batalkan dulu sebelum menghapus.');
    err.code = 'NOT_VOID';
    throw err;
  }
  return ok({ ID_PO: id, deleted: true });
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
  const qty = num(b.QTY);
  const tanggal = b.TANGGAL || new Date().toISOString().slice(0, 10);
  // Date-based sales id (PJ-YYYYMMDD-NNN) allocated atomically per day.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    const idTx = await genDatedId(client, s.outletId, 'PJ', tanggal);
    await client.sql`INSERT INTO penjualan (outlet_id, id_transaksi, id_produk, qty, tanggal)
              VALUES (${s.outletId}, ${idTx}, ${b.ID_PRODUK}, ${qty}, ${tanggal});`;
    await client.sql`COMMIT`;
    return ok({ ID_TRANSAKSI: idTx, ID_PRODUK: b.ID_PRODUK });
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
async function apiInvAdjustment(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  const stokBaru = num(b.STOK), minStok = num(b.MIN_STOK);
  const tanggal = b.TANGGAL || new Date().toISOString().slice(0, 10);
  // Set stock and record a dated movement (ADJ-YYYYMMDD-NNN) in one transaction.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    await client.sql`INSERT INTO stok (outlet_id, id_bahan, stok, min_stok)
              VALUES (${s.outletId}, ${b.ID_BAHAN}, ${stokBaru}, ${minStok})
              ON CONFLICT (outlet_id, id_bahan) DO UPDATE SET stok=${stokBaru}, min_stok=${minStok};`;
    const idTx = await genDatedId(client, s.outletId, 'ADJ', tanggal);
    await client.sql`INSERT INTO stok_movements (id_transaksi, outlet_id, tanggal, id_bahan, jenis, qty, stok_akhir, catatan)
              VALUES (${idTx}, ${s.outletId}, ${tanggal}, ${b.ID_BAHAN}, 'ADJUST', ${stokBaru}, ${stokBaru}, ${b.CATATAN || null});`;
    await client.sql`COMMIT`;
    return ok({ ID_BAHAN: b.ID_BAHAN, ID_TRANSAKSI: idTx });
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Generate the next master-data id (e.g. B011, P006, S019) for an outlet by
// taking the highest existing numeric suffix + 1. `table` is a fixed internal
// identifier (never user input), so template interpolation here is safe.
async function genId(outletId, table, prefix) {
  const { rows } = await sql.query(`SELECT id FROM ${table} WHERE outlet_id = $1`, [outletId]);
  let max = 0;
  for (const r of rows) {
    const m = String(r.id).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// Insert a master row whose id is either supplied or auto-generated, retrying
// with a fresh suffix if a concurrent create raced onto the same id (unique
// violation 23505). Only auto-generated ids are retried; an explicit duplicate
// id surfaces the error as before.
async function insertWithGenId(outletId, table, prefix, providedId, doInsert) {
  const provided = providedId && String(providedId).trim();
  for (let attempt = 0; attempt < 6; attempt++) {
    const id = provided || await genId(outletId, table, prefix);
    try {
      await doInsert(id);
      return id;
    } catch (e) {
      if (e?.code === '23505' && !provided && attempt < 5) continue;
      throw e;
    }
  }
}

// Date-based transaction id: PREFIX-YYYYMMDD-NNN, where NNN is a per-day
// sequence allocated atomically from the counters table (name "prefix:date").
// Must be called with a transaction-scoped client so the counter bump commits
// (or rolls back) together with the row it identifies.
async function genDatedId(client, outletId, prefix, dateStr) {
  const compact = String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10).replace(/-/g, '');
  const name = `${prefix.toLowerCase()}:${compact}`;
  const { rows } = await client.sql`
    INSERT INTO counters (outlet_id, name, value) VALUES (${outletId}, ${name}, 1)
    ON CONFLICT (outlet_id, name) DO UPDATE SET value = counters.value + 1
    RETURNING value;`;
  return `${prefix}-${compact}-${String(rows[0].value).padStart(3, '0')}`;
}

// ─── Maintenance: hapus sisa data contoh (seed lama) ─────────────────────────
// Database yang sudah terlanjur di-provision SEBELUM data contoh dibuang dari
// seed.js masih menyimpan baris-baris contoh itu (seedIfEmpty() tidak jalan
// lagi begitu outlet sudah ada, jadi mengubah seed.js saja tidak membersihkan
// apa pun). Handler ini menghapus HANYA baris ber-ID contoh yang dikenal, di
// outlet milik sesi yang memanggil. Data yang diinput lewat aplikasi selalu
// mendapat id hasil genId() (B011+, P006+, S019+, PO bernomor sendiri),
// sehingga tidak pernah bertabrakan dengan id di bawah dan tidak pernah ikut
// terhapus.
const SEED_BAHAN_IDS    = Array.from({ length: 10 }, (_, i) => `B${String(i + 1).padStart(3, '0')}`);
const SEED_PRODUK_IDS   = Array.from({ length: 5 },  (_, i) => `P${String(i + 1).padStart(3, '0')}`);
const SEED_SUPPLIER_IDS = Array.from({ length: 18 }, (_, i) => `S${String(i + 1).padStart(3, '0')}`);

async function apiPurgeSeedData(p) {
  const s = await requireSession(p);
  const o = s.outletId;
  const deleted = {};
  const countOf = (r) => Number(r.rows?.[0]?.c ?? 0);

  deleted.resep = countOf(await sql`SELECT COUNT(*)::int AS c FROM resep WHERE outlet_id=${o} AND (id_produk = ANY(${SEED_PRODUK_IDS}) OR id_bahan = ANY(${SEED_BAHAN_IDS}));`);
  await sql`DELETE FROM resep WHERE outlet_id=${o} AND (id_produk = ANY(${SEED_PRODUK_IDS}) OR id_bahan = ANY(${SEED_BAHAN_IDS}));`;

  deleted.pembelian = countOf(await sql`SELECT COUNT(*)::int AS c FROM pembelian WHERE outlet_id=${o} AND id_po LIKE 'PO-2026%';`);
  await sql`DELETE FROM pembelian WHERE outlet_id=${o} AND id_po LIKE 'PO-2026%';`;

  deleted.stok = countOf(await sql`SELECT COUNT(*)::int AS c FROM stok WHERE outlet_id=${o} AND id_bahan = ANY(${SEED_BAHAN_IDS});`);
  await sql`DELETE FROM stok WHERE outlet_id=${o} AND id_bahan = ANY(${SEED_BAHAN_IDS});`;

  deleted.stok_movements = countOf(await sql`SELECT COUNT(*)::int AS c FROM stok_movements WHERE outlet_id=${o} AND id_bahan = ANY(${SEED_BAHAN_IDS});`);
  await sql`DELETE FROM stok_movements WHERE outlet_id=${o} AND id_bahan = ANY(${SEED_BAHAN_IDS});`;

  deleted.penjualan = countOf(await sql`SELECT COUNT(*)::int AS c FROM penjualan WHERE outlet_id=${o} AND id_produk = ANY(${SEED_PRODUK_IDS});`);
  await sql`DELETE FROM penjualan WHERE outlet_id=${o} AND id_produk = ANY(${SEED_PRODUK_IDS});`;

  deleted.supplier = countOf(await sql`SELECT COUNT(*)::int AS c FROM supplier WHERE outlet_id=${o} AND id = ANY(${SEED_SUPPLIER_IDS});`);
  await sql`DELETE FROM supplier WHERE outlet_id=${o} AND id = ANY(${SEED_SUPPLIER_IDS});`;

  deleted.produk = countOf(await sql`SELECT COUNT(*)::int AS c FROM produk WHERE outlet_id=${o} AND id = ANY(${SEED_PRODUK_IDS});`);
  await sql`DELETE FROM produk WHERE outlet_id=${o} AND id = ANY(${SEED_PRODUK_IDS});`;

  deleted.bahan = countOf(await sql`SELECT COUNT(*)::int AS c FROM bahan WHERE outlet_id=${o} AND id = ANY(${SEED_BAHAN_IDS});`);
  await sql`DELETE FROM bahan WHERE outlet_id=${o} AND id = ANY(${SEED_BAHAN_IDS});`;

  await sql`DELETE FROM counters WHERE outlet_id=${o} AND name LIKE 'po:202606%';`;

  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  return ok({ deleted, total });
}

// ─── Transaksi Harian & Dashboard Stok ───────────────────────────────────────
// Sumber item = tabel `bahan` (Inventory, sudah ada) — TIDAK ada tabel/CRUD
// master item terpisah. Skema tabel daily_stock: lihat migrasi di db.js →
// createSchema().

// Kolom mutasi harian, urutan tampil di tabel Transaksi Harian & Dashboard
// Stok. isOutflow menandai kolom yang MENGURANGI Balance (semua kecuali
// Beg. Balance & Receiving). Hanya 4 kolom yang dipakai — Snack, Backcharge,
// HKL, Event, Ent, TO dihapus sesuai kebutuhan (tidak relevan untuk retail).
const MOVEMENT_COLUMNS = [
  { key: 'beg_balance', out: 'BEG_BALANCE', isOutflow: false },
  { key: 'receiving', out: 'RECEIVING', isOutflow: false },
  { key: 'regular', out: 'REGULAR', isOutflow: true },
  { key: 'spoil', out: 'SPOIL', isOutflow: true },
];
// Kolom yang diinput user — semua kecuali beg_balance, yang selalu auto dari
// Balance tanggal sebelumnya (read-only, tidak pernah dipercaya dari client).
const EDITABLE_MOVEMENT_KEYS = MOVEMENT_COLUMNS.filter((c) => c.key !== 'beg_balance').map((c) => c.key);

// Balance = Beg.Balance + Receiving − Regular − Spoil.
function computeBalance(m) {
  return num(m.beg_balance) + num(m.receiving) - num(m.regular) - num(m.spoil);
}

// "YYYY-MM-DD" + n hari (n boleh negatif), tanpa dependensi tanggal eksternal.
function isoDateAddDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
    const err = new Error('Tanggal harus dalam format YYYY-MM-DD.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
}

// ─── Transaksi Harian (daily_stock): gabungan view per tanggal ─────────────
//
// Setiap bahan aktif (dari Inventory) ditampilkan satu baris — baik sudah
// pernah disimpan untuk tanggal ini (PERSISTED=true, isi dari daily_stock)
// maupun belum (baris kosong, PERSISTED=false, hanya Beg. Balance yang
// terisi). BEG_BALANCE selalu diturunkan LIVE dari Balance tanggal
// sebelumnya — bukan dibekukan saat baris pertama kali disimpan — supaya
// koreksi di hari sebelumnya otomatis mengalir ke hari ini.

async function buildDailyStockView(outletId, date) {
  const prevDate = isoDateAddDays(date, -1);
  const [{ rows: items }, { rows: current }, { rows: previous }] = await Promise.all([
    sql`SELECT * FROM bahan WHERE outlet_id=${outletId} AND active=TRUE ORDER BY nama;`,
    sql`SELECT * FROM daily_stock WHERE outlet_id=${outletId} AND record_date=${date};`,
    sql`SELECT id_bahan, balance FROM daily_stock WHERE outlet_id=${outletId} AND record_date=${prevDate};`,
  ]);

  const currentByItem = new Map(current.map((r) => [r.id_bahan, r]));
  const prevBalanceByItem = new Map(previous.map((r) => [r.id_bahan, num(r.balance)]));

  return items.map((item) => {
    const stored = currentByItem.get(item.id);
    const begBalance = prevBalanceByItem.get(item.id) ?? 0;
    const m = stored
      ? { beg_balance: begBalance, receiving: stored.receiving, regular: stored.regular, spoil: stored.spoil }
      : { beg_balance: begBalance, receiving: 0, regular: 0, spoil: 0 };

    return {
      // Data bahan langsung dari Inventory — tidak ada katalog terpisah.
      ID_BAHAN: item.id, NAMA: item.nama, SATUAN: item.satuan_pakai, HARGA: num(item.harga_rata2),
      BEG_BALANCE: num(m.beg_balance), RECEIVING: num(m.receiving), REGULAR: num(m.regular), SPOIL: num(m.spoil),
      BALANCE: computeBalance(m),
      PERSISTED: !!stored,
    };
  });
}

async function apiDailyStockView(p) {
  const s = await requireSession(p);
  const date = p.TANGGAL || p.date || new Date().toISOString().slice(0, 10);
  assertValidDate(date);
  const rows = await buildDailyStockView(s.outletId, date);
  return ok(rows);
}

// Simpan/revisi transaksi harian untuk satu tanggal (batch, 1 baris per
// bahan). BEG_BALANCE & BALANCE yang dikirim client SELALU diabaikan —
// dihitung ulang di server dari Balance tanggal sebelumnya, supaya ledger
// tidak bisa "diakali" dari sisi client. ON CONFLICT pada (outlet_id,
// record_date, id_bahan) berarti menyimpan ulang tanggal yang sama = revisi,
// bukan baris baru — cocok untuk "mengecek transaksi harian yang sudah
// digunakan/disimpan".
async function apiDailyStockSave(p) {
  const s = await requireSession(p);
  const b = p.data || p;
  const date = b.TANGGAL || b.date;
  assertValidDate(date);

  const entries = Array.isArray(b.ENTRIES) ? b.ENTRIES : [];
  if (entries.length === 0) { const e = new Error('Minimal satu entri diperlukan.'); e.code = 'BAD_REQUEST'; throw e; }

  const seen = new Set();
  const parsed = entries.map((raw) => {
    const idBahan = String(raw.ID_BAHAN || '').trim();
    if (!idBahan) { const e = new Error('Setiap entri butuh ID_BAHAN.'); e.code = 'BAD_REQUEST'; throw e; }
    if (seen.has(idBahan)) { const e = new Error(`Entri ganda untuk bahan ${idBahan}.`); e.code = 'BAD_REQUEST'; throw e; }
    seen.add(idBahan);
    const m = {};
    for (const key of EDITABLE_MOVEMENT_KEYS) {
      const col = MOVEMENT_COLUMNS.find((c) => c.key === key);
      const n = num(raw[col.out]);
      if (!Number.isFinite(n) || n < 0) { const e = new Error(`Kolom "${col.out}" tidak valid.`); e.code = 'BAD_REQUEST'; throw e; }
      m[key] = n;
    }
    return { idBahan, ...m };
  });

  // Validasi terhadap Inventory yang sudah ada — bukan katalog terpisah.
  const idBahanList = parsed.map((e) => e.idBahan);
  const { rows: knownRows } = await sql`SELECT id FROM bahan WHERE outlet_id=${s.outletId} AND id = ANY(${idBahanList});`;
  const knownIds = new Set(knownRows.map((r) => r.id));
  const unknown = idBahanList.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    const e = new Error(`Bahan tidak dikenal di Inventory: ${unknown.slice(0, 3).join(', ')}`);
    e.code = 'BAD_REQUEST';
    throw e;
  }

  const prevDate = isoDateAddDays(date, -1);
  const [{ rows: prevRows }, { rows: existingRows }] = await Promise.all([
    sql`SELECT id_bahan, balance FROM daily_stock WHERE outlet_id=${s.outletId} AND record_date=${prevDate} AND id_bahan = ANY(${idBahanList});`,
    sql`SELECT id_bahan FROM daily_stock WHERE outlet_id=${s.outletId} AND record_date=${date} AND id_bahan = ANY(${idBahanList});`,
  ]);
  const prevBalanceByItem = new Map(prevRows.map((r) => [r.id_bahan, num(r.balance)]));
  const existingIds = new Set(existingRows.map((r) => r.id_bahan));

  // Satu transaksi DB untuk seluruh batch: kalau salah satu entri gagal,
  // tidak ada baris yang tersimpan separuh untuk tanggal ini.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    for (const e of parsed) {
      const begBalance = prevBalanceByItem.get(e.idBahan) ?? 0;
      const balance = computeBalance({ beg_balance: begBalance, ...e });
      await client.sql`
        INSERT INTO daily_stock (outlet_id, record_date, id_bahan, beg_balance, receiving, regular,
                                  spoil, balance, created_by, updated_by)
        VALUES (${s.outletId}, ${date}, ${e.idBahan}, ${begBalance}, ${e.receiving}, ${e.regular},
                ${e.spoil}, ${balance}, ${s.userId}, ${s.userId})
        ON CONFLICT (outlet_id, record_date, id_bahan) DO UPDATE SET
          beg_balance=${begBalance}, receiving=${e.receiving}, regular=${e.regular}, spoil=${e.spoil},
          balance=${balance}, updated_by=${s.userId}, updated_at=NOW();`;
    }
    await client.sql`COMMIT`;
  } catch (err) {
    try { await client.sql`ROLLBACK`; } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

  const revised = parsed.filter((e) => existingIds.has(e.idBahan)).length;
  return ok({ saved: parsed.length, created: parsed.length - revised, revised });
}

// ─── Dashboard Stok: rekap nilai Rp dari view Transaksi Harian ─────────────
//
// Memakai view yang sama dengan Transaksi Harian (buildDailyStockView), lalu
// disaring per QUERY (cari nama bahan) dan direkap: nilai Rp per kolom
// mutasi (Harga × Qty), total masuk/keluar, dan total nilai stok
// (Balance × Harga).

async function apiDashboardStok(p) {
  const s = await requireSession(p);
  const date = p.TANGGAL || p.date || new Date().toISOString().slice(0, 10);
  assertValidDate(date);
  const q = String(p.QUERY || p.query || '').trim().toLowerCase();

  const all = await buildDailyStockView(s.outletId, date);
  const rows = q ? all.filter((r) => r.NAMA.toLowerCase().includes(q)) : all;

  const perColumn = {};
  for (const c of MOVEMENT_COLUMNS) perColumn[c.out] = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalStockValue = 0;
  for (const r of rows) {
    for (const c of MOVEMENT_COLUMNS) {
      const value = r.HARGA * r[c.out];
      perColumn[c.out] += value;
      if (c.isOutflow) totalOut += value; else totalIn += value;
    }
    totalStockValue += r.BALANCE * r.HARGA;
  }

  return ok({
    rows,
    summary: { perColumn, totalIn, totalOut, balanceValue: totalIn - totalOut, totalStockValue },
    counts: { total: all.length, shown: rows.length },
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
  apiInvPurchaseCreate: 'ADMIN', apiInvPurchaseVoid: 'ADMIN', apiInvPurchaseDelete: 'ADMIN', apiInvAdjustment: 'ADMIN',
  apiSetAppConfig: 'ADMIN',
  // maintenance: purge sisa data contoh (hanya pemilik outlet tertinggi)
  apiPurgeSeedData: 'SUPER_ADMIN',
  // cashier-level: recording sales
  apiInvSalesCreate: 'KASIR',

  // Transaksi Harian — dibuka ke STAFF ke atas (asumsi: diisi petugas
  // gudang/kasir tiap hari, berdasarkan bahan yang sudah ada di Inventory).
  // Ubah minimum role di sini kalau kebutuhan bisnisnya berbeda.
  apiDailyStockSave: 'STAFF',
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
  // reads (Transaksi Harian & Dashboard Stok — bersumber dari bahan/Inventory)
  apiDailyStockView, apiDashboardStok,
  // master writes
  apiBahanCreate, apiBahanUpdate, apiBahanDeactivate, apiBahanReactivate,
  apiProdukCreate, apiProdukUpdate, apiProdukDeactivate, apiProdukReactivate,
  apiSupplierCreate, apiSupplierUpdate, apiSupplierDeactivate, apiSupplierReactivate,
  // recipe writes
  apiResepAddItem, apiResepUpdateItem, apiResepDeleteItem,
  // inventory writes
  apiInvPurchaseCreate, apiInvPurchaseVoid, apiInvPurchaseDelete, apiInvSalesCreate, apiInvAdjustment,
  // config
  apiSetAppConfig,
  // maintenance
  apiPurgeSeedData,
  // writes (Transaksi Harian — bersumber dari bahan/Inventory)
  apiDailyStockSave,
};

// Apply per-action role guards (reads/auth pass through untouched).
export const HANDLERS = Object.fromEntries(
  Object.entries(RAW_HANDLERS).map(([name, fn]) => [name, guard(name, fn)]),
);
