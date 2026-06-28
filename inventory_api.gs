// ============================================================
// inventory_api.gs — Public API & Setup untuk Inventory Engine
// Entry point dari google.script.run untuk semua fungsi inventory.
// File ini melengkapi Code.gs tanpa mengubahnya.
// ============================================================


// ════════════════════════════════════════════════════════════
// SETUP INVENTORY
// ════════════════════════════════════════════════════════════

/**
 * Inisialisasi sheet-sheet Inventory Engine.
 * Jalankan sekali setelah setup() dari Recipe Engine selesai.
 * Aman dijalankan berulang — tidak akan mengubah data yang sudah ada.
 */
function setupInventory() {
  const ss = getSpreadsheet();
  const created = [], existed = [];

  Object.entries(INV_SHEET).forEach(([key, sheetName]) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      created.push(sheetName);
    } else {
      existed.push(sheetName);
    }

    const headers = INV_HEADERS[sheetName];
    if (headers && sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      // Styling header — warna berbeda dari Recipe Engine (teal untuk Inventory)
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange
        .setBackground('#006064')   // teal gelap
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(10);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    }
  });

  const msg = [
    '✅ Inventory Engine setup selesai',
    `📦 Sheet dibuat: ${created.join(', ') || '-'}`,
    `📦 Sudah ada: ${existed.join(', ') || '-'}`,
    '',
    'Sheet inventory:',
    '  • STOCK_CARD — Kartu stok FIFO per bahan',
    '  • PURCHASE   — Pembelian bahan baku',
    '  • PRODUCTION — Produksi (konsumsi bahan otomatis)',
    '  • SALES      — Penjualan produk jadi',
  ].join('\n');

  console.log(msg);
  writeLog('INFO', 'inventory_api', 'SYSTEM', 'setupInventory dijalankan', { created, existed });
  return msg;
}


// ════════════════════════════════════════════════════════════
// PUBLIC API — Purchase
// ════════════════════════════════════════════════════════════

function apiInvPurchaseCreate(data)       { return createPurchase(data); }
function apiInvPurchaseVoid(idPurchase)   { return voidPurchase(idPurchase); }
function apiInvPurchaseGetAll()           {
  try {
    return ok(_invReadAll(INV_SHEET.PURCHASE));
  } catch(e) { return fail(e.message); }
}
function apiInvPurchaseGetById(id) {
  try {
    const row = _invReadAll(INV_SHEET.PURCHASE).find(r => r.ID_PURCHASE === id);
    return row ? ok(row) : fail(`Purchase ${id} tidak ditemukan`);
  } catch(e) { return fail(e.message); }
}


// ════════════════════════════════════════════════════════════
// PUBLIC API — Production
// ════════════════════════════════════════════════════════════

function apiInvProductionCreate(data)     { return createProduction(data); }
function apiInvProductionVoid(id)         { return voidProduction(id); }
function apiInvProductionGetAll()         {
  try {
    return ok(_invReadAll(INV_SHEET.PRODUCTION));
  } catch(e) { return fail(e.message); }
}
function apiInvProductionGetById(id) {
  try {
    const row = _invReadAll(INV_SHEET.PRODUCTION).find(r => r.ID_PRODUKSI === id);
    return row ? ok(row) : fail(`Produksi ${id} tidak ditemukan`);
  } catch(e) { return fail(e.message); }
}


// ════════════════════════════════════════════════════════════
// PUBLIC API — Sales
// ════════════════════════════════════════════════════════════

function apiInvSalesCreate(data)          { return createSales(data); }
function apiInvSalesVoid(id)              { return voidSales(id); }
function apiInvSalesGetAll()              {
  try {
    return ok(_invReadAll(INV_SHEET.SALES));
  } catch(e) { return fail(e.message); }
}
function apiInvSalesGetById(id) {
  try {
    const row = _invReadAll(INV_SHEET.SALES).find(r => r.ID_SALES === id);
    return row ? ok(row) : fail(`Sales ${id} tidak ditemukan`);
  } catch(e) { return fail(e.message); }
}


// ════════════════════════════════════════════════════════════
// PUBLIC API — Stock & Movement
// ════════════════════════════════════════════════════════════

function apiInvGetStockCard(idBahan)                  { return getStockCard(idBahan); }
function apiInvGetStokSemua()                          { return getStokSemua(); }
function apiInvGetMovementByRef(referensi)             { return getMovementByRef(referensi); }
function apiInvGetMovementByRange(dari, sampai)        { return getMovementByRange(dari, sampai); }
function apiInvGetSummary()                            { return getInventorySummary(); }


// ════════════════════════════════════════════════════════════
// PUBLIC API — Adjustment
// ════════════════════════════════════════════════════════════

function apiInvAdjustment(data)           { return createStockAdjustment(data); }


// ════════════════════════════════════════════════════════════
// SETUP ALL — Satu perintah untuk setup Recipe + Inventory
// ════════════════════════════════════════════════════════════

/**
 * Jalankan ini untuk setup SEMUA (Recipe Engine + Inventory Engine) sekaligus.
 * Aman dijalankan berulang.
 */
function setupAll() {
  const r1 = setup();           // Recipe Engine (Code.gs)
  const r2 = setupInventory();  // Inventory Engine (inventory_api.gs)
  const combined = r1 + '\n\n' + r2;
  console.log(combined);
  return combined;
}
