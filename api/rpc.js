// ═══════════════════════════════════════════════════════════════════════════
// api/rpc.js  —  Single Vercel Serverless Function entry point.
//
// The frontend calls one endpoint with { action, params } and gets back the
// same { success, data|token|session, message, code } envelope the old GAS
// google.script.run layer used. This mirrors gasRun(fnName, params) exactly,
// so the migration is transparent to the React app.
//
//   POST /api/rpc   body: { "action": "apiLogin", "params": { ... } }
//   GET  /api/rpc?action=apiHealth      (health check convenience)
// ═══════════════════════════════════════════════════════════════════════════

import { ensureReady } from './_lib/db.js';
import { HANDLERS } from './_lib/handlers.js';

// GET is limited to read-only, side-effect-free actions so credentials and
// mutation payloads can never travel in a URL (query strings land in access
// logs and browser history).
const GET_ALLOWED = new Set(['apiHealth']);

export default async function handler(req, res) {
  // CORS: same-origin in production (no wildcard). Non-production deployments
  // (preview/dev) reflect '*' so previews and local tooling work.
  const isProd = process.env.VERCEL_ENV === 'production';
  const allowOrigin = isProd ? (process.env.ALLOWED_ORIGIN || '') : '*';
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let action, params;
  try {
    if (req.method === 'GET') {
      action = req.query.action;
      params = req.query;
      if (!GET_ALLOWED.has(action)) {
        return res.status(405).json({
          success: false, code: 'METHOD_NOT_ALLOWED',
          message: 'Gunakan POST untuk action ini. GET hanya untuk health check.',
        });
      }
    } else {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      action = body.action;
      params = body.params || {};
    }
  } catch {
    return res.status(400).json({ success: false, code: 'BAD_REQUEST', message: 'Body JSON tidak valid.' });
  }

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ success: false, code: 'BAD_REQUEST', message: 'Parameter "action" wajib diisi.' });
  }

  const fn = HANDLERS[action];
  if (!fn) {
    return res.status(404).json({ success: false, code: 'UNKNOWN_ACTION', message: `Action "${action}" tidak dikenal.` });
  }

  try {
    await ensureReady(); // idempotent schema + seed provisioning
    const result = await fn(params || {});
    // Handlers return an object; if a handler signalled failure, surface 200
    // with success:false (client convention) rather than an HTTP error.
    return res.status(200).json(result);
  } catch (err) {
    const code = err.code || 'SERVER_ERROR';
    const status = code === 'INVALID_SESSION' ? 401 : code === 'BAD_REQUEST' ? 400 : 500;
    // Missing DB configuration is the most common deploy-time error — make it clear.
    const message =
      /connection string|POSTGRES_URL|ECONNREFUSED|getaddrinfo/i.test(err.message || '')
        ? 'Database belum terkonfigurasi. Set variabel POSTGRES_URL di Vercel (attach Vercel Postgres).'
        : (err.message || 'Terjadi kesalahan server.');
    return res.status(status).json({ success: false, code, message });
  }
}
