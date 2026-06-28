/**
 * useGAS.js
 * Promise-based wrapper for google.script.run.
 *
 * Usage:
 *   import { gasRun, gasCall } from './useGAS';
 *
 *   // Low-level: call any GAS function by name
 *   const result = await gasRun('apiLogin', { outletCode, username, password });
 *
 *   // Hook variant (used inside components)
 *   const { call, loading, error } = useGAS();
 *   await call('apiGetDashboardSummary', { token });
 */

// ─── Core Promise wrapper ──────────────────────────────────────────────────

/**
 * Calls a Google Apps Script server-side function and returns a Promise.
 *
 * @param {string} fnName   - Name of the GAS function exposed via Code.gs
 * @param {*}      params   - Single argument passed to the function (object, string, etc.)
 * @returns {Promise<*>}    - Resolves with success value, rejects with error object
 */
export function gasRun(fnName, params) {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google.script || !google.script.run) {
      // Dev environment — GAS not available
      reject(new Error('[useGAS] google.script.run is not available (dev environment).'));
      return;
    }

    const runner = google.script.run
      .withSuccessHandler((result) => {
        // GAS convention: functions return { success, data, message, code }
        if (result && result.success === false) {
          const err = new Error(result.message || 'GAS returned success:false');
          err.code = result.code || 'GAS_ERROR';
          err.gasResult = result;
          reject(err);
        } else {
          resolve(result);
        }
      })
      .withFailureHandler((err) => {
        // GAS runtime error (unhandled exception server-side)
        const error = new Error(err.message || 'Unexpected server error');
        error.code = 'SERVER_ERROR';
        error.gasError = err;
        reject(error);
      });

    if (typeof runner[fnName] !== 'function') {
      reject(new Error(`[useGAS] Function "${fnName}" is not defined in google.script.run`));
      return;
    }

    // Call with single param (GAS functions accept one argument from frontend)
    if (params !== undefined) {
      runner[fnName](params);
    } else {
      runner[fnName]();
    }
  });
}

// ─── React Hook ───────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';

/**
 * React hook that wraps gasRun with loading/error state.
 *
 * @returns {{ call, loading, error, clearError }}
 */
export function useGAS() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  /**
   * @param {string} fnName   - GAS function name
   * @param {*}      params   - Params object (token should be included by caller)
   * @returns {Promise<*>}
   */
  const call = useCallback(async (fnName, params) => {
    setLoading(true);
    setError(null);
    try {
      const result = await gasRun(fnName, params);
      return result;
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
