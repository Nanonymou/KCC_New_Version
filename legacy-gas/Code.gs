// ============================================================
// Code.gs — Entry point WebApp
// ============================================================

function doGet(e) {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle(CONFIG.APP_NAME)
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// ════════════════════════════════════════════════════════════
// SETUP & INISIALISASI
// ════════════════════════════════════════════════════════════

function setup() {
  const ss = getSpreadsheet();
  let created = [], existed = [];

  Object.entries(SHEET).forEach(([key, sheetName]) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      created.push(sheetName);
    } else {
      existed.push(sheetName);
    }

    const headers = HEADERS[sheetName];
    if (headers && sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#1e3a5f').setFontColor('#ffffff')
                 .setFontWeight('bold').setFontSize(10);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    }
  });

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);

  _initDefaultConfig();

  const msg = [
    `✅ Setup selesai`,
    `📋 Dibuat: ${created.join(', ') || '-'}`,
    `📋 Sudah ada: ${existed.join(', ')}`,
    `🔗 URL: ${ss.getUrl()}`,
  ].join('\n');

  console.log(msg);
  writeLog('INFO', 'Code', 'SYSTEM', 'Setup dijalankan', { created, existed });
  return msg;
}

function _initDefaultConfig() {
  DEFAULT_APP_CONFIG.forEach(cfg => {
    if (!exists(SHEET.APP_CONFIG, 'KEY', cfg.KEY)) {
      insertRow(SHEET.APP_CONFIG, { KEY: cfg.KEY, VALUE: cfg.VALUE, DESKRIPSI: cfg.DESKRIPSI });
    }
  });
}

function getSpreadsheetUrl() {
  try { return ok(getSpreadsheet().getUrl()); }
  catch (e) { return fail(e.message); }
}


// ════════════════════════════════════════════════════════════
// PUBLIC API — Dipanggil google.script.run dari client
// ════════════════════════════════════════════════════════════

// ── Bahan ──
function apiBahanGetAll(allStatus)        { return getBahanAll(allStatus); }
function apiBahanGetById(id)              { return getBahanById(id); }
function apiBahanCreate(data)             { return createBahan(data); }
function apiBahanUpdate(id, data)         { return updateBahan(id, data); }
function apiBahanDeactivate(id)           { return deactivateBahan(id); }
function apiBahanReactivate(id)           { return reactivateBahan(id); }

// ── Produk ──
function apiProdukGetAll(allStatus)       { return getProdukAll(allStatus); }
function apiProdukGetById(id)             { return getProdukById(id); }
function apiProdukCreate(data)            { return createProduk(data); }
function apiProdukUpdate(id, data)        { return updateProduk(id, data); }
function apiProdukDeactivate(id)          { return deactivateProduk(id); }
function apiProdukReactivate(id)          { return reactivateProduk(id); }

// ── Resep ──
function apiResepGetByProduk(idProduk)    { return getResepByProduk(idProduk); }
function apiResepAddItem(data)            { return addResepItem(data); }
function apiResepUpdateItem(id, data)     { return updateResepItem(id, data); }
function apiResepDeleteItem(id)           { return deleteResepItem(id); }

// ── Supplier ──
function apiSupplierGetAll(allStatus)     { return getSupplierAll(allStatus); }
function apiSupplierGetById(id)           { return getSupplierById(id); }
function apiSupplierCreate(data)          { return createSupplier(data); }
function apiSupplierUpdate(id, data)      { return updateSupplier(id, data); }
function apiSupplierDeactivate(id)        { return deactivateSupplier(id); }
function apiSupplierReactivate(id)        { return reactivateSupplier(id); }

// ── Config ──
function apiGetAppConfig(key)             { return ok(getAppConfig(key)); }
function apiSetAppConfig(key, value)      { setAppConfig(key, value); return ok(null); }
function apiGetSpreadsheetUrl()           { return getSpreadsheetUrl(); }

// ── Recipe Engine ──
// Semua kalkulasi dilakukan di Apps Script (recipe_engine.gs), bukan di client.
function apiKalkulasiResep(idProduk)                          { return kalkulasiResep(idProduk); }
function apiHitungDanSimpanHPP(idProduk)                      { return hitungDanSimpanHPP(idProduk); }
function apiRecalcSemuaHPP()                                  { return recalcSemuaHPP(); }
function apiGetResepLengkap(idProduk)                         { return getResepLengkap(idProduk); }
function apiGetRingkasanHPPSemua()                            { return getRingkasanHPPSemua(); }
function apiSimulasiResep(idProduk, overrideHarga, yieldPcs)  { return simulasiResep(idProduk, overrideHarga, yieldPcs); }

// ── Dashboard ──
function apiGetDashboardSummary()                             { return getDashboardSummary(); }
