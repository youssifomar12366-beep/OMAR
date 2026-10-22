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
    Error
  };
  context.window = context;
  [
    "js/storageService.js",
    "js/services/inventoryService.js",
    "js/services/purchaseService.js"
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInNewContext(source, context, { filename: relativePath });
  });
  context.PepsiApp.__getTestStorageValue = () => values.get("pepsi_inventory_frontend_v1");
  return context.PepsiApp;
}

function addProduct(app) {
  return app.inventoryService.addProduct({
    code: "P-001",
    name: "مشروب",
    unit: "كرتونة",
    purchasePrice: "10",
    salePrice: "20",
    openingQuantity: "10",
    lowStockThreshold: "2"
  });
}

function purchaseRequest(product, overrides = {}) {
  return {
    requestId: "purchase-once",
    supplierId: "supplier-company",
    items: [{
      productId: product.id,
      quantity: "3.5",
      purchasePrice: "12.50",
      salePrice: "30"
    }],
    paidAmount: "20",
    ...overrides
  };
}

test("records supplier purchase, adds stock, updates prices, and keeps unpaid balance", () => {
  const app = loadServices();
  const product = addProduct(app);
  const purchase = app.purchaseService.createPurchase(purchaseRequest(product));
  const savedProduct = app.inventoryService.getProducts()[0];
  const movements = app.inventoryService.getMovements(product.id);
  const summary = app.purchaseService.getSummary();

  assert.equal(purchase.number, "PUR-000001");
  assert.equal(purchase.supplierName, "الشركة");
  assert.equal(purchase.totalCents, 4375);
  assert.equal(purchase.paidCents, 2000);
  assert.equal(purchase.balanceCents, 2375);
  assert.equal(savedProduct.stockQuantityMilli, 13500);
  assert.equal(savedProduct.purchasePriceCents, 1250);
  assert.equal(savedProduct.salePriceCents, 3000);
  assert.equal(movements.filter((movement) => movement.type === "purchase_receipt").length, 1);
  assert.equal(summary.totalCents, 4375);
  assert.equal(summary.paidCents, 2000);
  assert.equal(summary.balanceCents, 2375);
});

test("purchase retries are idempotent and persistence preserves the purchase and stock", () => {
  const app = loadServices();
  const product = addProduct(app);
  const first = app.purchaseService.createPurchase(purchaseRequest(product));
  const retry = app.purchaseService.createPurchase(purchaseRequest(product, {
    items: [{ productId: product.id, quantity: "100", purchasePrice: "99", salePrice: "99" }],
    paidAmount: "0"
  }));

  assert.equal(retry.id, first.id);
  assert.equal(app.purchaseService.getPurchases().length, 1);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 13500);

  const reloaded = loadServices(app.__getTestStorageValue());
  assert.equal(reloaded.purchaseService.getPurchases().length, 1);
  assert.equal(reloaded.purchaseService.getSummary().balanceCents, 2375);
  assert.equal(reloaded.inventoryService.getProducts()[0].stockQuantityMilli, 13500);
  assert.equal(reloaded.inventoryService.getProducts()[0].salePriceCents, 3000);
});

test("supports multiple products in one purchase and totals each line", () => {
  const app = loadServices();
  const firstProduct = addProduct(app);
  const secondProduct = app.inventoryService.addProduct({
    code: "P-002",
    name: "مشروب آخر",
    unit: "عبوة",
    purchasePrice: "4",
    salePrice: "6",
    openingQuantity: "1",
    lowStockThreshold: "0"
  });
  const purchase = app.purchaseService.createPurchase(purchaseRequest(firstProduct, {
    items: [
      { productId: firstProduct.id, quantity: "3.5", purchasePrice: "12.50", salePrice: "30" },
      { productId: secondProduct.id, quantity: "2", purchasePrice: "5", salePrice: "8" }
    ],
    paidAmount: "50"
  }));

  assert.equal(purchase.items.length, 2);
  assert.equal(purchase.totalCents, 5375);
  assert.equal(purchase.balanceCents, 375);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 13500);
  assert.equal(app.inventoryService.getProducts()[1].stockQuantityMilli, 3000);
  assert.equal(app.purchaseService.getSummary().totalCents, 5375);
});

test("rejects invalid purchase entries atomically", () => {
  const app = loadServices();
  const product = addProduct(app);

  assert.throws(() => app.purchaseService.createPurchase(purchaseRequest(product, {
    paidAmount: "44"
  })), /لا يمكن أن يتجاوز/);
  assert.throws(() => app.purchaseService.createPurchase(purchaseRequest(product, {
    items: [{ productId: product.id, quantity: "0", purchasePrice: "12", salePrice: "30" }]
  })), /أكبر من صفر/);
  assert.throws(() => app.purchaseService.createPurchase(purchaseRequest(product, {
    supplierId: "unknown-supplier"
  })), /اختر المورد/);

  assert.equal(app.purchaseService.getPurchases().length, 0);
  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 10000);
  assert.equal(app.inventoryService.getProducts()[0].purchasePriceCents, 1000);
});

test("migrates version five storage without losing existing data", () => {
  const app = loadServices();
  addProduct(app);
  const legacyState = JSON.parse(app.__getTestStorageValue());
  legacyState.schemaVersion = 5;
  delete legacyState.purchases;
  delete legacyState.nextPurchaseNumber;

  const migrated = loadServices(JSON.stringify(legacyState));
  assert.equal(migrated.storageService.readState().schemaVersion, 7);
  assert.equal(migrated.purchaseService.getPurchases().length, 0);
  assert.equal(migrated.inventoryService.getProducts()[0].stockQuantityMilli, 10000);
});
