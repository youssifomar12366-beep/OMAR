(function (global) {
  "use strict";

  var tripService = global.PepsiApp.tripService;
  var inventoryService = global.PepsiApp.inventoryService;
  var invoiceService = global.PepsiApp.invoiceService;
  var customerService = global.PepsiApp.customerService;
  var invoiceRequestCounter = 0;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function formatQuantity(milli) {
    return (milli / 1000).toLocaleString("ar-EG", {
      maximumFractionDigits: 3
    });
  }

  function formatMoney(cents) {
    if (cents === null || typeof cents === "undefined") {
      return "—";
    }
    return (cents / 100).toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatDate(value) {
    return new Date(value).toLocaleString("ar-EG");
  }

  function localDateTimeValue() {
    var date = new Date();
    var localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localTime.toISOString().slice(0, 16);
  }

  function localDateTimeValue() {
    var date = new Date();
    var localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localTime.toISOString().slice(0, 16);
  }

  function createRequestId() {
    return "request-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFF).toString(36);
  }

  function createInvoiceRequestId() {
    invoiceRequestCounter += 1;
    return "trip-invoice-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" +
      invoiceRequestCounter.toString(36);
  }

  function tripRows(trips) {
    if (trips.length === 0) {
      return '<tr><td class="table-empty" colspan="7">لا توجد طلعات مسجلة بعد.</td></tr>';
    }

    return trips.map(function (trip) {
      var statusText = trip.status === "returned" ? "تم تسجيل الراجع" : "على الطريق";
      var statusClass = trip.status === "returned" ? "trip-status--returned" : "trip-status--open";
      return '<tr>' +
        '<td><strong>' + escapeHtml(trip.number) + '</strong></td>' +
        '<td>' + escapeHtml(formatDate(trip.dateTime)) + '</td>' +
        '<td>' + escapeHtml(trip.vehicleName) + '</td>' +
        '<td>' + escapeHtml(trip.driverName) + '</td>' +
        '<td>' + trip.lines.length.toLocaleString("ar-EG") + '</td>' +
        '<td><span class="trip-status ' + statusClass + '">' + statusText + '</span></td>' +
        '<td class="table-actions">' +
          '<button class="text-button" type="button" data-action="details" data-id="' + escapeHtml(trip.id) + '">التفاصيل</button>' +
          (trip.status === "open"
            ? '<button class="text-button" type="button" data-action="replenish" data-id="' + escapeHtml(trip.id) + '">تزويد تحميلة</button>' +
              '<button class="text-button" type="button" data-action="return" data-id="' + escapeHtml(trip.id) + '">' +
                (trip.returnRecord ? "متابعة إكمال الطلعة" : "تسجيل الراجع") + '</button>'
            : "") +
        '</td>' +
      '</tr>';
    }).join("");
  }

  function createPanelMarkup() {
    return '<section class="trip-panel trip-form-panel" id="trip-create-panel" hidden>' +
      '<div class="panel-heading"><div><h3>تسجيل طلعة جديدة</h3>' +
        '<p class="panel-hint">يُخصم التحميل المعتمد من المخزون مرة واحدة، وتُحفظ كل طلعة مستقلة.</p></div>' +
        '<button class="button button--quiet" type="button" data-action="cancel-create">إلغاء</button></div>' +
      '<div id="trip-create-host"></div>' +
    '</section>';
  }

  function renderCreateForm(container) {
    var fleet = tripService.getFleet();
    var products = inventoryService.getProducts().filter(function (product) {
      return product.active;
    });
    var host = container.querySelector("#trip-create-host");
    var vehicleCards = fleet.vehicles.filter(function (vehicle) {
      return vehicle.active;
    }).map(function (vehicle) {
      return '<button class="vehicle-card" type="button" data-action="choose-vehicle" data-id="' +
        escapeHtml(vehicle.id) + '" aria-pressed="false"><span class="vehicle-card__mark" aria-hidden="true">ع</span>' +
        '<strong>' + escapeHtml(vehicle.name) + '</strong><small>اختيار العربية</small></button>';
    }).join("");
    var itemRows = products.map(function (product) {
      return '<tr><td><strong>' + escapeHtml(product.code) + '</strong></td>' +
        '<td>' + escapeHtml(product.name) + '</td><td>' + escapeHtml(product.unit) + '</td>' +
        '<td>' + formatQuantity(product.stockQuantityMilli) + '</td><td>' +
        '<input class="quantity-input" name="quantity-' + escapeHtml(product.id) +
        '" data-load-quantity data-product-id="' + escapeHtml(product.id) +
        '" data-product-name="' + escapeHtml(product.name) + '" data-unit="' + escapeHtml(product.unit) +
        '" type="number" min="0" step="0.001" inputmode="decimal" required aria-label="الكمية المسحوبة من ' +
        escapeHtml(product.name) + '"></td></tr>';
    }).join("");

    host.innerHTML =
      '<form id="trip-create-form" data-form="create-trip">' +
        '<input type="hidden" name="vehicleId" value="">' +
        '<div class="trip-form-block"><h4>١. اختر العربية</h4>' +
          '<div class="vehicle-grid">' + (vehicleCards || '<p class="panel-hint">لا توجد عربيات نشطة.</p>') + '</div></div>' +
        '<div class="trip-form-grid">' +
          '<div class="trip-form-block driver-block" id="driver-block" hidden>' +
            '<label>٢. اختر السائق<select name="driverId" required disabled><option value="">اختر السائق</option>' +
              fleet.drivers.filter(function (driver) {
                return driver.active;
              }).map(function (driver) {
                return '<option value="' + escapeHtml(driver.id) + '">' + escapeHtml(driver.name) + '</option>';
              }).join("") +
            '</select></label>' +
          '</div>' +
          '<label class="trip-date-field">تاريخ ووقت الطلعة<input name="dateTime" type="datetime-local" value="' +
            escapeHtml(localDateTimeValue()) + '" required></label>' +
        '</div>' +
        '<div class="trip-form-block"><h4>٣. الكميات المسحوبة</h4>' +
          '<p class="panel-hint">أدخل قيمة لكل صنف؛ أدخل ٠ صراحةً للصنف غير المحمّل. الخانة الفارغة ليست صفرًا.</p>' +
          (products.length === 0
            ? '<p class="trip-inline-warning">أضف أصنافًا نشطة قبل تسجيل الطلعة.</p>'
            : '<div class="table-wrap"><table class="inventory-table"><thead><tr><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>المتاح الآن</th><th>المسحوب</th></tr></thead><tbody>' +
              itemRows + '</tbody></table></div>') +
        '</div>' +
        '<div class="trip-summary" id="trip-load-summary" aria-live="polite">أدخل الكميات لمراجعة ملخص التحميلة.</div>' +
        '<div class="form-actions">' +
          '<button class="button button--primary" type="submit"' + (products.length === 0 ? " disabled" : "") + '>مراجعة وحفظ الطلعة</button>' +
          '<button class="button button--quiet" type="button" data-action="cancel-create">إلغاء</button>' +
        '</div>' +
      '</form>';
  }

  function fleetFormMarkup(fleet) {
    function fields(members, type, label) {
      return members.map(function (member) {
        return '<label>' + label + '<input data-fleet-member data-kind="' + type +
          '" data-id="' + escapeHtml(member.id) + '" value="' + escapeHtml(member.name) +
          '" maxlength="80" required></label>';
      }).join("");
    }

    return '<form id="fleet-form" data-form="fleet">' +
      '<div class="trip-form-block"><h4>العربيات</h4><div class="fleet-grid">' +
        fields(fleet.vehicles, "vehicle", "اسم العربية") + '</div>' +
        '<button class="button button--quiet" type="button" data-action="add-vehicle">إضافة عربية جديدة</button></div>' +
      '<div class="trip-form-block"><h4>السائقون</h4><div class="fleet-grid">' +
        fields(fleet.drivers, "driver", "اسم السائق") + '</div>' +
        '<button class="button button--quiet" type="button" data-action="add-driver">إضافة سائق جديد</button></div>' +
      '<div class="form-actions"><button class="button button--primary" type="submit">حفظ الأسماء</button>' +
        '<button class="button button--quiet" type="button" data-action="cancel-fleet">إلغاء</button></div>' +
    '</form>' +
    '<form data-form="add-fleet-member" data-kind="vehicle" id="add-vehicle-form" hidden>' +
      '<label>اسم العربية<input name="name" maxlength="80" required></label>' +
      '<div class="form-actions"><button class="button button--primary" type="submit">حفظ العربية</button>' +
        '<button class="button button--quiet" type="button" data-action="cancel-add-fleet-member">إلغاء</button></div>' +
    '</form>' +
    '<form data-form="add-fleet-member" data-kind="driver" id="add-driver-form" hidden>' +
      '<label>اسم السائق<input name="name" maxlength="80" required></label>' +
      '<div class="form-actions"><button class="button button--primary" type="submit">حفظ السائق</button>' +
        '<button class="button button--quiet" type="button" data-action="cancel-add-fleet-member">إلغاء</button></div>' +
    '</form>';
  }

  function render(container) {
    var fleet;
    var trips;
    container.setAttribute("data-module", "trips");

    try {
      fleet = tripService.getFleet();
      trips = tripService.getTrips();
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل الطلعات</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.innerHTML =
      '<section class="trip-heading">' +
        '<div><p class="inventory-eyebrow">التوزيع اليومي</p><h2>الطلعات</h2>' +
          '<p class="inventory-description">كل طلعة لها رقم وسجل مستقل؛ يمكن للعربية تنفيذ عدة طلعات في اليوم.</p></div>' +
        '<div class="trip-heading__actions">' +
          '<button class="button button--quiet" type="button" data-action="edit-fleet">إدارة العربيات والسائقين</button>' +
          '<button class="button button--primary" type="button" data-action="new-trip">تسجيل طلعة</button>' +
        '</div>' +
      '</section>' +
      '<div class="notice" id="trip-notice" role="status" aria-live="polite" hidden></div>' +
      '<section class="trip-panel trip-form-panel" id="fleet-panel" hidden>' +
        '<div class="panel-heading"><div><h3>العربيات والسائقون</h3>' +
          '<p class="panel-hint">تغيير الأسماء لا يغير معرّفاتهم ولا سجلات الطلعات السابقة.</p></div></div>' +
        '<div id="fleet-host">' + fleetFormMarkup(fleet) + '</div>' +
      '</section>' +
      createPanelMarkup() +
      '<section class="trip-panel">' +
        '<div class="inventory-toolbar"><div><h3>سجل الطلعات</h3>' +
          '<p class="panel-hint">عدد الطلعات المسجلة: <strong>' + trips.length.toLocaleString("ar-EG") + '</strong></p></div>' +
          '<label class="search-field">بحث<input id="trip-search" type="search" placeholder="رقم الطلعة أو العربية أو السائق" autocomplete="off"></label>' +
        '</div>' +
        '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
          '<th>رقم الطلعة</th><th>التاريخ والوقت</th><th>العربية</th><th>السائق</th><th>عدد الأصناف</th><th>الحالة</th><th>الإجراءات</th>' +
        '</tr></thead><tbody id="trip-rows">' + tripRows(trips) + '</tbody></table></div>' +
      '</section>' +
      '<section class="trip-panel trip-details-panel" id="trip-action-panel" hidden></section>';

    bindEvents(container);
  }

  function showNotice(container, message, type) {
    var notice = container.querySelector("#trip-notice");
    if (!notice) {
      return;
    }
    notice.hidden = false;
    notice.className = "notice notice--" + type;
    notice.textContent = message;
  }

  function updateCreateSummary(form) {
    var inputs = Array.prototype.slice.call(form.querySelectorAll("[data-load-quantity]"));
    var entered = inputs.filter(function (input) {
      return input.value !== "";
    });
    var loaded = entered.filter(function (input) {
      return Number(input.value) > 0;
    }).length;
    var empty = inputs.length - entered.length;
    var summary = form.querySelector("#trip-load-summary");
    var lines = entered.map(function (input) {
      return '<li>' + escapeHtml(input.getAttribute("data-product-name")) + ': ' +
        formatQuantity(Math.round(Number(input.value) * 1000)) + ' ' +
        escapeHtml(input.getAttribute("data-unit")) + '</li>';
    });

    summary.innerHTML =
      '<strong>ملخص التحميلة</strong><p>أصناف بكميات أكبر من صفر: ' +
        loaded.toLocaleString("ar-EG") + '؛ خانات غير مكتملة: ' + empty.toLocaleString("ar-EG") + '.</p>' +
      (lines.length ? '<ul>' + lines.join("") + '</ul>' : '<p>لم تُدخل أي كميات بعد.</p>');
  }

  function showTripDetails(container, tripId) {
    var trip = tripService.getTrip(tripId);
    var invoices = invoiceService.getTripInvoices(tripId);
    var customerPayments = invoices.reduce(function (total, invoice) {
      return total + invoice.paidCents;
    }, 0);
    var needsReview = trip.invoiceDifferenceCents !== null && trip.invoiceDifferenceCents !== 0 ||
      trip.cashDifferenceCents !== null && trip.cashDifferenceCents !== 0;
    var panel = container.querySelector("#trip-action-panel");

    panel.hidden = false;
    panel.innerHTML =
      '<div class="panel-heading"><div><h3>تفاصيل الطلعة ' + escapeHtml(trip.number) + '</h3>' +
        '<p class="panel-hint">' + escapeHtml(trip.vehicleName) + ' - ' + escapeHtml(trip.driverName) +
        ' - ' + escapeHtml(formatDate(trip.dateTime)) + '</p></div>' +
        '<button class="button button--quiet" type="button" data-action="close-trip-panel">إغلاق</button></div>' +
      '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
        '<th>الصنف</th><th>الوحدة</th><th>المسحوب الأساسي</th><th>التزويدات</th><th>الخارج</th><th>الراجع</th><th>المباع</th><th>المفوتر</th><th>غير المفوتر</th><th>قيمة المباع</th>' +
      '</tr></thead><tbody>' +
        trip.lines.map(function (line) {
          return '<tr><td>' + escapeHtml(line.name) + '</td><td>' + escapeHtml(line.unit) + '</td>' +
            '<td>' + formatQuantity(line.initialMilli) + '</td><td>' + formatQuantity(line.replenishedMilli) + '</td>' +
            '<td>' + formatQuantity(line.outgoingMilli) + '</td><td>' + formatQuantity(line.returnedMilli) + '</td>' +
            '<td><strong>' + formatQuantity(line.soldMilli) + '</strong></td>' +
            '<td>' + formatQuantity(line.invoicedMilli || 0) + '</td>' +
            '<td>' + formatQuantity(line.uninvoicedMilli === undefined ? line.soldMilli : line.uninvoicedMilli) + '</td>' +
            '<td>' + formatMoney(line.valueCents) + '</td></tr>';
        }).join("") +
      '</tbody></table></div>' +
      '<p class="trip-value-note">إجمالي قيمة المباع عند توافر أسعار البيع: <strong>' +
        formatMoney(trip.saleValueCents) + '</strong></p>' +
      '<p class="trip-value-note">إجمالي فواتير الطلعة: <strong>' +
        formatMoney(trip.invoicedValueCents || 0) + '</strong>؛ قيمة المباع غير المفوترة: <strong>' +
        formatMoney(trip.invoiceDifferenceCents) + '</strong>. هذه ليست عجزًا تلقائيًا.</p>' +
      (trip.returnRecord
        ? '<div class="trip-summary"><strong>ملخص تصفية الطلعة</strong>' +
          '<p>إجمالي قيمة المباع: ' + formatMoney(trip.saleValueCents) + '</p>' +
          '<p>فواتير العملاء المرتبطة: ' + formatMoney(trip.invoicedValueCents) + '</p>' +
          '<p>ما دفعه العملاء على الفواتير: ' + formatMoney(customerPayments) + '</p>' +
          '<p>الديون الجديدة: ' + formatMoney(trip.debtCents) + '</p>' +
          '<p>النقدية العائدة مع السائق: ' +
            (trip.cashReturnedCents === null ? "غير مسجلة في البيانات القديمة" : formatMoney(trip.cashReturnedCents)) + '</p>' +
          '<p>فرق النقدية عن دفعات العملاء: ' +
            (trip.cashDifferenceCents === null ? "غير محسوب" : formatMoney(trip.cashDifferenceCents)) +
            ' (الزيادة أو النقص تحتاج إلى مراجعة، ولا تُضاف تلقائيًا للإيرادات).</p>' +
          (trip.reconciliationReview
            ? '<p>سبب المراجعة المسجل: ' + escapeHtml(trip.reconciliationReview.reason) + '</p>'
            : (needsReview
              ? '<form data-form="trip-reconciliation" data-trip-id="' + escapeHtml(trip.id) + '">' +
              '<label>سبب مراجعة فرق النقدية أو المبيعات<textarea name="reason" maxlength="500" rows="2" required></textarea></label>' +
              '<button class="button button--quiet" type="submit">تسجيل سبب المراجعة</button></form>'
              : '<p class="panel-hint">لا توجد فروقات نقدية أو فواتير غير مطابقة حاليًا.</p>')) +
        '</div>' : "") +
      '<div><h4 class="customer-ledger-title">مبيعات العملاء</h4>' +
        (invoices.length === 0
          ? '<p class="panel-hint">لم تُسجل فواتير عملاء لهذه الطلعة بعد.</p>'
          : '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
            '<th>الفاتورة</th><th>العميل</th><th>قيمة الفاتورة</th><th>المدفوع</th><th>من الرصيد الدائن</th><th>المتبقي</th><th>الحالة</th>' +
            '</tr></thead><tbody>' + invoices.map(function (invoice) {
              var status = invoice.status === "cancelled" ? "ملغاة" :
                (invoice.balanceCents === 0 ? "مدفوعة" :
                  (invoice.paidCents > 0 ? "مدفوعة جزئيًا" : "آجلة"));
              return '<tr><td>' + escapeHtml(invoice.number) + '</td><td>' +
                escapeHtml(invoice.customerName) + '</td><td>' + formatMoney(invoice.totalCents) +
                '</td><td>' + formatMoney(invoice.paidCents) + '</td><td>' +
                formatMoney(invoice.creditAppliedCents) + '</td><td>' +
                formatMoney(invoice.balanceCents) + '</td><td>' + status + '</td></tr>';
            }).join("") + '</tbody></table></div>') +
        (trip.status === "open"
          ? (trip.salesCompletedAt
            ? '<p class="panel-hint">تم اعتماد اكتمال تسجيل المبيعات لهذه الطلعة.</p>'
            : '<p class="panel-hint">' + (trip.returnRecord
              ? "سُجل الراجع والنقدية. عند حفظ فواتير الكميات المباعة كاملة ستُعتمد الطلعة وتُغلق تلقائيًا."
              : "سجّل فواتير العملاء والراجع. ستُعتمد الطلعة وتُغلق تلقائيًا بعد حفظ الراجع واكتمال فواتير الكميات المباعة.") + '</p>')
          : '<p class="panel-hint">دفعات العملاء مسجلة على فواتيرهم، والنقدية العائدة مع السائق مسجلة بشكل مستقل.</p>') +
        (!trip.salesCompletedAt
          ? '<button class="button button--primary" type="button" data-action="trip-customer-sales" data-id="' +
            escapeHtml(trip.id) + '">تسجيل مبيعات العملاء</button>'
          : "") + '</div>' +
      (trip.replenishments.length === 0 ? "" :
        '<div class="replenishment-list"><h4>سجل التزويدات</h4><ul>' +
          trip.replenishments.map(function (item) {
            return '<li>' + escapeHtml(item.productName) + ': ' +
              formatQuantity(item.quantityMilli) + ' ' + escapeHtml(item.unit) +
              ' - ' + escapeHtml(formatDate(item.createdAt)) + '</li>';
          }).join("") +
        '</ul></div>') +
      (trip.returnRecord
        ? '<p class="panel-hint">تم تسجيل الراجع بتاريخ ' + escapeHtml(formatDate(trip.returnRecord.createdAt)) + '.</p>'
        : "");
  }

  function showReplenishmentForm(container, tripId) {
    var trip = tripService.getTrip(tripId);
    var products = inventoryService.getProducts();
    var panel = container.querySelector("#trip-action-panel");

    panel.hidden = false;
    panel.innerHTML =
      '<div class="panel-heading"><div><h3>تزويد تحميلة ' + escapeHtml(trip.number) + '</h3>' +
        '<p class="panel-hint">تُسجل كل تزويدة كحركة صرف مستقلة مرتبطة بالطلعة.</p></div>' +
        '<button class="button button--quiet" type="button" data-action="close-trip-panel">إغلاق</button></div>' +
      '<form data-form="replenishment"><input type="hidden" name="tripId" value="' + escapeHtml(trip.id) + '">' +
        '<input type="hidden" name="requestId" value="' + escapeHtml(createRequestId()) + '">' +
        '<div class="trip-form-grid">' +
          '<label>الصنف<select name="productId" required><option value="">اختر الصنف</option>' +
            trip.lines.map(function (line) {
              var product = products.find(function (item) {
                return item.id === line.productId;
              });
              return '<option value="' + escapeHtml(line.productId) + '">' +
                escapeHtml(line.name) + ' (المتاح ' +
                formatQuantity(product ? product.stockQuantityMilli : 0) + ' ' +
                escapeHtml(line.unit) + ')</option>';
            }).join("") +
          '</select></label>' +
          '<label>كمية التزويد<input name="quantity" type="number" min="0.001" step="0.001" inputmode="decimal" required></label>' +
        '</div>' +
        '<div class="form-actions"><button class="button button--primary" type="submit">حفظ التزويدة</button>' +
          '<button class="button button--quiet" type="button" data-action="close-trip-panel">إلغاء</button></div>' +
      '</form>';
  }

  function showReturnForm(container, tripId) {
    var trip = tripService.getTrip(tripId);
    var panel = container.querySelector("#trip-action-panel");

    if (trip.returnRecord) {
      showTripDetails(container, tripId);
      return;
    }

    panel.hidden = false;
    panel.innerHTML =
      '<div class="panel-heading"><div><h3>تسجيل راجع ' + escapeHtml(trip.number) + '</h3>' +
        '<p class="panel-hint">أدخل كمية لكل صنف، واستخدم صفرًا صريحًا عند عدم وجود راجع.</p></div>' +
        '<button class="button button--quiet" type="button" data-action="close-trip-panel">إغلاق</button></div>' +
      '<form data-form="return"><input type="hidden" name="tripId" value="' + escapeHtml(trip.id) + '">' +
        '<div class="table-wrap"><table class="inventory-table"><thead><tr><th>الصنف</th><th>المسحوب الأساسي</th><th>التزويدات</th><th>إجمالي الخارج</th><th>الراجع</th><th>المباع</th><th>سعر البيع المعتمد</th><th>قيمة المباع</th></tr></thead><tbody>' +
          trip.lines.map(function (line) {
            return '<tr><td>' + escapeHtml(line.name) + ' (' + escapeHtml(line.unit) + ')</td>' +
              '<td>' + formatQuantity(line.initialMilli) + '</td>' +
              '<td>' + formatQuantity(line.replenishedMilli) + '</td>' +
              '<td>' + formatQuantity(line.outgoingMilli) + '</td><td>' +
              '<input class="quantity-input" name="return-' + escapeHtml(line.productId) +
              '" data-return-quantity data-product-id="' + escapeHtml(line.productId) +
              '" type="number" min="0" max="' + (line.outgoingMilli / 1000) +
              '" step="0.001" inputmode="decimal" value="' +
              ((line.outgoingMilli - line.invoicedMilli) / 1000) +
              '" required aria-label="الراجع من ' + escapeHtml(line.name) + '">' +
              '</td><td data-return-sold>' + formatQuantity(line.outgoingMilli) + '</td>' +
              '<td>' + formatMoney(line.salePriceCents) + '</td><td data-return-value>' +
              formatMoney(line.salePriceCents === null ? null :
                Math.round(line.outgoingMilli * line.salePriceCents / 1000)) + '</td></tr>';
          }).join("") +
        '</tbody></table></div>' +
        '<p class="trip-value-note">إجمالي قيمة المباع حسب الأسعار المعتمدة: <strong data-return-value-total>' +
          (trip.saleValueCents === null ? "—" : formatMoney(trip.saleValueCents)) + '</strong></p>' +
        '<div class="trip-form-grid"><label>إجمالي النقدية التي عاد بها السائق<input name="cashReturned" type="number" min="0" step="0.01" inputmode="decimal" required></label></div>' +
        '<p class="panel-hint">قيمة المباع تقدير حسب سعر البيع، والنقدية العائدة مبلغ فعلي مستقل. لا يُسجل فرق النقدية إيرادًا تلقائيًا.</p>' +
        '<div class="form-actions"><button class="button button--primary" type="submit">تسجيل الراجع</button>' +
          '<button class="button button--quiet" type="button" data-action="close-trip-panel">إلغاء</button></div>' +
      '</form>';
    updateReturnPreview(panel.querySelector('[data-form="return"]'));
  }

  function updateReturnPreview(form) {
    var totalCents = 0;
    var allPricesKnown = true;
    form.querySelectorAll("[data-return-quantity]").forEach(function (input) {
      var quantityMilli = Math.round(Number(input.value || 0) * 1000);
      var row = input.closest("tr");
      var trip = tripService.getTrip(form.elements.tripId.value);
      var line = trip.lines.find(function (item) {
        return item.productId === input.getAttribute("data-product-id");
      });
      var soldMilli = line.outgoingMilli - quantityMilli;
      row.querySelector("[data-return-sold]").textContent = formatQuantity(soldMilli);
      if (line.salePriceCents === null) {
        allPricesKnown = false;
        row.querySelector("[data-return-value]").textContent = "—";
      } else {
        var valueCents = Math.round(soldMilli * line.salePriceCents / 1000);
        totalCents += valueCents;
        row.querySelector("[data-return-value]").textContent = formatMoney(valueCents);
      }
    });
    var notice = form.querySelector("[data-return-value-total]");
    if (notice) {
      notice.textContent = allPricesKnown ? formatMoney(totalCents) : "غير متاح؛ يوجد صنف بلا سعر معتمد";
    }
  }

  function salesColumnHeader(invoice, customers, columnId) {
    if (invoice) {
      return '<th data-sales-column="' + escapeHtml(columnId) + '">' +
        '<strong>' + escapeHtml(invoice.customerName) + '</strong><br><span>' +
        escapeHtml(invoice.number + (invoice.status === "cancelled" ? " · ملغاة" : "")) +
        '</span></th>';
    }
    return '<th data-sales-column="' + escapeHtml(columnId) + '">' +
      '<select data-sales-customer aria-label="اختار العميل"><option value="">اختار العميل</option>' +
      customers.map(function (customer) {
        return '<option value="' + escapeHtml(customer.id) + '">' +
          escapeHtml(customer.code + " - " + customer.name) + '</option>';
      }).join("") + '</select></th>';
  }

  function salesProductCell(line, invoice, columnId) {
    var savedItem;
    if (invoice) {
      savedItem = invoice.items.find(function (item) {
        return item.productId === line.productId;
      });
      return '<td data-sales-value="' + escapeHtml(columnId) + '">' +
        formatQuantity(savedItem ? savedItem.quantityMilli : 0) + '</td>';
    }
    return '<td data-sales-value="' + escapeHtml(columnId) + '">' +
      (line.salePriceCents === null
        ? "—"
        : '<input class="quantity-input" data-sales-quantity data-product-id="' +
          escapeHtml(line.productId) + '" data-sales-column="' + escapeHtml(columnId) +
          '" type="number" min="0" step="1" inputmode="numeric" max="' +
          (line.outgoingMilli / 1000) + '" value="0"' +
          (line.outgoingMilli <= 0 ? " disabled" : "") +
          ' aria-label="' + escapeHtml("كمية " + line.name + " للعميل") + '">') +
      '</td>';
  }

  function salesSummaryCell(invoice, columnId, kind) {
    if (invoice) {
      var value = kind === "discount" ? invoice.discountCents :
        (kind === "creditApplied" ? invoice.creditAppliedCents :
          (kind === "collected" ? invoice.paidCents :
          (kind === "total" ? invoice.subtotalCents :
            (kind === "credit" ? invoice.creditCents : invoice.balanceCents))));
      return '<td data-sales-' + kind + '="' + escapeHtml(columnId) + '">' +
        formatMoney(value) + (kind === "balance"
          ? '<br><span>' + (invoice.balanceCents === 0 ? "خالص" : "متبقي") + '</span>'
          : "") + '</td>';
    }
    if (kind === "discount" || kind === "collected") {
      return '<td data-sales-' + kind + '="' + escapeHtml(columnId) + '">' +
        '<input class="quantity-input" data-sales-' + kind + ' type="number" min="0" ' +
        'step="0.01" inputmode="decimal" value="0.00" aria-label="' +
        (kind === "discount" ? "الخصم" : "المبلغ المحصل") + '"></td>';
    }
    return '<td data-sales-' + kind + '="' + escapeHtml(columnId) + '">' +
      '0.00' + (kind === "balance" ? '<br><span data-sales-balance-status>خالص</span>' : "") +
      '</td>';
  }

  function appendSalesColumn(form, trip, customers) {
    var requestId = createInvoiceRequestId();
    var lines = trip.lines.filter(function (line) {
      return line.outgoingMilli > 0;
    });
    form.querySelector("thead tr").insertAdjacentHTML("beforeend",
      salesColumnHeader(null, customers, requestId));
    lines.forEach(function (line) {
      var row = form.querySelector('[data-sales-product-row="' + line.productId + '"]');
      row.insertAdjacentHTML("beforeend", salesProductCell(line, null, requestId));
    });
    ["creditApplied", "discount", "collected", "total", "balance", "credit"].forEach(function (kind) {
      form.querySelector('[data-sales-summary-row="' + kind + '"]').insertAdjacentHTML(
        "beforeend", salesSummaryCell(null, requestId, kind));
    });
    updateTripSalesPreview(form.closest("#trip-action-panel"));
  }

  function showTripCustomerSales(container, tripId) {
    var trip = tripService.getTrip(tripId);
    if (trip.salesCompletedAt) {
      throw new Error("تم اعتماد اكتمال مبيعات هذه الطلعة.");
    }
    var customers = customerService.getCustomers().filter(function (customer) {
      return customer.active;
    });
    var invoices = invoiceService.getTripInvoices(tripId);
    var lines = trip.lines.filter(function (line) {
      return line.outgoingMilli > 0;
    });
    var panel = container.querySelector("#trip-action-panel");
    panel.hidden = false;
    panel.innerHTML =
      '<div class="panel-heading"><div><h3>مبيعات العملاء - ' + escapeHtml(trip.number) + '</h3>' +
        '<p class="panel-hint">كل عمود يمثل عميلًا. أسعار الكراتين مأخوذة من سعر البيع المعتمد في الطلعة، ولن يُخصم المخزون مرة أخرى.</p></div>' +
        '<button class="button button--quiet" type="button" data-action="trip-sales-back" data-id="' +
          escapeHtml(tripId) + '">العودة للتصفية</button></div>' +
      '<form data-form="trip-customer-invoice" dir="rtl">' +
        '<input type="hidden" name="tripId" value="' + escapeHtml(tripId) + '">' +
        '<label>تاريخ الفواتير<input name="date" type="datetime-local" value="' +
          escapeHtml(localDateTimeValue()) + '" required></label>' +
        '<div class="table-wrap trip-sales-table-wrap"><table class="inventory-table trip-sales-table" data-sales-table><thead><tr>' +
          '<th>الصنف / المتاح</th>' +
          invoices.map(function (invoice) {
            return salesColumnHeader(invoice, customers, invoice.id);
          }).join("") +
          '</tr></thead><tbody>' +
          lines.map(function (line) {
            return '<tr data-sales-product-row="' + escapeHtml(line.productId) + '">' +
              '<th><strong>' + escapeHtml(line.name) + '</strong><br><span>المتاح: ' +
                formatQuantity(trip.returnRecord ? line.soldMilli :
                  (trip.status === "open" ? line.outgoingMilli : line.soldMilli)) + '</span><br><span>' +
                formatMoney(line.salePriceCents) + ' / ' + escapeHtml(line.unit) + '</span></th>' +
              invoices.map(function (invoice) {
                return salesProductCell(line, invoice, invoice.id);
              }).join("") + '</tr>';
          }).join("") +
          '</tbody><tfoot>' +
          ["creditApplied", "discount", "collected", "total", "balance", "credit"].map(function (kind) {
            var labels = {
              creditApplied: "المستخدم من الرصيد الدائن",
              discount: "الخصم",
              collected: "المدفوع سابقًا",
              total: "إجمالي اللي أخده العميل",
              balance: "الباقي على العميل",
              credit: "رصيد لصالح العميل"
            };
            return '<tr data-sales-summary-row="' + kind + '"><th>' + labels[kind] + '</th>' +
              invoices.map(function (invoice) {
                return salesSummaryCell(invoice, invoice.id, kind);
              }).join("") + '</tr>';
          }).join("") +
          '</tfoot></table></div>' +
        '<button class="text-button" type="button" data-action="trip-add-sales-column">+ إضافة عميل</button>' +
        '<button class="text-button" type="button" data-action="trip-remove-last-sales-column">حذف آخر عميل</button>' +
        '<button class="text-button" type="button" data-action="trip-add-customer">إضافة عميل جديد</button>' +
        '<div class="trip-summary" data-trip-inline-customer hidden>' +
          '<label>اسم العميل<input name="name" maxlength="120"></label>' +
          '<label>الهاتف<input name="phone" maxlength="40"></label>' +
          '<label>العنوان<input name="address" maxlength="240"></label>' +
          '<button class="button button--quiet" type="button" data-action="trip-save-customer">حفظ العميل</button>' +
        '</div>' +
        '<p class="trip-inline-warning" data-sales-validation role="alert"></p>' +
        '<div class="trip-summary" aria-live="polite"><strong>ملخص الطلعة</strong>' +
          '<p>إجمالي كراتين الطلعة المتاحة: <strong data-sales-trip-quantity>0</strong></p>' +
          '<p>الموزع للعملاء: <strong data-sales-distributed>0</strong></p>' +
          '<p>المتبقي غير المسجل: <strong data-sales-remaining>0</strong></p>' +
          '<p>إجمالي قيمة المبيعات: <strong data-sales-sales-total>0.00</strong></p>' +
          '<p>إجمالي المدفوع سابقًا على الفواتير: <strong data-sales-collected-total>0.00</strong></p>' +
          '<p>إجمالي المبالغ المتبقية: <strong data-sales-outstanding-total>0.00</strong></p></div>' +
        '<div class="form-actions"><button class="button button--primary" type="submit" data-sales-save>' +
          'حفظ الفواتير</button>' +
          '<button class="button button--quiet" type="button" data-action="trip-sales-back" data-id="' +
            escapeHtml(tripId) + '">إلغاء</button></div>' +
      '</form>';
    appendSalesColumn(panel.querySelector('[data-form="trip-customer-invoice"]'), trip, customers);
    updateTripSalesPreview(panel);
  }

  function updateTripSalesPreview(panel) {
    var form = panel.querySelector('[data-form="trip-customer-invoice"]');
    var trip = tripService.getTrip(form.elements.tripId.value);
    var invoices = invoiceService.getTripInvoices(trip.id);
    var customerRecords = customerService.getCustomers();
    var distributedByProduct = Object.create(null);
    var existingDistributedByProduct = Object.create(null);
    var tripQuantity = 0;
    var distributedTotal = 0;
    var salesTotal = 0;
    var collectedTotal = 0;
    var outstandingTotal = 0;
    var selectedCustomers = Object.create(null);
    var warnings = [];

    invoices.forEach(function (invoice) {
      if (invoice.status !== "posted") {
        return;
      }
      selectedCustomers[invoice.customerId] = true;
      salesTotal += invoice.totalCents;
      collectedTotal += invoice.paidCents + invoice.creditCents;
      outstandingTotal += invoice.balanceCents;
      invoice.items.forEach(function (item) {
        distributedByProduct[item.productId] =
          (distributedByProduct[item.productId] || 0) + item.quantityMilli;
        existingDistributedByProduct[item.productId] =
          (existingDistributedByProduct[item.productId] || 0) + item.quantityMilli;
        distributedTotal += item.quantityMilli;
      });
    });

    form.querySelectorAll("[data-sales-quantity]").forEach(function (input) {
      var productId = input.getAttribute("data-product-id");
      var quantity = input.value.trim() === "" ? 0 : Number(input.value);
      var line = trip.lines.find(function (item) {
        return item.productId === productId;
      });
      var alreadyDistributed = existingDistributedByProduct[productId] || 0;
      var available;
      form.querySelectorAll('[data-sales-quantity][data-product-id="' + productId + '"]')
        .forEach(function (otherInput) {
          var otherQuantity;
          if (otherInput === input) {
            return;
          }
          otherQuantity = otherInput.value.trim() === "" ? 0 : Number(otherInput.value);
          if (Number.isSafeInteger(otherQuantity) && otherQuantity >= 0) {
            alreadyDistributed += otherQuantity * 1000;
          }
        });
      available = Math.max(0,
        (trip.returnRecord ? line.soldMilli :
          (trip.status === "open" ? line.outgoingMilli : line.soldMilli)) - alreadyDistributed);
      input.max = String(available / 1000);
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        input.setCustomValidity("أدخل عددًا صحيحًا غير سالب.");
        input.setAttribute("aria-invalid", "true");
        warnings.push("الكميات يجب أن تكون أعدادًا صحيحة غير سالبة.");
        return;
      }
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
      if (quantity * 1000 > available) {
        input.setCustomValidity("الكمية تتجاوز المتاح بعد احتساب باقي العملاء.");
        input.setAttribute("aria-invalid", "true");
        warnings.push("كمية " + line.name + " تتجاوز المتاح بعد توزيع الكميات على العملاء.");
      }
      if (quantity > 0) {
        distributedByProduct[productId] =
          (distributedByProduct[productId] || 0) + quantity * 1000;
        distributedTotal += quantity * 1000;
      }
    });

    form.querySelectorAll("thead [data-sales-column]").forEach(function (header) {
      var columnId = header.getAttribute("data-sales-column");
      var invoice = invoices.find(function (item) {
        return item.id === columnId;
      });
      var customerSelect;
      var customerId;
      var subtotalCents = 0;
      var discountInput;
      var collectedInput;
      var discountCents = 0;
      var collectedCents = 0;
      var creditAppliedCents = 0;
      var hasQuantity = false;
      if (invoice) {
        return;
      }
      customerSelect = header.querySelector("[data-sales-customer]");
      customerId = customerSelect.value;
      if (customerId && selectedCustomers[customerId]) {
        warnings.push("لا يمكن اختيار العميل نفسه أكثر من مرة في مبيعات الطلعة.");
        customerSelect.setCustomValidity("هذا العميل محدد بالفعل في هذه الفاتورة.");
        customerSelect.setAttribute("aria-invalid", "true");
      } else {
        if (customerId) {
          selectedCustomers[customerId] = true;
        }
        customerSelect.setCustomValidity("");
        customerSelect.removeAttribute("aria-invalid");
      }
      form.querySelectorAll('[data-sales-quantity][data-sales-column="' + columnId + '"]')
        .forEach(function (input) {
          var line = trip.lines.find(function (item) {
            return item.productId === input.getAttribute("data-product-id");
          });
          var quantity = input.value.trim() === "" ? 0 : Number(input.value);
          if (Number.isSafeInteger(quantity) && quantity > 0 &&
              Number.isSafeInteger(line.salePriceCents)) {
            subtotalCents += quantity * line.salePriceCents;
            hasQuantity = true;
          }
        });
      discountInput = form.querySelector('[data-sales-discount="' + columnId + '"] input');
      collectedInput = form.querySelector('[data-sales-collected="' + columnId + '"] input');
      var discountAmount = discountInput.value.trim() === "" ? 0 : Number(discountInput.value);
      var collectedAmount = collectedInput.value.trim() === "" ? 0 : Number(collectedInput.value);
      if (!Number.isFinite(discountAmount) || discountAmount < 0 ||
          Math.abs(discountAmount * 100 - Math.round(discountAmount * 100)) > 0.000001 ||
          !Number.isSafeInteger(Math.round(discountAmount * 100))) {
        discountInput.setCustomValidity("أدخل خصمًا غير سالب وبحد أقصى منزلتين عشريتين.");
        discountInput.setAttribute("aria-invalid", "true");
        warnings.push("تحقق من قيمة الخصم؛ يجب أن يكون غير سالب وبحد أقصى منزلتين عشريتين.");
      } else {
        discountCents = Math.round(discountAmount * 100);
        discountInput.setCustomValidity("");
        discountInput.removeAttribute("aria-invalid");
      }
      if (!Number.isFinite(collectedAmount) || collectedAmount < 0 ||
          Math.abs(collectedAmount * 100 - Math.round(collectedAmount * 100)) > 0.000001 ||
          !Number.isSafeInteger(Math.round(collectedAmount * 100))) {
        collectedInput.setCustomValidity("أدخل مبلغًا غير سالب وبحد أقصى منزلتين عشريتين.");
        collectedInput.setAttribute("aria-invalid", "true");
        warnings.push("تحقق من المبلغ المحصل؛ يجب أن يكون غير سالب وبحد أقصى منزلتين عشريتين.");
      } else {
        collectedCents = Math.round(collectedAmount * 100);
        collectedInput.setCustomValidity("");
        collectedInput.removeAttribute("aria-invalid");
      }
      if (discountCents > subtotalCents) {
        discountInput.setCustomValidity("الخصم لا يمكن أن يتجاوز إجمالي قيمة الأصناف.");
        discountInput.setAttribute("aria-invalid", "true");
        warnings.push("الخصم لا يمكن أن يتجاوز إجمالي قيمة مبيعات العميل.");
      }
      var totalCents = Math.max(0, subtotalCents - discountCents);
      var selectedCustomer = customerRecords.find(function (customer) {
        return customer.id === customerId;
      });
      creditAppliedCents = selectedCustomer
        ? Math.min(totalCents, selectedCustomer.creditAvailableCents) : 0;
      var outstandingAfterCreditCents = totalCents - creditAppliedCents;
      var creditCents = Math.max(0, collectedCents - outstandingAfterCreditCents);
      if (customerId && !hasQuantity) {
        warnings.push("أدخل كمية صنف واحدة على الأقل للعميل المحدد.");
      }
      if (!customerId && (hasQuantity || discountCents > 0 || collectedCents > 0)) {
        warnings.push("اختر عميلًا لكل عمود يحتوي على بيانات.");
      }
      form.querySelector('[data-sales-total="' + columnId + '"]').textContent =
        formatMoney(subtotalCents);
      form.querySelector('[data-sales-creditApplied="' + columnId + '"]').textContent =
        formatMoney(creditAppliedCents);
      var balanceCell = form.querySelector('[data-sales-balance="' + columnId + '"]');
      balanceCell.firstChild.nodeValue =
        formatMoney(Math.max(0, outstandingAfterCreditCents - collectedCents));
      balanceCell.querySelector("[data-sales-balance-status]").textContent =
        outstandingAfterCreditCents === collectedCents ? "خالص" :
          (collectedCents > outstandingAfterCreditCents ? "رصيد لصالح العميل" : "متبقي");
      form.querySelector('[data-sales-credit="' + columnId + '"]').textContent =
        formatMoney(creditCents);
      salesTotal += totalCents;
      collectedTotal += collectedCents;
      outstandingTotal += Math.max(0, outstandingAfterCreditCents - collectedCents);
    });

    trip.lines.forEach(function (line) {
      var availableMilli = trip.returnRecord ? line.soldMilli :
        (trip.status === "open" ? line.outgoingMilli : line.soldMilli);
      if (availableMilli <= 0) {
        return;
      }
      tripQuantity += availableMilli;
      var quantityDistributed = distributedByProduct[line.productId] || 0;
      var difference = availableMilli - quantityDistributed;
      var productRow = form.querySelector('[data-sales-product-row="' + line.productId + '"]');
      if (productRow) {
        productRow.setAttribute("data-sales-incomplete", difference === 0 ? "false" : "true");
        productRow.setAttribute("aria-invalid", difference === 0 ? "false" : "true");
      }
      if ((trip.status === "returned" || trip.salesCompletedAt) && difference !== 0) {
        var message = difference > 0
          ? "الكمية المسجلة: " + formatQuantity(quantityDistributed) + " من " +
            formatQuantity(availableMilli) + " كرتونة؛ المتبقي " + formatQuantity(difference) + "."
          : "الكمية الموزعة تتجاوز الموجود بمقدار " + formatQuantity(Math.abs(difference)) + " كرتونة.";
        warnings.push(line.name + ": " + message);
      }
      if (line.salePriceCents === null) {
        warnings.push("لا يوجد سعر بيع معتمد للصنف " + line.name + ".");
      }
    });
    var remainingTotal = Math.max(0, tripQuantity - distributedTotal);
    form.querySelector("[data-sales-trip-quantity]").textContent = formatQuantity(tripQuantity);
    form.querySelector("[data-sales-distributed]").textContent = formatQuantity(distributedTotal);
    form.querySelector("[data-sales-remaining]").textContent = formatQuantity(remainingTotal);
    form.querySelector("[data-sales-sales-total]").textContent = formatMoney(salesTotal);
    form.querySelector("[data-sales-collected-total]").textContent = formatMoney(collectedTotal);
    form.querySelector("[data-sales-outstanding-total]").textContent = formatMoney(outstandingTotal);
    form.querySelector("[data-sales-validation]").textContent =
      warnings.length ? warnings.join(" ") : (trip.status === "returned"
        ? "توزيع الأصناف مكتمل ويمكن حفظ الفواتير."
        : "يمكن حفظ المبيعات المسجلة. تُعتمد الطلعة تلقائيًا بعد حفظ الراجع واكتمال الفواتير.");
    form.setAttribute("data-valid", warnings.length === 0 ? "true" : "false");
    var saveButton = form.querySelector("[data-sales-save]");
    saveButton.disabled = form.getAttribute("data-saving") === "true" || warnings.length > 0;
    return warnings.length === 0;
  }

  function filterTrips(container, query) {
    var trips = tripService.getTrips();
    var normalizedQuery = query.trim().toLocaleLowerCase();
    var filtered = trips.filter(function (trip) {
      return [trip.number, trip.vehicleName, trip.driverName]
        .some(function (value) {
          return value.toLocaleLowerCase().indexOf(normalizedQuery) !== -1;
        });
    });
    container.querySelector("#trip-rows").innerHTML = filtered.length === 0 && trips.length > 0
      ? '<tr><td class="table-empty" colspan="7">لا توجد نتائج مطابقة للبحث.</td></tr>'
      : tripRows(filtered);
  }

  function bindEvents(container) {
    if (container.tripEventsBound) {
      return;
    }
    container.tripEventsBound = true;

    container.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      var action;
      var panel;

      if (!button || !container.contains(button) ||
          container.getAttribute("data-module") !== "trips") {
        return;
      }

      action = button.getAttribute("data-action");
      panel = container.querySelector("#trip-action-panel");

      try {
        if (action === "new-trip") {
          renderCreateForm(container);
          container.querySelector("#trip-create-panel").hidden = false;
          container.querySelector("#trip-create-panel").scrollIntoView({ block: "nearest" });
          return;
        }
        if (action === "cancel-create") {
          container.querySelector("#trip-create-panel").hidden = true;
          return;
        }
        if (action === "edit-fleet") {
          container.querySelector("#fleet-panel").hidden = false;
          container.querySelector("#fleet-panel").scrollIntoView({ block: "nearest" });
          return;
        }
        if (action === "cancel-fleet") {
          container.querySelector("#fleet-panel").hidden = true;
          return;
        }
        if (action === "add-vehicle" || action === "add-driver") {
          var addFormId = action === "add-vehicle" ? "#add-vehicle-form" : "#add-driver-form";
          var addForm = container.querySelector(addFormId);
          container.querySelectorAll('[data-form="add-fleet-member"]').forEach(function (form) {
            form.hidden = form !== addForm;
          });
          addForm.hidden = false;
          addForm.elements.name.focus();
          return;
        }
        if (action === "cancel-add-fleet-member") {
          button.closest('[data-form="add-fleet-member"]').hidden = true;
          return;
        }
        if (action === "choose-vehicle") {
          var createForm = container.querySelector("#trip-create-form");
          createForm.elements.vehicleId.value = button.getAttribute("data-id");
          createForm.querySelectorAll("[data-action='choose-vehicle']").forEach(function (card) {
            var selected = card === button;
            card.classList.toggle("is-selected", selected);
            card.setAttribute("aria-pressed", selected ? "true" : "false");
          });
          createForm.querySelector("#driver-block").hidden = false;
          createForm.elements.driverId.disabled = false;
          createForm.elements.driverId.focus();
          return;
        }
        if (action === "details") {
          showTripDetails(container, button.getAttribute("data-id"));
          return;
        }
        if (action === "trip-customer-sales") {
          showTripCustomerSales(container, button.getAttribute("data-id"));
          return;
        }
        if (action === "trip-sales-back") {
          showTripDetails(container, button.getAttribute("data-id"));
          return;
        }
        if (action === "trip-add-sales-column") {
          var salesForm = container.querySelector('[data-form="trip-customer-invoice"]');
          var salesTrip = tripService.getTrip(salesForm.elements.tripId.value);
          var salesCustomers = customerService.getCustomers().filter(function (customer) {
            return customer.active;
          });
          appendSalesColumn(salesForm, salesTrip, salesCustomers);
          return;
        }
        if (action === "trip-remove-last-sales-column") {
          var removeSalesForm = container.querySelector('[data-form="trip-customer-invoice"]');
          var customerColumns = Array.prototype.slice.call(
            removeSalesForm.querySelectorAll("thead [data-sales-column]"));
          var editableColumns = customerColumns.filter(function (header) {
            return Boolean(header.querySelector("[data-sales-customer]"));
          });
          var lastColumn = editableColumns[editableColumns.length - 1];
          var columnId;
          var hasEnteredData;
          if (!lastColumn) {
            showNotice(container, "لا يوجد عميل غير محفوظ لحذفه من جدول الطلعة.", "error");
            return;
          }
          if (customerColumns.length <= 1) {
            showNotice(container, "لا يمكن حذف آخر عميل من جدول مبيعات الطلعة.", "error");
            return;
          }
          columnId = lastColumn.getAttribute("data-sales-column");
          hasEnteredData = Array.prototype.some.call(
            removeSalesForm.querySelectorAll('[data-sales-quantity][data-sales-column="' +
              columnId + '"]'),
            function (input) {
              return input.value.trim() !== "" && Number(input.value) !== 0;
            }) || ["discount"].some(function (kind) {
            var input = removeSalesForm.querySelector('[data-sales-' + kind + '="' +
              columnId + '"] input');
            return input.value.trim() !== "" && Number(input.value) !== 0;
          });
          if (hasEnteredData &&
              !global.confirm("يحتوي آخر عميل على كميات أو مبالغ. هل تريد حذفه وفقد هذه البيانات؟")) {
            return;
          }
          lastColumn.remove();
          removeSalesForm.querySelectorAll(
            '[data-sales-value="' + columnId + '"], ' +
            '[data-sales-discount="' + columnId + '"], ' +
            '[data-sales-collected="' + columnId + '"], ' +
            '[data-sales-total="' + columnId + '"], ' +
            '[data-sales-balance="' + columnId + '"], ' +
            '[data-sales-credit="' + columnId + '"]').forEach(function (cell) {
            cell.remove();
          });
          updateTripSalesPreview(panel);
          return;
        }
        if (action === "trip-add-customer") {
          var customerBox = container.querySelector("[data-trip-inline-customer]");
          customerBox.hidden = false;
          customerBox.querySelector('[name="name"]').required = true;
          customerBox.querySelector('[name="name"]').focus();
          return;
        }
        if (action === "trip-save-customer") {
          var box = button.closest("[data-trip-inline-customer]");
          var customerName = box.querySelector('[name="name"]');
          var newCustomer;
          if (!customerName.value.trim()) {
            customerName.reportValidity();
            return;
          }
          newCustomer = customerService.addCustomer({
            name: customerName.value,
            phone: box.querySelector('[name="phone"]').value,
            address: box.querySelector('[name="address"]').value
          });
          var salesForm = container.querySelector('[data-form="trip-customer-invoice"]');
          salesForm.querySelectorAll("[data-sales-customer]").forEach(function (customerSelect) {
            customerSelect.insertAdjacentHTML("beforeend",
              '<option value="' + escapeHtml(newCustomer.id) + '">' +
                escapeHtml(newCustomer.code + " - " + newCustomer.name) + '</option>');
          });
          var emptySalesSelect = Array.prototype.find.call(
            salesForm.querySelectorAll("[data-sales-customer]"),
            function (select) {
              return !select.value;
            });
          if (!emptySalesSelect) {
            var salesTrip = tripService.getTrip(salesForm.elements.tripId.value);
            appendSalesColumn(salesForm, salesTrip, customerService.getCustomers().filter(function (customer) {
                return customer.active;
              }));
            var customerSelects = salesForm.querySelectorAll("[data-sales-customer]");
            emptySalesSelect = customerSelects[customerSelects.length - 1];
          }
          emptySalesSelect.value = newCustomer.id;
          box.hidden = true;
          customerName.required = false;
          updateTripSalesPreview(panel);
          showNotice(container, "تمت إضافة العميل إلى قائمة الطلعة دون فقد تفاصيل الفاتورة.", "success");
          return;
        }
        if (action === "replenish") {
          showReplenishmentForm(container, button.getAttribute("data-id"));
          return;
        }
        if (action === "return") {
          var selectedTrip = tripService.getTrip(button.getAttribute("data-id"));
          if (selectedTrip.returnRecord) {
            showTripDetails(container, selectedTrip.id);
          } else {
            showReturnForm(container, selectedTrip.id);
          }
          return;
        }
        if (action === "close-trip-panel") {
          panel.hidden = true;
        }
      } catch (error) {
        showNotice(container, error.message, "error");
      }
    });

    container.addEventListener("input", function (event) {
      if (event.target.id === "trip-search") {
        try {
          filterTrips(container, event.target.value);
        } catch (error) {
          showNotice(container, error.message, "error");
        }
      }
      if (event.target.matches("[data-load-quantity]")) {
        updateCreateSummary(event.target.form);
      }
      if (event.target.matches("[data-return-quantity]")) {
        updateReturnPreview(event.target.form);
      }
      if (event.target.closest('[data-form="trip-customer-invoice"]') &&
          (event.target.matches("[data-sales-quantity]") ||
           event.target.matches("[data-sales-collected]") ||
           event.target.matches("[data-sales-discount]"))) {
        updateTripSalesPreview(container.querySelector("#trip-action-panel"));
      }
    });

    container.addEventListener("change", function (event) {
      if (container.getAttribute("data-module") === "trips" &&
          event.target.matches("[data-sales-customer]")) {
        var changedSelect = event.target;
        var currentForm = changedSelect.form;
        var customerId = changedSelect.value;
        var duplicate = Array.prototype.some.call(
          currentForm.querySelectorAll("[data-sales-customer]"),
          function (otherSelect) {
            return otherSelect !== changedSelect && otherSelect.value === customerId;
          }
        ) || invoiceService.getTripInvoices(currentForm.elements.tripId.value).some(function (invoice) {
          return invoice.status === "posted" && invoice.customerId === customerId;
        });
        if (customerId && duplicate) {
          var selectedCustomer = customerService.getCustomer(customerId);
          changedSelect.value = "";
          showNotice(container, "العميل " + selectedCustomer.name +
            " موجود بالفعل في مبيعات هذه الطلعة؛ اختر عميلًا آخر.", "error");
        }
        updateTripSalesPreview(container.querySelector("#trip-action-panel"));
      }
    });

    container.addEventListener("submit", function (event) {
      var form = event.target;
      var formType = form.getAttribute("data-form");

      if (!formType) {
        return;
      }
      event.preventDefault();

      try {
        if (formType === "create-trip") {
          var products = inventoryService.getProducts().filter(function (product) {
            return product.active;
          });
          var items = products.map(function (product) {
            var input = form.querySelector('[data-product-id="' + product.id + '"]');
            return {
              productId: product.id,
              quantity: input ? input.value : ""
            };
          });
          var trip = tripService.createTrip({
            vehicleId: form.elements.vehicleId.value,
            driverId: form.elements.driverId.value,
            dateTime: form.elements.dateTime.value,
            items: items
          });
          render(container);
          showNotice(container, "تم تسجيل الطلعة " + trip.number + " وصرف كمياتها للمخزون.", "success");
          return;
        }

        if (formType === "fleet") {
          var vehicles = [];
          var drivers = [];
          form.querySelectorAll("[data-fleet-member]").forEach(function (input) {
            var member = {
              id: input.getAttribute("data-id"),
              name: input.value
            };
            if (input.getAttribute("data-kind") === "vehicle") {
              vehicles.push(member);
            } else {
              drivers.push(member);
            }
          });
          tripService.updateFleet(vehicles, drivers);
          render(container);
          showNotice(container, "تم حفظ أسماء العربيات والسائقين.", "success");
          return;
        }

        if (formType === "add-fleet-member") {
          var memberKind = form.getAttribute("data-kind");
          var addedMember = memberKind === "vehicle"
            ? tripService.addVehicle({ name: form.elements.name.value })
            : tripService.addDriver({ name: form.elements.name.value });
          render(container);
          showNotice(container, memberKind === "vehicle"
            ? "تمت إضافة العربية " + addedMember.name + " وستظهر ضمن اختيارات الطلعات."
            : "تمت إضافة السائق " + addedMember.name + " وسيظهر ضمن اختيارات الطلعات.", "success");
          return;
        }

        if (formType === "replenishment") {
          tripService.addReplenishment(form.elements.tripId.value, {
            productId: form.elements.productId.value,
            quantity: form.elements.quantity.value,
            requestId: form.elements.requestId.value
          });
          render(container);
          showNotice(container, "تم تسجيل التزويدة كحركة مستقلة.", "success");
          return;
        }

        if (formType === "return") {
          var returnItems = Array.prototype.map.call(
            form.querySelectorAll("[data-return-quantity]"),
            function (input) {
              return {
                productId: input.getAttribute("data-product-id"),
                quantity: input.value
              };
            }
          );
          var returnSaveButton = form.querySelector('[type="submit"]');
          var savedReturnTrip;
          if (form.getAttribute("data-saving") === "true") {
            return;
          }
          form.setAttribute("data-saving", "true");
          returnSaveButton.disabled = true;
          try {
            savedReturnTrip = tripService.recordReturn(
              form.elements.tripId.value, returnItems, form.elements.cashReturned.value);
          } catch (returnError) {
            form.removeAttribute("data-saving");
            returnSaveButton.disabled = false;
            showNotice(container, returnError.message, "error");
            return;
          }
          render(container);
          showNotice(container, savedReturnTrip.status === "returned"
            ? "تم تسجيل الراجع واكتمال الطلعة."
            : "تم حفظ الراجع والنقدية. ستُغلق الطلعة تلقائيًا بعد حفظ فواتير الكميات المباعة كاملة.", "success");
          showTripDetails(container, form.elements.tripId.value);
          return;
        }

        if (formType === "trip-customer-invoice") {
          var salesPanel = container.querySelector("#trip-action-panel");
          var complete = updateTripSalesPreview(salesPanel);
          var entries;
          var savedInvoices;
          var tripId = form.elements.tripId.value;
          var currentTrip;
          if (!complete) {
            showNotice(container, "راجع الصفوف والكميات المظللة قبل حفظ الفواتير.", "error");
            return;
          }
          entries = Array.prototype.map.call(
            form.querySelectorAll("thead [data-sales-column]"),
            function (header) {
              var columnId = header.getAttribute("data-sales-column");
              var customerSelect = header.querySelector("[data-sales-customer]");
              if (!customerSelect) {
                return null;
              }
              return {
                customerId: customerSelect.value,
                requestId: columnId,
                discount: form.querySelector('[data-sales-discount="' + columnId + '"] input').value,
                initialPayment: form.querySelector('[data-sales-collected="' + columnId + '"] input').value,
                paymentMethod: "نقدي",
                items: Array.prototype.map.call(
                  form.querySelectorAll('[data-sales-quantity][data-sales-column="' + columnId + '"]'),
                  function (input) {
                    return {
                      productId: input.getAttribute("data-product-id"),
                      quantity: input.value
                    };
                  }).filter(function (item) {
                  return Number(item.quantity) > 0;
                })
              };
            }).filter(function (entry) {
              return entry && entry.customerId && entry.items.length > 0;
            });
          if (!entries.length) {
            savedInvoices = invoiceService.getTripInvoices(tripId).filter(function (invoice) {
              return invoice.status === "posted";
            });
            if (savedInvoices.length === 0) {
              showNotice(container, "أضف عميلًا وسجّل الكميات قبل الحفظ.", "error");
              return;
            }
            currentTrip = tripService.getTrip(tripId);
            if (!currentTrip.returnRecord) {
              showNotice(container, "الفواتير المحفوظة محفوظة كما هي. سجّل الراجع أولًا، وستُغلق الطلعة تلقائيًا عند اكتمال الشروط.", "success");
              return;
            }
            form.setAttribute("data-saving", "true");
            try {
              currentTrip = tripService.completeTripSales(tripId);
            } catch (completionError) {
              form.removeAttribute("data-saving");
              updateTripSalesPreview(salesPanel);
              showNotice(container, "الفواتير محفوظة، لكن تعذر إغلاق الطلعة: " +
                completionError.message + " يمكنك إعادة المحاولة دون تكرار الفواتير.", "error");
              return;
            }
            render(container);
            showNotice(container, currentTrip.status === "returned"
              ? "تم اعتماد الطلعة وإغلاقها بنجاح بعد التحقق من الفواتير المحفوظة."
              : "الفواتير محفوظة، لكن الطلعة ما زالت مفتوحة حتى استكمال الشروط.", "success");
            showTripDetails(container, tripId);
            return;
          }
          form.setAttribute("data-saving", "true");
          updateTripSalesPreview(salesPanel);
          savedInvoices = invoiceService.createTripInvoices({
            tripId: tripId,
            date: form.elements.date.value,
            entries: entries
          });
          currentTrip = tripService.getTrip(tripId);
          if (currentTrip.returnRecord) {
            try {
              currentTrip = tripService.completeTripSales(tripId);
            } catch (completionError) {
              render(container);
              showNotice(container, "تم حفظ الفواتير، لكن تعذر إغلاق الطلعة: " +
                completionError.message + " احتُفظ بالفواتير ويمكن إعادة المحاولة دون تكرارها.", "error");
              showTripDetails(container, tripId);
              return;
            }
          }
          render(container);
          showNotice(container, currentTrip.status === "returned"
            ? "تم حفظ " + savedInvoices.length +
              " فاتورة واعتماد الطلعة وإغلاقها بنجاح. لم يُخصم المخزون مرة أخرى."
            : "تم حفظ " + savedInvoices.length +
              " فاتورة للطلعة. ستظل مفتوحة حتى تسجيل الراجع واكتمال فواتير الكميات المباعة.", "success");
          showTripDetails(container, tripId);
          return;
        }

        if (formType === "trip-reconciliation") {
          var reviewedTripId = form.getAttribute("data-trip-id");
          tripService.recordReconciliationReview(reviewedTripId, form.elements.reason.value);
          showTripDetails(container, reviewedTripId);
          showNotice(container, "تم تسجيل سبب المراجعة دون إضافة الفرق إلى المبيعات أو الأرباح.", "success");
        }
      } catch (error) {
        var salesForm = container.querySelector('[data-form="trip-customer-invoice"]');
        if (salesForm) {
          salesForm.setAttribute("data-saving", "false");
          var validation = salesForm.querySelector("[data-sales-validation]");
          if (validation) {
            validation.textContent = error.message;
          }
          var saveButton = salesForm.querySelector("[data-sales-save]");
          if (saveButton) {
            saveButton.disabled = false;
          }
        }
        showNotice(container, error.message, "error");
      }
    });
  }

  global.PepsiApp.tripModule = {
    render: render
  };
}(window));
