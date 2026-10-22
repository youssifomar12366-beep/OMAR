(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;
  var idCounter = 0;

  function requireText(value, label) {
    var text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error("أدخل " + label + ".");
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

  function addCents(left, right) {
    var total = left + right;
    if (!Number.isSafeInteger(total)) {
      throw new Error("تعذر حساب الرصيد بدقة؛ تجاوز إجمالي المبالغ الحد الآمن.");
    }
    return total;
  }

  function createId(state) {
    var id;
    var exists;

    do {
      idCounter += 1;
      id = "customer-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      exists = state.customers.some(function (customer) {
        return customer.id === id;
      }) || state.customerEntries.some(function (entry) {
        return entry.id === id;
      });
    } while (exists);

    return id;
  }

  function formatCustomerCode(number) {
    var sequence = String(number);
    while (sequence.length < 6) {
      sequence = "0" + sequence;
    }
    return "CUS-" + sequence;
  }

  function getCustomerRecord(state, customerId) {
    var customer = state.customers.find(function (candidate) {
      return candidate.id === customerId;
    });

    if (!customer) {
      throw new Error("العميل المطلوب غير موجود.");
    }
    return customer;
  }

  function getOutstandingBeforeCreditCents(state, customerId) {
    var invoiceOutstandingCents = 0;
    var legacyBalanceCents = 0;
    state.invoices.forEach(function (invoice) {
      var paidCents;
      var creditAppliedCents;
      if (invoice.customerId !== customerId || invoice.status !== "posted") {
        return;
      }
      paidCents = state.payments.reduce(function (total, payment) {
        return payment.invoiceId === invoice.id ? addCents(total, payment.amountCents) : total;
      }, 0);
      creditAppliedCents = state.customerEntries.reduce(function (total, entry) {
        return entry.kind === "credit_applied" && entry.sourceId === invoice.id
          ? addCents(total, entry.amountCents) : total;
      }, 0);
      invoiceOutstandingCents = addCents(invoiceOutstandingCents,
        Math.max(0, invoice.totalCents - paidCents - creditAppliedCents));
    });
    state.customerEntries.forEach(function (entry) {
      var invoice;
      var payment;
      var delta;
      if (entry.customerId !== customerId) {
        return;
      }
      invoice = state.invoices.find(function (item) {
        return item.id === entry.sourceId;
      });
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
          payment = state.payments.find(function (item) {
            return item.id === entry.sourceId;
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
      legacyBalanceCents = addCents(legacyBalanceCents, delta);
    });
    return addCents(invoiceOutstandingCents, Math.max(0, legacyBalanceCents));
  }

  function getOutstandingCentsFromState(state, customerId) {
    var creditIssuedCents = 0;
    var creditAppliedCents = 0;
    var grossOutstandingCents = getOutstandingBeforeCreditCents(state, customerId);
    state.customerEntries.forEach(function (entry) {
      if (entry.customerId !== customerId) {
        return;
      }
      if (entry.kind === "adjustment" && entry.balanceDeltaCents < 0) {
        creditIssuedCents = addCents(creditIssuedCents, -entry.balanceDeltaCents);
      } else if (entry.kind === "credit_applied") {
        creditAppliedCents = addCents(creditAppliedCents, entry.amountCents);
      }
    });
    return Math.max(0, grossOutstandingCents -
      Math.max(0, creditIssuedCents - creditAppliedCents));
  }

  function accountTotals(state, customerId) {
    var grossOutstandingCents;
    var unusedCreditCents;
    var totals = state.customerEntries.reduce(function (totals, entry) {
      var invoice;
      if (entry.customerId !== customerId) {
        return totals;
      }

      invoice = state.invoices.find(function (item) {
        return item.id === entry.sourceId;
      });
      if (entry.kind === "sale") {
        totals.salesCents = addCents(totals.salesCents, entry.amountCents);
        totals.balanceCents = addCents(totals.balanceCents, entry.amountCents);
      } else if (entry.kind === "sale_void") {
        totals.salesCents = addCents(totals.salesCents, -entry.amountCents);
        totals.balanceCents = addCents(totals.balanceCents, -entry.amountCents);
      } else if (entry.kind === "payment") {
        totals.paymentsCents = addCents(totals.paymentsCents, entry.amountCents);
        totals.balanceCents = addCents(totals.balanceCents, -entry.amountCents);
      } else if (entry.kind === "return") {
        totals.returnsCents = addCents(totals.returnsCents, entry.amountCents);
        totals.balanceCents = addCents(totals.balanceCents, -entry.amountCents);
      } else if (entry.kind === "adjustment") {
        totals.adjustmentsCents = addCents(totals.adjustmentsCents, entry.balanceDeltaCents);
        totals.balanceCents = addCents(totals.balanceCents, entry.balanceDeltaCents);
        if (entry.balanceDeltaCents < 0) {
          totals.creditIssuedCents = addCents(totals.creditIssuedCents, -entry.balanceDeltaCents);
          if (invoice) {
            totals.invoiceCreditIssuedCents =
              addCents(totals.invoiceCreditIssuedCents, -entry.balanceDeltaCents);
          }
        }
      } else if (entry.kind === "credit_applied") {
        totals.creditAppliedCents = addCents(totals.creditAppliedCents, entry.amountCents);
      }

      return totals;
    }, {
      salesCents: 0,
      paymentsCents: 0,
      returnsCents: 0,
      adjustmentsCents: 0,
      balanceCents: 0,
      creditIssuedCents: 0,
      creditAppliedCents: 0,
      invoiceCreditIssuedCents: 0
    });
    grossOutstandingCents = getOutstandingBeforeCreditCents(state, customerId);
    unusedCreditCents = Math.max(0,
      totals.creditIssuedCents - totals.creditAppliedCents);
    totals.creditAvailableCents = Math.max(0, unusedCreditCents - grossOutstandingCents);
    totals.outstandingCents = Math.max(0, grossOutstandingCents - unusedCreditCents);
    totals.totalCollectedCents = addCents(totals.paymentsCents,
      totals.invoiceCreditIssuedCents);
    return totals;
  }

  function presentCustomer(state, customer) {
    var totals = accountTotals(state, customer.id);
    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      active: customer.active,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      balanceCents: totals.balanceCents,
      totalSalesCents: totals.salesCents,
      totalPaymentsCents: totals.totalCollectedCents,
      totalReturnsCents: totals.returnsCents,
      outstandingCents: totals.outstandingCents,
      creditAvailableCents: totals.creditAvailableCents,
      totalCollectedCents: totals.totalCollectedCents,
    };
  }

  function addCustomer(input) {
    var updatedState = storage.updateState(function (state) {
      var now = new Date().toISOString();
      var code;
      var customer;

      while (true) {
        code = formatCustomerCode(state.nextCustomerNumber);
        state.nextCustomerNumber += 1;
        if (!state.customers.some(function (record) {
          return record.code.toLocaleUpperCase() === code.toLocaleUpperCase();
        })) {
          break;
        }
      }

      customer = {
        id: createId(state),
        code: code,
        name: requireText(input.name, "اسم العميل أو المحل"),
        phone: optionalText(input.phone, "رقم الهاتف", 40),
        address: optionalText(input.address, "العنوان", 240),
        active: true,
        createdAt: now,
        updatedAt: now
      };

      state.customers.push(customer);
      return state;
    });

    return presentCustomer(updatedState, updatedState.customers[updatedState.customers.length - 1]);
  }

  function updateCustomer(customerId, input) {
    var updatedState = storage.updateState(function (state) {
      var customer = getCustomerRecord(state, customerId);
      customer.name = requireText(input.name, "اسم العميل أو المحل");
      customer.phone = optionalText(input.phone, "رقم الهاتف", 40);
      customer.address = optionalText(input.address, "العنوان", 240);
      customer.updatedAt = new Date().toISOString();
      return state;
    });

    return presentCustomer(updatedState, getCustomerRecord(updatedState, customerId));
  }

  function setActive(customerId, active) {
    var updatedState = storage.updateState(function (state) {
      var customer = getCustomerRecord(state, customerId);
      if (typeof active !== "boolean") {
        throw new Error("حالة العميل غير صالحة.");
      }
      customer.active = active;
      customer.updatedAt = new Date().toISOString();
      return state;
    });

    return presentCustomer(updatedState, getCustomerRecord(updatedState, customerId));
  }

  function getCustomers() {
    var state = storage.readState();
    return state.customers.map(function (customer) {
      return presentCustomer(state, customer);
    });
  }

  function getCustomer(customerId) {
    var state = storage.readState();
    return presentCustomer(state, getCustomerRecord(state, customerId));
  }

  function getAccountHistory(customerId) {
    var state = storage.readState();
    var runningBalanceCents = 0;
    var entries;
    getCustomerRecord(state, customerId);
    entries = state.customerEntries.map(function (entry, index) {
      return { entry: entry, index: index };
    }).filter(function (record) {
      return record.entry.customerId === customerId;
    }).sort(function (left, right) {
      return left.entry.createdAt.localeCompare(right.entry.createdAt) || left.index - right.index;
    });
    return entries.map(function (record) {
      var entry = record.entry;
      var invoice;
      var payment;
      var delta;
      if (entry.kind === "adjustment") {
        delta = entry.balanceDeltaCents;
      } else if (entry.kind === "credit_applied") {
        delta = 0;
      } else if (entry.kind === "sale" || entry.kind === "sale_void") {
        delta = entry.kind === "sale" ? entry.amountCents : -entry.amountCents;
      } else {
        delta = -entry.amountCents;
      }
      runningBalanceCents = addCents(runningBalanceCents, delta);
      invoice = entry.kind === "sale" || entry.kind === "sale_void" ||
        entry.kind === "credit_applied"
        ? state.invoices.find(function (item) {
          return item.id === entry.sourceId;
        }) : null;
      payment = entry.kind === "payment" ? state.payments.find(function (item) {
        return item.id === entry.sourceId;
      }) : null;
      return {
        id: entry.id,
        kind: entry.kind,
        amountCents: entry.amountCents,
        balanceDeltaCents: delta,
        balanceAfterCents: runningBalanceCents,
        description: entry.description,
        sourceId: entry.sourceId || "",
        invoiceNumber: invoice ? invoice.number : "",
        invoiceItems: invoice ? invoice.items.map(function (line) {
          return {
            name: line.name,
            quantityMilli: line.quantityMilli,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            amountCents: line.amountCents
          };
        }) : [],
        tripNumber: invoice && invoice.tripId
          ? ((state.trips.find(function (trip) {
            return trip.id === invoice.tripId;
          }) || {}).number || "") : "",
        paymentNumber: payment ? payment.number : "",
        invoicePaymentNumber: payment && payment.invoiceId
          ? ((state.invoices.find(function (item) {
            return item.id === payment.invoiceId;
          }) || {}).number || "") : "",
        paymentMethod: payment ? payment.method : "",
        paymentNotes: payment ? payment.notes : "",
        createdAt: entry.createdAt
      };
    });
  }

  global.PepsiApp.customerService = {
    addCustomer: addCustomer,
    updateCustomer: updateCustomer,
    setActive: setActive,
    getCustomers: getCustomers,
    getCustomer: getCustomer,
    getOutstandingCentsFromState: getOutstandingCentsFromState,
    getAccountHistory: getAccountHistory
  };
}(window));
