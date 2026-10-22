const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadServices(initialStorageValue) {
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
    "js/services/inventoryService.js",
    "js/services/tripService.js",
    "js/services/customerService.js",
    "js/services/invoiceService.js"
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInNewContext(source, context, { filename: relativePath });
  });

  return context.PepsiApp;
}

function productInput(overrides = {}) {
  return {
    code: "P-001",
    name: "مشروب",
    unit: "كرتونة",
    purchasePrice: "100",
    salePrice: "120.50",
    openingQuantity: "20",
    lowStockThreshold: "2",
    ...overrides
  };
}

function createTrip(app, vehicleId, quantity, overrides = {}) {
  const product = app.inventoryService.getProducts()[0];
  return app.tripService.createTrip({
    vehicleId,
    driverId: app.tripService.getFleet().drivers[0].id,
    dateTime: "2026-10-19T08:00",
    items: [{ productId: product.id, quantity }],
    ...overrides
  });
}

test("provides the requested default fleet and preserves IDs when names change", () => {
  const app = loadServices();
  const before = app.tripService.getFleet();

  assert.equal(
    before.vehicles.map((vehicle) => vehicle.name).join(","),
    ["عربية 1", "عربية 2", "عربية 3"].join(",")
  );
  assert.equal(
    before.drivers.map((driver) => driver.name).join(","),
    ["محمد", "محمود", "أحمد"].join(",")
  );

  app.inventoryService.addProduct(productInput());
  const historicalTrip = createTrip(app, before.vehicles[0].id, "1");
  app.tripService.updateFleet(
    before.vehicles.map((vehicle) => ({ id: vehicle.id, name: `مركبة ${vehicle.id.slice(-1)}` })),
    before.drivers.map((driver) => ({ id: driver.id, name: `سائق ${driver.id.slice(-1)}` }))
  );

  const after = app.tripService.getFleet();
  assert.equal(after.vehicles[0].id, before.vehicles[0].id);
  assert.equal(after.vehicles[0].name, "مركبة 1");
  assert.equal(app.tripService.getTrip(historicalTrip.id).vehicleName, "عربية 1");
  assert.equal(app.tripService.getTrip(historicalTrip.id).driverName, "محمد");
});

test("adds vehicles and drivers with validation, trip availability, and persistence", () => {
  const app = loadServices();
  const vehicle = app.tripService.addVehicle({ name: "عربية جديدة" });
  const driver = app.tripService.addDriver({ name: "سائق جديد" });
  const fleet = app.tripService.getFleet();

  assert.equal(fleet.vehicles.some((item) => item.id === vehicle.id && item.active), true);
  assert.equal(fleet.drivers.some((item) => item.id === driver.id && item.active), true);
  assert.throws(() => app.tripService.addVehicle({ name: " " }), /أدخل اسم العربية/);
  assert.throws(() => app.tripService.addDriver({ name: "محمد" }), /مسجل بالفعل/);
  assert.throws(() => app.tripService.addVehicle({ name: "ع".repeat(81) }), /تجاوز اسم العربية/);

  app.inventoryService.addProduct(productInput());
  const trip = app.tripService.createTrip({
    vehicleId: vehicle.id,
    driverId: driver.id,
    dateTime: "2026-10-19T08:00",
    items: [{ productId: app.inventoryService.getProducts()[0].id, quantity: "1" }]
  });
  assert.equal(trip.vehicleName, "عربية جديدة");
  assert.equal(trip.driverName, "سائق جديد");

  const reloaded = loadServices(JSON.stringify(app.storageService.readState()));
  assert.equal(reloaded.tripService.getFleet().vehicles.some((item) => item.id === vehicle.id), true);
  assert.equal(reloaded.tripService.getFleet().drivers.some((item) => item.id === driver.id), true);
});

test("creates separate same-day trips and deducts each issue once", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput());
  const fleet = app.tripService.getFleet();

  const first = createTrip(app, fleet.vehicles[0].id, "6");
  const second = createTrip(app, fleet.vehicles[0].id, "3");

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.number, second.number);
  assert.equal(first.dateTime.slice(0, 10), second.dateTime.slice(0, 10));
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 11000);
});

test("makes replenishment idempotent and calculates the returned and sold quantities", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput());
  const fleet = app.tripService.getFleet();
  const product = app.inventoryService.getProducts()[0];
  const trip = createTrip(app, fleet.vehicles[0].id, "6");
  const request = {
    productId: product.id,
    quantity: "2",
    requestId: "request-once"
  };

  app.tripService.addReplenishment(trip.id, request);
  app.tripService.addReplenishment(trip.id, request);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 12000);

  const customer = app.customerService.addCustomer({ name: "متجر النور" });
  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-19T08:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-service-sale",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "7" }]
    }]
  });
  app.tripService.completeTripSales(trip.id);
  assert.throws(
    () => app.tripService.addReplenishment(trip.id, {
      productId: product.id,
      quantity: "1",
      requestId: "replenishment-after-sales-close"
    }),
    /بعد اعتماد اكتمال مبيعات الطلعة/
  );

  assert.throws(
    () => app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "9" }], "0"),
    /تتجاوز الكمية الخارجة/
  );
  assert.throws(
    () => app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "1" }], "-0.01"),
    /غير سالب/
  );
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 12000);

  const completed = app.tripService.recordReturn(
    trip.id,
    [{ productId: product.id, quantity: "1" }],
    "25.50"
  );
  assert.equal(completed.lines[0].initialMilli, 6000);
  assert.equal(completed.lines[0].replenishedMilli, 2000);
  assert.equal(completed.lines[0].outgoingMilli, 8000);
  assert.equal(completed.lines[0].returnedMilli, 1000);
  assert.equal(completed.lines[0].soldMilli, 7000);
  assert.ok(completed.salesCompletedAt);
  assert.equal(completed.cashReturnedCents, 2550);
  assert.equal(completed.cashDifferenceCents, 2550);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 13000);
  assert.equal(app.inventoryService.getMovements(product.id).length, 4);
  assert.throws(
    () => app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "1" }], "0"),
    /تم تسجيل راجع هذه الطلعة/
  );
});

test("keeps a recorded return open until posted invoices match, then completes without repeating stock", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput());
  const product = app.inventoryService.getProducts()[0];
  const fleet = app.tripService.getFleet();
  const trip = createTrip(app, fleet.vehicles[0].id, "4");
  const firstCustomer = app.customerService.addCustomer({ name: "متجر النور" });
  const secondCustomer = app.customerService.addCustomer({ name: "متجر الهدى" });

  const savedReturn = app.tripService.recordReturn(
    trip.id,
    [{ productId: product.id, quantity: "1" }],
    "25.50"
  );
  assert.equal(savedReturn.status, "open");
  assert.equal(savedReturn.cashReturnedCents, 2550);
  assert.equal(savedReturn.lines[0].soldMilli, 3000);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 17000);
  assert.equal(app.invoiceService.getInvoiceableTrips()[0].id, trip.id);

  assert.throws(() => app.tripService.completeTripSales(trip.id), /لا يمكن إكمال الطلعة/);
  assert.equal(app.tripService.getTrip(trip.id).status, "open");
  assert.equal(app.tripService.getTrip(trip.id).salesCompletedAt, null);

  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-19T08:30",
    entries: [{
      customerId: firstCustomer.id,
      requestId: "return-first-invoice",
      initialPayment: "25",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  });
  assert.throws(() => app.tripService.completeTripSales(trip.id), /المباع بعد الراجع/);
  assert.equal(app.tripService.getTrip(trip.id).status, "open");
  assert.equal(app.tripService.getTrip(trip.id).salesCompletedAt, null);

  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-19T08:45",
    entries: [{
      customerId: secondCustomer.id,
      requestId: "return-second-invoice",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  });
  const completed = app.tripService.completeTripSales(trip.id);

  assert.equal(completed.status, "returned");
  assert.equal(completed.lines[0].invoicedMilli, 3000);
  assert.equal(completed.lines[0].returnedMilli, 1000);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 17000);
  assert.equal(app.inventoryService.getMovements(product.id).length, 3);
  assert.throws(
    () => app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "1" }], "0"),
    /تم تسجيل راجع هذه الطلعة بالفعل/
  );

  const reloaded = loadServices(JSON.stringify(app.storageService.readState()));
  assert.equal(reloaded.tripService.getTrip(trip.id).status, "returned");
  assert.equal(reloaded.tripService.getTrip(trip.id).cashReturnedCents, 2550);
  assert.equal(reloaded.inventoryService.getProducts()[0].stockQuantityMilli, 17000);
});

test("completes automatically when the last trip-closing prerequisite is saved", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput());
  const product = app.inventoryService.getProducts()[0];
  const fleet = app.tripService.getFleet();
  const returnFirstTrip = createTrip(app, fleet.vehicles[0].id, "4");
  const invoiceFirstTrip = createTrip(app, fleet.vehicles[0].id, "4");
  const returnFirstCustomer = app.customerService.addCustomer({ name: "متجر النور" });
  const invoiceFirstCustomer = app.customerService.addCustomer({ name: "متجر الهدى" });

  app.tripService.recordReturn(
    returnFirstTrip.id,
    [{ productId: product.id, quantity: "1" }],
    "25.50"
  );
  assert.equal(app.tripService.getTrip(returnFirstTrip.id).status, "open");
  app.invoiceService.createTripInvoices({
    tripId: returnFirstTrip.id,
    date: "2026-10-19T08:30",
    entries: [{
      customerId: returnFirstCustomer.id,
      requestId: "auto-close-return-first",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "3" }]
    }]
  });
  const closedAfterInvoices = app.tripService.completeTripSales(returnFirstTrip.id);
  assert.equal(closedAfterInvoices.status, "returned");

  app.invoiceService.createTripInvoices({
    tripId: invoiceFirstTrip.id,
    date: "2026-10-19T08:45",
    entries: [{
      customerId: invoiceFirstCustomer.id,
      requestId: "auto-close-invoice-first",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  });
  assert.equal(app.tripService.getTrip(invoiceFirstTrip.id).status, "open");
  assert.equal(app.tripService.getTrip(invoiceFirstTrip.id).salesCompletedAt, null);
  const closedAfterReturn = app.tripService.recordReturn(
    invoiceFirstTrip.id,
    [{ productId: product.id, quantity: "2" }],
    "0"
  );
  assert.equal(closedAfterReturn.status, "returned");
  assert.equal(app.tripService.getTrip(returnFirstTrip.id).status, "returned");
  assert.equal(app.inventoryService.getMovements(product.id).filter((movement) =>
    movement.type === "trip_return"
  ).length, 2);

  const reloaded = loadServices(JSON.stringify(app.storageService.readState()));
  assert.equal(reloaded.tripService.getTrip(returnFirstTrip.id).status, "returned");
  assert.equal(reloaded.tripService.getTrip(invoiceFirstTrip.id).status, "returned");
});

test("requires explicit quantities and rejects loads exceeding available stock", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput({ openingQuantity: "5" }));
  const fleet = app.tripService.getFleet();
  const product = app.inventoryService.getProducts()[0];

  assert.throws(
    () => createTrip(app, fleet.vehicles[0].id, ""),
    /أدخل كمية الصنف/
  );
  assert.throws(
    () => createTrip(app, fleet.vehicles[0].id, "6"),
    /المخزون غير كافٍ/
  );
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 5000);
  assert.equal(app.tripService.getTrips().length, 0);

  const trip = createTrip(app, fleet.vehicles[0].id, "0.125");
  assert.equal(trip.lines[0].initialMilli, 125);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 4875);
  assert.equal(product.id, trip.lines[0].productId);
});

test("migrates existing inventory data while preserving its stock history", () => {
  const legacyState = {
    schemaVersion: 1,
    products: [{
      id: "item-legacy",
      code: "OLD-1",
      name: "صنف قديم",
      unit: "عبوة",
      purchasePriceCents: null,
      salePriceCents: null,
      lowStockThresholdMilli: 0,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    stockMovements: [{
      id: "move-legacy",
      productId: "item-legacy",
      type: "opening",
      quantityMilli: 4000,
      reference: "رصيد افتتاحي",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]
  };
  const app = loadServices(JSON.stringify(legacyState));

  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 4000);
  assert.equal(app.tripService.getFleet().vehicles.length, 3);
  assert.equal(app.tripService.getTrips().length, 0);
});
