// ═══════════════════════════════════════════════════════════════════════════
// useGAS.js
// HTTP client for the KCC backend (Vercel Serverless Function at /api/rpc).
//
// Historically this wrapped Google Apps Script's google.script.run. The app
// has since migrated to a Vercel + Postgres backend, but the public API of
// this module is unchanged (gasRun / useGAS) so no calling code needed edits:
//
//   import { gasRun, useGAS } from './useGAS';
//   const res = await gasRun('apiLogin', { outletCode, username, password });
//
// The backend keeps the same response envelope:
//   { success, data | token | session, message, code }
// and gasRun rejects whenever success === false (or on transport errors).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';

// Endpoint is same-origin on Vercel. Override with VITE_API_BASE if the API
// is hosted elsewhere (e.g. a separate Vercel project).
const API_BASE = (import.meta?.env?.VITE_API_BASE || '').replace(/\/$/, '');
const RPC_URL = `${API_BASE}/api/rpc`;

// ─── Core Promise wrapper ───────────────────────────────────────────────────

/**
 * Calls a backend action and returns a Promise.
 * @param {string} fnName - action name exposed by api/_lib/handlers.js
 * @param {*}      params - single params object
 * @returns {Promise<*>}  - resolves with the response envelope, rejects on failure
 */
const REQUEST_TIMEOUT_MS = 15000;

export function gasRun(fnName, params) {
  // Abort a stalled request so callers never hang with loading stuck true.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  return fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: fnName, params: params ?? {} }),
    signal: controller.signal,
  })
    .finally(() => clearTimeout(timer))
    .then(async (resp) => {
      let result;
      try {
        result = await resp.json();
      } catch {
        const err = new Error(`Respons server tidak valid (HTTP ${resp.status}).`);
        err.code = 'BAD_RESPONSE';
        throw err;
      }

      // Backend convention: { success: false, ... } means a handled failure.
      if (result && result.success === false) {
        const err = new Error(result.message || 'Permintaan gagal.');
        err.code = result.code || 'GAS_ERROR';
        err.gasResult = result;
        throw err;
      }
      return result;
    })
    .catch((err) => {
      // Network / transport error (server unreachable, offline, CORS, timeout).
      // An aborted fetch surfaces as DOMException AbortError with a truthy
      // legacy numeric .code (20), so it must be matched by name explicitly.
      const aborted = err.name === 'AbortError';
      if (!err.code || aborted) {
        const e = new Error(aborted
          ? 'Permintaan melebihi batas waktu. Periksa koneksi Anda.'
          : (err.message || 'Tidak dapat terhubung ke server.'));
        e.code = 'NETWORK_ERROR';
        e.original = err;
        throw e;
      }
      throw err;
    });
}

// ─── React Hook ─────────────────────────────────────────────────────────────

/**
 * React hook wrapping gasRun with loading/error state.
 * @returns {{ call, loading, error, clearError }}
 */
export function useGAS() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = useCallback(async (fnName, params) => {
    setLoading(true);
    setError(null);
    try {
      return await gasRun(fnName, params);
    } catch (err) {
      setError(err.message || 'Terjadi kesalahan.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { call, loading, error, clearError };
}

export default useGAS;
