(function (global) {
  "use strict";

  var storage = global.PepsiApp.storageService;
  var customerService = global.PepsiApp.customerService;
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

  function parseCents(value, label) {
    var amount;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل " + label + ".");
    }
    amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
        !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("تحقق من " + label + "؛ أدخل مبلغًا غير سالب وبحد أقصى منزلتين عشريتين.");
    }
    return Math.round(amount * 100);
  }

  function parseQuantityMilli(value, label) {
    var quantity;
    var milli;
    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل " + label + ".");
    }
    quantity = Number(value);
    milli = Math.round(quantity * 1000);
    if (!Number.isFinite(quantity) || quantity <= 0 ||
        Math.abs(quantity * 1000 - milli) > 0.000001 ||
        !Number.isSafeInteger(milli)) {
      throw new Error("تحقق من " + label + "؛ يجب أن تكون أكبر من صفر وبحد أقصى ثلاث منازل عشرية.");
    }
    return milli;
  }

  function createId(state, prefix) {
    var id;
    var usedIds;
    do {
      idCounter += 1;
      id = prefix + "-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      usedIds = state.products.concat(state.stockMovements, state.vehicles, state.drivers,
        state.trips, state.customers, state.customerEntries, state.invoices, state.payments)
        .some(function (record) {
          return record.id === id;
        });
      if (!usedIds) {
        usedIds = state.trips.some(function (trip) {
          return trip.replenishments.some(function (entry) {
            return entry.id === id;
          }) || (trip.returnRecord && trip.returnRecord.id === id);
        });
      }
    } while (usedIds);
    return id;
  }

  function addCents(left, right) {
    var total = left + right;
    if (!Number.isSafeInteger(total)) {
      throw new Error("تعذر حساب المبلغ بدقة؛ تجاوز الحد الآمن.");
    }
    return total;
  }

  function lineAmountCents(quantityMilli, unitPriceCents) {
    var rawAmount = quantityMilli * unitPriceCents;
    if (!Number.isSafeInteger(rawAmount)) {
      throw new Error("قيمة الصنف تتجاوز الحد الذي يمكن حسابه بدقة.");
    }
    return Math.round(rawAmount / 1000);
  }

  function formatQuantity(quantityMilli) {
    return (quantityMilli / 1000).toLocaleString("ar-EG", {
      maximumFractionDigits: 3
    });
  }

  function getCustomer(state, customerId) {
    var customer = state.customers.find(function (candidate) {
      return candidate.id === customerId && candidate.active;
    });
    if (!customer) {
      throw new Error("اختر عميلًا نشطًا مسجلًا.");
    }
    return customer;
  }

  function getTrip(state, tripId) {
    var trip = state.trips.find(function (candidate) {
      return candidate.id === tripId;
    });
    if (!trip || trip.status !== "returned") {
      throw new Error("لا يمكن ربط الفاتورة إلا بطلعة سُجل راجعها أولًا.");
    }
    if (trip.salesCompletedAt) {
      throw new Error("تم اعتماد اكتمال مبيعات هذه الطلعة؛ لا يمكن إضافة فواتير جديدة.");
    }
    return trip;
  }

  function getTripForCustomerSales(state, tripId) {
    var trip = state.trips.find(function (candidate) {
      return candidate.id === tripId;
    });
    if (!trip) {
      throw new Error("الطلعة المطلوبة غير موجودة.");
    }
    return trip;
  }

  function getStock(state, productId) {
    return state.stockMovements.reduce(function (total, movement) {
      return movement.productId === productId ? total + movement.quantityMilli : total;
    }, 0);
  }

  function tripSoldQuantity(trip, productId) {
    var tripLine = trip.items.find(function (item) {
      return item.productId === productId;
    });
    var outgoing = tripLine ? tripLine.quantityMilli : 0;
    var returned = 0;
    trip.replenishments.forEach(function (item) {
      if (item.productId === productId) {
        outgoing += item.quantityMilli;
      }
    });
    if (trip.returnRecord) {
      trip.returnRecord.items.forEach(function (item) {
        if (item.productId === productId) {
          returned = item.quantityMilli;
        }
      });
    }
    return outgoing - returned;
  }

  function tripBilledQuantity(state, tripId, productId) {
    return state.invoices.reduce(function (total, invoice) {
      if (invoice.tripId !== tripId || invoice.status !== "posted") {
        return total;
      }
      return invoice.items.reduce(function (lineTotal, line) {
        return line.productId === productId
          ? lineTotal + line.quantityMilli : lineTotal;
      }, total);
    }, 0);
  }

  function getPaidCents(state, invoiceId) {
    return state.payments.reduce(function (total, payment) {
      return payment.invoiceId === invoiceId ? addCents(total, payment.amountCents) : total;
    }, 0);
  }

  function getCreditAppliedCents(state, invoiceId) {
    return state.customerEntries.reduce(function (total, entry) {
      return entry.kind === "credit_applied" && entry.sourceId === invoiceId
        ? addCents(total, entry.amountCents) : total;
    }, 0);
  }

  function getAvailableCustomerCreditCents(state, customerId) {
    var issuedCents = state.customerEntries.reduce(function (total, entry) {
      return entry.customerId === customerId && entry.kind === "adjustment" &&
        entry.balanceDeltaCents < 0
        ? addCents(total, -entry.balanceDeltaCents) : total;
    }, 0);
    var appliedCents = state.customerEntries.reduce(function (total, entry) {
      return entry.customerId === customerId && entry.kind === "credit_applied"
        ? addCents(total, entry.amountCents) : total;
    }, 0);
    return Math.max(0, issuedCents - appliedCents);
  }

  function getInvoiceOutstandingCents(state, invoice) {
    return Math.max(0, invoice.totalCents - getPaidCents(state, invoice.id) -
      getCreditAppliedCents(state, invoice.id));
  }

  function createCreditApplication(state, customerId, invoiceId, amountCents, now) {
    if (amountCents <= 0) {
      return;
    }
    state.customerEntries.push({
      id: createId(state, "entry"),
      customerId: customerId,
      kind: "credit_applied",
      amountCents: amountCents,
      description: "استخدام رصيد دائن في الفاتورة",
      sourceId: invoiceId,
      createdAt: now
    });
  }

  function presentInvoice(state, invoice) {
    var customer = state.customers.find(function (item) {
      return item.id === invoice.customerId;
    });
    var trip = invoice.tripId
      ? state.trips.find(function (item) {
        return item.id === invoice.tripId;
      })
      : null;
    var paidCents = getPaidCents(state, invoice.id);
    var creditAppliedCents = getCreditAppliedCents(state, invoice.id);
    var creditCents = state.customerEntries.reduce(function (total, entry) {
      return entry.customerId === invoice.customerId &&
        entry.kind === "adjustment" && entry.sourceId === invoice.id &&
        entry.balanceDeltaCents < 0
        ? addCents(total, -entry.balanceDeltaCents) : total;
    }, 0);
    var tripCollectionPayment = invoice.tripId
      ? state.payments.find(function (item) {
        return item.invoiceId === invoice.id &&
          item.requestId === invoice.requestId + ":initial-payment";
      })
      : null;
    var tripCollectedCents = invoice.tripId
      ? addCents(tripCollectionPayment ? tripCollectionPayment.amountCents : 0, creditCents)
      : 0;
    var payments = state.payments.filter(function (item) {
      return item.invoiceId === invoice.id;
    }).map(function (item) {
      return {
        number: item.number,
        amountCents: item.amountCents,
        method: item.method,
        notes: item.notes,
        createdAt: item.createdAt
      };
    });

    return {
      id: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: typeof invoice.customerName === "string"
        ? invoice.customerName : (customer ? customer.name : "عميل غير معروف"),
      customerCode: typeof invoice.customerCode === "string"
        ? invoice.customerCode : (customer ? customer.code : ""),
      customerPhone: typeof invoice.customerPhone === "string"
        ? invoice.customerPhone : (customer ? customer.phone : ""),
      customerAddress: typeof invoice.customerAddress === "string"
        ? invoice.customerAddress : (customer ? customer.address : ""),
      tripId: invoice.tripId,
      tripNumber: trip ? trip.number : "",
      date: invoice.date,
      createdAt: invoice.createdAt,
      source: invoice.tripId ? "trip" : "direct",
      status: invoice.status,
      cancellationReason: invoice.cancellation ? invoice.cancellation.reason : "",
      items: invoice.items.map(function (item) {
        return {
          productId: item.productId,
          code: item.code,
          name: item.name,
          unit: item.unit,
          quantityMilli: item.quantityMilli,
          unitPriceCents: item.unitPriceCents,
          amountCents: item.amountCents
        };
      }),
      subtotalCents: invoice.subtotalCents,
      discountCents: invoice.discountCents,
      discountReason: invoice.discountReason,
      totalCents: invoice.totalCents,
      paidCents: paidCents,
      tripCollectedCents: tripCollectedCents,
      creditCents: creditCents,
      creditAppliedCents: creditAppliedCents,
      balanceCents: invoice.status === "cancelled" ? 0 :
        invoice.totalCents - paidCents - creditAppliedCents,
      payments: payments
    };
  }

  function formatNumber(number, prefix, width) {
    var value = String(number);
    while (value.length < width) {
      value = "0" + value;
    }
    return prefix + value;
  }

  function createPaymentRecord(state, customerId, invoiceId, amountCents, method, notes, now, requestId) {
    var payment = {
      id: createId(state, "payment"),
      number: formatNumber(state.nextPaymentNumber, "PAY-", 6),
      customerId: customerId,
      invoiceId: invoiceId,
      amountCents: amountCents,
      method: method,
      notes: notes,
      requestId: requestId || createId(state, "payment-request"),
      createdAt: now
    };
    state.nextPaymentNumber += 1;
    state.payments.push(payment);
    state.customerEntries.push({
      id: createId(state, "entry"),
      customerId: customerId,
      kind: "payment",
      amountCents: amountCents,
      description: "تحصيل " + payment.number,
      sourceId: payment.id,
      createdAt: now
    });
    return payment;
  }

  function createInvoice(input) {
    var requestId = optionalText(input.requestId, "معرف حفظ الفاتورة", 120);
    var savedInvoiceId = "";
    var updatedState = storage.updateState(function (state) {
      var existingInvoice = requestId ? state.invoices.find(function (item) {
        return item.requestId === requestId;
      }) : null;
      if (existingInvoice) {
        savedInvoiceId = existingInvoice.id;
        return state;
      }
      var customer = getCustomer(state, input.customerId);
      var trip = input.tripId ? getTrip(state, input.tripId) : null;
      var date = new Date(input.date);
      var now = new Date().toISOString();
      var seenProducts = Object.create(null);
      var lines;
      var subtotalCents = 0;
      var discountInput = input.discount === null || typeof input.discount === "undefined" ||
        input.discount === "" ? "0" : input.discount;
      var discountCents = parseCents(discountInput, "قيمة الخصم");
      var discountReason = discountCents > 0
        ? optionalText(input.discountReason, "سبب الخصم", 240) : "";
      var totalCents;
      var initialPaymentCents;
      var creditAppliedCents;
      var outstandingAfterCreditCents;
      var method = input.paymentMethod ? requireText(input.paymentMethod, "طريقة التحصيل") : "";
      var invoice;

      if (!Number.isFinite(date.getTime())) {
        throw new Error("أدخل تاريخًا صالحًا للفاتورة.");
      }
      if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new Error("أضف صنفًا واحدًا على الأقل إلى الفاتورة.");
      }
      if (discountCents > 0 && !discountReason) {
        throw new Error("أدخل سبب الخصم عند تسجيل خصم.");
      }

      lines = input.items.map(function (requested) {
        var product;
        var sourceLine;
        var quantityMilli;
        var unitPriceCents;
        var amountCents;

        if (!requested || typeof requested.productId !== "string" ||
            seenProducts[requested.productId]) {
          throw new Error("تحقق من أصناف الفاتورة؛ لا تكرر الصنف نفسه.");
        }
        seenProducts[requested.productId] = true;
        product = state.products.find(function (item) {
          return item.id === requested.productId;
        });
        if (!product || (!trip && !product.active)) {
          throw new Error("أحد أصناف الفاتورة غير متاح.");
        }
        sourceLine = trip && trip.items.find(function (item) {
          return item.productId === product.id;
        });
        if (trip && !sourceLine) {
          throw new Error("الصنف " + product.name + " غير موجود في الطلعة المحددة.");
        }
        quantityMilli = parseQuantityMilli(requested.quantity, "كمية " + product.name);
        unitPriceCents = parseCents(requested.unitPrice, "سعر " + product.name);
        amountCents = lineAmountCents(quantityMilli, unitPriceCents);
        if (!Number.isSafeInteger(amountCents)) {
          throw new Error("تعذر حساب قيمة الصنف " + product.name + " بدقة.");
        }
        subtotalCents = addCents(subtotalCents, amountCents);

        if (trip) {
          var availableForInvoice =
            tripSoldQuantity(trip, product.id) - tripBilledQuantity(state, trip.id, product.id);
          if (quantityMilli > availableForInvoice) {
            throw new Error("كمية " + product.name + " تتجاوز المباع غير المفوتر في الطلعة؛ المتاح " +
              (availableForInvoice / 1000) + " " + product.unit + ".");
          }
        } else if (getStock(state, product.id) < quantityMilli) {
          throw new Error("المخزون غير كافٍ للصنف " + product.name + ".");
        }

        return {
          productId: product.id,
          code: trip && sourceLine ? sourceLine.code : product.code,
          name: trip && sourceLine ? sourceLine.name : product.name,
          unit: trip && sourceLine ? sourceLine.unit : product.unit,
          quantityMilli: quantityMilli,
          unitPriceCents: unitPriceCents,
          amountCents: amountCents
        };
      });

      if (discountCents > subtotalCents) {
        throw new Error("لا يمكن أن يتجاوز الخصم إجمالي الأصناف.");
      }
      totalCents = subtotalCents - discountCents;
      creditAppliedCents = Math.min(totalCents,
        getAvailableCustomerCreditCents(state, customer.id));
      outstandingAfterCreditCents = totalCents - creditAppliedCents;
      initialPaymentCents = input.initialPayment === "" ||
        typeof input.initialPayment === "undefined"
        ? 0 : parseCents(input.initialPayment, "المبلغ المدفوع");
      if (initialPaymentCents > outstandingAfterCreditCents) {
        throw new Error("المبلغ المدفوع لا يمكن أن يتجاوز المستحق بعد استخدام رصيد العميل.");
      }
      if (initialPaymentCents > 0 && !method) {
        throw new Error("اختر طريقة التحصيل للمبلغ المدفوع.");
      }

      invoice = {
        id: createId(state, "invoice"),
        number: formatNumber(state.nextInvoiceNumber, "INV-", 6),
        customerId: customer.id,
        customerName: customer.name,
        customerCode: customer.code,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        requestId: requestId || createId(state, "invoice-request"),
        tripId: trip ? trip.id : null,
        date: date.toISOString(),
        createdAt: now,
        status: "posted",
        items: lines,
        subtotalCents: subtotalCents,
        discountCents: discountCents,
        discountReason: discountReason,
        totalCents: totalCents
      };
      state.nextInvoiceNumber += 1;
      state.invoices.push(invoice);
      state.customerEntries.push({
        id: createId(state, "entry"),
        customerId: customer.id,
        kind: "sale",
        amountCents: totalCents,
        description: "فاتورة " + invoice.number,
        sourceId: invoice.id,
        createdAt: now
      });
      createCreditApplication(state, customer.id, invoice.id, creditAppliedCents, now);

      if (!trip) {
        lines.forEach(function (line) {
          state.stockMovements.push({
            id: createId(state, "move"),
            productId: line.productId,
            type: "invoice_sale",
            quantityMilli: -line.quantityMilli,
            reference: invoice.number,
            sourceId: invoice.id,
            createdAt: now
          });
        });
      }
      if (initialPaymentCents > 0) {
        createPaymentRecord(state, customer.id, invoice.id, initialPaymentCents, method,
          optionalText(input.paymentNotes, "ملاحظات التحصيل", 240), now,
          (requestId || invoice.id) + ":initial-payment");
      }
      savedInvoiceId = invoice.id;
      return state;
    });

    return presentInvoice(updatedState, updatedState.invoices.find(function (invoice) {
      return invoice.id === savedInvoiceId;
    }));
  }

  function createTripInvoices(input) {
    var invoiceIds = [];
    var updatedState = storage.updateState(function (state) {
      var trip = getTripForCustomerSales(state, input.tripId);
      var date = new Date(input.date);
      var entries = input.entries;
      var seenCustomers = Object.create(null);
      var seenRequests = Object.create(null);
      var billedByProduct = Object.create(null);
      var existingByRequest = [];
      var existingCount = 0;
      var now = new Date().toISOString();

      if (!Number.isFinite(date.getTime())) {
        throw new Error("أدخل تاريخًا صالحًا للفواتير.");
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("أدخل مبيعات عميل واحدة على الأقل قبل الحفظ.");
      }

      entries.forEach(function (entry) {
        if (!entry || typeof entry !== "object") {
          throw new Error("بيانات صفوف مبيعات الطلعة غير صالحة.");
        }
        var requestId = requireText(entry.requestId, "معرف حفظ الفاتورة");
        if (seenRequests[requestId]) {
          throw new Error("معرف حفظ الفاتورة مكرر داخل عملية الحفظ.");
        }
        seenRequests[requestId] = true;
        var existing = state.invoices.find(function (invoice) {
          return invoice.requestId === requestId;
        });
        if (existing) {
          if (existing.tripId !== trip.id || existing.customerId !== entry.customerId ||
              existing.status !== "posted") {
            throw new Error("معرف حفظ الفاتورة مستخدم لسجل آخر.");
          }
          existingByRequest.push(existing);
          existingCount += 1;
        } else {
          existingByRequest.push(null);
        }
      });

      if (existingCount > 0) {
        if (existingCount !== entries.length) {
          throw new Error("حالة حفظ سابقة غير مكتملة؛ لم تُجرَ أي تغييرات جديدة. أعد تحميل الشاشة لمراجعة الفواتير.");
        }
        invoiceIds = existingByRequest.map(function (invoice) {
          return invoice.id;
        });
        return state;
      }
      if (trip.salesCompletedAt) {
        throw new Error("تم اعتماد اكتمال مبيعات هذه الطلعة؛ لا يمكن إضافة فواتير جديدة.");
      }

      state.invoices.forEach(function (invoice) {
        if (invoice.tripId === trip.id && invoice.status === "posted") {
          seenCustomers[invoice.customerId] = true;
          invoice.items.forEach(function (line) {
            billedByProduct[line.productId] =
              (billedByProduct[line.productId] || 0) + line.quantityMilli;
          });
        }
      });

      entries.forEach(function (entry) {
        var customer = getCustomer(state, entry.customerId);
        var requestId = requireText(entry.requestId, "معرف حفظ الفاتورة");
        var seenProducts = Object.create(null);
        var lines;
        var subtotalCents = 0;
        var discountCents = entry.discount === "" ||
          typeof entry.discount === "undefined" ? 0 : parseCents(entry.discount, "الخصم");
        var totalCents;
        var initialPaymentCents = parseCents(entry.initialPayment, "المبلغ المحصل من العميل");
        var creditAppliedCents;
        var outstandingAfterCreditCents;
        var appliedPaymentCents;
        var customerCreditCents;
        var method = initialPaymentCents > 0
          ? requireText(entry.paymentMethod || "نقدي", "طريقة التحصيل") : "";
        var invoice;

        if (seenCustomers[customer.id]) {
          throw new Error("لا يمكن اختيار العميل نفسه أكثر من مرة في مبيعات هذه الطلعة.");
        }
        seenCustomers[customer.id] = true;
        if (!Array.isArray(entry.items) || entry.items.length === 0) {
          throw new Error("أدخل كمية صنف واحدة على الأقل لكل عميل محدد.");
        }

        lines = entry.items.map(function (requested) {
          var sourceLine = trip.items.find(function (item) {
            return item.productId === requested.productId;
          });
          var product = state.products.find(function (item) {
            return item.id === requested.productId;
          });
          var quantityMilli;
          var amountCents;
          if (!sourceLine || !product || seenProducts[requested.productId]) {
            throw new Error("تحقق من الأصناف المدخلة؛ يوجد صنف غير تابع للطلعة أو مكرر.");
          }
          seenProducts[requested.productId] = true;
          if (!Number.isSafeInteger(sourceLine.salePriceCents) || sourceLine.salePriceCents < 0) {
            throw new Error("لا يوجد سعر بيع معتمد للصنف " + sourceLine.name + ".");
          }
          quantityMilli = parseQuantityMilli(requested.quantity, "كمية " + sourceLine.name);
          if (quantityMilli % 1000 !== 0) {
            throw new Error("كمية " + sourceLine.name + " يجب أن تكون عددًا صحيحًا من الكراتين.");
          }
          amountCents = lineAmountCents(quantityMilli, sourceLine.salePriceCents);
          subtotalCents = addCents(subtotalCents, amountCents);
          billedByProduct[requested.productId] =
            (billedByProduct[requested.productId] || 0) + quantityMilli;
          if (billedByProduct[requested.productId] > tripSoldQuantity(trip, requested.productId)) {
            throw new Error("توزيع " + sourceLine.name + " يتجاوز الكمية المباعة المتاحة في الطلعة.");
          }
          return {
            productId: sourceLine.productId,
            code: sourceLine.code,
            name: sourceLine.name,
            unit: sourceLine.unit,
            quantityMilli: quantityMilli,
            unitPriceCents: sourceLine.salePriceCents,
            amountCents: amountCents
          };
        });

        if (discountCents > subtotalCents) {
          throw new Error("خصم " + customer.name + " لا يمكن أن يتجاوز إجمالي قيمة الأصناف.");
        }
        totalCents = subtotalCents - discountCents;
        creditAppliedCents = Math.min(totalCents,
          getAvailableCustomerCreditCents(state, customer.id));
        outstandingAfterCreditCents = totalCents - creditAppliedCents;
        appliedPaymentCents = Math.min(initialPaymentCents, outstandingAfterCreditCents);
        customerCreditCents = initialPaymentCents - appliedPaymentCents;
        invoice = {
          id: createId(state, "invoice"),
          number: formatNumber(state.nextInvoiceNumber, "INV-", 6),
          customerId: customer.id,
          customerName: customer.name,
          customerCode: customer.code,
          customerPhone: customer.phone,
          customerAddress: customer.address,
          requestId: requestId,
          tripId: trip.id,
          date: date.toISOString(),
          createdAt: now,
          status: "posted",
          items: lines,
          subtotalCents: subtotalCents,
          discountCents: discountCents,
          discountReason: "",
          totalCents: totalCents
        };
        state.nextInvoiceNumber += 1;
        state.invoices.push(invoice);
        state.customerEntries.push({
          id: createId(state, "entry"),
          customerId: customer.id,
          kind: "sale",
          amountCents: invoice.totalCents,
          description: "فاتورة " + invoice.number,
          sourceId: invoice.id,
          createdAt: now
        });
        createCreditApplication(state, customer.id, invoice.id, creditAppliedCents, now);
        if (appliedPaymentCents > 0) {
          createPaymentRecord(state, customer.id, invoice.id, appliedPaymentCents, method, "",
            now, requestId + ":initial-payment");
        }
        if (customerCreditCents > 0) {
          state.customerEntries.push({
            id: createId(state, "entry"),
            customerId: customer.id,
            kind: "adjustment",
            amountCents: customerCreditCents,
            balanceDeltaCents: -customerCreditCents,
            description: "رصيد دائن من زيادة التحصيل في فاتورة " + invoice.number,
            sourceId: invoice.id,
            paymentMethod: method,
            createdAt: now
          });
        }
        invoiceIds.push(invoice.id);
      });

      if (trip.status === "returned") {
        trip.items.forEach(function (item) {
          var soldMilli = tripSoldQuantity(trip, item.productId);
          var distributedMilli = billedByProduct[item.productId] || 0;
          if (soldMilli === 0) {
            return;
          }
          if (distributedMilli !== soldMilli) {
            var remainingMilli = soldMilli - distributedMilli;
            throw new Error("لا يمكن حفظ الفواتير قبل اكتمال توزيع صنف " + item.name +
              ". الكمية المسجلة: " + formatQuantity(distributedMilli) + " من " +
              formatQuantity(soldMilli) + " كرتونة. المتبقي: " +
              formatQuantity(remainingMilli) + " كرتونة.");
          }
        });
      }
      return state;
    });

    return invoiceIds.map(function (invoiceId) {
      var invoice = updatedState.invoices.find(function (item) {
        return item.id === invoiceId;
      });
      return presentInvoice(updatedState, invoice);
    });
  }

  function addPayment(invoiceId, input) {
    var requestId = optionalText(input.requestId, "معرف حفظ التحصيل", 120);
    var updatedState = storage.updateState(function (state) {
      var invoice = state.invoices.find(function (candidate) {
        return candidate.id === invoiceId;
      });
      var amountCents;
      var method;
      var outstanding;
      if (!invoice) {
        throw new Error("الفاتورة المطلوبة غير موجودة.");
      }
      if (invoice.status !== "posted") {
        throw new Error("لا يمكن تحصيل فاتورة ملغاة.");
      }
      if (requestId && state.payments.some(function (payment) {
        return payment.requestId === requestId;
      })) {
        var duplicate = state.payments.find(function (payment) {
          return payment.requestId === requestId;
        });
        if (duplicate.invoiceId !== invoiceId) {
          throw new Error("معرف التحصيل مستخدم لعملية أخرى.");
        }
        return state;
      }
      amountCents = parseCents(input.amount, "المبلغ المحصل");
      method = requireText(input.method, "طريقة التحصيل");
      outstanding = getInvoiceOutstandingCents(state, invoice);
      if (amountCents <= 0) {
        throw new Error("يجب أن يكون مبلغ التحصيل أكبر من صفر.");
      }
      if (amountCents > outstanding) {
        throw new Error("مبلغ التحصيل يتجاوز الرصيد المتبقي على الفاتورة.");
      }
      createPaymentRecord(state, invoice.customerId, invoice.id, amountCents, method,
        optionalText(input.notes, "ملاحظات التحصيل", 240), new Date().toISOString(), requestId);
      return state;
    });
    return presentInvoice(updatedState, updatedState.invoices.find(function (invoice) {
      return invoice.id === invoiceId;
    }));
  }

  function addCustomerPayment(customerId, input) {
    var requestId = optionalText(input.requestId, "معرف حفظ التحصيل", 120);
    var updatedState = storage.updateState(function (state) {
      var customer = state.customers.find(function (item) {
        return item.id === customerId;
      });
      var duplicate = requestId && state.payments.find(function (payment) {
        return payment.requestId === requestId;
      });
      var customerBalance;
      var amountCents;
      var method;
      var notes;
      var now;
      var paymentRequestId;
      var existingPayments;
      var remainingCents;
      var invoices;
      if (!customer) {
        throw new Error("العميل المطلوب غير موجود.");
      }
      existingPayments = requestId ? state.payments.filter(function (payment) {
        return payment.requestId === requestId ||
          payment.requestId.indexOf(requestId + ":") === 0;
      }) : [];
      if (duplicate || existingPayments.length > 0) {
        if (duplicate && (duplicate.customerId !== customerId || duplicate.invoiceId !== null)) {
          throw new Error("معرف التحصيل مستخدم لعملية أخرى.");
        }
        if (existingPayments.some(function (payment) {
          return payment.customerId !== customerId;
        })) {
          throw new Error("معرف التحصيل مستخدم لعملية أخرى.");
        }
        return state;
      }
      amountCents = parseCents(input.amount, "المبلغ المحصل");
      if (amountCents <= 0) {
        throw new Error("يجب أن يكون مبلغ التحصيل أكبر من صفر.");
      }
      customerBalance = customerService.getOutstandingCentsFromState(state, customerId);
      if (amountCents > customerBalance) {
        throw new Error("مبلغ التحصيل يتجاوز إجمالي ديون العميل الحالية.");
      }
      method = requireText(input.method, "طريقة التحصيل");
      notes = optionalText(input.notes, "ملاحظات التحصيل", 240);
      now = new Date().toISOString();
      paymentRequestId = requestId || createId(state, "payment-request");
      remainingCents = amountCents;
      invoices = state.invoices.filter(function (invoice) {
        return invoice.customerId === customerId && invoice.status === "posted" &&
          getInvoiceOutstandingCents(state, invoice) > 0;
      }).sort(function (left, right) {
        return left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt);
      });
      invoices.forEach(function (invoice) {
        var appliedCents = Math.min(remainingCents, getInvoiceOutstandingCents(state, invoice));
        if (appliedCents > 0) {
          createPaymentRecord(state, customerId, invoice.id, appliedCents, method, notes, now,
            paymentRequestId + ":invoice:" + invoice.id);
          remainingCents -= appliedCents;
        }
      });
      if (remainingCents > 0) {
        createPaymentRecord(state, customerId, null, remainingCents, method, notes, now,
          paymentRequestId + ":legacy");
      }
      return state;
    });
    return getCustomerPaymentsFromState(updatedState, customerId);
  }

  function getCustomerPaymentsFromState(state, customerId) {
    var tripCreditsByInvoice = Object.create(null);
    var mergedCreditInvoiceIds = Object.create(null);
    var payments;
    state.customerEntries.forEach(function (entry) {
      var invoice;
      var credit;
      if (entry.customerId !== customerId || entry.kind !== "adjustment" ||
          entry.balanceDeltaCents >= 0) {
        return;
      }
      invoice = state.invoices.find(function (item) {
        return item.id === entry.sourceId && item.customerId === customerId && item.tripId;
      });
      if (!invoice) {
        return;
      }
      credit = tripCreditsByInvoice[invoice.id] || {
        amountCents: 0,
        paymentMethod: entry.paymentMethod || "",
        createdAt: entry.createdAt
      };
      credit.amountCents = addCents(credit.amountCents, -entry.balanceDeltaCents);
      if (!credit.paymentMethod && entry.paymentMethod) {
        credit.paymentMethod = entry.paymentMethod;
      }
      if (entry.createdAt < credit.createdAt) {
        credit.createdAt = entry.createdAt;
      }
      tripCreditsByInvoice[invoice.id] = credit;
    });
    payments = state.payments.filter(function (payment) {
      return payment.customerId === customerId;
    }).map(function (payment) {
      var invoice = payment.invoiceId ? state.invoices.find(function (item) {
        return item.id === payment.invoiceId;
      }) : null;
      var credit = invoice && invoice.tripId && invoice.requestId &&
        payment.requestId === invoice.requestId + ":initial-payment"
        ? tripCreditsByInvoice[invoice.id] : null;
      var creditCents = credit ? credit.amountCents : 0;
      if (credit) {
        mergedCreditInvoiceIds[invoice.id] = true;
      }
      return {
        id: payment.id,
        number: payment.number,
        invoiceId: payment.invoiceId,
        invoiceNumber: invoice ? invoice.number : "",
        amountCents: addCents(payment.amountCents, creditCents),
        appliedCents: payment.amountCents,
        creditCents: creditCents,
        method: payment.method,
        notes: payment.notes,
        createdAt: payment.createdAt
      };
    });
    Object.keys(tripCreditsByInvoice).forEach(function (invoiceId) {
      var invoice;
      var credit;
      if (mergedCreditInvoiceIds[invoiceId]) {
        return;
      }
      invoice = state.invoices.find(function (item) {
        return item.id === invoiceId;
      });
      credit = tripCreditsByInvoice[invoiceId];
      payments.push({
        id: "credit-" + invoiceId,
        number: "—",
        invoiceId: invoiceId,
        invoiceNumber: invoice ? invoice.number : "",
        amountCents: credit.amountCents,
        appliedCents: 0,
        creditCents: credit.amountCents,
        method: credit.paymentMethod || "غير مسجل",
        notes: "تحصيل محفوظ بالكامل كرصيد دائن",
        createdAt: credit.createdAt
      });
    });
    return payments.sort(function (left, right) {
      return left.createdAt.localeCompare(right.createdAt) ||
        left.number.localeCompare(right.number);
    });
  }

  function getCustomerInvoices(customerId) {
    var state = storage.readState();
    if (!state.customers.some(function (customer) {
      return customer.id === customerId;
    })) {
      throw new Error("العميل المطلوب غير موجود.");
    }
    return state.invoices.filter(function (invoice) {
      return invoice.customerId === customerId;
    }).sort(function (left, right) {
      return left.date.localeCompare(right.date);
    }).map(function (invoice) {
      return presentInvoice(state, invoice);
    });
  }

  function getCustomerPayments(customerId) {
    var state = storage.readState();
    if (!state.customers.some(function (customer) {
      return customer.id === customerId;
    })) {
      throw new Error("العميل المطلوب غير موجود.");
    }
    return getCustomerPaymentsFromState(state, customerId);
  }

  function cancelInvoice(invoiceId, reason) {
    var text = requireText(reason, "سبب إلغاء الفاتورة");
    if (text.length > 240) {
      throw new Error("تجاوز سبب الإلغاء الحد المسموح من الأحرف.");
    }
    var updatedState = storage.updateState(function (state) {
      var invoice = state.invoices.find(function (item) {
        return item.id === invoiceId;
      });
      var now = new Date().toISOString();
      if (!invoice) {
        throw new Error("الفاتورة المطلوبة غير موجودة.");
      }
      if (invoice.status === "cancelled") {
        return state;
      }
      if (invoice.tripId) {
        throw new Error("لا يمكن إلغاء فاتورة طلعة قبل تسجيل معالجة فعلية للبضاعة المرتبطة بها؛ لم تتوفر حركة إرجاع للطلعة.");
      }
      if (getPaidCents(state, invoiceId) > 0 || getCreditAppliedCents(state, invoiceId) > 0) {
        throw new Error("لا يمكن إلغاء فاتورة عليها تحصيل أو رصيد دائن مستخدم؛ راجع الحركات أولًا دون حذف سجلها.");
      }
      invoice.status = "cancelled";
      invoice.cancellation = { reason: text, createdAt: now };
      state.customerEntries.push({
        id: createId(state, "entry"),
        customerId: invoice.customerId,
        kind: "sale_void",
        amountCents: invoice.totalCents,
        description: "إلغاء الفاتورة " + invoice.number + ": " + text,
        sourceId: invoice.id,
        createdAt: now
      });
      if (!invoice.tripId) {
        invoice.items.forEach(function (line) {
          state.stockMovements.push({
            id: createId(state, "move"),
            productId: line.productId,
            type: "invoice_cancel",
            quantityMilli: line.quantityMilli,
            reference: invoice.number,
            sourceId: invoice.id,
            createdAt: now
          });
        });
      }
      return state;
    });
    return presentInvoice(updatedState, updatedState.invoices.find(function (item) {
      return item.id === invoiceId;
    }));
  }

  function getInvoices() {
    var state = storage.readState();
    return state.invoices.slice().sort(function (left, right) {
      return right.date.localeCompare(left.date) || right.number.localeCompare(left.number);
    }).map(function (invoice) {
      return presentInvoice(state, invoice);
    });
  }

  function getInvoice(invoiceId) {
    var state = storage.readState();
    var invoice = state.invoices.find(function (candidate) {
      return candidate.id === invoiceId;
    });
    if (!invoice) {
      throw new Error("الفاتورة المطلوبة غير موجودة.");
    }
    return presentInvoice(state, invoice);
  }

  function getInvoiceableTrips() {
    var state = storage.readState();
    return state.trips.filter(function (trip) {
      return (trip.status === "returned" || trip.returnRecord) && !trip.salesCompletedAt;
    }).map(function (trip) {
      return {
        id: trip.id,
        number: trip.number,
        date: trip.dateTime,
        lines: trip.items.map(function (item) {
          var soldMilli = tripSoldQuantity(trip, item.productId);
          var availableMilli = soldMilli - tripBilledQuantity(state, trip.id, item.productId);
          return {
            productId: item.productId,
            code: item.code,
            name: item.name,
            unit: item.unit,
            salePriceCents: item.salePriceCents,
            soldMilli: soldMilli,
            availableMilli: availableMilli
          };
        }).filter(function (line) {
          return line.availableMilli > 0;
        })
      };
    }).filter(function (trip) {
      return trip.lines.length > 0;
    });
  }

  function getTripInvoices(tripId) {
    var state = storage.readState();
    if (!state.trips.some(function (trip) {
      return trip.id === tripId;
    })) {
      throw new Error("الطلعة المطلوبة غير موجودة.");
    }
    return state.invoices.filter(function (invoice) {
      return invoice.tripId === tripId;
    }).sort(function (left, right) {
      return left.date.localeCompare(right.date);
    }).map(function (invoice) {
      return presentInvoice(state, invoice);
    });
  }

  global.PepsiApp.invoiceService = {
    createInvoice: createInvoice,
    createTripInvoices: createTripInvoices,
    addPayment: addPayment,
    getInvoices: getInvoices,
    getInvoice: getInvoice,
    getInvoiceableTrips: getInvoiceableTrips,
    getTripInvoices: getTripInvoices,
    getCustomerInvoices: getCustomerInvoices,
    getCustomerPayments: getCustomerPayments,
    addCustomerPayment: addCustomerPayment,
    cancelInvoice: cancelInvoice
  };
}(window));
