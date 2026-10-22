(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;
  var idCounter = 0;

  function createId(state, prefix) {
    var id;
    var exists;

    do {
      idCounter += 1;
      id = prefix + "-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      exists = state.products.some(function (product) {
        return product.id === id;
      }) || state.stockMovements.some(function (movement) {
        return movement.id === id;
      });
    } while (exists);

    return id;
  }

  function requireText(value, label) {
    var text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error("أدخل " + label + ".");
    }
    return text;
  }

  function parseMoney(value, label) {
    var amount;

    if (value === "" || value === null || typeof value === "undefined") {
      return null;
    }

    amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
      throw new Error("تحقق من " + label + "؛ يجب أن يكون مبلغًا غير سالب وبحد أقصى منزلتين عشريتين.");
    }

    return Math.round(amount * 100);
  }

  function parseQuantity(value, label) {
    var quantity = Number(value);

    if (typeof value === "string" && value.trim() === "") {
      throw new Error("أدخل " + label + ".");
    }

    if (!Number.isFinite(quantity) || quantity < 0 ||
        Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001) {
      throw new Error("تحقق من " + label + "؛ يجب أن تكون كمية غير سالبة وبحد أقصى ثلاث منازل عشرية.");
    }

    return Math.round(quantity * 1000);
  }

  function validateProductInput(input, isNew, state, productId) {
    var code = requireText(input.code, "كود الصنف").toLocaleUpperCase();
    var duplicateCode = state.products.some(function (product) {
      return product.id !== productId && product.code.toLocaleUpperCase() === code;
    });

    if (duplicateCode) {
      throw new Error("كود الصنف مستخدم بالفعل؛ اختر كودًا فريدًا.");
    }

    return {
      code: code,
      name: requireText(input.name, "اسم الصنف"),
      unit: requireText(input.unit, "وحدة القياس"),
      purchasePriceCents: parseMoney(input.purchasePrice, "سعر الشراء"),
      salePriceCents: parseMoney(input.salePrice, "سعر البيع"),
      openingQuantityMilli: isNew ? parseQuantity(input.openingQuantity, "الرصيد الافتتاحي") : null,
      lowStockThresholdMilli: parseQuantity(input.lowStockThreshold || "0", "حد التنبيه")
    };
  }

  function getProductOrThrow(state, productId) {
    var product = state.products.find(function (candidate) {
      return candidate.id === productId;
    });

    if (!product) {
      throw new Error("الصنف المطلوب غير موجود.");
    }
    return product;
  }

  function getStockFromState(state, productId) {
    return state.stockMovements.reduce(function (total, movement) {
      return movement.productId === productId ? total + movement.quantityMilli : total;
    }, 0);
  }

  function listMovements(state, productId) {
    return state.stockMovements.filter(function (movement) {
      return movement.productId === productId;
    }).sort(function (left, right) {
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  function addProduct(input) {
    return storage.updateState(function (state) {
      var values = validateProductInput(input, true, state, null);
      var now = new Date().toISOString();
      var product = {
        id: createId(state, "item"),
        code: values.code,
        name: values.name,
        unit: values.unit,
        purchasePriceCents: values.purchasePriceCents,
        salePriceCents: values.salePriceCents,
        lowStockThresholdMilli: values.lowStockThresholdMilli,
        active: true,
        createdAt: now,
        updatedAt: now
      };
      var openingMovement = {
        id: createId(state, "move"),
        productId: product.id,
        type: "opening",
        quantityMilli: values.openingQuantityMilli,
        reference: "رصيد افتتاحي",
        createdAt: now
      };

      state.products.push(product);
      state.stockMovements.push(openingMovement);
      return state;
    }).products.slice(-1)[0];
  }

  function updateProduct(productId, input) {
    var updatedState = storage.updateState(function (state) {
      var product = getProductOrThrow(state, productId);
      var values = validateProductInput(input, false, state, productId);

      product.code = values.code;
      product.name = values.name;
      product.unit = values.unit;
      product.purchasePriceCents = values.purchasePriceCents;
      product.salePriceCents = values.salePriceCents;
      product.lowStockThresholdMilli = values.lowStockThresholdMilli;
      product.updatedAt = new Date().toISOString();
      return state;
    });

    return getProductOrThrow(updatedState, productId);
  }

  function setActive(productId, active) {
    var updatedState = storage.updateState(function (state) {
      var product = getProductOrThrow(state, productId);

      if (typeof active !== "boolean") {
        throw new Error("حالة الصنف غير صالحة.");
      }
      product.active = active;
      product.updatedAt = new Date().toISOString();
      return state;
    });

    return getProductOrThrow(updatedState, productId);
  }

  function replenishStock(productId, inputQuantity) {
    var quantity;
    var quantityMilli;

    if (typeof inputQuantity === "string" && inputQuantity.trim() === "") {
      throw new Error("أدخل كمية التزويد.");
    }

    quantity = Number(inputQuantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("يجب أن تكون كمية التزويد رقمًا صحيحًا موجبًا أكبر من صفر.");
    }

    quantityMilli = quantity * 1000;
    if (!Number.isSafeInteger(quantityMilli)) {
      throw new Error("كمية التزويد أكبر من النطاق المسموح.");
    }

    return storage.updateState(function (state) {
      var product = getProductOrThrow(state, productId);
      var currentStockMilli = getStockFromState(state, product.id);

      if (!Number.isSafeInteger(currentStockMilli) ||
          !Number.isSafeInteger(currentStockMilli + quantityMilli)) {
        throw new Error("لا يمكن إضافة الكمية؛ الرصيد سيتجاوز النطاق المسموح.");
      }

      state.stockMovements.push({
        id: createId(state, "move"),
        productId: product.id,
        type: "stock_replenishment",
        quantityMilli: quantityMilli,
        reference: "تزويد يدوي",
        createdAt: new Date().toISOString()
      });
      return state;
    });
  }

  function getProducts() {
    var state = storage.readState();
    return state.products.map(function (product) {
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        purchasePriceCents: product.purchasePriceCents,
        salePriceCents: product.salePriceCents,
        lowStockThresholdMilli: product.lowStockThresholdMilli,
        active: product.active,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        stockQuantityMilli: getStockFromState(state, product.id)
      };
    });
  }

  function getMovements(productId) {
    var state = storage.readState();
    getProductOrThrow(state, productId);
    return listMovements(state, productId).map(function (movement) {
      return {
        id: movement.id,
        type: movement.type,
        quantityMilli: movement.quantityMilli,
        reference: movement.reference,
        createdAt: movement.createdAt
      };
    });
  }

  function clearTestData() {
    storage.clearState();
  }

  global.PepsiApp.inventoryService = {
    addProduct: addProduct,
    updateProduct: updateProduct,
    setActive: setActive,
    replenishStock: replenishStock,
    getProducts: getProducts,
    getMovements: getMovements,
    clearTestData: clearTestData
  };
}(window));
