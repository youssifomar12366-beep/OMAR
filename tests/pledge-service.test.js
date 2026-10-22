const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadService(initialValue) {
  const values = new Map();
  if (typeof initialValue !== "undefined") {
    values.set("warehousePledges", initialValue);
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
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "services", "pledgeService.js"),
    "utf8"
  );
  vm.runInNewContext(source, context, { filename: "js/services/pledgeService.js" });
  context.PepsiApp.__getPledgeStorage = () => values.get("warehousePledges");
  context.PepsiApp.__getStoredKeys = () => Array.from(values.keys());
  return context.PepsiApp;
}

test("stores each pledge independently and keeps active records after reload", () => {
  const app = loadService();
  const first = app.pledgeService.createPledge({ name: "أحمد", amount: "1000" });
  const second = app.pledgeService.createPledge({ name: "أحمد", amount: "250.50" });

  assert.notEqual(first.id, second.id);
  assert.equal(first.amountCents, 100000);
  assert.equal(second.amountCents, 25050);
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));
  assert.equal(app.pledgeService.getPledges().length, 2);

  const reloaded = loadService(app.__getPledgeStorage());
  assert.equal(reloaded.pledgeService.getPledges().length, 2);
  assert.equal(reloaded.pledgeService.getPledges()[0].name, "أحمد");
  assert.deepEqual(reloaded.__getStoredKeys(), ["warehousePledges"]);
});

test("settles only the selected pledge and persists the remaining active records", () => {
  const app = loadService();
  const first = app.pledgeService.createPledge({ name: "شخص أول", amount: "1000" });
  const second = app.pledgeService.createPledge({ name: "شخص ثان", amount: "2000" });

  assert.equal(app.pledgeService.settlePledge(first.id), true);
  assert.deepEqual(app.pledgeService.getPledges().map((pledge) => pledge.id), [second.id]);
  assert.equal(app.pledgeService.settlePledge(first.id), false);

  const reloaded = loadService(app.__getPledgeStorage());
  assert.deepEqual(reloaded.pledgeService.getPledges().map((pledge) => pledge.id), [second.id]);
});

test("rejects missing names and invalid pledge amounts without saving", () => {
  const app = loadService();
  [
    { name: "", amount: "100" },
    { name: "شخص", amount: "" },
    { name: "شخص", amount: "0" },
    { name: "شخص", amount: "-1" },
    { name: "شخص", amount: "abc" },
    { name: "شخص", amount: "1.001" }
  ].forEach((input) => {
    assert.throws(() => app.pledgeService.createPledge(input));
  });
  assert.equal(app.pledgeService.getPledges().length, 0);
  assert.equal(app.__getPledgeStorage(), undefined);
});

test("reports corrupted pledge storage without replacing the saved value", () => {
  const app = loadService("{invalid");
  assert.throws(() => app.pledgeService.getPledges(), /تعذرت قراءة سجلات الرهن/);
  assert.equal(app.__getPledgeStorage(), "{invalid");
});
