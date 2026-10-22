(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;

  function addSafe(total, value) {
    var result = total + value;
    if (!Number.isSafeInteger(result)) {
      throw new Error("تعذر حساب ملخص التقرير بدقة؛ تجاوز الإجمالي الحد الآمن.");
    }
    return result;
  }

  function consumeReservedSegments(segments, quantityMilli, fallbackUnitCostCents) {
    var remaining = quantityMilli;
    var costCents = 0;
    var unknownQuantityMilli = 0;
    var estimatedQuantityMilli = 0;
    for (var index = 0; index < segments.length && remaining > 0; index += 1) {
      var segment = segments[index];
      var quantity = Math.min(remaining, segment.quantityMilli);
      var cost = segment.known
        ? (quantity === segment.quantityMilli
          ? segment.costCents
          : Math.round(segment.costCents * quantity / segment.quantityMilli))
        : !Number.isSafeInteger(segment.fallbackUnitCostCents)
          ? 0 : Math.round(quantity * segment.fallbackUnitCostCents / 1000);
      segment.quantityMilli -= quantity;
      segment.costCents -= cost;
      remaining -= quantity;
      if (segment.known || Number.isSafeInteger(segment.fallbackUnitCostCents)) {
        costCents = addSafe(costCents, cost);
        if (!segment.known) {
          estimatedQuantityMilli = addSafe(estimatedQuantityMilli, quantity);
        }
      } else {
        unknownQuantityMilli = addSafe(unknownQuantityMilli, quantity);
      }
    }
    if (remaining > 0) {
      if (Number.isSafeInteger(fallbackUnitCostCents)) {
        costCents = addSafe(costCents, Math.round(remaining * fallbackUnitCostCents / 1000));
        estimatedQuantityMilli = addSafe(estimatedQuantityMilli, remaining);
      } else {
        unknownQuantityMilli = addSafe(unknownQuantityMilli, remaining);
      }
    }
    return {
      costCents: costCents,
      unknownQuantityMilli: unknownQuantityMilli,
      estimatedQuantityMilli: estimatedQuantityMilli
    };
  }

  function periodStart(period, now) {
    var start = new Date(now.getTime());
    var day = start.getDate();
    var month;
    if (period === "month") {
      month = start.getMonth() - 1;
      start.setDate(1);
      start.setMonth(month);
      start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
    } else if (period === "year") {
      start.setDate(1);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
    } else {
      throw new Error("الفترة المحددة للتقرير غير صالحة.");
    }
    return start;
  }

  function isInPeriod(value, start, end) {
    var timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
  }

  function localDateKey(date) {
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  function recordDateKey(value) {
    var dateOnly = typeof value === "string" &&
      value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var date;
    if (dateOnly) {
      date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
      return date.getFullYear() === Number(dateOnly[1]) &&
        date.getMonth() === Number(dateOnly[2]) - 1 &&
        date.getDate() === Number(dateOnly[3]) ? value : "";
    }
    date = new Date(value);
    return Number.isFinite(date.getTime()) ? localDateKey(date) : "";
  }

  function isOnLocalDate(value, dateKey) {
    return recordDateKey(value) === dateKey;
  }

  function getLegacyDebtForDate(state, dateKey, invoicesById) {
    var entriesByCustomer = Object.create(null);
    var debtCents = 0;

    state.customerEntries.forEach(function (entry, index) {
      var invoice = invoicesById[entry.sourceId];
      var payment;
      var delta;
      if ((entry.kind === "sale" || entry.kind === "sale_void" ||
          entry.kind === "adjustment" || entry.kind === "credit_applied") && invoice) {
        return;
      }
      if (entry.kind === "sale") {
        delta = entry.amountCents;
      } else if (entry.kind === "sale_void" || entry.kind === "payment" ||
          entry.kind === "return") {
        delta = -entry.amountCents;
        if (entry.kind === "payment") {
          payment = state.payments.find(function (candidate) {
            return candidate.id === entry.sourceId;
          });
          if (payment && payment.invoiceId !== null) {
            return;
          }
        }
      } else if (entry.kind === "adjustment") {
        delta = entry.balanceDeltaCents;
      } else {
        return;
      }
      if (!entriesByCustomer[entry.customerId]) {
        entriesByCustomer[entry.customerId] = [];
      }
      entriesByCustomer[entry.customerId].push({
        entry: entry,
        delta: delta,
        order: index
      });
    });

    Object.keys(entriesByCustomer).forEach(function (customerId) {
      var balances = [];
      var creditCents = 0;
      entriesByCustomer[customerId].sort(function (left, right) {
        return left.entry.createdAt.localeCompare(right.entry.createdAt) ||
          left.order - right.order;
      }).forEach(function (record) {
        var remaining = Math.abs(record.delta);
        if (record.delta > 0) {
          var creditApplied = Math.min(creditCents, remaining);
          creditCents -= creditApplied;
          remaining -= creditApplied;
          if (remaining > 0) {
            balances.push({
              dateKey: recordDateKey(record.entry.createdAt),
              amountCents: remaining
            });
          }
        } else {
          for (var index = 0; index < balances.length && remaining > 0; index += 1) {
            var applied = Math.min(remaining, balances[index].amountCents);
            balances[index].amountCents -= applied;
            remaining -= applied;
          }
          creditCents = addSafe(creditCents, remaining);
        }
      });
      balances.forEach(function (balance) {
        if (balance.dateKey === dateKey) {
          debtCents = addSafe(debtCents, balance.amountCents);
        }
      });
    });
    return debtCents;
  }

  function getDailySummary(nowValue) {
    var state = storage.readState();
    var now = nowValue ? new Date(nowValue) : new Date();
    var dateKey;
    var summary = {
      dateKey: "",
      salesCents: 0,
      collectionsCents: 0,
      debtCents: 0,
      expensesCents: 0,
      profitCents: 0,
      tripCount: 0,
      hasUncostedSales: false,
      hasEstimatedCost: false
    };
    var invoicesById = Object.create(null);
    var invoiceCost;
    var expenseRepaymentsCents = 0;

    if (!Number.isFinite(now.getTime())) {
      throw new Error("تاريخ التقرير غير صالح.");
    }
    dateKey = localDateKey(now);
    summary.dateKey = dateKey;
    state.invoices.forEach(function (invoice) {
      invoicesById[invoice.id] = invoice;
    });
    invoiceCost = calculateCostOfGoodsSold(state);

    state.invoices.forEach(function (invoice) {
      var cost;
      var paidCents;
      var creditAppliedCents;
      if (invoice.status !== "posted") {
        return;
      }
      if (isOnLocalDate(invoice.date, dateKey)) {
        summary.salesCents = addSafe(summary.salesCents, invoice.totalCents);
        cost = invoiceCost[invoice.id];
        if (!cost || cost.unknownQuantityMilli > 0) {
          summary.hasUncostedSales = true;
        }
        if (cost) {
          summary.hasEstimatedCost = summary.hasEstimatedCost ||
            cost.estimatedQuantityMilli > 0;
          summary.profitCents = addSafe(summary.profitCents,
            invoice.totalCents - cost.costCents);
        }
      }
      if (isOnLocalDate(invoice.date, dateKey)) {
        paidCents = state.payments.reduce(function (total, payment) {
          return payment.invoiceId === invoice.id ? addSafe(total, payment.amountCents) : total;
        }, 0);
        creditAppliedCents = state.customerEntries.reduce(function (total, entry) {
          return entry.kind === "credit_applied" && entry.sourceId === invoice.id
            ? addSafe(total, entry.amountCents) : total;
        }, 0);
        summary.debtCents = addSafe(summary.debtCents,
          Math.max(0, invoice.totalCents - paidCents - creditAppliedCents));
      }
    });

    state.customerEntries.forEach(function (entry) {
      if ((entry.kind !== "sale" && entry.kind !== "sale_void" && entry.kind !== "return") ||
          (entry.kind === "sale" && invoicesById[entry.sourceId]) ||
          (entry.kind === "sale_void" && invoicesById[entry.sourceId]) ||
          !isOnLocalDate(entry.createdAt, dateKey)) {
        return;
      }
      summary.salesCents = addSafe(summary.salesCents, entry.kind === "sale"
        ? entry.amountCents : -entry.amountCents);
      summary.hasUncostedSales = true;
    });
    summary.debtCents = addSafe(summary.debtCents,
      getLegacyDebtForDate(state, dateKey, invoicesById));

    state.payments.forEach(function (payment) {
      var invoice = invoicesById[payment.invoiceId];
      if (invoice && invoice.tripId && invoice.status === "posted" &&
          isOnLocalDate(payment.createdAt, dateKey)) {
        summary.collectionsCents = addSafe(summary.collectionsCents, payment.amountCents);
      }
    });

    state.trips.forEach(function (trip) {
      if (isOnLocalDate(trip.dateTime, dateKey)) {
        summary.tripCount = addSafe(summary.tripCount, 1);
      }
    });

    state.expenseTransactions.forEach(function (transaction) {
      if (!isOnLocalDate(transaction.createdAt, dateKey)) {
        return;
      }
      if (transaction.type === "taken") {
        summary.expensesCents = addSafe(summary.expensesCents, transaction.amountCents);
      } else if (transaction.type === "repaid") {
        expenseRepaymentsCents = addSafe(expenseRepaymentsCents, transaction.amountCents);
      }
    });

    summary.profitCents = addSafe(summary.profitCents,
      -summary.expensesCents + expenseRepaymentsCents);
    if (summary.hasUncostedSales) {
      summary.profitCents = null;
    }
    return summary;
  }

  function consumeLots(lots, quantityMilli, fallbackUnitCostCents) {
    var remaining = quantityMilli;
    var costCents = 0;
    var unknownQuantityMilli = 0;
    var estimatedQuantityMilli = 0;
    var segments = [];

    for (var index = 0; index < lots.length && remaining > 0; index += 1) {
      var lot = lots[index];
      var quantity;
      var cost;
      if (lot.remainingMilli <= 0) {
        continue;
      }
      quantity = Math.min(remaining, lot.remainingMilli);
      cost = lot.known
        ? (quantity === lot.remainingMilli
          ? lot.remainingCostCents
          : Math.round(lot.remainingCostCents * quantity / lot.remainingMilli))
        : !Number.isSafeInteger(lot.fallbackUnitCostCents)
          ? 0 : Math.round(quantity * lot.fallbackUnitCostCents / 1000);
      lot.remainingMilli -= quantity;
      if (lot.known) {
        lot.remainingCostCents -= cost;
      }
      remaining -= quantity;
      if (lot.known || Number.isSafeInteger(lot.fallbackUnitCostCents)) {
        costCents = addSafe(costCents, cost);
        if (!lot.known) {
          estimatedQuantityMilli = addSafe(estimatedQuantityMilli, quantity);
        }
      } else {
        unknownQuantityMilli = addSafe(unknownQuantityMilli, quantity);
      }
      segments.push({
        lot: lot,
        quantityMilli: quantity,
        costCents: cost,
        known: lot.known,
        fallbackUnitCostCents: lot.fallbackUnitCostCents
      });
    }

    if (remaining > 0) {
      if (Number.isSafeInteger(fallbackUnitCostCents)) {
        costCents = addSafe(costCents, Math.round(remaining * fallbackUnitCostCents / 1000));
        estimatedQuantityMilli = addSafe(estimatedQuantityMilli, remaining);
      } else {
        unknownQuantityMilli = addSafe(unknownQuantityMilli, remaining);
      }
      segments.push({
        lot: null,
        quantityMilli: remaining,
        costCents: Number.isSafeInteger(fallbackUnitCostCents)
          ? Math.round(remaining * fallbackUnitCostCents / 1000) : 0,
        known: false,
        fallbackUnitCostCents: Number.isSafeInteger(fallbackUnitCostCents)
          ? fallbackUnitCostCents : null
      });
    }
    return {
      segments: segments,
      costCents: costCents,
      unknownQuantityMilli: unknownQuantityMilli,
      estimatedQuantityMilli: estimatedQuantityMilli
    };
  }

  function restoreSegments(lots, segments, quantityMilli) {
    var remaining = quantityMilli;
    for (var index = segments.length - 1; index >= 0 && remaining > 0; index -= 1) {
      var segment = segments[index];
      var quantity = Math.min(remaining, segment.quantityMilli);
      var cost = segment.known
        ? (quantity === segment.quantityMilli
          ? segment.costCents
          : Math.round(segment.costCents * quantity / segment.quantityMilli))
        : !Number.isSafeInteger(segment.fallbackUnitCostCents)
          ? 0 : Math.round(quantity * segment.fallbackUnitCostCents / 1000);
      if (segment.lot) {
        segment.lot.remainingMilli += quantity;
        if (segment.known) {
          segment.lot.remainingCostCents += cost;
        }
      } else {
        lots.push({
          remainingMilli: quantity,
          remainingCostCents: 0,
          known: false,
          fallbackUnitCostCents: segment.fallbackUnitCostCents
        });
      }
      segment.quantityMilli -= quantity;
      segment.costCents -= cost;
      remaining -= quantity;
    }
    if (remaining > 0) {
      lots.push({
        remainingMilli: remaining,
        remainingCostCents: 0,
        known: false,
        fallbackUnitCostCents: null
      });
    }
  }

  function calculateCostOfGoodsSold(state) {
    var events = [];
    var lotsByProduct = Object.create(null);
    var tripLots = Object.create(null);
    var resultByInvoice = Object.create(null);
    var currentPurchasePrices = Object.create(null);
    var sequence = 0;

    state.products.forEach(function (product) {
      currentPurchasePrices[product.id] = Number.isSafeInteger(product.purchasePriceCents)
        ? product.purchasePriceCents : null;
    });

    function addEvent(date, type, data) {
      events.push({ date: date, type: type, data: data, sequence: sequence });
      sequence += 1;
    }

    state.purchases.forEach(function (purchase) {
      purchase.items.forEach(function (item) {
        addEvent(purchase.createdAt, "purchase", {
          productId: item.productId,
          quantityMilli: item.quantityMilli,
          costCents: item.totalCents
        });
      });
    });

    state.stockMovements.forEach(function (movement) {
      if (movement.type === "purchase_receipt" || movement.type === "invoice_sale" ||
          movement.type === "invoice_cancel") {
        return;
      }
      if (movement.type === "trip_issue" || movement.type === "trip_replenishment") {
        addEvent(movement.createdAt, "trip_issue", {
          productId: movement.productId,
          tripId: movement.sourceId,
          quantityMilli: -movement.quantityMilli
        });
      } else if (movement.type === "trip_return") {
        addEvent(movement.createdAt, "trip_return", {
          productId: movement.productId,
          tripId: movement.sourceId,
          quantityMilli: movement.quantityMilli
        });
      } else if (movement.quantityMilli > 0) {
        addEvent(movement.createdAt, "unknown_receipt", {
          productId: movement.productId,
          quantityMilli: movement.quantityMilli
        });
      }
    });

    state.invoices.forEach(function (invoice) {
      if (invoice.status === "posted") {
        addEvent(invoice.createdAt, "sale", invoice);
      }
    });

    events.sort(function (left, right) {
      return left.date.localeCompare(right.date) || left.sequence - right.sequence;
    }).forEach(function (event) {
      var data = event.data;
      var lots;
      if (event.type !== "sale") {
        lots = lotsByProduct[data.productId] || (lotsByProduct[data.productId] = []);
      }
      if (event.type === "purchase") {
        lots.push({
          remainingMilli: data.quantityMilli,
          remainingCostCents: data.costCents,
          known: true,
          fallbackUnitCostCents: null
        });
      } else if (event.type === "unknown_receipt") {
        lots.push({
          remainingMilli: data.quantityMilli,
          remainingCostCents: 0,
          known: false,
          fallbackUnitCostCents: currentPurchasePrices[data.productId] === undefined
            ? null : currentPurchasePrices[data.productId]
        });
      } else if (event.type === "trip_issue") {
        var issue = consumeLots(lots, data.quantityMilli,
          currentPurchasePrices[data.productId]);
        var tripKey = data.tripId + "|" + data.productId;
        (tripLots[tripKey] || (tripLots[tripKey] = [])).push.apply(
          tripLots[tripKey], issue.segments
        );
      } else if (event.type === "trip_return") {
        var returnKey = data.tripId + "|" + data.productId;
        var returnSegments = tripLots[returnKey] || [];
        restoreSegments(lots, returnSegments, data.quantityMilli);
      } else if (event.type === "sale") {
        var invoiceCostCents = 0;
        var unknownQuantityMilli = 0;
        var estimatedQuantityMilli = 0;
        data.items.forEach(function (line) {
          var consumed;
          if (data.tripId) {
            var saleKey = data.tripId + "|" + line.productId;
            var reserved = tripLots[saleKey] || [];
            consumed = consumeReservedSegments(reserved, line.quantityMilli,
              currentPurchasePrices[line.productId]);
            tripLots[saleKey] = reserved.filter(function (segment) {
              return segment.quantityMilli > 0;
            });
          } else {
            consumed = consumeLots(lotsByProduct[line.productId] ||
              (lotsByProduct[line.productId] = []), line.quantityMilli,
            currentPurchasePrices[line.productId]);
          }
          invoiceCostCents = addSafe(invoiceCostCents, consumed.costCents);
          unknownQuantityMilli = addSafe(unknownQuantityMilli, consumed.unknownQuantityMilli);
          estimatedQuantityMilli = addSafe(estimatedQuantityMilli, consumed.estimatedQuantityMilli);
        });
        resultByInvoice[data.id] = {
          costCents: invoiceCostCents,
          unknownQuantityMilli: unknownQuantityMilli,
          estimatedQuantityMilli: estimatedQuantityMilli
        };
      }
    });
    return resultByInvoice;
  }

  function getSummary(period, nowValue) {
    var state = storage.readState();
    var now = nowValue ? new Date(nowValue) : new Date();
    var start;
    var summary = {
      period: period,
      start: null,
      end: now.toISOString(),
      purchasesCents: 0,
      salesCents: 0,
      expensesCents: 0,
      companyPaymentsCents: 0,
      costOfGoodsSoldCents: 0,
      profitCents: null,
      hasUncostedSales: false,
      hasEstimatedCost: false
    };
    var invoicesById = Object.create(null);
    var invoiceCost;
    var hasSalesRecords = false;
    var expenseRepaymentsCents = 0;

    if (!Number.isFinite(now.getTime())) {
      throw new Error("تاريخ التقرير غير صالح.");
    }
    start = periodStart(period, now);
    summary.start = start.toISOString();

    state.invoices.forEach(function (invoice) {
      invoicesById[invoice.id] = true;
    });
    invoiceCost = calculateCostOfGoodsSold(state);

    state.purchases.forEach(function (purchase) {
      if (!isInPeriod(purchase.createdAt, start, now)) {
        return;
      }
      summary.purchasesCents = addSafe(summary.purchasesCents, purchase.totalCents);
      summary.companyPaymentsCents = addSafe(summary.companyPaymentsCents, purchase.paidCents);
    });

    state.invoices.forEach(function (invoice) {
      var cost;
      if (invoice.status !== "posted" || !isInPeriod(invoice.date, start, now)) {
        return;
      }
      hasSalesRecords = true;
      summary.salesCents = addSafe(summary.salesCents, invoice.totalCents);
      cost = invoiceCost[invoice.id];
      if (!cost || cost.unknownQuantityMilli > 0) {
        summary.hasUncostedSales = true;
      }
      if (cost) {
        summary.costOfGoodsSoldCents = addSafe(summary.costOfGoodsSoldCents, cost.costCents);
        summary.hasEstimatedCost = summary.hasEstimatedCost || cost.estimatedQuantityMilli > 0;
      }
    });

    state.customerEntries.forEach(function (entry) {
      if ((entry.kind !== "sale" && entry.kind !== "sale_void" && entry.kind !== "return") ||
          (entry.kind === "sale" && invoicesById[entry.sourceId]) ||
          (entry.kind === "sale_void" && invoicesById[entry.sourceId]) ||
          !isInPeriod(entry.createdAt, start, now)) {
        return;
      }
      hasSalesRecords = true;
      summary.salesCents = addSafe(summary.salesCents, entry.kind === "sale"
        ? entry.amountCents : -entry.amountCents);
      if (entry.kind === "sale") {
        summary.hasUncostedSales = true;
        summary.hasEstimatedCost = true;
      } else if (entry.kind === "return" || !invoicesById[entry.sourceId]) {
        summary.hasUncostedSales = true;
        summary.hasEstimatedCost = true;
      }
    });

    state.expenseTransactions.forEach(function (transaction) {
      if (!isInPeriod(transaction.createdAt, start, now)) {
        return;
      }
      if (transaction.type === "taken") {
        summary.expensesCents = addSafe(summary.expensesCents, transaction.amountCents);
      } else if (transaction.type === "repaid") {
        expenseRepaymentsCents = addSafe(expenseRepaymentsCents, transaction.amountCents);
      }
    });

    summary.profitCents = summary.salesCents - summary.costOfGoodsSoldCents -
      summary.expensesCents + expenseRepaymentsCents;
    if (!Number.isSafeInteger(summary.profitCents)) {
      throw new Error("تعذر حساب صافي الربح بدقة.");
    }
    if (summary.hasUncostedSales) {
      summary.profitCents = null;
    }
    summary.hasSalesRecords = hasSalesRecords;
    return summary;
  }

  global.PepsiApp.reportService = {
    getSummary: getSummary,
    getDailySummary: getDailySummary
  };
}(window));
