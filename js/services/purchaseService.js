(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;
  var idCounter = 0;
  var supplierId = "supplier-company";
  var supplierName = "الشركة";

  function requireText(value, label) {
    var text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error("أدخل " + label + ".");
    }
    return text;
  }

  function parseMoney(value, label) {
    var amount;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل " + label + ".");
    }
    amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
        !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("تحقق من " + label + "؛ يجب أن يكون مبلغًا غير سالب وبحد أقصى منزلتين عشريتين.");
    }
    return Math.round(amount * 100);
  }

  function parseQuantity(value) {
    var quantity;
    var quantityMilli;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل كمية الصنف المستلمة.");
    }
    quantity = Number(value);
    quantityMilli = Math.round(quantity * 1000);
    if (!Number.isFinite(quantity) || quantity <= 0 ||
        Math.abs(quantity * 1000 - quantityMilli) > 0.000001 ||
        !Number.isSafeInteger(quantityMilli)) {
      throw new Error("يجب أن تكون كمية الصنف أكبر من صفر وبحد أقصى ثلاث منازل عشرية.");
    }
    return quantityMilli;
  }

  function addCents(left, right) {
    var total = left + right;
    if (!Number.isSafeInteger(total)) {
      throw new Error("إجمالي الطلبية تجاوز الحد الآمن للحساب.");
    }
    return total;
  }

  function createId(state, prefix) {
    var id;
    var exists;
    do {
      idCounter += 1;
      id = prefix + "-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      exists = state.products.concat(state.stockMovements, state.vehicles, state.drivers,
        state.trips, state.customers, state.customerEntries, state.invoices,
        state.payments, state.purchases).some(function (record) {
        return record.id === id;
      });
    } while (exists);
    return id;
  }

  function formatPurchaseNumber(number) {
    var value = String(number);
    while (value.length < 6) {
      value = "0" + value;
    }
    return "PUR-" + value;
  }

  function createPurchase(input) {
    var purchaseId = "";
    var updatedState = storage.updateState(function (state) {
      var requestId = requireText(input && input.requestId, "معرف حفظ الطلبية");
      var existing = state.purchases.find(function (purchase) {
        return purchase.requestId === requestId;
      });
      var seenProducts = Object.create(null);
      var items = [];
      var totalCents = 0;
      var paidCents;
      var now;
      var purchase;

      if (existing) {
        purchaseId = existing.id;
        return state;
      }
      if (input.supplierId !== supplierId) {
        throw new Error("اختر المورد المسجل.");
      }
      if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new Error("أضف صنفًا واحدًا على الأقل إلى الطلبية.");
      }

      input.items.forEach(function (line) {
        var product;
        var quantityMilli;
        var purchasePriceCents;
        var salePriceCents;
        var lineTotalCents;
        if (!line || typeof line.productId !== "string" || seenProducts[line.productId]) {
          throw new Error("اختر صنفًا مختلفًا لكل سطر في الطلبية.");
        }
        product = state.products.find(function (item) {
          return item.id === line.productId && item.active;
        });
        if (!product) {
          throw new Error("أحد الأصناف المختارة غير موجود أو غير نشط.");
        }
        seenProducts[line.productId] = true;
        quantityMilli = parseQuantity(line.quantity);
        purchasePriceCents = parseMoney(line.purchasePrice, "سعر الشراء الجديد");
        salePriceCents = parseMoney(line.salePrice, "سعر البيع الجديد");
        lineTotalCents = Math.round(quantityMilli * purchasePriceCents / 1000);
        if (!Number.isSafeInteger(lineTotalCents)) {
          throw new Error("قيمة الصنف تتجاوز الحد الذي يمكن حسابه بدقة.");
        }
        totalCents = addCents(totalCents, lineTotalCents);
        items.push({
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          quantityMilli: quantityMilli,
          purchasePriceCents: purchasePriceCents,
          salePriceCents: salePriceCents,
          totalCents: lineTotalCents
        });
      });

      paidCents = parseMoney(input.paidAmount, "المبلغ المدفوع");
      if (paidCents > totalCents) {
        throw new Error("المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الطلبية.");
      }
      now = new Date().toISOString();
      purchase = {
        id: createId(state, "purchase"),
        number: formatPurchaseNumber(state.nextPurchaseNumber),
        requestId: requestId,
        supplierId: supplierId,
        supplierName: supplierName,
        createdAt: now,
        items: items,
        totalCents: totalCents,
        paidCents: paidCents,
        balanceCents: totalCents - paidCents
      };
      state.nextPurchaseNumber += 1;
      items.forEach(function (item) {
        var product = state.products.find(function (record) {
          return record.id === item.productId;
        });
        var currentQuantityMilli = state.stockMovements.reduce(function (total, movement) {
          return movement.productId === product.id
            ? total + movement.quantityMilli : total;
        }, 0);
        if (!Number.isSafeInteger(currentQuantityMilli) ||
            !Number.isSafeInteger(currentQuantityMilli + item.quantityMilli)) {
          throw new Error("إضافة كمية " + product.name + " ستتجاوز حد المخزون المسموح.");
        }
        product.purchasePriceCents = item.purchasePriceCents;
        product.salePriceCents = item.salePriceCents;
        product.updatedAt = now;
        state.stockMovements.push({
          id: createId(state, "move"),
          productId: product.id,
          type: "purchase_receipt",
          quantityMilli: item.quantityMilli,
          reference: purchase.number,
          sourceId: purchase.id,
          createdAt: now
        });
      });
      state.purchases.push(purchase);
      purchaseId = purchase.id;
      return state;
    });
    return updatedState.purchases.find(function (purchase) {
      return purchase.id === purchaseId;
    });
  }

  function getPurchases() {
    return storage.readState().purchases.slice().sort(function (left, right) {
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

  function getSummary() {
    return storage.readState().purchases.reduce(function (summary, purchase) {
      summary.totalCents = addCents(summary.totalCents, purchase.totalCents);
      summary.paidCents = addCents(summary.paidCents, purchase.paidCents);
      summary.balanceCents = addCents(summary.balanceCents, purchase.balanceCents);
      return summary;
    }, { totalCents: 0, paidCents: 0, balanceCents: 0 });
  }

  global.PepsiApp.purchaseService = {
    createPurchase: createPurchase,
    getPurchases: getPurchases,
    getSummary: getSummary,
    getSupplier: function () {
      return { id: supplierId, name: supplierName };
    }
  };
}(window));
