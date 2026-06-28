// ============================================================
// master.gs — Business Logic untuk semua entitas Master
// KCC Enterprise v3.0 — M06
//
// Tidak akses Spreadsheet langsung → semua lewat service.gs
// Dependensi: config.gs (M01), utils.gs (M02), service.gs (M03), auth.gs (M04)
//
// Perubahan dari V1:
// - Semua fungsi terima `session` (hasil validateRequest() di Code.gs) sebagai
//   parameter terakhir. Session DIANGGAP SUDAH VALID — Code.gs wajib panggil
//   validateRequest(token) sebelum masuk ke sini (sama seperti pola outlet.gs).
// - outletId selalu dari session.outletId, TIDAK PERNAH dari client/data.
// - readAll/readOne/readWhere/updateRow/deleteRow diberi outletId (cross-tenant
//   safety dari M03).
// - insertRow record selalu include OUTLET_ID: session.outletId.
// - Operasi WRITE (create/update/deactivate/reactivate, resep CRUD) wajib
//   hasPermission(session.role, ROLES.ADMIN) — konsisten dengan pola di outlet.gs.
//   Operasi READ terbuka untuk semua role yang punya sesi valid di outlet itu
//   (termasuk VIEWER/MANAGER).
// - Validasi angka manual → isPositiveNumber() (M02).
// - Sanitasi field string manual → sanitizeFields() (M02).
// - fail(message) tanpa code → fail(message, 'CODE_SPESIFIK') sesuai breaking
//   change M02 (fail(message, code), bukan lagi fail(message, detail)).
// - log.info/error(...) selalu diberi session sebagai argumen ke-5.
// ============================================================


// ════════════════════════════════════════════════════════════
// MASTER BAHAN
// ════════════════════════════════════════════════════════════

function getBahanAll(session, allStatus = false) {
  try {
    const outletId = session.outletId;
    let rows = readAll(SHEET.BAHAN, outletId);
    if (!allStatus) rows = rows.filter(r => String(r.AKTIF) !== 'FALSE');
    log.info('master', 'READ', `getBahanAll: ${rows.length} bahan`, null, session);
    return ok(rows);
  } catch (e) {
    log.error('master', 'READ', 'getBahanAll gagal', { error: e.message }, session);
    return fail('Gagal mengambil data bahan: ' + e.message);
  }
}

function getBahanById(idBahan, session) {
  try {
    const row = readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan, session.outletId);
    if (!row) return fail(`Bahan ${idBahan} tidak ditemukan`, 'NOT_FOUND');
    return ok(row);
  } catch (e) {
    return fail(e.message);
  }
}

function createBahan(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat menambah bahan.');
    }

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['NAMA_BAHAN', 'SATUAN_BELI', 'SATUAN_PAKAI', 'HARGA_TERAKHIR']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const hargaTerakhir = Number(data.HARGA_TERAKHIR) || 0;
    if (!isPositiveNumber(hargaTerakhir)) return fail('Harga Terakhir harus lebih dari 0', 'VALIDATION_ERROR');

    const konversi = Number(data.KONVERSI) || 1;
    if (!isPositiveNumber(konversi)) return fail('Konversi harus lebih dari 0', 'VALIDATION_ERROR');

    // Single read (semua outlet) — dipakai untuk generate ID global yang unik
    const allBahan = readAll(SHEET.BAHAN);
    const outletBahan = allBahan.filter(r => r.OUTLET_ID === outletId);

    // Cek duplikat nama — scope per outlet, nama sama boleh beda outlet
    const namaBaru = sanitize(data.NAMA_BAHAN);
    const duplicate = outletBahan.find(r =>
      r.NAMA_BAHAN.toLowerCase() === namaBaru.toLowerCase()
    );
    if (duplicate) return fail(`Bahan "${namaBaru}" sudah ada di outlet ini`, 'DUPLICATE');

    // Validasi supplier jika diisi — scope ke outlet sendiri
    if (data.ID_SUPPLIER && !readOne(SHEET.SUPPLIER, 'ID_SUPPLIER', data.ID_SUPPLIER, outletId)) {
      return fail(`Supplier ${data.ID_SUPPLIER} tidak ditemukan`, 'NOT_FOUND');
    }

    const hargaRata2 = Number(data.HARGA_RATA2) || hargaTerakhir;

    const id = generateId('B', getLastNumber(allBahan.map(r => r.ID_BAHAN)));

    const record = {
      ID_BAHAN       : id,
      OUTLET_ID      : outletId,
      NAMA_BAHAN     : namaBaru,
      KATEGORI       : sanitize(data.KATEGORI || ''),
      ID_SUPPLIER    : data.ID_SUPPLIER || '',
      SATUAN_BELI    : sanitize(data.SATUAN_BELI),
      SATUAN_PAKAI   : sanitize(data.SATUAN_PAKAI),
      KONVERSI       : konversi,
      HARGA_TERAKHIR : hargaTerakhir,
      HARGA_RATA2    : hargaRata2,
      STOK_MINIMUM   : Number(data.STOK_MINIMUM) || 0,
      AKTIF          : 'TRUE',
      CATATAN        : sanitize(data.CATATAN || ''),
    };

    insertRow(SHEET.BAHAN, record);
    log.info('master', 'CREATE', `Bahan baru: ${id} - ${record.NAMA_BAHAN}`, null, session);
    return ok(record, `Bahan "${record.NAMA_BAHAN}" berhasil ditambahkan dengan ID ${id}`);
  } catch (e) {
    log.error('master', 'CREATE', 'createBahan gagal', { error: e.message }, session);
    return fail('Gagal menambah bahan: ' + e.message);
  }
}

function updateBahan(idBahan, updateData, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat mengubah bahan.');
    }

    const outletId = session.outletId;

    if (!readOne(SHEET.BAHAN, 'ID_BAHAN', idBahan, outletId)) {
      return fail(`Bahan ${idBahan} tidak ditemukan di outlet ini`, 'NOT_FOUND');
    }

    if (updateData.ID_SUPPLIER && !readOne(SHEET.SUPPLIER, 'ID_SUPPLIER', updateData.ID_SUPPLIER, outletId)) {
      return fail(`Supplier ${updateData.ID_SUPPLIER} tidak ditemukan`, 'NOT_FOUND');
    }

    // Cegah OUTLET_ID / primary key dipindah lewat update
    delete updateData.OUTLET_ID;
    delete updateData.ID_BAHAN;

    sanitizeFields(updateData, ['NAMA_BAHAN', 'KATEGORI', 'SATUAN_BELI', 'SATUAN_PAKAI', 'CATATAN']);

    ['KONVERSI', 'HARGA_TERAKHIR', 'HARGA_RATA2', 'STOK_MINIMUM'].forEach(f => {
      if (updateData[f] !== undefined) updateData[f] = Number(updateData[f]) || 0;
    });

    updateRow(SHEET.BAHAN, 'ID_BAHAN', idBahan, updateData, outletId);
    log.info('master', 'UPDATE', `Bahan diupdate: ${idBahan}`, null, session);
    return ok(null, `Bahan ${idBahan} berhasil diupdate`);
  } catch (e) {
    log.error('master', 'UPDATE', 'updateBahan gagal', { idBahan, error: e.message }, session);
    return fail('Gagal update bahan: ' + e.message);
  }
}

function deactivateBahan(idBahan, session) {
  return updateBahan(idBahan, { AKTIF: 'FALSE' }, session);
}

function reactivateBahan(idBahan, session) {
  return updateBahan(idBahan, { AKTIF: 'TRUE' }, session);
}


// ════════════════════════════════════════════════════════════
// MASTER PRODUK
// ════════════════════════════════════════════════════════════

function getProdukAll(session, allStatus = false) {
  try {
    let rows = readAll(SHEET.PRODUK, session.outletId);
    if (!allStatus) rows = rows.filter(r => String(r.AKTIF) !== 'FALSE');
    return ok(rows);
  } catch (e) {
    return fail(e.message);
  }
}

function getProdukById(idProduk, session) {
  try {
    const row = readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk, session.outletId);
    if (!row) return fail(`Produk ${idProduk} tidak ditemukan`, 'NOT_FOUND');
    return ok(row);
  } catch (e) {
    return fail(e.message);
  }
}

function createProduk(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat menambah produk.');
    }

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['NAMA_PRODUK', 'HARGA_JUAL', 'SATUAN_JUAL']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const hargaJual = Number(data.HARGA_JUAL) || 0;
    if (!isPositiveNumber(hargaJual)) return fail('Harga Jual harus lebih dari 0', 'VALIDATION_ERROR');

    const yieldPcs = Number(data.YIELD_PCS) || 1;
    if (!isPositiveNumber(yieldPcs)) return fail('Yield PCS harus lebih dari 0', 'VALIDATION_ERROR');

    const allProduk = readAll(SHEET.PRODUK);
    const outletProduk = allProduk.filter(r => r.OUTLET_ID === outletId);
    const namaBaru = sanitize(data.NAMA_PRODUK);

    const duplicate = outletProduk.find(r =>
      r.NAMA_PRODUK.toLowerCase() === namaBaru.toLowerCase()
    );
    if (duplicate) return fail(`Produk "${namaBaru}" sudah ada di outlet ini`, 'DUPLICATE');

    const id = generateId('P', getLastNumber(allProduk.map(r => r.ID_PRODUK)));

    const record = {
      ID_PRODUK   : id,
      OUTLET_ID   : outletId,
      NAMA_PRODUK : namaBaru,
      KATEGORI    : sanitize(data.KATEGORI || ''),
      HARGA_JUAL  : hargaJual,
      HPP         : 0,
      MARGIN_PCT  : 0,
      YIELD_PCS   : yieldPcs,
      SATUAN_JUAL : sanitize(data.SATUAN_JUAL),
      AKTIF       : 'TRUE',
      CATATAN     : sanitize(data.CATATAN || ''),
    };

    insertRow(SHEET.PRODUK, record);
    log.info('master', 'CREATE', `Produk baru: ${id} - ${record.NAMA_PRODUK}`, null, session);
    return ok(record, `Produk "${record.NAMA_PRODUK}" berhasil ditambahkan dengan ID ${id}`);
  } catch (e) {
    log.error('master', 'CREATE', 'createProduk gagal', { error: e.message }, session);
    return fail('Gagal menambah produk: ' + e.message);
  }
}

function updateProduk(idProduk, updateData, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat mengubah produk.');
    }

    const outletId = session.outletId;

    if (!readOne(SHEET.PRODUK, 'ID_PRODUK', idProduk, outletId)) {
      return fail(`Produk ${idProduk} tidak ditemukan di outlet ini`, 'NOT_FOUND');
    }

    delete updateData.OUTLET_ID;
    delete updateData.ID_PRODUK;

    sanitizeFields(updateData, ['NAMA_PRODUK', 'KATEGORI', 'SATUAN_JUAL', 'CATATAN']);
    if (updateData.HARGA_JUAL !== undefined) updateData.HARGA_JUAL = Number(updateData.HARGA_JUAL) || 0;
    if (updateData.YIELD_PCS  !== undefined) updateData.YIELD_PCS  = Number(updateData.YIELD_PCS)  || 1;

    updateRow(SHEET.PRODUK, 'ID_PRODUK', idProduk, updateData, outletId);
    log.info('master', 'UPDATE', `Produk diupdate: ${idProduk}`, null, session);
    return ok(null, `Produk ${idProduk} berhasil diupdate`);
  } catch (e) {
    return fail('Gagal update produk: ' + e.message);
  }
}

function deactivateProduk(idProduk, session) {
  return updateProduk(idProduk, { AKTIF: 'FALSE' }, session);
}

function reactivateProduk(idProduk, session) {
  return updateProduk(idProduk, { AKTIF: 'TRUE' }, session);
}


// ════════════════════════════════════════════════════════════
// MASTER RESEP (tetap ada untuk kompatibilitas fase berikutnya — recipe.gs M07)
// ════════════════════════════════════════════════════════════

function getResepByProduk(idProduk, session) {
  try {
    const rows = readWhere(SHEET.RESEP, r => r.ID_PRODUK === idProduk, session.outletId);
    return ok(rows);
  } catch (e) {
    return fail(e.message);
  }
}

function addResepItem(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat mengubah resep.');
    }

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['ID_PRODUK', 'ID_BAHAN', 'JUMLAH', 'SATUAN']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    if (!readOne(SHEET.PRODUK, 'ID_PRODUK', data.ID_PRODUK, outletId)) {
      return fail(`Produk ${data.ID_PRODUK} tidak ditemukan`, 'NOT_FOUND');
    }
    if (!readOne(SHEET.BAHAN, 'ID_BAHAN', data.ID_BAHAN, outletId)) {
      return fail(`Bahan ${data.ID_BAHAN} tidak ditemukan`, 'NOT_FOUND');
    }

    const existing = readWhere(SHEET.RESEP, r => r.ID_PRODUK === data.ID_PRODUK, outletId);

    const duplicate = existing.filter(r => r.ID_BAHAN === data.ID_BAHAN);
    if (duplicate.length > 0) return fail(`Bahan ${data.ID_BAHAN} sudah ada di resep. Gunakan update.`, 'DUPLICATE');

    const seq = String(existing.length + 1).padStart(3, '0');
    const id  = `${data.ID_PRODUK}-${seq}`;

    const record = {
      ID_RESEP  : id,
      OUTLET_ID : outletId,
      ID_PRODUK : data.ID_PRODUK,
      ID_BAHAN  : data.ID_BAHAN,
      JUMLAH    : Number(data.JUMLAH),
      SATUAN    : sanitize(data.SATUAN),
      CATATAN   : sanitize(data.CATATAN || ''),
    };

    insertRow(SHEET.RESEP, record);
    log.info('master', 'CREATE', `Resep item baru: ${id}`, null, session);
    return ok(record);
  } catch (e) {
    log.error('master', 'CREATE', 'addResepItem gagal', { error: e.message }, session);
    return fail('Gagal menambah item resep: ' + e.message);
  }
}

function updateResepItem(idResep, updateData, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat mengubah resep.');
    }

    const outletId = session.outletId;

    delete updateData.OUTLET_ID;
    delete updateData.ID_RESEP;
    if (updateData.JUMLAH !== undefined) updateData.JUMLAH = Number(updateData.JUMLAH) || 0;
    if (updateData.SATUAN !== undefined) updateData.SATUAN = sanitize(String(updateData.SATUAN));
    if (updateData.CATATAN !== undefined) updateData.CATATAN = sanitize(String(updateData.CATATAN));

    const updated = updateRow(SHEET.RESEP, 'ID_RESEP', idResep, updateData, outletId);
    if (!updated) return fail(`Item resep ${idResep} tidak ditemukan di outlet ini`, 'NOT_FOUND');

    log.info('master', 'UPDATE', `Resep item diupdate: ${idResep}`, null, session);
    return ok(null, `Item resep ${idResep} diupdate`);
  } catch (e) {
    return fail(e.message);
  }
}

function deleteResepItem(idResep, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat menghapus item resep.');
    }

    const deleted = deleteRow(SHEET.RESEP, 'ID_RESEP', idResep, session.outletId);
    if (!deleted) return fail(`Item resep ${idResep} tidak ditemukan di outlet ini`, 'NOT_FOUND');

    log.info('master', 'DELETE', `Resep item dihapus: ${idResep}`, null, session);
    return ok(null, `Item resep ${idResep} dihapus`);
  } catch (e) {
    return fail(e.message);
  }
}


// ════════════════════════════════════════════════════════════
// MASTER SUPPLIER
// ════════════════════════════════════════════════════════════

function getSupplierAll(session, allStatus = false) {
  try {
    let rows = readAll(SHEET.SUPPLIER, session.outletId);
    if (!allStatus) rows = rows.filter(r => String(r.AKTIF) !== 'FALSE');
    return ok(rows);
  } catch (e) {
    return fail(e.message);
  }
}

function getSupplierById(idSupplier, session) {
  try {
    const row = readOne(SHEET.SUPPLIER, 'ID_SUPPLIER', idSupplier, session.outletId);
    if (!row) return fail(`Supplier ${idSupplier} tidak ditemukan`, 'NOT_FOUND');
    return ok(row);
  } catch (e) {
    return fail(e.message);
  }
}

function createSupplier(data, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat menambah supplier.');
    }

    const outletId = session.outletId;

    const { valid, missing } = validateRequired(data, ['NAMA_SUPPLIER']);
    if (!valid) return fail('Field wajib tidak lengkap: ' + missing.join(', '), 'VALIDATION_ERROR');

    const allSupplier = readAll(SHEET.SUPPLIER);
    const outletSupplier = allSupplier.filter(r => r.OUTLET_ID === outletId);
    const namaBaru = sanitize(data.NAMA_SUPPLIER);

    const duplicate = outletSupplier.find(r =>
      r.NAMA_SUPPLIER.toLowerCase() === namaBaru.toLowerCase()
    );
    if (duplicate) return fail(`Supplier "${namaBaru}" sudah ada di outlet ini`, 'DUPLICATE');

    const id = generateId('S', getLastNumber(allSupplier.map(r => r.ID_SUPPLIER)));

    const record = {
      ID_SUPPLIER   : id,
      OUTLET_ID     : outletId,
      NAMA_SUPPLIER : namaBaru,
      PIC           : sanitize(data.PIC || ''),
      TELEPON       : sanitize(data.TELEPON || ''),
      ALAMAT        : sanitize(data.ALAMAT || ''),
      AKTIF         : 'TRUE',
      CATATAN       : sanitize(data.CATATAN || ''),
    };

    insertRow(SHEET.SUPPLIER, record);
    log.info('master', 'CREATE', `Supplier baru: ${id} - ${record.NAMA_SUPPLIER}`, null, session);
    return ok(record, `Supplier "${record.NAMA_SUPPLIER}" ditambahkan dengan ID ${id}`);
  } catch (e) {
    return fail('Gagal menambah supplier: ' + e.message);
  }
}

function updateSupplier(idSupplier, updateData, session) {
  try {
    if (!hasPermission(session.role, ROLES.ADMIN)) {
      return failForbidden('Hanya ADMIN atau SUPER_ADMIN yang dapat mengubah supplier.');
    }

    const outletId = session.outletId;

    if (!readOne(SHEET.SUPPLIER, 'ID_SUPPLIER', idSupplier, outletId)) {
      return fail(`Supplier ${idSupplier} tidak ditemukan di outlet ini`, 'NOT_FOUND');
    }

    delete updateData.OUTLET_ID;
    delete updateData.ID_SUPPLIER;

    sanitizeFields(updateData, ['NAMA_SUPPLIER', 'PIC', 'TELEPON', 'ALAMAT', 'CATATAN']);

    updateRow(SHEET.SUPPLIER, 'ID_SUPPLIER', idSupplier, updateData, outletId);
    log.info('master', 'UPDATE', `Supplier diupdate: ${idSupplier}`, null, session);
    return ok(null, `Supplier ${idSupplier} berhasil diupdate`);
  } catch (e) {
    return fail('Gagal update supplier: ' + e.message);
  }
}

function deactivateSupplier(idSupplier, session) {
  return updateSupplier(idSupplier, { AKTIF: 'FALSE' }, session);
}

function reactivateSupplier(idSupplier, session) {
  return updateSupplier(idSupplier, { AKTIF: 'TRUE' }, session);
}
