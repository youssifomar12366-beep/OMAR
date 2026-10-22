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
  context.PepsiApp.__getTestStorageValue = () => values.get("pepsi_inventory_frontend_v1");
  return context.PepsiApp;
}

function addProduct(app, overrides = {}) {
  return app.inventoryService.addProduct({
    code: "P-001",
    name: "مشروب",
    unit: "كرتونة",
    purchasePrice: "100",
    salePrice: "120.50",
    openingQuantity: "20",
    lowStockThreshold: "2",
    ...overrides
  });
}

function addCustomer(app) {
  return app.customerService.addCustomer({ name: "متجر النور" });
}

function createTrip(app, product, quantity) {
  const fleet = app.tripService.getFleet();
  return app.tripService.createTrip({
    vehicleId: fleet.vehicles[0].id,
    driverId: fleet.drivers[0].id,
    dateTime: "2026-10-19T08:00",
    items: [{ productId: product.id, quantity }]
  });
}

test("creates a direct sale, records a partial payment, updates customer balance, and deducts stock once", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const invoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "2", unitPrice: "150.00" }],
    discount: "10",
    discountReason: "خصم معتمد",
    initialPayment: "100",
    paymentMethod: "نقدي",
    paymentNotes: ""
  });

  assert.equal(invoice.number, "INV-000001");
  assert.equal(invoice.subtotalCents, 30000);
  assert.equal(invoice.totalCents, 29000);
  assert.equal(invoice.paidCents, 10000);
  assert.equal(invoice.balanceCents, 19000);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 18000);
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 19000);
  app.customerService.updateCustomer(customer.id, {
    name: "متجر النور الجديد",
    phone: "01000000000",
    address: "عنوان جديد"
  });
  assert.equal(app.invoiceService.getInvoice(invoice.id).customerName, "متجر النور");
  assert.equal(app.invoiceService.getInvoice(invoice.id).customerPhone, "");

  const paid = app.invoiceService.addPayment(invoice.id, {
    amount: "50",
    method: "تحويل بنكي",
    notes: "دفعة ثانية"
  });
  assert.equal(paid.paidCents, 15000);
  assert.equal(paid.balanceCents, 14000);
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 14000);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 18000);
  assert.equal(paid.payments.length, 2);
});

test("allows a full cash invoice and reports it as fully paid", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const invoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "1", unitPrice: "120.50" }],
    discount: "0",
    initialPayment: "120.50",
    paymentMethod: "نقدي"
  });

  assert.equal(invoice.totalCents, 12050);
  assert.equal(invoice.paidCents, 12050);
  assert.equal(invoice.balanceCents, 0);
  assert.equal(invoice.payments[0].number, "PAY-000001");
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 0);
});

test("records trip customer sales before return without deducting stock again", () => {
  const app = loadServices();
  const product = addProduct(app);
  const firstCustomer = addCustomer(app);
  const secondCustomer = app.customerService.addCustomer({ name: "متجر الهدى" });
  const trip = createTrip(app, product, "6");
  app.tripService.addReplenishment(trip.id, {
    productId: product.id,
    quantity: "2",
    requestId: "replenishment-1"
  });
  const stockBeforeInvoicing = app.inventoryService.getProducts()[0].stockQuantityMilli;
  const invoices = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [
      {
        customerId: firstCustomer.id,
        requestId: "trip-sales-first",
        initialPayment: "0",
        items: [{ productId: product.id, quantity: "4" }]
      },
      {
        customerId: secondCustomer.id,
        requestId: "trip-sales-second",
        initialPayment: "0",
        items: [{ productId: product.id, quantity: "3" }]
      }
    ]
  });
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, stockBeforeInvoicing);
  assert.equal(app.tripService.getTrip(trip.id).lines[0].soldMilli, 7000);
  app.tripService.completeTripSales(trip.id);
  assert.throws(
    () => app.tripService.recordReturn(trip.id, [
      { productId: product.id, quantity: "0" }
    ], "30"),
    /يجب أن تكمل الكمية الخارجة/
  );
  const returnedTrip = app.tripService.recordReturn(trip.id, [
    { productId: product.id, quantity: "1" }
  ], "30");
  assert.equal(returnedTrip.lines[0].soldMilli, 7000);
  assert.equal(app.invoiceService.getInvoiceableTrips().length, 0);
  assert.throws(() => app.invoiceService.createInvoice({
    customerId: firstCustomer.id,
    date: "2026-10-20T11:30",
    tripId: trip.id,
    items: [{ productId: product.id, quantity: "0.001", unitPrice: "120.50" }]
  }), /اكتمال مبيعات هذه الطلعة/);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, stockBeforeInvoicing + 1000);

  const tripSummary = app.tripService.getTrip(trip.id);
  assert.equal(tripSummary.lines[0].invoicedMilli, 7000);
  assert.equal(tripSummary.lines[0].uninvoicedMilli, 0);
  assert.equal(tripSummary.invoiceCount, 2);
  assert.equal(tripSummary.invoiceDifferenceCents, 0);
  assert.equal(invoices[0].totalCents + invoices[1].totalCents, returnedTrip.saleValueCents);
});

test("keeps same-day trip records separate and closes each when its sales and return are complete", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const fleet = app.tripService.getFleet();
  const firstTrip = app.tripService.createTrip({
    vehicleId: fleet.vehicles[0].id,
    driverId: fleet.drivers[0].id,
    dateTime: "2026-10-19T08:00",
    items: [{ productId: product.id, quantity: "2" }]
  });
  const secondTrip = app.tripService.createTrip({
    vehicleId: fleet.vehicles[0].id,
    driverId: fleet.drivers[0].id,
    dateTime: "2026-10-19T13:00",
    items: [{ productId: product.id, quantity: "3" }]
  });

  assert.notEqual(firstTrip.id, secondTrip.id);
  assert.equal(app.tripService.getTrip(secondTrip.id).salesCompletedAt, null);
  const firstReturned = app.tripService.recordReturn(
    firstTrip.id, [{ productId: product.id, quantity: "1" }], "0");
  assert.equal(firstReturned.status, "open");
  assert.ok(firstReturned.returnRecord);

  app.invoiceService.createTripInvoices({
    tripId: firstTrip.id,
    date: "2026-10-19T09:00",
    entries: [{
      customerId: customer.id,
      requestId: "same-day-first-trip-sale",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  });
  app.tripService.completeTripSales(firstTrip.id);
  assert.equal(app.tripService.getTrip(firstTrip.id).status, "returned");
  const secondReturned = app.tripService.recordReturn(
    secondTrip.id, [{ productId: product.id, quantity: "3" }], "0");
  assert.equal(secondReturned.status, "returned");
  const secondCompleted = app.tripService.getTrip(secondTrip.id);

  const reloaded = loadServices(app.__getTestStorageValue());
  assert.equal(reloaded.tripService.getTrip(firstTrip.id).status, "returned");
  assert.ok(reloaded.tripService.getTrip(firstTrip.id).salesCompletedAt);
  assert.equal(reloaded.invoiceService.getTripInvoices(firstTrip.id).length, 1);
  assert.equal(reloaded.tripService.getTrip(secondTrip.id).status, "returned");
  assert.ok(reloaded.tripService.getTrip(secondTrip.id).salesCompletedAt);
  assert.equal(reloaded.tripService.getTrip(secondTrip.id).invoiceCount, 0);
  assert.equal(secondCompleted.lines[0].soldMilli, 0);
  assert.equal(reloaded.inventoryService.getProducts()[0].stockQuantityMilli, 19000);
});

test("rejects invalid discounts, overpayments, missing payment methods, and insufficient stock atomically", () => {
  const app = loadServices();
  const product = addProduct(app, { openingQuantity: "1" });
  const customer = addCustomer(app);
  const makeInput = (overrides = {}) => ({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "1", unitPrice: "120.50" }],
    ...overrides
  });

  assert.throws(() => app.invoiceService.createInvoice(makeInput({
    discount: "5"
  })), /سبب الخصم/);
  assert.throws(() => app.invoiceService.createInvoice(makeInput({
    discount: "121",
    discountReason: "خصم"
  })), /يتجاوز الخصم إجمالي الأصناف/);
  assert.throws(() => app.invoiceService.createInvoice(makeInput({
    initialPayment: "1"
  })), /طريقة التحصيل/);
  assert.throws(() => app.invoiceService.createInvoice(makeInput({
    initialPayment: "121"
  })), /يتجاوز .*الفاتورة|المستحق/);
  assert.throws(() => app.invoiceService.createInvoice(makeInput({
    items: [{ productId: product.id, quantity: "2", unitPrice: "120.50" }]
  })), /المخزون غير كافٍ/);
  assert.equal(app.invoiceService.getInvoices().length, 0);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 1000);
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 0);
});

test("requires a returned trip and rejects duplicate products or over-collection", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const trip = createTrip(app, product, "2");
  const input = {
    customerId: customer.id,
    date: "2026-10-20T11:30",
    tripId: trip.id,
    items: [{ productId: product.id, quantity: "1", unitPrice: "120.50" }]
  };
  assert.throws(() => app.invoiceService.createInvoice(input), /سُجل راجعها/);

  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-sale-before-return",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  });
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "1" }], "0");
  assert.throws(() => app.invoiceService.createInvoice({
    ...input,
    items: [
      { productId: product.id, quantity: "1", unitPrice: "120.50" },
      { productId: product.id, quantity: "0.5", unitPrice: "120.50" }
    ]
  }), /اكتمال مبيعات هذه الطلعة/);

  assert.throws(() => app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [
      { productId: product.id, quantity: "1", unitPrice: "120.50" },
      { productId: product.id, quantity: "0.5", unitPrice: "120.50" }
    ]
  }), /لا تكرر الصنف/);
  const invoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "1", unitPrice: "120.50" }]
  });
  assert.throws(() => app.invoiceService.addPayment(invoice.id, {
    amount: "121",
    method: "نقدي"
  }), /يتجاوز الرصيد المتبقي/);
  assert.equal(app.invoiceService.getInvoice(invoice.id).paidCents, 0);
});

test("supports multiple customers and products in one trip and reconciles their payments once", () => {
  const app = loadServices();
  const firstProduct = addProduct(app);
  const secondProduct = addProduct(app, {
    code: "P-002",
    name: "مشروب آخر",
    openingQuantity: "10"
  });
  const firstCustomer = addCustomer(app);
  const secondCustomer = app.customerService.addCustomer({ name: "متجر الهدى" });
  const fleet = app.tripService.getFleet();
  const trip = app.tripService.createTrip({
    vehicleId: fleet.vehicles[0].id,
    driverId: fleet.drivers[0].id,
    dateTime: "2026-10-19T08:00",
    items: [
      { productId: firstProduct.id, quantity: "5" },
      { productId: secondProduct.id, quantity: "0" }
    ]
  });
  app.tripService.addReplenishment(trip.id, {
    productId: secondProduct.id,
    quantity: "4",
    requestId: "second-product-replenishment"
  });
  const tripInvoices = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [
      {
        customerId: firstCustomer.id,
        requestId: "trip-invoice-first",
        initialPayment: "100",
        paymentMethod: "نقدي",
        items: [
          { productId: firstProduct.id, quantity: "2" },
          { productId: secondProduct.id, quantity: "1" }
        ]
      },
      {
        customerId: secondCustomer.id,
        requestId: "trip-invoice-second",
        initialPayment: "0",
        items: [
          { productId: firstProduct.id, quantity: "3" },
          { productId: secondProduct.id, quantity: "3" }
        ]
      }
    ]
  });
  const firstInvoice = tripInvoices[0];
  const repeatedFirstInvoice = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: firstCustomer.id,
      requestId: "trip-invoice-first",
      initialPayment: "100",
      paymentMethod: "نقدي",
      items: [{ productId: firstProduct.id, quantity: "2" }]
    }]
  })[0];
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [
    { productId: firstProduct.id, quantity: "0" },
    { productId: secondProduct.id, quantity: "0" }
  ], "100");
  const stockAfterReturn = app.inventoryService.getProducts().map((product) => product.stockQuantityMilli);

  assert.equal(repeatedFirstInvoice.id, firstInvoice.id);
  assert.equal(firstInvoice.subtotalCents, 36150);
  assert.equal(firstInvoice.balanceCents, 26150);

  const secondInvoice = tripInvoices[1];
  assert.equal(secondInvoice.totalCents, 72300);
  assert.throws(
    () => app.invoiceService.cancelInvoice(secondInvoice.id, "تصحيح"),
    /معالجة فعلية للبضاعة/
  );
  assert.equal(app.invoiceService.getInvoiceableTrips().length, 0);
  assert.throws(() => app.invoiceService.createInvoice({
    customerId: firstCustomer.id,
    tripId: trip.id,
    date: "2026-10-20T11:32",
    items: [{ productId: secondProduct.id, quantity: "0.001", unitPrice: "120.50" }]
  }), /اكتمال مبيعات هذه الطلعة/);
  assert.deepEqual(
    app.inventoryService.getProducts().map((product) => product.stockQuantityMilli),
    stockAfterReturn
  );

  const summary = app.tripService.getTrip(trip.id);
  assert.equal(summary.saleValueCents, 108450);
  assert.equal(summary.invoicedValueCents, 108450);
  assert.equal(summary.collectedCents, 10000);
  assert.equal(summary.debtCents, 98450);
  assert.equal(summary.cashReturnedCents, 10000);
  assert.equal(summary.cashDifferenceCents, 0);
  assert.equal(summary.invoiceDifferenceCents, 0);
  assert.equal(app.invoiceService.getInvoice(firstInvoice.id).tripCollectedCents, 10000);
  assert.equal(app.customerService.getCustomer(firstCustomer.id).balanceCents, 26150);
  assert.equal(app.customerService.getCustomer(secondCustomer.id).balanceCents, 72300);
  assert.equal(
    app.customerService.getAccountHistory(firstCustomer.id)
      .find((entry) => entry.kind === "sale").invoiceItems.length,
    2
  );
});

test("saves partial trip sales before return and prevents duplicate or excessive distribution", () => {
  const app = loadServices();
  const product = addProduct(app);
  const firstCustomer = addCustomer(app);
  const secondCustomer = app.customerService.addCustomer({ name: "متجر الهدى" });
  const trip = createTrip(app, product, "6");
  const entry = (customer, quantity, requestId, collected = "0") => ({
    customerId: customer.id,
    requestId,
    initialPayment: collected,
    paymentMethod: Number(collected) > 0 ? "نقدي" : "",
    items: [{ productId: product.id, quantity }]
  });

  const partial = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [entry(firstCustomer, "2", "table-first-partial")]
  });
  assert.equal(partial.length, 1);

  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [
      entry(secondCustomer, "1", "table-duplicate-first"),
      entry(secondCustomer, "2", "table-duplicate-second")
    ]
  }), /العميل نفسه/);
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 1);

  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [
      entry(secondCustomer, "5", "table-over")
    ]
  }), /يتجاوز الكمية المباعة/);
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 1);

  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [entry(firstCustomer, "1", "table-same-customer")]
  }), /العميل نفسه/);

  const secondBatch = [entry(secondCustomer, "3", "table-second-final", "50")];
  const created = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: secondBatch
  });
  const retried = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: secondBatch
  });

  assert.equal(created.length, 1);
  assert.deepEqual(retried.map((invoice) => invoice.id), created.map((invoice) => invoice.id));
  assert.equal(created[0].totalCents, 36150);
  assert.equal(created[0].balanceCents, 31150);
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 2);
  app.tripService.completeTripSales(trip.id);
  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [entry(app.customerService.addCustomer({ name: "عميل جديد" }), "1", "after-sales-close")]
  }), /اكتمال مبيعات هذه الطلعة/);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "1" }], "100");
  const stockAfterReturn = app.inventoryService.getProducts()[0].stockQuantityMilli;
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 2);
  assert.equal(app.tripService.getTrip(trip.id).invoiceDifferenceCents, 0);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, stockAfterReturn);
});

test("trip invoices apply manual discounts before recording collection and customer balance", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const trip = createTrip(app, product, "2");

  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-discount-too-large",
      discount: "300",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  }), /لا يمكن أن يتجاوز إجمالي قيمة الأصناف/);
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 0);

  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-discount-invalid-payment",
      discount: "10",
      initialPayment: "-1",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  }), /المبلغ المحصل من العميل/);
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 0);

  const invoices = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-discount-valid",
      discount: "10",
      initialPayment: "100",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  });

  assert.equal(invoices[0].subtotalCents, 24100);
  assert.equal(invoices[0].discountCents, 1000);
  assert.equal(invoices[0].totalCents, 23100);
  assert.equal(invoices[0].paidCents, 10000);
  assert.equal(invoices[0].balanceCents, 13100);
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "0" }], "0");
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 13100);
  assert.equal(app.tripService.getTrip(trip.id).invoiceDifferenceCents, 0);
});

test("tracks collection for each trip invoice separately from later payments", () => {
  const app = loadServices();
  const product = addProduct(app);
  const firstCustomer = addCustomer(app);
  const secondCustomer = app.customerService.addCustomer({ name: "متجر الربيع" });
  const trip = createTrip(app, product, "3");

  const invoices = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [
      {
        customerId: firstCustomer.id,
        requestId: "trip-collection-first",
        initialPayment: "100",
        paymentMethod: "نقدي",
        items: [{ productId: product.id, quantity: "1" }]
      },
      {
        customerId: secondCustomer.id,
        requestId: "trip-collection-second",
        initialPayment: "300",
        paymentMethod: "نقدي",
        items: [{ productId: product.id, quantity: "2" }]
      }
    ]
  });

  assert.equal(invoices[0].tripCollectedCents, 10000);
  assert.equal(invoices[1].tripCollectedCents, 30000);
  assert.equal(invoices[1].creditCents, 5900);

  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "0" }], "0");
  app.invoiceService.addPayment(invoices[0].id, {
    amount: "20",
    method: "نقدي",
    notes: "دفعة لاحقة"
  });
  const reloaded = loadServices(app.__getTestStorageValue());
  const firstInvoiceAfterReload = reloaded.invoiceService.getCustomerInvoices(firstCustomer.id)[0];
  const secondInvoiceAfterReload = reloaded.invoiceService.getCustomerInvoices(secondCustomer.id)[0];

  assert.equal(firstInvoiceAfterReload.paidCents, 12000);
  assert.equal(firstInvoiceAfterReload.tripCollectedCents, 10000);
  assert.equal(secondInvoiceAfterReload.tripCollectedCents, 30000);
});

test("shows zero trip collection for invoices without a recorded initial collection", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const trip = createTrip(app, product, "1");
  const invoice = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "legacy-trip-invoice",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  })[0];
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "0" }], "0");
  const legacyState = JSON.parse(app.__getTestStorageValue());
  legacyState.invoices.find((item) => item.id === invoice.id).requestId =
    "legacy-invoice-" + invoice.id;

  const reloaded = loadServices(JSON.stringify(legacyState));
  assert.equal(reloaded.invoiceService.getCustomerInvoices(customer.id)[0].tripCollectedCents, 0);
});

test("trip invoice collection at sale remains idempotent and preserves customer credit", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const trip = createTrip(app, product, "2");
  app.storageService.updateState((state) => {
    state.customerEntries.push({
      id: "existing-credit-entry",
      customerId: customer.id,
      kind: "adjustment",
      amountCents: 5000,
      balanceDeltaCents: -5000,
      description: "رصيد دائن سابق",
      sourceId: "legacy-credit",
      createdAt: "2026-10-18T10:00:00.000Z"
    });
    return state;
  });

  const request = {
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-overpayment-once",
      discount: "10",
      initialPayment: "300",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  };
  const created = app.invoiceService.createTripInvoices(request);
  const retried = app.invoiceService.createTripInvoices(request);
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "0" }], "0");
  const history = app.customerService.getAccountHistory(customer.id);
  const adjustments = history.filter((entry) =>
    entry.kind === "adjustment" && entry.sourceId === created[0].id
  );
  const payments = app.invoiceService.getCustomerPayments(customer.id);

  assert.equal(created[0].subtotalCents, 24100);
  assert.equal(created[0].discountCents, 1000);
  assert.equal(created[0].totalCents, 23100);
  assert.equal(created[0].paidCents, 18100);
  assert.equal(created[0].tripCollectedCents, 30000);
  assert.equal(created[0].creditAppliedCents, 5000);
  assert.equal(created[0].balanceCents, 0);
  assert.equal(created[0].creditCents, 11900);
  assert.equal(retried[0].id, created[0].id);
  assert.equal(retried[0].creditCents, 11900);
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].balanceDeltaCents, -11900);
  assert.equal(payments.filter((payment) => payment.invoiceId === created[0].id).length, 1);
  const tripCollection = payments.find((payment) => payment.invoiceId === created[0].id);
  assert.equal(tripCollection.amountCents, 30000);
  assert.equal(tripCollection.appliedCents, 18100);
  assert.equal(tripCollection.creditCents, 11900);
  assert.equal(tripCollection.method, "نقدي");
  assert.equal(payments.filter((payment) => payment.invoiceId === created[0].id).length, 1);
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, -11900);
  assert.equal(
    loadServices(app.__getTestStorageValue()).customerService.getCustomer(customer.id).balanceCents,
    -11900
  );
});

test("keeps customer debt and credit separate through trip closure and later credit use", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const oldInvoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-19T08:00",
    items: [{ productId: product.id, quantity: "5", unitPrice: "100" }],
    initialPayment: "0"
  });
  const trip = createTrip(app, product, "1");
  const tripInvoiceRequest = {
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "debt-and-credit-trip-invoice",
      initialPayment: "320.50",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  };

  const tripInvoice = app.invoiceService.createTripInvoices(tripInvoiceRequest)[0];
  const retry = app.invoiceService.createTripInvoices(tripInvoiceRequest)[0];
  let account = app.customerService.getCustomer(customer.id);
  assert.equal(oldInvoice.balanceCents, 50000);
  assert.equal(tripInvoice.totalCents, 12050);
  assert.equal(tripInvoice.paidCents, 12050);
  assert.equal(tripInvoice.creditCents, 20000);
  assert.equal(tripInvoice.balanceCents, 0);
  assert.equal(retry.id, tripInvoice.id);
  assert.equal(account.outstandingCents, 30000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(account.balanceCents, 30000);
  assert.equal(account.totalCollectedCents, 32050);
  const tripCollection = app.invoiceService.getCustomerPayments(customer.id)
    .find((payment) => payment.invoiceId === tripInvoice.id);
  assert.equal(tripCollection.amountCents, 32050);
  assert.equal(tripCollection.appliedCents, 12050);
  assert.equal(tripCollection.creditCents, 20000);
  assert.equal(tripCollection.amountCents, account.totalCollectedCents);

  const returnedTrip = app.tripService.recordReturn(
    trip.id, [{ productId: product.id, quantity: "0" }], "320.50");
  assert.equal(returnedTrip.status, "returned");
  account = app.customerService.getCustomer(customer.id);
  assert.equal(account.outstandingCents, 30000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(account.totalCollectedCents, 32050);

  const laterInvoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-21T11:30",
    items: [{ productId: product.id, quantity: "1", unitPrice: "100" }],
    initialPayment: "0",
    requestId: "use-part-of-trip-credit"
  });
  assert.equal(laterInvoice.creditAppliedCents, 10000);
  account = app.customerService.getCustomer(customer.id);
  assert.equal(account.outstandingCents, 40000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(account.balanceCents, 40000);
  assert.equal(account.totalCollectedCents, 32050);

  const reloaded = loadServices(app.__getTestStorageValue());
  account = reloaded.customerService.getCustomer(customer.id);
  assert.equal(account.outstandingCents, 40000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(account.totalCollectedCents, 32050);
  assert.equal(reloaded.invoiceService.getCustomerPayments(customer.id)
    .find((payment) => payment.invoiceId === tripInvoice.id).amountCents, 32050);
  assert.equal(reloaded.invoiceService.getCustomerInvoices(customer.id)
    .filter((invoice) => invoice.id === tripInvoice.id).length, 1);
});

test("nets unused customer credit against debt for all customer account summaries", () => {
  const app = loadServices();
  const customer = addCustomer(app);
  const product = addProduct(app, { salePrice: "14000" });
  app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-19T08:00",
    items: [{ productId: product.id, quantity: "1", unitPrice: "1500" }],
    initialPayment: "0"
  });
  const trip = createTrip(app, product, "1");
  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "net-trip-credit-against-debt",
      initialPayment: "15000",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  });

  const account = app.customerService.getCustomer(customer.id);
  assert.equal(account.totalSalesCents, 1550000);
  assert.equal(account.totalCollectedCents, 1500000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(account.outstandingCents, 50000);
  const invoiceDebtCents = app.invoiceService.getCustomerInvoices(customer.id)
    .reduce((total, invoice) => total + invoice.balanceCents, 0);
  assert.equal(invoiceDebtCents, 150000);
  const tripCollection = app.invoiceService.getCustomerPayments(customer.id)
    .find((payment) => payment.creditCents > 0);
  assert.equal(tripCollection.creditCents, 100000);
  assert.equal(invoiceDebtCents - tripCollection.creditCents, account.outstandingCents);

  const reloaded = loadServices(app.__getTestStorageValue());
  const persistedAccount = reloaded.customerService.getCustomer(customer.id);
  assert.equal(persistedAccount.outstandingCents, 50000);
  assert.equal(persistedAccount.creditAvailableCents, 0);
});

test("settles debt from available credit first and retains only the surplus", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-19T08:00",
    items: [{ productId: product.id, quantity: "1", unitPrice: "1500" }],
    initialPayment: "0"
  });
  const trip = createTrip(app, product, "1");
  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "credit-surplus-after-debt-settlement",
      initialPayment: "2120.50",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  });

  const account = app.customerService.getCustomer(customer.id);
  assert.equal(account.outstandingCents, 0);
  assert.equal(account.creditAvailableCents, 50000);
  assert.equal(account.totalSalesCents, 162050);
  assert.equal(account.totalCollectedCents, 212050);
  assert.equal(app.invoiceService.getCustomerPayments(customer.id)
    .filter((payment) => payment.invoiceNumber).length, 1);
});

test("lists collected trip overpayment when it is entirely converted to customer credit", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  app.storageService.updateState((state) => {
    state.customerEntries.push({
      id: "opening-customer-credit",
      customerId: customer.id,
      kind: "adjustment",
      amountCents: 20000,
      balanceDeltaCents: -20000,
      description: "رصيد دائن افتتاحي",
      sourceId: "opening-credit",
      createdAt: "2026-10-18T10:00:00.000Z"
    });
    return state;
  });
  const trip = createTrip(app, product, "1");
  const invoice = app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "trip-credit-only-collection",
      initialPayment: "50",
      paymentMethod: "نقدي",
      items: [{ productId: product.id, quantity: "1" }]
    }]
  })[0];

  const collection = app.invoiceService.getCustomerPayments(customer.id)
    .find((payment) => payment.invoiceId === invoice.id);
  assert.equal(invoice.paidCents, 0);
  assert.equal(invoice.creditAppliedCents, invoice.totalCents);
  assert.equal(invoice.tripCollectedCents, 5000);
  assert.equal(collection.amountCents, 5000);
  assert.equal(collection.appliedCents, 0);
  assert.equal(collection.creditCents, 5000);
  assert.equal(collection.method, "نقدي");
  assert.equal(app.customerService.getCustomer(customer.id).totalCollectedCents, 5000);
});

test("uses customer credit before cash and preserves old invoice debt separately", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const oldInvoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "2", unitPrice: "100" }],
    initialPayment: "0"
  });

  app.storageService.updateState((state) => {
    state.customerEntries.push({
      id: "credit-before-sale",
      customerId: customer.id,
      kind: "adjustment",
      amountCents: 30000,
      balanceDeltaCents: -30000,
      description: "رصيد دائن سابق",
      sourceId: "legacy-credit",
      createdAt: "2026-10-18T10:00:00.000Z"
    });
    return state;
  });

  const request = {
    customerId: customer.id,
    date: "2026-10-21T11:30",
    items: [{ productId: product.id, quantity: "10", unitPrice: "100" }],
    discount: "100",
    discountReason: "خصم معتمد",
    initialPayment: "400",
    paymentMethod: "نقدي",
    requestId: "apply-credit-before-cash"
  };
  const invoice = app.invoiceService.createInvoice(request);
  const retry = app.invoiceService.createInvoice(request);
  const account = app.customerService.getCustomer(customer.id);
  const history = app.customerService.getAccountHistory(customer.id);
  const creditMovement = history.find((entry) => entry.kind === "credit_applied");

  assert.equal(oldInvoice.balanceCents, 20000);
  assert.equal(invoice.totalCents, 90000);
  assert.equal(invoice.creditAppliedCents, 30000);
  assert.equal(invoice.paidCents, 40000);
  assert.equal(invoice.balanceCents, 20000);
  assert.equal(retry.id, invoice.id);
  assert.equal(retry.creditAppliedCents, 30000);
  assert.equal(account.creditAvailableCents, 0);
  assert.equal(account.outstandingCents, 40000);
  assert.equal(account.totalCollectedCents, 40000);
  assert.equal(history.filter((entry) => entry.kind === "credit_applied").length, 1);
  assert.equal(creditMovement.balanceDeltaCents, 0);

  const reloaded = loadServices(app.__getTestStorageValue()).customerService.getCustomer(customer.id);
  assert.equal(reloaded.creditAvailableCents, 0);
  assert.equal(reloaded.outstandingCents, 40000);

  app.invoiceService.addCustomerPayment(customer.id, {
    amount: "100",
    method: "نقدي",
    notes: "سداد جزء من الدين القديم",
    requestId: "partial-old-debt-payment"
  });
  const updatedInvoices = app.invoiceService.getCustomerInvoices(customer.id);
  assert.equal(updatedInvoices.find((item) => item.id === oldInvoice.id).balanceCents, 10000);
  assert.equal(updatedInvoices.find((item) => item.id === invoice.id).balanceCents, 20000);
  assert.equal(app.customerService.getCustomer(customer.id).outstandingCents, 30000);
});

test("retains unused credit when it covers all or exactly matches a new invoice", () => {
  const app = loadServices();
  const product = addProduct(app);
  const coveredCustomer = addCustomer(app);
  const exactCustomer = app.customerService.addCustomer({ name: "متجر الرصيد المطابق" });

  app.storageService.updateState((state) => {
    state.customerEntries.push(
      {
        id: "credit-covered",
        customerId: coveredCustomer.id,
        kind: "adjustment",
        amountCents: 50000,
        balanceDeltaCents: -50000,
        description: "رصيد دائن",
        sourceId: "old-credit-covered",
        createdAt: "2026-10-18T10:00:00.000Z"
      },
      {
        id: "credit-exact",
        customerId: exactCustomer.id,
        kind: "adjustment",
        amountCents: 30000,
        balanceDeltaCents: -30000,
        description: "رصيد دائن",
        sourceId: "old-credit-exact",
        createdAt: "2026-10-18T10:00:00.000Z"
      }
    );
    return state;
  });

  const coveredInvoice = app.invoiceService.createInvoice({
    customerId: coveredCustomer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "3", unitPrice: "100" }],
    initialPayment: "0",
    requestId: "credit-covers-invoice"
  });
  const exactInvoice = app.invoiceService.createInvoice({
    customerId: exactCustomer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "3", unitPrice: "100" }],
    initialPayment: "0",
    requestId: "credit-matches-invoice"
  });

  assert.equal(coveredInvoice.creditAppliedCents, 30000);
  assert.equal(coveredInvoice.balanceCents, 0);
  assert.equal(app.customerService.getCustomer(coveredCustomer.id).creditAvailableCents, 20000);
  assert.equal(app.customerService.getCustomer(coveredCustomer.id).outstandingCents, 0);
  assert.equal(exactInvoice.creditAppliedCents, 30000);
  assert.equal(exactInvoice.balanceCents, 0);
  assert.equal(app.customerService.getCustomer(exactCustomer.id).creditAvailableCents, 0);
});

test("trip sales accepts whole cartons only and retains discounts in the separate invoice workflow", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const trip = createTrip(app, product, "2");

  assert.throws(() => app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "fractional-carton",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "1.5" }]
    }]
  }), /عددًا صحيحًا من الكراتين/);
  assert.equal(app.invoiceService.getTripInvoices(trip.id).length, 0);
  app.invoiceService.createTripInvoices({
    tripId: trip.id,
    date: "2026-10-20T11:30",
    entries: [{
      customerId: customer.id,
      requestId: "whole-carton-sale",
      initialPayment: "0",
      items: [{ productId: product.id, quantity: "2" }]
    }]
  });
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "0" }], "0");

  const directInvoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "1", unitPrice: "120.50" }],
    discount: "10",
    discountReason: "خصم معتمد"
  });
  assert.equal(directInvoice.discountCents, 1000);
  assert.equal(directInvoice.totalCents, 11050);
});

test("records old-debt collections once and preserves the customer's running account", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "2", unitPrice: "120.50" }]
  });

  app.invoiceService.addCustomerPayment(customer.id, {
    amount: "100",
    method: "تحويل بنكي",
    notes: "تحصيل دين سابق",
    requestId: "old-debt-payment"
  });
  app.invoiceService.addCustomerPayment(customer.id, {
    amount: "100",
    method: "تحويل بنكي",
    notes: "تحصيل دين سابق",
    requestId: "old-debt-payment"
  });

  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 14100);
  assert.equal(app.customerService.getCustomer(customer.id).outstandingCents, 14100);
  assert.equal(app.invoiceService.getCustomerPayments(customer.id).length, 1);
  assert.equal(app.invoiceService.getCustomerPayments(customer.id)[0].invoiceNumber, "INV-000001");
  assert.equal(app.invoiceService.getCustomerInvoices(customer.id)[0].balanceCents, 14100);
  const history = app.customerService.getAccountHistory(customer.id);
  assert.deepEqual(history.map((entry) => entry.balanceAfterCents), [24100, 14100]);
  assert.equal(history[1].paymentMethod, "تحويل بنكي");
  assert.throws(() => app.invoiceService.addCustomerPayment(customer.id, {
    amount: "141.01",
    method: "نقدي",
    requestId: "over-balance"
  }), /يتجاوز إجمالي ديون العميل/);
});

test("cancels an unpaid direct invoice with reversing stock and ledger movements", () => {
  const app = loadServices();
  const product = addProduct(app, { openingQuantity: "5" });
  const customer = addCustomer(app);
  const invoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "2", unitPrice: "150" }]
  });
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 3000);

  app.invoiceService.cancelInvoice(invoice.id, "إدخال خاطئ");
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 5000);
  assert.equal(app.customerService.getCustomer(customer.id).balanceCents, 0);
  assert.equal(app.invoiceService.getInvoice(invoice.id).status, "cancelled");
  assert.equal(app.customerService.getAccountHistory(customer.id).length, 2);
  assert.equal(app.inventoryService.getMovements(product.id).length, 3);
  assert.throws(() => app.invoiceService.addPayment(invoice.id, {
    amount: "1",
    method: "نقدي"
  }), /فاتورة ملغاة/);
});

test("migrates version 4 invoice and trip data without losing history", () => {
  const app = loadServices();
  const product = addProduct(app);
  const customer = addCustomer(app);
  const trip = createTrip(app, product, "2");
  app.tripService.completeTripSales(trip.id);
  app.tripService.recordReturn(trip.id, [{ productId: product.id, quantity: "2" }], "12.50");
  app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T11:30",
    items: [{ productId: product.id, quantity: "1", unitPrice: "120.50" }],
    initialPayment: "20",
    paymentMethod: "نقدي"
  });

  const legacy = JSON.parse(app.__getTestStorageValue());
  legacy.schemaVersion = 4;
  delete legacy.trips[0].returnRecord.cashReturnedCents;
  delete legacy.trips[0].returnRecord.reconciliationReview;
  legacy.invoices.forEach((invoice) => {
    delete invoice.customerName;
    delete invoice.customerCode;
    delete invoice.customerPhone;
    delete invoice.customerAddress;
    delete invoice.requestId;
  });
  legacy.payments.forEach((payment) => delete payment.requestId);

  const migratedApp = loadServices(JSON.stringify(legacy));
  const migrated = migratedApp.storageService.readState();
  const migratedInvoice = migratedApp.invoiceService.getInvoices()[0];

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.trips[0].returnRecord.cashReturnedCents, null);
  assert.equal(migrated.trips[0].returnRecord.reconciliationReview, null);
  assert.equal(migratedInvoice.customerName, customer.name);
  assert.equal(migrated.invoices[0].requestId, "legacy-invoice-" + migratedInvoice.id);
  assert.equal(migratedInvoice.paidCents, 2000);
  assert.equal(migratedApp.customerService.getCustomer(customer.id).balanceCents, 10050);
  assert.equal(JSON.parse(migratedApp.__getTestStorageValue()).schemaVersion, 7);
});

test("migrates schema version 3 to invoices while retaining existing customer and trip data", () => {
  const stateV3 = {
    schemaVersion: 3,
    products: [],
    stockMovements: [],
    vehicles: [{ id: "vehicle-1", name: "عربية 1", active: true }],
    drivers: [{ id: "driver-1", name: "محمد", active: true }],
    trips: [],
    customers: [{
      id: "customer-old",
      code: "CUS-000001",
      name: "عميل قديم",
      phone: "",
      address: "",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    customerEntries: [{
      id: "entry-old",
      customerId: "customer-old",
      kind: "sale",
      amountCents: 500,
      description: "فاتورة قديمة",
      createdAt: "2026-01-01T00:00:00.000Z"
    }],
    nextCustomerNumber: 2
  };
  const app = loadServices(JSON.stringify(stateV3));
  const upgraded = app.storageService.readState();

  assert.equal(upgraded.schemaVersion, 7);
  assert.equal(upgraded.invoices.length, 0);
  assert.equal(upgraded.payments.length, 0);
  assert.equal(upgraded.nextInvoiceNumber, 1);
  assert.equal(upgraded.nextPaymentNumber, 1);
  assert.equal(app.customerService.getCustomers()[0].balanceCents, 500);
});
