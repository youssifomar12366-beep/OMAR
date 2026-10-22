(function (global) {
  "use strict";

  var storageKey = "pepsi_inventory_frontend_v1";

  function defaultFleet() {
    return {
      vehicles: [
        { id: "vehicle-1", name: "عربية 1", active: true },
        { id: "vehicle-2", name: "عربية 2", active: true },
        { id: "vehicle-3", name: "عربية 3", active: true }
      ],
      drivers: [
        { id: "driver-1", name: "محمد", active: true },
        { id: "driver-2", name: "محمود", active: true },
        { id: "driver-3", name: "أحمد", active: true }
      ]
    };
  }

  function emptyState() {
    var fleet = defaultFleet();
    return {
      schemaVersion: 8,
      products: [],
      stockMovements: [],
      vehicles: fleet.vehicles,
      drivers: fleet.drivers,
      trips: [],
      customers: [],
      customerEntries: [],
      nextCustomerNumber: 1,
      invoices: [],
      payments: [],
      nextInvoiceNumber: 1,
      nextPaymentNumber: 1,
      purchases: [],
      nextPurchaseNumber: 1,
      expensePeople: [],
      expenseTransactions: [],
      bonusTransactions: []
    };
  }

  function migrateState(state) {
    var fleet = defaultFleet();

    while (state && state.schemaVersion < 8) {
      if (state.schemaVersion === 1 && Array.isArray(state.products) &&
          Array.isArray(state.stockMovements)) {
        state.schemaVersion = 2;
        state.vehicles = fleet.vehicles;
        state.drivers = fleet.drivers;
        state.trips = [];
      } else if (state.schemaVersion === 2) {
        state.customers = Array.isArray(state.customers) ? state.customers : [];
        state.customerEntries = Array.isArray(state.customerEntries) ? state.customerEntries : [];
        state.nextCustomerNumber = Number.isSafeInteger(state.nextCustomerNumber)
          ? state.nextCustomerNumber : 1;
        state.schemaVersion = 3;
      } else if (state.schemaVersion === 3) {
        state.invoices = Array.isArray(state.invoices) ? state.invoices : [];
        state.payments = Array.isArray(state.payments) ? state.payments : [];
        state.nextInvoiceNumber = Number.isSafeInteger(state.nextInvoiceNumber)
          ? state.nextInvoiceNumber : 1;
        state.nextPaymentNumber = Number.isSafeInteger(state.nextPaymentNumber)
          ? state.nextPaymentNumber : 1;
        state.schemaVersion = 4;
      } else if (state.schemaVersion === 4) {
        state.trips.forEach(function (trip) {
          if (trip.returnRecord) {
            trip.returnRecord.cashReturnedCents =
              Number.isSafeInteger(trip.returnRecord.cashReturnedCents)
                ? trip.returnRecord.cashReturnedCents : null;
            trip.returnRecord.reconciliationReview = trip.returnRecord.reconciliationReview || null;
          }
        });
        (state.invoices || []).forEach(function (invoice) {
          var customer = (state.customers || []).find(function (item) {
            return item.id === invoice.customerId;
          });
          if (customer) {
            invoice.customerName = customer.name;
            invoice.customerCode = customer.code;
            invoice.customerPhone = customer.phone;
            invoice.customerAddress = customer.address;
          }
          if (typeof invoice.requestId !== "string" || !invoice.requestId) {
            invoice.requestId = "legacy-invoice-" + invoice.id;
          }
        });
        state.schemaVersion = 5;
      } else if (state.schemaVersion === 5) {
        state.purchases = Array.isArray(state.purchases) ? state.purchases : [];
        state.nextPurchaseNumber = Number.isSafeInteger(state.nextPurchaseNumber)
          ? state.nextPurchaseNumber : 1;
        state.schemaVersion = 6;
      } else if (state.schemaVersion === 6) {
        state.expensePeople = Array.isArray(state.expensePeople) ? state.expensePeople : [];
        state.expenseTransactions = Array.isArray(state.expenseTransactions)
          ? state.expenseTransactions : [];
        state.schemaVersion = 7;
      } else if (state.schemaVersion === 7) {
        state.bonusTransactions = Array.isArray(state.bonusTransactions)
          ? state.bonusTransactions : [];
        state.schemaVersion = 8;
      } else {
        break;
      }
    }

    return state;
  }

  function validCustomerEntry(entry) {
    var validKinds = ["sale", "sale_void", "payment", "return", "adjustment", "credit_applied"];

    if (!entry || typeof entry.id !== "string" || !entry.id ||
        typeof entry.customerId !== "string" || !entry.customerId ||
        validKinds.indexOf(entry.kind) === -1 ||
        !Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0 ||
        typeof entry.description !== "string" || typeof entry.createdAt !== "string" ||
        (typeof entry.sourceId !== "undefined" && typeof entry.sourceId !== "string")) {
      return false;
    }

    return entry.kind === "adjustment"
      ? Number.isSafeInteger(entry.balanceDeltaCents)
      : typeof entry.balanceDeltaCents === "undefined";
  }

  function validateState(state) {
    var productIds = new Set();
    var recordIds = new Set();
    var productCodes = new Set();
    var vehicleIds = new Set();
    var driverIds = new Set();
    var tripNumbers = new Set();
    var requestIds = new Set();
    var customerIds = new Set();
    var customerCodes = new Set();
    var invoiceIds = new Set();
    var invoiceNumbers = new Set();
    var invoiceRequestIds = new Set();
    var paymentIds = new Set();
    var paymentNumbers = new Set();
    var paymentRequestIds = new Set();
    var purchaseNumbers = new Set();
    var purchaseRequestIds = new Set();
    var expensePersonIds = new Set();
    var expensePersonNames = new Set();
    var expenseRequestIds = new Set();
    var bonusRequestIds = new Set();
    var expenseBalances = Object.create(null);
    var expenseTransactionsInOrder = [];
    var invoiceById = Object.create(null);
    var tripBilledTotals = Object.create(null);
    var creditAppliedByInvoice = Object.create(null);
    var creditAppliedByCustomer = Object.create(null);
    var creditIssuedByCustomer = Object.create(null);
    var creditApplicationInvoices = new Set();

    if (!state || typeof state !== "object" || Array.isArray(state) ||
        state.schemaVersion !== 8 || !Number.isSafeInteger(state.nextCustomerNumber) ||
        state.nextCustomerNumber < 1 || !Number.isSafeInteger(state.nextInvoiceNumber) ||
        state.nextInvoiceNumber < 1 || !Number.isSafeInteger(state.nextPaymentNumber) ||
        state.nextPaymentNumber < 1 || !Number.isSafeInteger(state.nextPurchaseNumber) ||
        state.nextPurchaseNumber < 1 || !Array.isArray(state.purchases) ||
        !Array.isArray(state.expensePeople) || !Array.isArray(state.expenseTransactions) ||
        !Array.isArray(state.products) ||
        !Array.isArray(state.stockMovements) || !Array.isArray(state.vehicles) ||
        !Array.isArray(state.drivers) || !Array.isArray(state.trips) ||
        !Array.isArray(state.customers) || !Array.isArray(state.customerEntries) ||
        !Array.isArray(state.invoices) || !Array.isArray(state.payments) ||
        !Array.isArray(state.bonusTransactions)) {
      throw new Error("بنية بيانات التجربة غير صالحة؛ لم تُحفظ أي تغييرات.");
    }

    state.products.forEach(function (product) {
      if (!product || typeof product.id !== "string" || !product.id ||
          typeof product.code !== "string" || !product.code ||
          typeof product.name !== "string" || !product.name ||
          typeof product.unit !== "string" || !product.unit ||
          typeof product.active !== "boolean" ||
          !Number.isSafeInteger(product.lowStockThresholdMilli) || product.lowStockThresholdMilli < 0 ||
          (product.purchasePriceCents !== null &&
            (!Number.isSafeInteger(product.purchasePriceCents) || product.purchasePriceCents < 0)) ||
          (product.salePriceCents !== null &&
            (!Number.isSafeInteger(product.salePriceCents) || product.salePriceCents < 0)) ||
          typeof product.createdAt !== "string" || typeof product.updatedAt !== "string" ||
          productIds.has(product.id) || recordIds.has(product.id) ||
          productCodes.has(product.code.toLocaleUpperCase())) {
        throw new Error("بيانات صنف غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      productIds.add(product.id);
      recordIds.add(product.id);
      productCodes.add(product.code.toLocaleUpperCase());
    });

    state.vehicles.concat(state.drivers).forEach(function (member) {
      if (!member || typeof member.id !== "string" || !member.id ||
          typeof member.name !== "string" || !member.name.trim() ||
          typeof member.active !== "boolean" || recordIds.has(member.id)) {
        throw new Error("بيانات العربيات أو السائقين غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      recordIds.add(member.id);
    });
    state.vehicles.forEach(function (vehicle) {
      vehicleIds.add(vehicle.id);
    });
    state.drivers.forEach(function (driver) {
      driverIds.add(driver.id);
    });

    state.expensePeople.forEach(function (person) {
      var normalizedName;
      if (!person || typeof person.id !== "string" || !person.id ||
          typeof person.name !== "string" || !person.name.trim() ||
          person.name.length > 120 || typeof person.createdAt !== "string" ||
          recordIds.has(person.id)) {
        throw new Error("بيانات شخص في سجل المصروفات غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      normalizedName = person.name.trim().toLocaleLowerCase();
      if (expensePersonNames.has(normalizedName)) {
        throw new Error("يوجد اسم مكرر في سجل الأشخاص؛ لم تُحفظ أي تغييرات.");
      }
      expensePersonIds.add(person.id);
      expensePersonNames.add(normalizedName);
      recordIds.add(person.id);
      expenseBalances[person.id] = 0;
    });

    state.expenseTransactions.forEach(function (transaction, index) {
      if (!transaction || typeof transaction.id !== "string" || !transaction.id ||
          typeof transaction.personId !== "string" ||
          !expensePersonIds.has(transaction.personId) ||
          (transaction.type !== "taken" && transaction.type !== "repaid") ||
          !Number.isSafeInteger(transaction.amountCents) || transaction.amountCents <= 0 ||
          typeof transaction.description !== "string" ||
          transaction.description.length > 240 ||
          typeof transaction.createdAt !== "string" ||
          typeof transaction.requestId !== "string" || !transaction.requestId ||
          expenseRequestIds.has(transaction.requestId) || recordIds.has(transaction.id)) {
        throw new Error("بيانات حركة مصروف غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      expenseRequestIds.add(transaction.requestId);
      expenseTransactionsInOrder.push({ transaction: transaction, index: index });
      recordIds.add(transaction.id);
    });

    expenseTransactionsInOrder.sort(function (left, right) {
      var dateOrder = left.transaction.createdAt.localeCompare(right.transaction.createdAt);
      return dateOrder || left.index - right.index;
    }).forEach(function (entry) {
      var transaction = entry.transaction;
      var currentBalance = expenseBalances[transaction.personId];
      var nextBalance = transaction.type === "taken"
        ? currentBalance + transaction.amountCents
        : currentBalance - transaction.amountCents;
      if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {
        throw new Error("حركة سداد تتجاوز مديونية الشخص؛ لم تُحفظ أي تغييرات.");
      }
      expenseBalances[transaction.personId] = nextBalance;
    });

    state.stockMovements.forEach(function (movement) {
      if (!movement || typeof movement.id !== "string" || !movement.id ||
          typeof movement.productId !== "string" || !productIds.has(movement.productId) ||
          !Number.isSafeInteger(movement.quantityMilli) ||
          typeof movement.type !== "string" || typeof movement.reference !== "string" ||
          typeof movement.createdAt !== "string" ||
          recordIds.has(movement.id)) {
        throw new Error("بيانات حركة مخزون غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      recordIds.add(movement.id);
    });

    state.purchases.forEach(function (purchase) {
      var subtotalCents = 0;
      if (!purchase || typeof purchase.id !== "string" || !purchase.id ||
          typeof purchase.number !== "string" || !purchase.number ||
          purchase.supplierId !== "supplier-company" ||
          purchase.supplierName !== "الشركة" ||
          typeof purchase.requestId !== "string" || !purchase.requestId ||
          purchaseRequestIds.has(purchase.requestId) ||
          typeof purchase.createdAt !== "string" ||
          !Array.isArray(purchase.items) || purchase.items.length === 0 ||
          !Number.isSafeInteger(purchase.totalCents) || purchase.totalCents < 0 ||
          !Number.isSafeInteger(purchase.paidCents) || purchase.paidCents < 0 ||
          purchase.paidCents > purchase.totalCents ||
          purchase.balanceCents !== purchase.totalCents - purchase.paidCents ||
          recordIds.has(purchase.id) || purchaseNumbers.has(purchase.number)) {
        throw new Error("بيانات طلبية شراء غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      purchase.items.forEach(function (item) {
        var lineTotal;
        if (!item || typeof item.productId !== "string" ||
            !productIds.has(item.productId) ||
            typeof item.productName !== "string" || !item.productName ||
            typeof item.unit !== "string" || !item.unit ||
            !Number.isSafeInteger(item.quantityMilli) || item.quantityMilli <= 0 ||
            !Number.isSafeInteger(item.purchasePriceCents) || item.purchasePriceCents < 0 ||
            !Number.isSafeInteger(item.salePriceCents) || item.salePriceCents < 0 ||
            !Number.isSafeInteger(item.totalCents) || item.totalCents < 0) {
          throw new Error("تفاصيل طلبية الشراء غير صالحة؛ لم تُحفظ أي تغييرات.");
        }
        lineTotal = Math.round(item.quantityMilli * item.purchasePriceCents / 1000);
        if (!Number.isSafeInteger(lineTotal) || lineTotal !== item.totalCents) {
          throw new Error("إجمالي صنف في طلبية الشراء غير صالح؛ لم تُحفظ أي تغييرات.");
        }
        subtotalCents += lineTotal;
        if (!Number.isSafeInteger(subtotalCents)) {
          throw new Error("إجمالي طلبية الشراء تجاوز الحد الآمن؛ لم تُحفظ أي تغييرات.");
        }
      });
      if (subtotalCents !== purchase.totalCents) {
        throw new Error("إجمالي طلبية الشراء غير مطابق لتفاصيلها؛ لم تُحفظ أي تغييرات.");
      }
      recordIds.add(purchase.id);
      purchaseNumbers.add(purchase.number);
      purchaseRequestIds.add(purchase.requestId);
    });

    state.bonusTransactions.forEach(function (bonus) {
      if (!bonus || typeof bonus.id !== "string" || !bonus.id ||
          typeof bonus.requestId !== "string" || !bonus.requestId ||
          bonusRequestIds.has(bonus.requestId) ||
          !Number.isSafeInteger(bonus.amountCents) || bonus.amountCents <= 0 ||
          ((typeof bonus.settledCents === "undefined") !==
            (typeof bonus.profitCents === "undefined")) ||
          (typeof bonus.settledCents !== "undefined" &&
            (!Number.isSafeInteger(bonus.settledCents) || bonus.settledCents < 0 ||
              !Number.isSafeInteger(bonus.profitCents) || bonus.profitCents < 0 ||
              bonus.settledCents + bonus.profitCents !== bonus.amountCents)) ||
          typeof bonus.createdAt !== "string" || !Number.isFinite(Date.parse(bonus.createdAt)) ||
          recordIds.has(bonus.id)) {
        throw new Error("بيانات بونص غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      recordIds.add(bonus.id);
      bonusRequestIds.add(bonus.requestId);
    });

    state.trips.forEach(function (trip) {
      var tripProductIds = new Set();
      var shipmentTotals = Object.create(null);
      var returnedTotals = Object.create(null);

      if (!trip || typeof trip.id !== "string" || !trip.id ||
          typeof trip.number !== "string" || !trip.number ||
          typeof trip.vehicleId !== "string" || !vehicleIds.has(trip.vehicleId) ||
          typeof trip.vehicleName !== "string" || !trip.vehicleName ||
          typeof trip.driverId !== "string" || !driverIds.has(trip.driverId) ||
          typeof trip.driverName !== "string" || !trip.driverName ||
          typeof trip.dateTime !== "string" || typeof trip.createdAt !== "string" ||
          (trip.status !== "open" && trip.status !== "returned") ||
          (typeof trip.salesCompletedAt !== "undefined" &&
            trip.salesCompletedAt !== null &&
            (typeof trip.salesCompletedAt !== "string" ||
              !Number.isFinite(Date.parse(trip.salesCompletedAt)))) ||
          !Array.isArray(trip.items) || !Array.isArray(trip.replenishments) ||
          (trip.returnRecord !== null &&
            (!trip.returnRecord || typeof trip.returnRecord !== "object" ||
              !Array.isArray(trip.returnRecord.items) ||
              (trip.returnRecord.cashReturnedCents !== null &&
                (!Number.isSafeInteger(trip.returnRecord.cashReturnedCents) ||
                  trip.returnRecord.cashReturnedCents < 0)) ||
              (trip.returnRecord.reconciliationReview !== null &&
                (!trip.returnRecord.reconciliationReview ||
                  typeof trip.returnRecord.reconciliationReview.reason !== "string" ||
                  !trip.returnRecord.reconciliationReview.reason.trim() ||
                  typeof trip.returnRecord.reconciliationReview.createdAt !== "string")))) ||
          (trip.status === "returned" && trip.returnRecord === null) ||
          recordIds.has(trip.id) || tripNumbers.has(trip.number)) {
        throw new Error("بيانات طلعة غير صالحة؛ لم تُحفظ أي تغييرات.");
      }

      recordIds.add(trip.id);
      tripNumbers.add(trip.number);

      trip.items.forEach(function (item) {
        if (!item || typeof item.productId !== "string" || !productIds.has(item.productId) ||
            !Number.isSafeInteger(item.quantityMilli) || item.quantityMilli < 0 ||
            tripProductIds.has(item.productId)) {
          throw new Error("تفاصيل طلعة غير صالحة؛ لم تُحفظ أي تغييرات.");
        }
        tripProductIds.add(item.productId);
        shipmentTotals[item.productId] = item.quantityMilli;
      });

      trip.replenishments.forEach(function (replenishment) {
        if (!replenishment || typeof replenishment.id !== "string" ||
            typeof replenishment.requestId !== "string" || !replenishment.requestId ||
            typeof replenishment.productId !== "string" || !tripProductIds.has(replenishment.productId) ||
            !Number.isSafeInteger(replenishment.quantityMilli) || replenishment.quantityMilli <= 0 ||
            typeof replenishment.createdAt !== "string" || recordIds.has(replenishment.id) ||
            requestIds.has(replenishment.requestId)) {
          throw new Error("بيانات تزويدة غير صالحة؛ لم تُحفظ أي تغييرات.");
        }
        recordIds.add(replenishment.id);
        requestIds.add(replenishment.requestId);
        shipmentTotals[replenishment.productId] += replenishment.quantityMilli;
      });

      if (trip.returnRecord) {
        if (typeof trip.returnRecord.id !== "string" ||
            typeof trip.returnRecord.createdAt !== "string" ||
            recordIds.has(trip.returnRecord.id)) {
          throw new Error("بيانات راجع غير صالحة؛ لم تُحفظ أي تغييرات.");
        }
        recordIds.add(trip.returnRecord.id);
        trip.returnRecord.items.forEach(function (item) {
          if (!item || typeof item.productId !== "string" || !tripProductIds.has(item.productId) ||
              !Number.isSafeInteger(item.quantityMilli) || item.quantityMilli < 0 ||
              Object.prototype.hasOwnProperty.call(returnedTotals, item.productId) ||
              item.quantityMilli > shipmentTotals[item.productId]) {
            throw new Error("تفاصيل راجع غير صالحة؛ لم تُحفظ أي تغييرات.");
          }
          returnedTotals[item.productId] = item.quantityMilli;
        });
        if (trip.returnRecord.items.length !== tripProductIds.size) {
          throw new Error("تفاصيل راجع غير مكتملة؛ لم تُحفظ أي تغييرات.");
        }
      }
    });

    state.customers.forEach(function (customer) {
      if (!customer || typeof customer.id !== "string" || !customer.id ||
          typeof customer.code !== "string" || !customer.code ||
          typeof customer.name !== "string" || !customer.name.trim() ||
          typeof customer.phone !== "string" || typeof customer.address !== "string" ||
          typeof customer.active !== "boolean" ||
          typeof customer.createdAt !== "string" || typeof customer.updatedAt !== "string" ||
          customerIds.has(customer.id) || recordIds.has(customer.id) ||
          customerCodes.has(customer.code.toLocaleUpperCase())) {
        throw new Error("بيانات عميل غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      customerIds.add(customer.id);
      customerCodes.add(customer.code.toLocaleUpperCase());
      recordIds.add(customer.id);
    });

    state.invoices.forEach(function (invoice) {
      var trip = null;
      var subtotalCents = 0;
      if (!invoice || typeof invoice.id !== "string" || !invoice.id ||
          typeof invoice.number !== "string" || !invoice.number ||
          typeof invoice.customerId !== "string" || !customerIds.has(invoice.customerId) ||
          typeof invoice.customerName !== "string" || !invoice.customerName.trim() ||
          typeof invoice.customerCode !== "string" || !invoice.customerCode ||
          typeof invoice.customerPhone !== "string" || typeof invoice.customerAddress !== "string" ||
          (invoice.tripId !== null &&
            (typeof invoice.tripId !== "string" || !state.trips.some(function (item) {
              return item.id === invoice.tripId;
            }))) ||
          typeof invoice.createdAt !== "string" || typeof invoice.date !== "string" ||
          (invoice.status !== "posted" && invoice.status !== "cancelled") ||
          (invoice.status === "cancelled" &&
            (!invoice.cancellation || typeof invoice.cancellation.reason !== "string" ||
              !invoice.cancellation.reason.trim() ||
              typeof invoice.cancellation.createdAt !== "string")) ||
          (invoice.status === "posted" && typeof invoice.cancellation !== "undefined") ||
          (typeof invoice.requestId !== "undefined" &&
            (typeof invoice.requestId !== "string" || !invoice.requestId ||
              invoiceRequestIds.has(invoice.requestId))) ||
          !Array.isArray(invoice.items) || invoice.items.length === 0 ||
          !Number.isSafeInteger(invoice.subtotalCents) || invoice.subtotalCents < 0 ||
          !Number.isSafeInteger(invoice.discountCents) || invoice.discountCents < 0 ||
          typeof invoice.discountReason !== "string" ||
          !Number.isSafeInteger(invoice.totalCents) || invoice.totalCents < 0 ||
          recordIds.has(invoice.id) || invoiceIds.has(invoice.id) ||
          invoiceNumbers.has(invoice.number)) {
        throw new Error("بيانات فاتورة غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      if (invoice.tripId !== null) {
        trip = state.trips.find(function (item) {
          return item.id === invoice.tripId;
        });
      }
      invoice.items.forEach(function (line) {
        var lineAmount;
        if (!line || typeof line.productId !== "string" || !productIds.has(line.productId) ||
            typeof line.code !== "string" || typeof line.name !== "string" ||
            typeof line.unit !== "string" ||
            !Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0 ||
            !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0 ||
            !Number.isSafeInteger(line.amountCents) || line.amountCents < 0) {
          throw new Error("تفاصيل فاتورة غير صالحة؛ لم تُحفظ أي تغييرات.");
        }
        if (!Number.isSafeInteger(line.quantityMilli * line.unitPriceCents)) {
          throw new Error("قيمة صنف بالفاتورة تتجاوز الحد الآمن؛ لم تُحفظ أي تغييرات.");
        }
        lineAmount = Math.round(line.quantityMilli * line.unitPriceCents / 1000);
        if (!Number.isSafeInteger(lineAmount) || lineAmount !== line.amountCents ||
            !Number.isSafeInteger(subtotalCents + line.amountCents)) {
          throw new Error("إجمالي تفاصيل فاتورة غير متطابق؛ لم تُحفظ أي تغييرات.");
        }
        subtotalCents += line.amountCents;
        if (trip && invoice.status === "posted") {
          var tripLine = trip.items.find(function (item) {
            return item.productId === line.productId;
          });
          var tripTotal = 0;
          trip.replenishments.forEach(function (entry) {
            if (entry.productId === line.productId) {
              tripTotal += entry.quantityMilli;
            }
          });
          if (!tripLine) {
            throw new Error("فاتورة الطلعة تحتوي صنفًا غير مرتبط بها.");
          }
          tripTotal += tripLine.quantityMilli;
          if (trip.returnRecord) {
            var returnedLine = trip.returnRecord.items.find(function (item) {
              return item.productId === line.productId;
            });
            tripTotal -= returnedLine ? returnedLine.quantityMilli : 0;
          }
          var billedKey = trip.id + "|" + line.productId;
          tripBilledTotals[billedKey] = (tripBilledTotals[billedKey] || 0) + line.quantityMilli;
          if (tripBilledTotals[billedKey] > tripTotal) {
            throw new Error("كمية فواتير الطلعة تتجاوز المباع المسجل؛ لم تُحفظ أي تغييرات.");
          }
        }
      });
      if (subtotalCents !== invoice.subtotalCents ||
          invoice.discountCents > subtotalCents ||
          invoice.totalCents !== subtotalCents - invoice.discountCents ||
          (invoice.discountCents > 0 && !invoice.discountReason.trim() && !invoice.tripId) ||
          (invoice.discountCents === 0 && invoice.discountReason !== "")) {
        throw new Error("حساب إجمالي أو خصم الفاتورة غير صالح؛ لم تُحفظ أي تغييرات.");
      }
      recordIds.add(invoice.id);
      invoiceIds.add(invoice.id);
      invoiceNumbers.add(invoice.number);
      if (invoice.requestId) {
        invoiceRequestIds.add(invoice.requestId);
      }
      invoiceById[invoice.id] = invoice;
    });

    state.payments.forEach(function (payment) {
      var invoice = null;
      if (!payment || typeof payment.id !== "string" || !payment.id ||
          typeof payment.number !== "string" || !payment.number ||
          typeof payment.customerId !== "string" || !customerIds.has(payment.customerId) ||
          (typeof payment.requestId !== "undefined" &&
            (typeof payment.requestId !== "string" || !payment.requestId ||
              paymentRequestIds.has(payment.requestId))) ||
          (payment.invoiceId !== null &&
            (typeof payment.invoiceId !== "string" || !invoiceIds.has(payment.invoiceId))) ||
          !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 ||
          typeof payment.method !== "string" || !payment.method ||
          typeof payment.notes !== "string" || typeof payment.createdAt !== "string" ||
          recordIds.has(payment.id) || paymentIds.has(payment.id) ||
          paymentNumbers.has(payment.number)) {
        throw new Error("بيانات تحصيل غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      if (payment.invoiceId !== null) {
        invoice = invoiceById[payment.invoiceId];
        if (!invoice || invoice.customerId !== payment.customerId) {
          throw new Error("ارتباط التحصيل بالفاتورة أو العميل غير صالح؛ لم تُحفظ أي تغييرات.");
        }
      }
      recordIds.add(payment.id);
      paymentIds.add(payment.id);
      paymentNumbers.add(payment.number);
      if (payment.requestId) {
        paymentRequestIds.add(payment.requestId);
      }
    });

    state.invoices.forEach(function (invoice) {
      var paidCents = state.payments.reduce(function (total, payment) {
        return payment.invoiceId === invoice.id ? total + payment.amountCents : total;
      }, 0);
      var creditAppliedCents = creditAppliedByInvoice[invoice.id] || 0;
      if (!Number.isSafeInteger(paidCents) || !Number.isSafeInteger(creditAppliedCents) ||
          paidCents + creditAppliedCents > invoice.totalCents ||
          (invoice.status === "cancelled" && paidCents !== 0)) {
        throw new Error("إجمالي التحصيلات والرصيد المستخدم يتجاوز قيمة الفاتورة؛ لم تُحفظ أي تغييرات.");
      }
    });

    state.customerEntries.forEach(function (entry) {
      var invoice;
      if (!validCustomerEntry(entry) || !customerIds.has(entry.customerId) ||
          recordIds.has(entry.id)) {
        throw new Error("بيانات حركة حساب عميل غير صالحة؛ لم تُحفظ أي تغييرات.");
      }
      if (entry.kind === "credit_applied") {
        invoice = invoiceById[entry.sourceId];
        if (!invoice || invoice.status !== "posted" ||
            invoice.customerId !== entry.customerId || entry.amountCents <= 0 ||
            creditApplicationInvoices.has(entry.sourceId)) {
          throw new Error("ارتباط استخدام الرصيد الدائن بالفاتورة غير صالح؛ لم تُحفظ أي تغييرات.");
        }
        creditApplicationInvoices.add(entry.sourceId);
        creditAppliedByInvoice[entry.sourceId] =
          (creditAppliedByInvoice[entry.sourceId] || 0) + entry.amountCents;
        creditAppliedByCustomer[entry.customerId] =
          (creditAppliedByCustomer[entry.customerId] || 0) + entry.amountCents;
        if (!Number.isSafeInteger(creditAppliedByInvoice[entry.sourceId]) ||
            !Number.isSafeInteger(creditAppliedByCustomer[entry.customerId])) {
          throw new Error("إجمالي استخدام الرصيد الدائن تجاوز الحد الآمن؛ لم تُحفظ أي تغييرات.");
        }
      } else if (entry.kind === "adjustment" && entry.balanceDeltaCents < 0) {
        creditIssuedByCustomer[entry.customerId] =
          (creditIssuedByCustomer[entry.customerId] || 0) - entry.balanceDeltaCents;
        if (!Number.isSafeInteger(creditIssuedByCustomer[entry.customerId])) {
          throw new Error("إجمالي الرصيد الدائن تجاوز الحد الآمن؛ لم تُحفظ أي تغييرات.");
        }
      }
      recordIds.add(entry.id);
    });

    state.invoices.forEach(function (invoice) {
      var paidCents = state.payments.reduce(function (total, payment) {
        return payment.invoiceId === invoice.id ? total + payment.amountCents : total;
      }, 0);
      var creditAppliedCents = creditAppliedByInvoice[invoice.id] || 0;
      if (!Number.isSafeInteger(paidCents + creditAppliedCents) ||
          paidCents + creditAppliedCents > invoice.totalCents ||
          (invoice.status === "cancelled" && creditAppliedCents !== 0)) {
        throw new Error("إجمالي التحصيلات والرصيد المستخدم يتجاوز قيمة الفاتورة؛ لم تُحفظ أي تغييرات.");
      }
    });

    Object.keys(creditAppliedByCustomer).forEach(function (customerId) {
      if (creditAppliedByCustomer[customerId] > (creditIssuedByCustomer[customerId] || 0)) {
        throw new Error("تم استخدام رصيد دائن يتجاوز الرصيد المسجل للعميل؛ لم تُحفظ أي تغييرات.");
      }
    });
  }

  function readState() {
    var serialized = global.localStorage.getItem(storageKey);
    var state;
    var needsMigration;

    if (serialized === null) {
      return emptyState();
    }

    try {
      state = JSON.parse(serialized);
    } catch (error) {
      throw new Error("تعذرت قراءة بيانات التجربة المحفوظة؛ لم تُستبدل البيانات.");
    }

    needsMigration = state && state.schemaVersion >= 1 && state.schemaVersion < 8;
    state = migrateState(state);
    validateState(state);
    if (needsMigration) {
      global.localStorage.setItem(storageKey, JSON.stringify(state));
    }
    return state;
  }

  function updateState(update) {
    var state = readState();
    var updatedState = update(state) || state;

    validateState(updatedState);
    global.localStorage.setItem(storageKey, JSON.stringify(updatedState));
    return updatedState;
  }

  function clearState() {
    var state = emptyState();
    global.localStorage.setItem(storageKey, JSON.stringify(state));
    return state;
  }

  global.PepsiApp = global.PepsiApp || {};
  global.PepsiApp.storageService = {
    readState: readState,
    updateState: updateState,
    clearState: clearState
  };
}(window));
