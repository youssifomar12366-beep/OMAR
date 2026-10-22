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
    "js/services/expenseService.js"
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInNewContext(source, context, { filename: relativePath });
  });
  context.PepsiApp.__getTestStorageValue = () => values.get("pepsi_inventory_frontend_v1");
  return context.PepsiApp;
}

test("records a person's advances and repayments with the remaining balance in history", () => {
  const app = loadService();
  const person = app.expenseService.addPerson({ name: "أحمد" });

  app.expenseService.recordTransaction({
    requestId: "taken-1",
    personId: person.id,
    type: "taken",
    amount: "100.50",
    description: "مصاريف"
  });
  app.expenseService.recordTransaction({
    requestId: "repaid-1",
    personId: person.id,
    type: "repaid",
    amount: "30",
    description: "سداد نقدي"
  });

  const account = app.expenseService.getPeople()[0];
  const history = app.expenseService.getHistory(person.id);
  assert.equal(account.takenCents, 10050);
  assert.equal(account.repaidCents, 3000);
  assert.equal(account.balanceCents, 7050);
  assert.deepEqual(history.map((entry) => entry.balanceCents), [10050, 7050]);
  assert.deepEqual(history.map((entry) => entry.type), ["taken", "repaid"]);
});

test("reuses a person's record by name and prevents duplicate transactions and excessive repayment", () => {
  const app = loadService();
  const person = app.expenseService.addPerson({ name: "  سارة " });
  const duplicate = app.expenseService.addPerson({ name: "سارة" });
  const transactionInput = {
    requestId: "advance-once",
    personId: person.id,
    type: "taken",
    amount: "50",
    description: ""
  };
  const first = app.expenseService.recordTransaction(transactionInput);
  const retry = app.expenseService.recordTransaction(transactionInput);

  assert.equal(duplicate.id, person.id);
  assert.equal(app.expenseService.getPeople().length, 1);
  assert.equal(retry.id, first.id);
  assert.equal(app.expenseService.getHistory(person.id).length, 1);
  assert.throws(() => app.expenseService.recordTransaction({
    requestId: "too-much",
    personId: person.id,
    type: "repaid",
    amount: "50.01",
    description: ""
  }), /أكبر من المديونية/);
  assert.equal(app.expenseService.getPeople()[0].balanceCents, 5000);
});

test("persists people and transactions and migrates schema six without dropping existing records", () => {
  const app = loadService();
  const person = app.expenseService.addPerson({ name: "محمود" });
  app.expenseService.recordTransaction({
    requestId: "persisted-advance",
    personId: person.id,
    type: "taken",
    amount: "12.25",
    description: "طلب شخصي"
  });

  const reloaded = loadService(app.__getTestStorageValue());
  assert.equal(reloaded.expenseService.getPeople()[0].balanceCents, 1225);
  assert.equal(reloaded.expenseService.getHistory(person.id)[0].description, "طلب شخصي");

  const legacy = reloaded.storageService.readState();
  legacy.schemaVersion = 6;
  delete legacy.expensePeople;
  delete legacy.expenseTransactions;
  legacy.products.push({
    id: "legacy-product",
    code: "LEGACY",
    name: "صنف قديم",
    unit: "وحدة",
    purchasePriceCents: null,
    salePriceCents: null,
    lowStockThresholdMilli: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  const upgraded = loadService(JSON.stringify(legacy));

  assert.equal(upgraded.storageService.readState().schemaVersion, 7);
  assert.equal(upgraded.storageService.readState().products[0].id, "legacy-product");
  assert.deepEqual(Array.from(upgraded.storageService.readState().expensePeople), []);
});
