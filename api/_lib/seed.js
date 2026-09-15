// ═══════════════════════════════════════════════════════════════════════════
// api/_lib/seed.js
// Initial data used to provision a fresh database.
//
// Multi-site: 10 outlets are provisioned (OUTLET01..OUTLET10), each with its
// own admin & kasir account, so the app can serve up to 10 independent sites
// out of the box.
//
// NOTE: this file used to also ship a full set of sample bahan/produk/resep/
// supplier/pembelian/stok/penjualan rows ("Ayam Goreng Crispy" dkk.) inserted
// into every outlet on first boot. That sample business data has been
// removed on purpose — a fresh outlet now starts completely empty and only
// ever contains data entered through the app itself. Only the outlet and
// login accounts below (needed just to be able to sign in) are still seeded.
//
// Default credentials (CHANGE IN PRODUCTION):
//   Outlet code : OUTLET01 .. OUTLET10
//   Username    : admin   Password: admin123   (SUPER_ADMIN di OUTLET01, ADMIN di lainnya)
//   Username    : kasir   Password: kasir123   (KASIR)
// ═══════════════════════════════════════════════════════════════════════════

export const NUM_OUTLETS = 10;

export const OUTLETS = Array.from({ length: NUM_OUTLETS }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    id:   `OUT${n}`,
    code: `OUTLET${n}`,
    name: i === 0 ? 'KCC Pusat' : `KCC Site ${i + 1}`,
  };
});

// Two accounts per outlet; the first outlet's admin is the SUPER_ADMIN.
export const USER_TEMPLATE = [
  { key: 'A', username: 'admin', password: 'admin123', roleFirst: 'SUPER_ADMIN', role: 'ADMIN' },
  { key: 'K', username: 'kasir', password: 'kasir123', role: 'KASIR' },
];

// Business data is intentionally empty — outlets start blank and are
// populated only through the app (Inventory, Resep, Pembelian, dst.).
export const SEED = {
  bahan:     [],
  produk:    [],
  resep:     [],
  supplier:  [],
  pembelian: [],
  stok:      [],
  penjualan: [],
};

export default SEED;
