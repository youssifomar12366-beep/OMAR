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

  function createId(state, prefix) {
    var id;
    var knownIds;

    do {
      idCounter += 1;
      id = prefix + "-" + Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + idCounter.toString(36);
      knownIds = state.products.some(function (product) {
        return product.id === id;
      }) || state.vehicles.some(function (vehicle) {
        return vehicle.id === id;
      }) || state.drivers.some(function (driver) {
        return driver.id === id;
      }) || state.trips.some(function (trip) {
        return trip.id === id;
      }) || state.stockMovements.some(function (movement) {
        return movement.id === id;
      }) || state.trips.some(function (trip) {
        return trip.replenishments.some(function (replenishment) {
          return replenishment.id === id;
        }) || (trip.returnRecord && trip.returnRecord.id === id);
      });
    } while (knownIds);

    return id;
  }

  function quantityToMilli(value, label, allowZero) {
    var quantity;
    var milli;

    if (value === null || typeof value === "undefined" ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error("أدخل " + label + ".");
    }

    quantity = Number(value);
    milli = Math.round(quantity * 1000);

    if (!Number.isFinite(quantity) || quantity < 0 ||
        Math.abs(quantity * 1000 - milli) > 0.000001 ||
        !Number.isSafeInteger(milli) || (!allowZero && milli === 0)) {
      throw new Error(allowZero
        ? "تحقق من " + label + "؛ أدخل كمية غير سالبة وبحد أقصى ثلاث منازل عشرية."
        : "تحقق من " + label + "؛ يجب أن تكون الكمية أكبر من صفر وبحد أقصى ثلاث منازل عشرية.");
    }

    return milli;
  }

  function moneyToCents(value, label) {
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

  function getVehicle(state, vehicleId) {
    return state.vehicles.find(function (vehicle) {
      return vehicle.id === vehicleId && vehicle.active;
    });
  }

  function invoicedQuantity(state, tripId, productId) {
    return state.invoices.reduce(function (total, invoice) {
      if (invoice.tripId !== tripId || invoice.status !== "posted") {
        return total;
      }
      return invoice.items.reduce(function (lineTotal, item) {
        return item.productId === productId
          ? lineTotal + item.quantityMilli : lineTotal;
      }, total);
    }, 0);
  }

  function requireInvoicesMatchReturnedTrip(state, trip, lines) {
    lines.forEach(function (line) {
      var returnedMilli = trip.returnRecord.items.find(function (item) {
        return item.productId === line.productId;
      }).quantityMilli;
      var soldMilli = line.outgoingMilli - returnedMilli;
      var invoicedMilli = invoicedQuantity(state, trip.id, line.productId);

      if (invoicedMilli !== soldMilli) {
        throw new Error("لا يمكن إكمال الطلعة قبل تسجيل فواتير الكمية المباعة للصنف " +
          line.name + ". المفوتر " + (invoicedMilli / 1000) +
          " والمباع بعد الراجع " + (soldMilli / 1000) + ".");
      }
    });
  }

  function getDriver(state, driverId) {
    return state.drivers.find(function (driver) {
      return driver.id === driverId && driver.active;
    });
  }

  function getProduct(state, productId) {
    return state.products.find(function (product) {
      return product.id === productId;
    });
  }

  function getStock(state, productId) {
    return state.stockMovements.reduce(function (total, movement) {
      return movement.productId === productId ? total + movement.quantityMilli : total;
    }, 0);
  }

  function tripLineTotals(trip) {
    var replenished = Object.create(null);
    var returned = Object.create(null);

    trip.replenishments.forEach(function (replenishment) {
      replenished[replenishment.productId] =
        (replenished[replenishment.productId] || 0) + replenishment.quantityMilli;
    });

    if (trip.returnRecord) {
      trip.returnRecord.items.forEach(function (item) {
        returned[item.productId] = item.quantityMilli;
      });
    }

    return trip.items.map(function (item) {
      var replenishedMilli = replenished[item.productId] || 0;
      var returnedMilli = returned[item.productId] || 0;
      var outgoingMilli = item.quantityMilli + replenishedMilli;
      var soldMilli = outgoingMilli - returnedMilli;
      var valueCents = item.salePriceCents === null
        ? null : Math.round(soldMilli * item.salePriceCents / 1000);

      return {
        productId: item.productId,
        code: item.code,
        name: item.name,
        unit: item.unit,
        salePriceCents: item.salePriceCents,
        initialMilli: item.quantityMilli,
        replenishedMilli: replenishedMilli,
        outgoingMilli: outgoingMilli,
        returnedMilli: returnedMilli,
        soldMilli: soldMilli,
        valueCents: valueCents
      };
    });
  }

  function presentTrip(trip, state) {
    var lines = tripLineTotals(trip);
    var invoicedByProduct = Object.create(null);
    var invoicedValueCents = 0;
    var invoicedSubtotalCents = 0;
    var invoiceCount = 0;
    var linkedInvoices = (state.invoices || []).filter(function (invoice) {
      return invoice.tripId === trip.id && invoice.status === "posted";
    });
    var collectedCents = 0;
    var debtCents = 0;
    var returnCashCents = trip.returnRecord
      ? trip.returnRecord.cashReturnedCents : null;
    var cashDifferenceCents = null;
    var allPricesKnown;
    var saleValueCents;
    var vehicle = state.vehicles.find(function (item) {
      return item.id === trip.vehicleId;
    });
    var driver = state.drivers.find(function (item) {
      return item.id === trip.driverId;
    });

    linkedInvoices.forEach(function (invoice) {
      invoiceCount += 1;
      invoicedValueCents += invoice.totalCents;
      invoicedSubtotalCents += invoice.subtotalCents;
      var invoicePaidCents = (state.payments || []).reduce(function (total, payment) {
        return payment.invoiceId === invoice.id ? total + payment.amountCents : total;
      }, 0);
      collectedCents += invoicePaidCents;
      debtCents += invoice.totalCents - invoicePaidCents;
      if (!Number.isSafeInteger(invoicedValueCents) ||
          !Number.isSafeInteger(invoicedSubtotalCents)) {
        throw new Error("تعذر حساب إجمالي فواتير الطلعة بدقة.");
      }
      if (!Number.isSafeInteger(collectedCents) || !Number.isSafeInteger(debtCents)) {
        throw new Error("تعذر حساب المدفوعات والديون للطلعة بدقة.");
      }
      invoice.items.forEach(function (item) {
        invoicedByProduct[item.productId] =
          (invoicedByProduct[item.productId] || 0) + item.quantityMilli;
        if (!Number.isSafeInteger(invoicedByProduct[item.productId])) {
          throw new Error("تعذر حساب الكميات المفوترة للطلعة بدقة.");
        }
      });
    });
    lines.forEach(function (line) {
      line.invoicedMilli = invoicedByProduct[line.productId] || 0;
      if (!trip.returnRecord) {
        line.soldMilli = line.invoicedMilli;
        line.uninvoicedMilli = line.outgoingMilli - line.invoicedMilli;
        line.valueCents = line.salePriceCents === null
          ? null : Math.round(line.soldMilli * line.salePriceCents / 1000);
      } else {
        line.uninvoicedMilli = line.soldMilli - line.invoicedMilli;
      }
    });
    allPricesKnown = lines.every(function (line) {
      return line.salePriceCents !== null && Number.isSafeInteger(line.valueCents);
    });
    saleValueCents = allPricesKnown
      ? lines.reduce(function (total, line) {
        return total + line.valueCents;
      }, 0)
      : null;
    if (Number.isSafeInteger(returnCashCents)) {
      cashDifferenceCents = returnCashCents - collectedCents;
    }

    return {
      id: trip.id,
      number: trip.number,
      dateTime: trip.dateTime,
      createdAt: trip.createdAt,
      vehicleId: trip.vehicleId,
      vehicleName: trip.vehicleName || (vehicle ? vehicle.name : "عربية غير معروفة"),
      driverId: trip.driverId,
      driverName: trip.driverName || (driver ? driver.name : "سائق غير معروف"),
      status: trip.status,
      salesCompletedAt: trip.salesCompletedAt || null,
      lines: lines,
      saleValueCents: Number.isSafeInteger(saleValueCents) ? saleValueCents : null,
      invoiceCount: invoiceCount,
      invoicedValueCents: invoicedValueCents,
      collectedCents: collectedCents,
      debtCents: debtCents,
      cashReturnedCents: returnCashCents,
      cashDifferenceCents: cashDifferenceCents,
      invoiceDifferenceCents: Number.isSafeInteger(saleValueCents)
        ? saleValueCents - invoicedSubtotalCents : null,
      reconciliationReview: trip.returnRecord && trip.returnRecord.reconciliationReview
        ? {
          reason: trip.returnRecord.reconciliationReview.reason,
          createdAt: trip.returnRecord.reconciliationReview.createdAt
        } : null,
      replenishments: trip.replenishments.map(function (item) {
        var line = lines.find(function (entry) {
          return entry.productId === item.productId;
        });
        return {
          id: item.id,
          productId: item.productId,
          productName: line.name,
          unit: line.unit,
          quantityMilli: item.quantityMilli,
          createdAt: item.createdAt
        };
      }),
      returnRecord: trip.returnRecord ? {
        createdAt: trip.returnRecord.createdAt
      } : null
    };
  }

  function getFleet() {
    var state = storage.readState();
    return {
      vehicles: state.vehicles.map(function (vehicle) {
        return { id: vehicle.id, name: vehicle.name, active: vehicle.active };
      }),
      drivers: state.drivers.map(function (driver) {
        return { id: driver.id, name: driver.name, active: driver.active };
      })
    };
  }

  function updateFleet(vehicleChanges, driverChanges) {
    return storage.updateState(function (state) {
      var now = new Date().toISOString();

      function applyNames(records, changes, label) {
        var seen = Object.create(null);
        var changedIds = Object.create(null);

        if (!Array.isArray(changes) || changes.length !== records.length) {
          throw new Error("يجب إدخال اسم لكل " + label + ".");
        }

        changes.forEach(function (change) {
          var member;
          var name;
          if (!change || typeof change.id !== "string") {
            throw new Error("بيانات " + label + " غير صالحة.");
          }
          member = records.find(function (record) {
            return record.id === change.id;
          });
          name = requireText(change.name, "الاسم");
          var normalized = name.toLocaleLowerCase();

          if (!member || changedIds[change.id] || seen[normalized]) {
            throw new Error("تحقق من أسماء " + label + "؛ يجب أن تكون الأسماء فريدة.");
          }
          member.name = name;
          member.updatedAt = now;
          changedIds[change.id] = true;
          seen[normalized] = true;
        });
      }

      applyNames(state.vehicles, vehicleChanges, "العربيات");
      applyNames(state.drivers, driverChanges, "السائقين");
      return state;
    });
  }

  function addFleetMember(kind, input) {
    var addedMember;
    storage.updateState(function (state) {
      var records = kind === "vehicle" ? state.vehicles :
        (kind === "driver" ? state.drivers : null);
      var label = kind === "vehicle" ? "اسم العربية" : "اسم السائق";
      var name;
      var now;
      if (!records) {
        throw new Error("نوع بيانات العربية أو السائق غير صالح.");
      }
      name = requireText(input && input.name, label);
      if (name.length > 80) {
        throw new Error("تجاوز " + label + " الحد المسموح من الأحرف.");
      }
      if (records.some(function (record) {
        return record.name.toLocaleLowerCase() === name.toLocaleLowerCase();
      })) {
        throw new Error("هذا الاسم مسجل بالفعل.");
      }
      now = new Date().toISOString();
      addedMember = {
        id: createId(state, kind),
        name: name,
        active: true,
        createdAt: now,
        updatedAt: now
      };
      records.push(addedMember);
      return state;
    });
    return addedMember;
  }

  function addVehicle(input) {
    return addFleetMember("vehicle", input);
  }

  function addDriver(input) {
    return addFleetMember("driver", input);
  }

  function createTrip(input) {
    var updatedState = storage.updateState(function (state) {
      var vehicle = getVehicle(state, input.vehicleId);
      var driver = getDriver(state, input.driverId);
      var tripDate = new Date(input.dateTime);
      var activeProducts = state.products.filter(function (product) {
        return product.active;
      });
      var requestedItems = input.items;
      var requestedByProduct = Object.create(null);
      var now = new Date().toISOString();
      var tripId;
      var tripNumber;
      var trip;
      var outgoingCount = 0;

      if (!vehicle) {
        throw new Error("اختر عربية نشطة.");
      }
      if (!driver) {
        throw new Error("اختر سائقًا نشطًا.");
      }
      if (!Number.isFinite(tripDate.getTime())) {
        throw new Error("أدخل تاريخًا ووقتًا صالحين للطلعة.");
      }
      if (activeProducts.length === 0) {
        throw new Error("أضف صنفًا نشطًا واحدًا على الأقل قبل تسجيل طلعة.");
      }
      if (!Array.isArray(requestedItems) || requestedItems.length !== activeProducts.length) {
        throw new Error("أدخل كمية لكل صنف نشط، واستخدم صفرًا صريحًا للأصناف غير المحملة.");
      }

      requestedItems.forEach(function (item) {
        if (!item || typeof item.productId !== "string" ||
            Object.prototype.hasOwnProperty.call(requestedByProduct, item.productId)) {
          throw new Error("قائمة أصناف الطلعة غير صالحة.");
        }
        requestedByProduct[item.productId] = quantityToMilli(item.quantity, "كمية الصنف", true);
      });

      activeProducts.forEach(function (product) {
        var quantityMilli;
        var availableMilli;
        if (!Object.prototype.hasOwnProperty.call(requestedByProduct, product.id)) {
          throw new Error("أدخل كمية لكل صنف نشط، واستخدم صفرًا صريحًا للأصناف غير المحملة.");
        }
        quantityMilli = requestedByProduct[product.id];
        availableMilli = getStock(state, product.id);
        if (availableMilli < quantityMilli) {
          throw new Error("المخزون غير كافٍ للصنف " + product.name + "؛ المتاح " +
            (availableMilli / 1000) + " " + product.unit + ".");
        }
        if (quantityMilli > 0) {
          outgoingCount += 1;
        }
      });

      if (outgoingCount === 0) {
        throw new Error("أدخل كمية أكبر من صفر لصنف واحد على الأقل لتسجيل الطلعة.");
      }

      tripId = createId(state, "trip");
      tripNumber = "TR-" + tripId.slice(5).toUpperCase();
      trip = {
        id: tripId,
        number: tripNumber,
        dateTime: tripDate.toISOString(),
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        driverId: driver.id,
        driverName: driver.name,
        status: "open",
        createdAt: now,
        items: activeProducts.map(function (product) {
          return {
            productId: product.id,
            code: product.code,
            name: product.name,
            unit: product.unit,
            salePriceCents: product.salePriceCents,
            quantityMilli: requestedByProduct[product.id]
          };
        }),
        replenishments: [],
        returnRecord: null
      };

      state.trips.push(trip);
      trip.items.forEach(function (item) {
        if (item.quantityMilli > 0) {
          state.stockMovements.push({
            id: createId(state, "move"),
            productId: item.productId,
            type: "trip_issue",
            quantityMilli: -item.quantityMilli,
            reference: trip.number,
            sourceId: trip.id,
            createdAt: now
          });
        }
      });
      return state;
    });

    return presentTrip(updatedState.trips[updatedState.trips.length - 1], updatedState);
  }

  function addReplenishment(tripId, input) {
    var updatedState = storage.updateState(function (state) {
      var trip = state.trips.find(function (candidate) {
        return candidate.id === tripId;
      });
      var product;
      var quantityMilli;
      var requestId = requireText(input.requestId, "رقم العملية");
      var duplicate;

      if (!trip) {
        throw new Error("الطلعة المطلوبة غير موجودة.");
      }
      quantityMilli = quantityToMilli(input.quantity, "كمية التزويد", false);
      duplicate = state.trips.reduce(function (found, candidate) {
        return found || candidate.replenishments.find(function (entry) {
          return entry.requestId === requestId;
        });
      }, null);

      if (duplicate) {
        if (duplicate.productId !== input.productId || duplicate.quantityMilli !== quantityMilli ||
            !trip.replenishments.some(function (entry) {
              return entry.requestId === requestId;
            })) {
          throw new Error("رقم عملية التزويد مستخدم لعملية أخرى.");
        }
        return state;
      }
      if (trip.status !== "open") {
        throw new Error("لا يمكن إضافة تزويدة بعد تسجيل راجع الطلعة.");
      }
      if (trip.salesCompletedAt) {
        throw new Error("لا يمكن إضافة تزويدة بعد اعتماد اكتمال مبيعات الطلعة.");
      }
      if (trip.returnRecord) {
        throw new Error("لا يمكن إضافة تزويدة بعد تسجيل راجع الطلعة.");
      }
      product = getProduct(state, input.productId);
      if (!product || !trip.items.some(function (item) {
        return item.productId === product.id;
      })) {
        throw new Error("اختر صنفًا مرتبطًا بهذه الطلعة.");
      }
      if (getStock(state, product.id) < quantityMilli) {
        throw new Error("المخزون غير كافٍ للصنف " + product.name + ".");
      }

      trip.replenishments.push({
        id: createId(state, "replenishment"),
        requestId: requestId,
        productId: product.id,
        quantityMilli: quantityMilli,
        createdAt: new Date().toISOString()
      });
      state.stockMovements.push({
        id: createId(state, "move"),
        productId: product.id,
        type: "trip_replenishment",
        quantityMilli: -quantityMilli,
        reference: trip.number,
        sourceId: trip.id,
        createdAt: new Date().toISOString()
      });
      return state;
    });

    return presentTrip(updatedState.trips.find(function (trip) {
      return trip.id === tripId;
    }), updatedState);
  }

  function recordReturn(tripId, requestedItems, cashReturned) {
    var updatedState = storage.updateState(function (state) {
      var trip = state.trips.find(function (candidate) {
        return candidate.id === tripId;
      });
      var lines;
      var requestedByProduct = Object.create(null);
      var now = new Date().toISOString();
      var cashReturnedCents;
      var invoicesMatchReturn;

      if (!trip) {
        throw new Error("الطلعة المطلوبة غير موجودة.");
      }
      if (trip.returnRecord) {
        throw new Error("تم تسجيل راجع هذه الطلعة بالفعل.");
      }
      cashReturnedCents = moneyToCents(cashReturned, "إجمالي النقدية العائدة مع السائق");
      if (!Array.isArray(requestedItems)) {
        throw new Error("بيانات الراجع غير صالحة.");
      }

      lines = tripLineTotals(trip);
      requestedItems.forEach(function (item) {
        if (!item || typeof item.productId !== "string" ||
            Object.prototype.hasOwnProperty.call(requestedByProduct, item.productId)) {
          throw new Error("قائمة الراجع غير صالحة.");
        }
        requestedByProduct[item.productId] = quantityToMilli(item.quantity, "الكمية الراجعة", true);
      });
      if (requestedItems.length !== lines.length) {
        throw new Error("أدخل كمية راجعة لكل صنف، واستخدم صفرًا صريحًا عند عدم وجود راجع.");
      }

      lines.forEach(function (line) {
        var returnedMilli;
        var invoicedMilli = invoicedQuantity(state, trip.id, line.productId);
        if (!Object.prototype.hasOwnProperty.call(requestedByProduct, line.productId)) {
          throw new Error("أدخل كمية راجعة لكل صنف، واستخدم صفرًا صريحًا عند عدم وجود راجع.");
        }
        returnedMilli = requestedByProduct[line.productId];
        if (returnedMilli > line.outgoingMilli) {
          throw new Error("الكمية الراجعة للصنف " + line.name + " تتجاوز الكمية الخارجة مع العربية.");
        }
        if (invoicedMilli > line.outgoingMilli - returnedMilli) {
          throw new Error("الكمية الراجعة للصنف " + line.name +
            " لا تترك كمية كافية للفواتير المحفوظة لهذه الطلعة.");
        }
        if (trip.salesCompletedAt && line.outgoingMilli - returnedMilli !== invoicedMilli) {
          throw new Error("كمية الراجع للصنف " + line.name +
            " يجب أن تكمل الكمية الخارجة بعد خصم الكمية المسجلة في فواتير هذه الطلعة.");
        }
      });

      trip.returnRecord = {
        id: createId(state, "return"),
        createdAt: now,
        cashReturnedCents: cashReturnedCents,
        reconciliationReview: null,
        items: lines.map(function (line) {
          return {
            productId: line.productId,
            quantityMilli: requestedByProduct[line.productId]
          };
        })
      };
      invoicesMatchReturn = lines.every(function (line) {
        return invoicedQuantity(state, trip.id, line.productId) ===
          line.outgoingMilli - requestedByProduct[line.productId];
      });
      if (trip.salesCompletedAt || invoicesMatchReturn) {
        requireInvoicesMatchReturnedTrip(state, trip, lines);
        trip.salesCompletedAt = trip.salesCompletedAt || now;
        trip.status = "returned";
      }
      trip.returnRecord.items.forEach(function (item) {
        if (item.quantityMilli > 0) {
          state.stockMovements.push({
            id: createId(state, "move"),
            productId: item.productId,
            type: "trip_return",
            quantityMilli: item.quantityMilli,
            reference: trip.number,
            sourceId: trip.id,
            createdAt: now
          });
        }
      });
      return state;
    });

    return presentTrip(updatedState.trips.find(function (trip) {
      return trip.id === tripId;
    }), updatedState);
  }

  function completeTripSales(tripId) {
    var updatedState = storage.updateState(function (state) {
      var trip = state.trips.find(function (candidate) {
        return candidate.id === tripId;
      });
      if (!trip) {
        throw new Error("الطلعة المطلوبة غير موجودة.");
      }
      if (trip.status === "returned") {
        return state;
      }
      if (trip.status !== "open") {
        throw new Error("لا يمكن اعتماد مبيعات طلعة غير مفتوحة.");
      }
      if (trip.returnRecord) {
        requireInvoicesMatchReturnedTrip(state, trip, tripLineTotals(trip));
      }
      trip.salesCompletedAt = trip.salesCompletedAt || new Date().toISOString();
      if (trip.returnRecord) {
        trip.status = "returned";
      }
      return state;
    });
    return presentTrip(updatedState.trips.find(function (trip) {
      return trip.id === tripId;
    }), updatedState);
  }

  function recordReconciliationReview(tripId, reason) {
    var text = typeof reason === "string" ? reason.trim() : "";
    if (!text || text.length > 500) {
      throw new Error("أدخل سبب المراجعة بحد أقصى 500 حرف.");
    }
    var updatedState = storage.updateState(function (state) {
      var trip = state.trips.find(function (candidate) {
        return candidate.id === tripId;
      });
      if (!trip || !trip.returnRecord) {
        throw new Error("سجّل راجع الطلعة قبل توثيق مراجعة الفروقات.");
      }
      trip.returnRecord.reconciliationReview = {
        reason: text,
        createdAt: new Date().toISOString()
      };
      return state;
    });
    return presentTrip(updatedState.trips.find(function (trip) {
      return trip.id === tripId;
    }), updatedState);
  }

  function getTrips() {
    var state = storage.readState();
    return state.trips.slice().sort(function (left, right) {
      return right.dateTime.localeCompare(left.dateTime);
    }).map(function (trip) {
      return presentTrip(trip, state);
    });
  }

  function getTrip(tripId) {
    var state = storage.readState();
    var trip = state.trips.find(function (candidate) {
      return candidate.id === tripId;
    });

    if (!trip) {
      throw new Error("الطلعة المطلوبة غير موجودة.");
    }
    return presentTrip(trip, state);
  }

  global.PepsiApp.tripService = {
    getFleet: getFleet,
    updateFleet: updateFleet,
    addVehicle: addVehicle,
    addDriver: addDriver,
    createTrip: createTrip,
    addReplenishment: addReplenishment,
    completeTripSales: completeTripSales,
    recordReturn: recordReturn,
    recordReconciliationReview: recordReconciliationReview,
    getTrips: getTrips,
    getTrip: getTrip
  };
}(window));
