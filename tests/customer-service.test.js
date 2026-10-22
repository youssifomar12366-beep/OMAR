const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadService(initialStorageValue) {
  const values = new Map();
  if (typeof initialStorageValue !== "undefined") {
    values.set("pepsi_inventory_frontend_v1", initialStorageValue);
  }

  const context = {
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
      }
    },
    Date,
    Math,
    JSON,
    Number,
    Error,
    Set
  };
  context.window = context;

  [
    "js/storageService.js",
    "js/services/customerService.js"
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInNewContext(source, context, { filename: relativePath });
  });

  return context.PepsiApp;
}

test("creates a unique customer code and keeps its ID and code unchanged on edit", () => {
  const app = loadService();
  const customer = app.customerService.addCustomer({
    name: "محل النور",
    phone: "01000000000",
    address: "شارع السوق"
  });

  assert.equal(customer.code, "CUS-000001");
  assert.equal(customer.balanceCents, 0);

  const updated = app.customerService.updateCustomer(customer.id, {
    name: "محل النور الجديد",
    phone: "",
    address: "شارع آخر",
    code: "CHANGED"
  });

  assert.equal(updated.id, customer.id);
  assert.equal(updated.code, "CUS-000001");
  assert.equal(updated.name, "محل النور الجديد");
  assert.equal(updated.phone, "");
  assert.equal(app.customerService.addCustomer({ name: "عميل ثان" }).code, "CUS-000002");
});

test("derives sales, collections, returns and balance from ledger entries", () => {
  const app = loadService();
  const customer = app.customerService.addCustomer({ name: "متجر الحساب" });

  app.storageService.updateState((state) => {
    const now = new Date().toISOString();
    state.customerEntries.push(
      { id: "entry-sale", customerId: customer.id, kind: "sale", amountCents: 100000, description: "فاتورة", createdAt: now },
      { id: "entry-payment", customerId: customer.id, kind: "payment", amountCents: 30000, description: "دفعة", createdAt: now },
      { id: "entry-return", customerId: customer.id, kind: "return", amountCents: 10000, description: "مرتجع", createdAt: now },
      { id: "entry-adjustment", customerId: customer.id, kind: "adjustment", amountCents: 5000, balanceDeltaCents: 5000, description: "تسوية معتمدة", createdAt: now }
    );
    return state;
  });

  const account = app.customerService.getCustomer(customer.id);
  assert.equal(account.totalSalesCents, 100000);
  assert.equal(account.totalPaymentsCents, 30000);
  assert.equal(account.totalReturnsCents, 10000);
  assert.equal(account.balanceCents, 65000);
  assert.equal(account.outstandingCents, 65000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(app.customerService.getAccountHistory(customer.id).length, 4);
});

test("deactivation retains the customer code and account history", () => {
  const app = loadService();
  const customer = app.customerService.addCustomer({ name: "متجر محفوظ" });

  const disabled = app.customerService.setActive(customer.id, false);
  assert.equal(disabled.active, false);
  assert.equal(disabled.code, customer.code);
  assert.equal(app.customerService.getCustomers().length, 1);
});

test("rejects an empty name and overlong optional contact data", () => {
  const app = loadService();

  assert.throws(() => app.customerService.addCustomer({ name: " " }), /أدخل اسم العميل/);
  assert.throws(() => app.customerService.addCustomer({
    name: "عميل",
    phone: "1".repeat(41)
  }), /تجاوز رقم الهاتف/);
  assert.equal(app.customerService.getCustomers().length, 0);
});

test("migrates trip storage to customer storage without discarding previous records", () => {
  const fleet = {
    vehicles: [{ id: "vehicle-1", name: "عربية 1", active: true }],
    drivers: [{ id: "driver-1", name: "محمد", active: true }]
  };
  const stateV2 = {
    schemaVersion: 2,
    products: [],
    stockMovements: [],
    vehicles: fleet.vehicles,
    drivers: fleet.drivers,
    trips: [{
      id: "trip-old",
      number: "TR-OLD",
      dateTime: "2026-01-01T08:00:00.000Z",
      vehicleId: "vehicle-1",
      vehicleName: "عربية 1",
      driverId: "driver-1",
      driverName: "محمد",
      status: "open",
      createdAt: "2026-01-01T08:00:00.000Z",
      items: [],
      replenishments: [],
      returnRecord: null
    }]
  };
  const app = loadService(JSON.stringify(stateV2));

  assert.equal(app.customerService.getCustomers().length, 0);
  assert.equal(app.storageService.readState().trips[0].number, "TR-OLD");
});
