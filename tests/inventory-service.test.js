const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadServices(initialStorageValue, values = new Map()) {
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
    "js/services/inventoryService.js"
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
    purchasePrice: "120.50",
    salePrice: "145",
    openingQuantity: "12.5",
    lowStockThreshold: "2",
    ...overrides
  };
}

test("records opening stock once and preserves it when editing product details", () => {
  const app = loadServices();
  const created = app.inventoryService.addProduct(productInput());

  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 12500);
  assert.equal(app.inventoryService.getMovements(created.id).length, 1);

  app.inventoryService.updateProduct(created.id, productInput({
    name: "مشروب معدل",
    openingQuantity: "999"
  }));

  const updated = app.inventoryService.getProducts()[0];
  assert.equal(updated.name, "مشروب معدل");
  assert.equal(updated.stockQuantityMilli, 12500);
  assert.equal(app.inventoryService.getMovements(created.id).length, 1);
});

test("rejects duplicate codes and missing or invalid quantities without saving", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput());

  assert.throws(
    () => app.inventoryService.addProduct(productInput({ name: "مكرر" })),
    /كود الصنف مستخدم/
  );
  assert.throws(
    () => app.inventoryService.addProduct(productInput({ code: "P-002", openingQuantity: "" })),
    /أدخل الرصيد الافتتاحي/
  );
  assert.throws(
    () => app.inventoryService.addProduct(productInput({ code: "P-003", openingQuantity: "-1" })),
    /كمية غير سالبة/
  );
  assert.equal(app.inventoryService.getProducts().length, 1);
});

test("deactivation keeps the product and its movement history", () => {
  const app = loadServices();
  const product = app.inventoryService.addProduct(productInput());

  app.inventoryService.setActive(product.id, false);

  const saved = app.inventoryService.getProducts()[0];
  assert.equal(saved.active, false);
  assert.equal(saved.stockQuantityMilli, 12500);
  assert.equal(app.inventoryService.getMovements(product.id).length, 1);
});

test("replenishes the selected product, records a positive movement, and persists it", () => {
  const values = new Map();
  const app = loadServices(undefined, values);
  const product = app.inventoryService.addProduct(productInput());
  const otherProduct = app.inventoryService.addProduct(productInput({
    code: "P-002",
    openingQuantity: "3"
  }));

  app.inventoryService.replenishStock(product.id, "50");

  const replenished = app.inventoryService.getProducts().find((item) => item.id === product.id);
  const untouched = app.inventoryService.getProducts().find((item) => item.id === otherProduct.id);
  const movements = app.inventoryService.getMovements(product.id);

  assert.equal(replenished.stockQuantityMilli, 62500);
  assert.equal(untouched.stockQuantityMilli, 3000);
  assert.equal(movements.length, 2);
  assert.equal(movements[1].type, "stock_replenishment");
  assert.equal(movements[1].quantityMilli, 50000);
  assert.equal(movements[1].reference, "تزويد يدوي");
  assert.ok(movements[1].createdAt);
  assert.equal(app.inventoryService.getMovements(otherProduct.id).length, 1);

  const reloadedApp = loadServices(undefined, values);
  assert.equal(
    reloadedApp.inventoryService.getProducts().find((item) => item.id === product.id).stockQuantityMilli,
    62500
  );
  assert.equal(reloadedApp.inventoryService.getMovements(product.id).length, 2);
});

test("rejects invalid replenishment quantities without changing stock or movements", () => {
  const app = loadServices();
  const product = app.inventoryService.addProduct(productInput());
  const invalidQuantities = ["", "0", "-1", "1.5", "not-a-number"];

  invalidQuantities.forEach((quantity) => {
    assert.throws(() => app.inventoryService.replenishStock(product.id, quantity));
  });

  assert.equal(app.inventoryService.getProducts()[0].stockQuantityMilli, 12500);
  assert.equal(app.inventoryService.getMovements(product.id).length, 1);
});

test("clears only local test data when explicitly requested", () => {
  const app = loadServices();
  app.inventoryService.addProduct(productInput());
  app.inventoryService.clearTestData();

  assert.deepEqual(app.inventoryService.getProducts(), []);
});

test("reports corrupt saved data instead of overwriting it", () => {
  const app = loadServices("{not valid JSON");

  assert.throws(() => app.inventoryService.getProducts(), /تعذرت قراءة بيانات التجربة/);
});
