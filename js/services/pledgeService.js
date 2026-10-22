(function (global) {
  "use strict";

  var storageKey = "warehousePledges";
  var idCounter = 0;

  function readPledges() {
    var serialized = global.localStorage.getItem(storageKey);
    var pledges;

    if (serialized === null) {
      return [];
    }
    try {
      pledges = JSON.parse(serialized);
    } catch (error) {
      throw new Error("تعذرت قراءة سجلات الرهن المحفوظة؛ لم تُستبدل البيانات.");
    }
    if (!Array.isArray(pledges) || !pledges.every(function (pledge) {
      return pledge && typeof pledge.id === "string" && pledge.id &&
        typeof pledge.name === "string" && pledge.name.trim() &&
        Number.isSafeInteger(pledge.amountCents) && pledge.amountCents > 0 &&
        typeof pledge.createdAt === "string" && Number.isFinite(Date.parse(pledge.createdAt));
    })) {
      throw new Error("بنية بيانات الرهن المحفوظة غير صالحة؛ لم تُستبدل البيانات.");
    }
    return pledges;
  }

  function parseAmount(value) {
    var amount;
    var cents;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل المبلغ المرهون.");
    }
    amount = Number(value);
    cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount <= 0 ||
        Math.abs(amount * 100 - cents) > 0.000001 ||
        !Number.isSafeInteger(cents)) {
      throw new Error("يجب أن يكون المبلغ المرهون رقمًا موجبًا وبحد أقصى منزلتين عشريتين.");
    }
    return cents;
  }

  function createId(pledges) {
    var id;
    do {
      idCounter += 1;
      id = "pledge-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
    } while (pledges.some(function (pledge) {
      return pledge.id === id;
    }));
    return id;
  }

  function getPledges() {
    return readPledges().slice().sort(function (left, right) {
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

  function createPledge(input) {
    var name = input && typeof input.name === "string" ? input.name.trim() : "";
    var pledges;
    var pledge;
    if (!name) {
      throw new Error("أدخل اسم الشخص.");
    }
    if (name.length > 120) {
      throw new Error("تجاوز اسم الشخص الحد المسموح من الأحرف.");
    }
    pledges = readPledges();
    pledge = {
      id: createId(pledges),
      name: name,
      amountCents: parseAmount(input.amount),
      createdAt: new Date().toISOString()
    };
    pledges.push(pledge);
    global.localStorage.setItem(storageKey, JSON.stringify(pledges));
    return pledge;
  }

  function settlePledge(pledgeId) {
    var pledges = readPledges();
    var index = pledges.findIndex(function (pledge) {
      return pledge.id === pledgeId;
    });
    if (index === -1) {
      return false;
    }
    pledges.splice(index, 1);
    global.localStorage.setItem(storageKey, JSON.stringify(pledges));
    return true;
  }

  global.PepsiApp = global.PepsiApp || {};
  global.PepsiApp.pledgeService = {
    getPledges: getPledges,
    createPledge: createPledge,
    settlePledge: settlePledge
  };
}(window));
