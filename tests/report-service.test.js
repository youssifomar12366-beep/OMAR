const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadServices() {
  const values = new Map();
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
    "js/services/customerService.js",
    "js/services/purchaseService.js",
    "js/services/invoiceService.js",
    "js/services/expenseService.js",
    "js/services/reportService.js"
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInNewContext(source, context, { filename: relativePath });
  });
  return context.PepsiApp;
}

test("summarizes monthly and yearly purchases, posted sales, expenses, payments, and purchase-cost profit", () => {
  const app = loadServices();
  const now = new Date("2026-10-22T12:00:00.000Z");
  const oldDate = "2025-11-01T10:00:00.000Z";
  const recentDate = "2026-10-10T10:00:00.000Z";
  const product = app.inventoryService.addProduct({
    code: "R-001",
    name: "صنف التقرير",
    unit: "قطعة",
    purchasePrice: "0",
    salePrice: "0",
    openingQuantity: "0",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "عميل التقرير" });
  const person = app.expenseService.addPerson({ name: "مصروف التقرير" });
  const oldPurchase = app.purchaseService.createPurchase({
    requestId: "purchase-old",
    supplierId: "supplier-company",
    items: [{ productId: product.id, quantity: "10", purchasePrice: "5", salePrice: "10" }],
    paidAmount: "30"
  });
  const oldInvoice = app.invoiceService.createInvoice({
    requestId: "invoice-old",
    customerId: customer.id,
    date: oldDate,
    items: [{ productId: product.id, quantity: "2", unitPrice: "10" }],
    initialPayment: "0"
  });
  const recentPurchase = app.purchaseService.createPurchase({
    requestId: "purchase-recent",
    supplierId: "supplier-company",
    items: [{ productId: product.id, quantity: "10", purchasePrice: "10", salePrice: "25" }],
    paidAmount: "60"
  });
  const recentInvoice = app.invoiceService.createInvoice({
    requestId: "invoice-recent",
    customerId: customer.id,
    date: recentDate,
    items: [{ productId: product.id, quantity: "4", unitPrice: "25" }],
    initialPayment: "0"
  });
  const oldExpense = app.expenseService.recordTransaction({
    requestId: "expense-old",
    personId: person.id,
    type: "taken",
    amount: "3",
    description: "قديم"
  });
  const recentExpense = app.expenseService.recordTransaction({
    requestId: "expense-recent",
    personId: person.id,
    type: "taken",
    amount: "5",
    description: "حديث"
  });

  app.storageService.updateState((state) => {
    state.purchases.find((purchase) => purchase.id === oldPurchase.id).createdAt = oldDate;
    state.stockMovements.filter((movement) => movement.sourceId === oldPurchase.id)
      .forEach((movement) => { movement.createdAt = oldDate; });
    state.invoices.find((invoice) => invoice.id === oldInvoice.id).createdAt = oldDate;
    state.invoices.find((invoice) => invoice.id === oldInvoice.id).date = oldDate;
    state.purchases.find((purchase) => purchase.id === recentPurchase.id).createdAt = recentDate;
    state.stockMovements.filter((movement) => movement.sourceId === recentPurchase.id)
      .forEach((movement) => { movement.createdAt = recentDate; });
    state.invoices.find((invoice) => invoice.id === recentInvoice.id).createdAt = recentDate;
    state.invoices.find((invoice) => invoice.id === recentInvoice.id).date = recentDate;
    state.expenseTransactions.find((transaction) => transaction.id === oldExpense.id).createdAt = oldDate;
    state.expenseTransactions.find((transaction) => transaction.id === recentExpense.id).createdAt = recentDate;
    return state;
  });

  const month = app.reportService.getSummary("month", now);
  assert.equal(month.purchasesCents, 10000);
  assert.equal(month.salesCents, 10000);
  assert.equal(month.expensesCents, 500);
  assert.equal(month.companyPaymentsCents, 6000);
  assert.equal(month.costOfGoodsSoldCents, 2000);
  assert.equal(month.profitCents, 7500);

  const year = app.reportService.getSummary("year", now);
  assert.equal(year.purchasesCents, 15000);
  assert.equal(year.salesCents, 12000);
  assert.equal(year.expensesCents, 800);
  assert.equal(year.companyPaymentsCents, 9000);
  assert.equal(year.costOfGoodsSoldCents, 3000);
  assert.equal(year.profitCents, 8200);
});

test("estimates opening-stock cost from the current purchase price and flags the estimate", () => {
  const app = loadServices();
  const now = new Date("2026-10-22T12:00:00.000Z");
  const product = app.inventoryService.addProduct({
    code: "R-002",
    name: "مخزون بلا تكلفة",
    unit: "قطعة",
    purchasePrice: "7",
    salePrice: "10",
    openingQuantity: "5",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "عميل مخزون" });
  app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T10:00:00.000Z",
    items: [{ productId: product.id, quantity: "2", unitPrice: "10" }],
    initialPayment: "0"
  });

  const summary = app.reportService.getSummary("month", now);
  assert.equal(summary.salesCents, 2000);
  assert.equal(summary.costOfGoodsSoldCents, 1400);
  assert.equal(summary.hasEstimatedCost, true);
  assert.equal(summary.hasUncostedSales, false);
  assert.equal(summary.profitCents, 600);
});

test("keeps profit unavailable only when the product has no readable purchase price", () => {
  const app = loadServices();
  const now = new Date("2026-10-22T12:00:00.000Z");
  const product = app.inventoryService.addProduct({
    code: "R-004",
    name: "منتج دون سعر شراء",
    unit: "قطعة",
    purchasePrice: "",
    salePrice: "10",
    openingQuantity: "5",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "عميل دون تكلفة" });
  app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T10:00:00.000Z",
    items: [{ productId: product.id, quantity: "2", unitPrice: "10" }],
    initialPayment: "0"
  });

  const summary = app.reportService.getSummary("month", now);
  assert.equal(summary.salesCents, 2000);
  assert.equal(summary.hasUncostedSales, true);
  assert.equal(summary.profitCents, null);
});

test("excludes cancelled invoices and never includes repayment transactions as expenses", () => {
  const app = loadServices();
  const now = new Date("2026-10-22T12:00:00.000Z");
  const product = app.inventoryService.addProduct({
    code: "R-003",
    name: "صنف الإلغاء",
    unit: "قطعة",
    purchasePrice: "0",
    salePrice: "10",
    openingQuantity: "5",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "عميل الإلغاء" });
  const person = app.expenseService.addPerson({ name: "شخص السداد" });
  const invoice = app.invoiceService.createInvoice({
    customerId: customer.id,
    date: "2026-10-20T10:00:00.000Z",
    items: [{ productId: product.id, quantity: "1", unitPrice: "10" }],
    initialPayment: "0"
  });
  app.invoiceService.cancelInvoice(invoice.id, "اختبار إلغاء");
  app.expenseService.recordTransaction({
    requestId: "expense-take",
    personId: person.id,
    type: "taken",
    amount: "10",
    description: ""
  });
  app.expenseService.recordTransaction({
    requestId: "expense-repay",
    personId: person.id,
    type: "repaid",
    amount: "4",
    description: ""
  });

  const summary = app.reportService.getSummary("month", now);
  assert.equal(summary.salesCents, 0);
  assert.equal(summary.expensesCents, 1000);
});

test("adds only actual repayments to profit in their transaction period without changing expenses", () => {
  const app = loadServices();
  const now = new Date("2026-10-22T12:00:00.000Z");
  const person = app.expenseService.addPerson({ name: "مديونية شخص" });
  const taken = app.expenseService.recordTransaction({
    requestId: "profit-taken",
    personId: person.id,
    type: "taken",
    amount: "1000",
    description: ""
  });
  const firstRepayment = app.expenseService.recordTransaction({
    requestId: "profit-repayment-1",
    personId: person.id,
    type: "repaid",
    amount: "400",
    description: ""
  });
  app.storageService.updateState((state) => {
    state.expenseTransactions.find((entry) => entry.id === taken.id).createdAt =
      "2025-11-01T10:00:00.000Z";
    state.expenseTransactions.find((entry) => entry.id === firstRepayment.id).createdAt =
      "2026-10-10T10:00:00.000Z";
    return state;
  });

  const monthly = app.reportService.getSummary("month", now);
  assert.equal(monthly.expensesCents, 0);
  assert.equal(monthly.profitCents, 40000);

  const yearly = app.reportService.getSummary("year", now);
  assert.equal(yearly.expensesCents, 100000);
  assert.equal(yearly.profitCents, -60000);

  const secondRepayment = app.expenseService.recordTransaction({
    requestId: "profit-repayment-2",
    personId: person.id,
    type: "repaid",
    amount: "600",
    description: ""
  });
  app.storageService.updateState((state) => {
    state.expenseTransactions.find((entry) => entry.id === secondRepayment.id).createdAt =
      "2026-10-20T10:00:00.000Z";
    return state;
  });

  const repaidYear = app.reportService.getSummary("year", now);
  assert.equal(repaidYear.expensesCents, 100000);
  assert.equal(repaidYear.profitCents, 0);
  assert.equal(app.expenseService.getPeople()[0].balanceCents, 0);
});

test("summarizes daily sales, trip collections, current-day debt, expenses, profit, and separate trips", () => {
  const app = loadServices();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayIso = today.toISOString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = yesterday.toISOString();
  const product = app.inventoryService.addProduct({
    code: "D-001",
    name: "صنف يومي",
    unit: "قطعة",
    purchasePrice: "2",
    salePrice: "10",
    openingQuantity: "10",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "عميل يومي" });
  const person = app.expenseService.addPerson({ name: "مصروف يومي" });

  app.storageService.updateState((state) => {
    [
      ["trip-today-1", "TR-TODAY-1", todayIso, 2000],
      ["trip-today-2", "TR-TODAY-2", todayIso, 1000],
      ["trip-yesterday", "TR-YESTERDAY", yesterdayIso, 1000]
    ].forEach(([id, number, dateTime, quantityMilli]) => {
      state.trips.push({
        id,
        number,
        vehicleId: "vehicle-1",
        vehicleName: "عربية 1",
        driverId: "driver-1",
        driverName: "محمد",
        dateTime,
        createdAt: dateTime,
        status: "returned",
        items: [{
          productId: product.id,
          code: product.code,
          name: product.name,
          unit: product.unit,
          salePriceCents: product.salePriceCents,
          quantityMilli
        }],
        replenishments: [],
        returnRecord: {
          id: "return-" + id,
          createdAt: dateTime,
          cashReturnedCents: 0,
          reconciliationReview: null,
          items: [{ productId: product.id, quantityMilli: 0 }]
        }
      });
    });
    return state;
  });

  const todayInvoice = app.invoiceService.createInvoice({
    requestId: "daily-invoice-today",
    customerId: customer.id,
    tripId: "trip-today-1",
    date: todayIso,
    items: [{ productId: product.id, quantity: "2", unitPrice: "10" }],
    initialPayment: "0"
  });
  const oldInvoice = app.invoiceService.createInvoice({
    requestId: "daily-invoice-old",
    customerId: customer.id,
    tripId: "trip-yesterday",
    date: yesterdayIso,
    items: [{ productId: product.id, quantity: "1", unitPrice: "10" }],
    initialPayment: "0"
  });
  app.invoiceService.addPayment(todayInvoice.id, {
    amount: "5",
    method: "نقدي",
    notes: ""
  });
  app.invoiceService.addPayment(oldInvoice.id, {
    amount: "3",
    method: "نقدي",
    notes: ""
  });
  const taken = app.expenseService.recordTransaction({
    requestId: "daily-expense",
    personId: person.id,
    type: "taken",
    amount: "5",
    description: ""
  });
  const repaid = app.expenseService.recordTransaction({
    requestId: "daily-repayment",
    personId: person.id,
    type: "repaid",
    amount: "2",
    description: ""
  });
  app.storageService.updateState((state) => {
    [taken.id, repaid.id].forEach((id) => {
      state.expenseTransactions.find((entry) => entry.id === id).createdAt = todayIso;
    });
    state.payments.forEach((payment) => { payment.createdAt = todayIso; });
    return state;
  });

  const summary = app.reportService.getDailySummary(today);
  assert.equal(summary.salesCents, 2000);
  assert.equal(summary.collectionsCents, 800);
  assert.equal(summary.debtCents, 1500);
  assert.equal(summary.expensesCents, 500);
  assert.equal(summary.profitCents, 1300);
  assert.equal(summary.tripCount, 2);
  assert.equal(summary.hasEstimatedCost, true);
  assert.equal(summary.hasUncostedSales, false);

  const nextDay = new Date(today);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDaySummary = app.reportService.getDailySummary(nextDay);
  assert.equal(nextDaySummary.salesCents, 0);
  assert.equal(nextDaySummary.collectionsCents, 0);
  assert.equal(nextDaySummary.debtCents, 0);
  assert.equal(nextDaySummary.expensesCents, 0);
  assert.equal(nextDaySummary.profitCents, 0);
  assert.equal(nextDaySummary.tripCount, 0);
  assert.equal(app.storageService.readState().invoices.length, 2);
});

test("refreshes daily values after transaction dates or records change and excludes old trader debt", () => {
  const app = loadServices();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const product = app.inventoryService.addProduct({
    code: "D-002",
    name: "صنف مديونية",
    unit: "قطعة",
    purchasePrice: "1",
    salePrice: "4",
    openingQuantity: "10",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "صاحب رصيد قديم" });
  const oldInvoice = app.invoiceService.createInvoice({
    requestId: "old-debt-invoice",
    customerId: customer.id,
    date: yesterday.toISOString(),
    items: [{ productId: product.id, quantity: "2", unitPrice: "4" }],
    initialPayment: "0"
  });
  const todayInvoice = app.invoiceService.createInvoice({
    requestId: "new-debt-invoice",
    customerId: customer.id,
    date: today.toISOString(),
    items: [{ productId: product.id, quantity: "1", unitPrice: "4" }],
    initialPayment: "0"
  });

  assert.equal(app.reportService.getDailySummary(today).debtCents, 400);
  app.storageService.updateState((state) => {
    state.invoices.find((invoice) => invoice.id === todayInvoice.id).date =
      yesterday.toISOString();
    return state;
  });
  assert.equal(app.reportService.getDailySummary(today).debtCents, 0);
  assert.equal(app.storageService.readState().invoices.length, 2);
  assert.ok(oldInvoice.id);
});

test("removes cancelled sales and their debt from daily dashboard values", () => {
  const app = loadServices();
  const today = new Date();
  const product = app.inventoryService.addProduct({
    code: "D-003",
    name: "صنف ملغي",
    unit: "قطعة",
    purchasePrice: "1",
    salePrice: "4",
    openingQuantity: "3",
    lowStockThreshold: "0"
  });
  const customer = app.customerService.addCustomer({ name: "عميل فاتورة ملغاة" });
  const invoice = app.invoiceService.createInvoice({
    requestId: "daily-cancelled-invoice",
    customerId: customer.id,
    date: today.toISOString(),
    items: [{ productId: product.id, quantity: "1", unitPrice: "4" }],
    initialPayment: "0"
  });

  assert.equal(app.reportService.getDailySummary(today).salesCents, 400);
  assert.equal(app.reportService.getDailySummary(today).debtCents, 400);
  app.invoiceService.cancelInvoice(invoice.id, "اختبار تحديث لوحة اليوم");
  const summary = app.reportService.getDailySummary(today);
  assert.equal(summary.salesCents, 0);
  assert.equal(summary.debtCents, 0);
});

test("applies a trader's earlier credit to today's legacy ledger balance", () => {
  const app = loadServices();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const customer = app.customerService.addCustomer({ name: "عميل رصيد دائن" });

  app.storageService.updateState((state) => {
    state.customerEntries.push({
      id: "legacy-credit-entry",
      customerId: customer.id,
      kind: "adjustment",
      amountCents: 0,
      balanceDeltaCents: -500,
      description: "رصيد قديم",
      createdAt: yesterday.toISOString()
    });
    state.customerEntries.push({
      id: "legacy-sale-entry",
      customerId: customer.id,
      kind: "sale",
      amountCents: 800,
      description: "تعامل اليوم",
      sourceId: "legacy-sale",
      createdAt: today.toISOString()
    });
    return state;
  });

  const summary = app.reportService.getDailySummary(today);
  assert.equal(summary.salesCents, 800);
  assert.equal(summary.debtCents, 300);
});
