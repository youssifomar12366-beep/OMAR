(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;
  var idCounter = 0;

  function requireText(value, label, maxLength) {
    var text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error("أدخل " + label + ".");
    }
    if (text.length > maxLength) {
      throw new Error("تجاوز " + label + " الحد المسموح من الأحرف.");
    }
    return text;
  }

  function optionalText(value, label, maxLength) {
    var text = typeof value === "string" ? value.trim() : "";
    if (text.length > maxLength) {
      throw new Error("تجاوز " + label + " الحد المسموح من الأحرف.");
    }
    return text;
  }

  function parseMoney(value) {
    var amount;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل المبلغ.");
    }
    amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
        !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("يجب أن يكون المبلغ أكبر من صفر وبحد أقصى منزلتين عشريتين.");
    }
    return Math.round(amount * 100);
  }

  function createId(state, prefix) {
    var id;
    var exists;
    do {
      idCounter += 1;
      id = prefix + "-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      exists = state.expensePeople.concat(state.expenseTransactions).some(function (record) {
        return record.id === id;
      });
    } while (exists);
    return id;
  }

  function transactionOrder(left, right) {
    var dateOrder = left.createdAt.localeCompare(right.createdAt);
    return dateOrder || left._order - right._order;
  }

  function getPeopleFromState(state) {
    var balances = Object.create(null);
    var totals = Object.create(null);
    var transactions = state.expenseTransactions.map(function (transaction, index) {
      return Object.assign({ _order: index }, transaction);
    }).sort(transactionOrder);

    state.expensePeople.forEach(function (person) {
      balances[person.id] = 0;
      totals[person.id] = { takenCents: 0, repaidCents: 0 };
    });
    transactions.forEach(function (transaction) {
      var personTotals = totals[transaction.personId];
      if (!personTotals) {
        return;
      }
      if (transaction.type === "taken") {
        personTotals.takenCents += transaction.amountCents;
        balances[transaction.personId] += transaction.amountCents;
      } else {
        personTotals.repaidCents += transaction.amountCents;
        balances[transaction.personId] -= transaction.amountCents;
      }
      if (!Number.isSafeInteger(personTotals.takenCents) ||
          !Number.isSafeInteger(personTotals.repaidCents) ||
          !Number.isSafeInteger(balances[transaction.personId])) {
        throw new Error("تعذر حساب سجل المصروفات بدقة.");
      }
    });

    return state.expensePeople.map(function (person) {
      return {
        id: person.id,
        name: person.name,
        createdAt: person.createdAt,
        takenCents: totals[person.id].takenCents,
        repaidCents: totals[person.id].repaidCents,
        balanceCents: balances[person.id]
      };
    }).sort(function (left, right) {
      return left.name.localeCompare(right.name, "ar");
    });
  }

  function findPerson(state, personId) {
    var person = state.expensePeople.find(function (candidate) {
      return candidate.id === personId;
    });
    if (!person) {
      throw new Error("الشخص المطلوب غير موجود.");
    }
    return person;
  }

  function addPerson(input) {
    var personId = "";
    var updatedState = storage.updateState(function (state) {
      var name = requireText(input && input.name, "اسم الشخص", 120);
      var existing = state.expensePeople.find(function (person) {
        return person.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase();
      });
      if (existing) {
        personId = existing.id;
        return state;
      }
      var person = {
        id: createId(state, "expense-person"),
        name: name,
        createdAt: new Date().toISOString()
      };
      state.expensePeople.push(person);
      personId = person.id;
      return state;
    });
    return updatedState.expensePeople.find(function (person) {
      return person.id === personId;
    });
  }

  function recordTransaction(input) {
    var transactionId = "";
    var updatedState = storage.updateState(function (state) {
      var requestId = requireText(input && input.requestId, "معرف حفظ العملية", 160);
      var existing = state.expenseTransactions.find(function (transaction) {
        return transaction.requestId === requestId;
      });
      var person;
      var amountCents;
      var balanceCents;
      var type = input && input.type;
      var transaction;

      if (existing) {
        transactionId = existing.id;
        return state;
      }
      if (type !== "taken" && type !== "repaid") {
        throw new Error("نوع العملية غير صالح.");
      }
      person = findPerson(state, input.personId);
      amountCents = parseMoney(input.amount);
      balanceCents = getPeopleFromState(state).find(function (entry) {
        return entry.id === person.id;
      }).balanceCents;
      if (type === "repaid" && amountCents > balanceCents) {
        throw new Error("مبلغ السداد أكبر من المديونية الحالية.");
      }
      transaction = {
        id: createId(state, "expense-transaction"),
        personId: person.id,
        type: type,
        amountCents: amountCents,
        description: optionalText(input.description, "وصف العملية", 240),
        requestId: requestId,
        createdAt: new Date().toISOString()
      };
      state.expenseTransactions.push(transaction);
      transactionId = transaction.id;
      return state;
    });
    return updatedState.expenseTransactions.find(function (transaction) {
      return transaction.id === transactionId;
    });
  }

  function getHistory(personId) {
    var state = storage.readState();
    var balanceCents = 0;
    return state.expenseTransactions.map(function (transaction, index) {
      return Object.assign({ _order: index }, transaction);
    }).filter(function (transaction) {
      return transaction.personId === personId;
    }).sort(transactionOrder).map(function (transaction) {
      balanceCents += transaction.type === "taken"
        ? transaction.amountCents : -transaction.amountCents;
      return {
        id: transaction.id,
        type: transaction.type,
        amountCents: transaction.amountCents,
        description: transaction.description,
        createdAt: transaction.createdAt,
        balanceCents: balanceCents
      };
    });
  }

  global.PepsiApp.expenseService = {
    addPerson: addPerson,
    getPeople: function () {
      return getPeopleFromState(storage.readState());
    },
    getHistory: getHistory,
    recordTransaction: recordTransaction
  };
}(window));
