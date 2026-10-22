(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;
  var purchaseService = global.PepsiApp.purchaseService;
  var idCounter = 0;

  function requireText(value, label) {
    var text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error("أدخل " + label + ".");
    }
    return text;
  }

  function parseAmount(value) {
    var amount;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل مبلغ البونص.");
    }
    amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
        !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("يجب أن يكون مبلغ البونص موجبًا وصحيحًا وبحد أقصى منزلتين عشريتين.");
    }
    return Math.round(amount * 100);
  }

  function createId(state) {
    var id;
    var exists;
    do {
      idCounter += 1;
      id = "bonus-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      exists = state.products.concat(state.stockMovements, state.vehicles, state.drivers,
        state.trips, state.customers, state.customerEntries, state.invoices,
        state.payments, state.purchases, state.expensePeople, state.expenseTransactions,
        state.bonusTransactions).some(function (record) {
        return record.id === id;
      });
    } while (exists);
    return id;
  }

  function createBonus(input) {
    var bonusId = "";
    var updatedState = storage.updateState(function (state) {
      var requestId = requireText(input && input.requestId, "معرف حفظ البونص");
      var existing = state.bonusTransactions.find(function (bonus) {
        return bonus.requestId === requestId;
      });
      var bonus;

      if (existing) {
        bonusId = existing.id;
        return state;
      }
      bonus = {
        id: createId(state),
        requestId: requestId,
        amountCents: parseAmount(input.amount),
        createdAt: new Date().toISOString()
      };
      bonus.settledCents = Math.min(
        bonus.amountCents,
        purchaseService.getOutstandingBalance(state)
      );
      bonus.profitCents = bonus.amountCents - bonus.settledCents;
      state.bonusTransactions.push(bonus);
      bonusId = bonus.id;
      return state;
    });
    return updatedState.bonusTransactions.find(function (bonus) {
      return bonus.id === bonusId;
    });
  }

  function getBonuses() {
    return storage.readState().bonusTransactions.slice().sort(function (left, right) {
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

  global.PepsiApp.bonusService = {
    createBonus: createBonus,
    getBonuses: getBonuses
  };
}(window));
