(function (global) {
  "use strict";

  var customerService = global.PepsiApp.customerService;
  var invoiceService = global.PepsiApp.invoiceService;
  var paymentRequestCounter = 0;

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

  function formatMoney(cents) {
    var value = Math.abs(cents) / 100;
    var formatted = value.toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return cents < 0 ? "−" + formatted : formatted;
  }

  function sumCents(total, amount) {
    var result = total + amount;
    if (!Number.isSafeInteger(result)) {
      throw new Error("تعذر حساب إجمالي حسابات العملاء بدقة.");
    }
    return result;
  }

  function createPaymentRequestId() {
    paymentRequestCounter += 1;
    return "customer-payment-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" +
      paymentRequestCounter.toString(36);
  }

  function customerRows(customers, search) {
    var query = search.trim().toLocaleLowerCase();
    var filtered = customers.filter(function (customer) {
      return [customer.name, customer.code, customer.phone]
        .some(function (value) {
          return value.toLocaleLowerCase().indexOf(query) !== -1;
        });
    });

    if (filtered.length === 0) {
      return '<tr><td class="table-empty" colspan="8">' +
        (customers.length === 0 ? "لا يوجد عملاء مسجلون بعد." : "لا توجد نتائج مطابقة للبحث.") +
        "</td></tr>";
    }

    return filtered.map(function (customer) {
      var outstandingClass = customer.outstandingCents > 0
        ? "customer-balance customer-balance--due"
        : "customer-balance";
      var creditClass = customer.creditAvailableCents > 0
        ? "customer-balance customer-balance--credit"
        : "customer-balance";
      return '<tr>' +
        '<td><strong>' + escapeHtml(customer.code) + '</strong></td>' +
        '<td>' + escapeHtml(customer.name) + '</td>' +
        '<td>' + (customer.phone ? escapeHtml(customer.phone) : "—") + '</td>' +
        '<td><span class="' + outstandingClass + '">الباقي: ' +
          formatMoney(customer.outstandingCents) + '</span><br><span class="' + creditClass +
          '">دائن: ' + formatMoney(customer.creditAvailableCents) + '</span></td>' +
        '<td>' + formatMoney(customer.totalSalesCents) + '</td>' +
        '<td>' + formatMoney(customer.totalPaymentsCents) + '</td>' +
        '<td><span class="status-label ' + (customer.active ? "status-label--active" : "status-label--inactive") + '">' +
          (customer.active ? "نشط" : "معطل") + '</span></td>' +
        '<td class="table-actions">' +
          '<button class="text-button" type="button" data-action="edit" data-id="' + escapeHtml(customer.id) + '">تعديل</button>' +
          '<button class="text-button" type="button" data-action="account" data-id="' + escapeHtml(customer.id) + '">كشف الحساب</button>' +
          '<button class="text-button" type="button" data-action="toggle" data-active="' + (!customer.active) +
            '" data-id="' + escapeHtml(customer.id) + '">' + (customer.active ? "تعطيل" : "تفعيل") + '</button>' +
        '</td>' +
      '</tr>';
    }).join("");
  }

  function formMarkup() {
    return '<section class="customer-panel customer-form-panel" id="customer-form-panel" hidden>' +
      '<div class="panel-heading"><div><h3 id="customer-form-title">إضافة عميل</h3>' +
        '<p class="panel-hint">يُنشأ كود فريد تلقائيًا ويظل ثابتًا عند تعديل بيانات العميل.</p></div></div>' +
      '<form class="customer-form" id="customer-form">' +
        '<input type="hidden" name="customerId">' +
        '<label>اسم العميل أو المحل<input name="name" maxlength="120" autocomplete="organization" required></label>' +
        '<label>رقم الهاتف (اختياري)<input name="phone" maxlength="40" type="tel" autocomplete="tel"></label>' +
        '<label class="customer-address-field">العنوان (اختياري)<textarea name="address" maxlength="240" rows="2"></textarea></label>' +
        '<div class="form-actions"><button class="button button--primary" type="submit">حفظ العميل</button>' +
          '<button class="button button--quiet" type="button" data-action="cancel-form">إلغاء</button></div>' +
      '</form>' +
    '</section>';
  }

  function render(container) {
    var customers;
    var activeCount;
    var totalDebt;
    var totalSales;
    var totalPayments;
    container.setAttribute("data-module", "customers");

    try {
      customers = customerService.getCustomers();
      activeCount = customers.filter(function (customer) {
        return customer.active;
      }).length;
      totalDebt = customers.reduce(function (total, customer) {
        return sumCents(total, customer.outstandingCents);
      }, 0);
      totalSales = customers.reduce(function (total, customer) {
        return sumCents(total, customer.totalSalesCents);
      }, 0);
      totalPayments = customers.reduce(function (total, customer) {
        return sumCents(total, customer.totalPaymentsCents);
      }, 0);
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل حسابات العملاء</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.innerHTML =
      '<section class="customer-heading">' +
        '<div><p class="inventory-eyebrow">إدارة الحسابات</p><h2>العملاء والمحلات</h2>' +
          '<p class="inventory-description">الأرصدة والإجماليات تُحسب من حركات الحساب المسجلة، ولا تُدخل يدويًا.</p></div>' +
        '<button class="button button--primary" type="button" data-action="new">إضافة عميل</button>' +
      '</section>' +
      '<div class="notice" id="customer-notice" role="status" aria-live="polite" hidden></div>' +
      '<section class="customer-summary" aria-label="ملخص حسابات العملاء">' +
        '<article class="customer-stat"><span>العملاء النشطون</span><strong>' + activeCount.toLocaleString("ar-EG") + '</strong></article>' +
        '<article class="customer-stat"><span>الديون المستحقة</span><strong>' + formatMoney(totalDebt) + '</strong></article>' +
        '<article class="customer-stat"><span>إجمالي المبيعات المسجلة</span><strong>' + formatMoney(totalSales) + '</strong></article>' +
        '<article class="customer-stat"><span>إجمالي التحصيلات المسجلة</span><strong>' + formatMoney(totalPayments) + '</strong></article>' +
      '</section>' +
      formMarkup() +
      '<section class="customer-panel">' +
        '<div class="inventory-toolbar"><div><h3>قائمة العملاء</h3>' +
          '<p class="panel-hint">عدد العملاء: <strong>' + customers.length.toLocaleString("ar-EG") + '</strong></p></div>' +
          '<label class="search-field">بحث<input id="customer-search" type="search" placeholder="الاسم أو الكود أو الهاتف" autocomplete="off"></label>' +
        '</div>' +
        '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
          '<th>كود العميل</th><th>الاسم</th><th>الهاتف</th><th>الباقي / الرصيد الدائن</th><th>إجمالي المبيعات</th><th>إجمالي التحصيلات</th><th>الحالة</th><th>الإجراءات</th>' +
        '</tr></thead><tbody id="customer-rows">' + customerRows(customers, "") + '</tbody></table></div>' +
      '</section>' +
      '<section class="customer-panel customer-account-panel" id="customer-account-panel" hidden></section>';

    bindEvents(container);
  }

  function showNotice(container, message, type) {
    var notice = container.querySelector("#customer-notice");
    if (!notice) {
      return;
    }
    notice.hidden = false;
    notice.className = "notice notice--" + type;
    notice.textContent = message;
  }

  function showAccount(container, customerId) {
    var customer = customerService.getCustomer(customerId);
    var entries = customerService.getAccountHistory(customerId);
    var invoices = invoiceService.getCustomerInvoices(customerId);
    var payments = invoiceService.getCustomerPayments(customerId);
    var panel = container.querySelector("#customer-account-panel");
    var entryLabels = {
      sale: "فاتورة بيع",
      sale_void: "إلغاء فاتورة",
      payment: "تحصيل",
      return: "مرتجع",
      adjustment: "تسوية",
      credit_applied: "استخدام رصيد دائن"
    };

    panel.hidden = false;
    panel.innerHTML =
      '<div class="panel-heading"><div><p class="inventory-eyebrow">' + escapeHtml(customer.code) + '</p>' +
        '<h3>كشف حساب: ' + escapeHtml(customer.name) + '</h3></div>' +
        '<button class="button button--quiet" type="button" data-action="close-account">إغلاق</button></div>' +
      '<dl class="customer-details">' +
        '<div><dt>الهاتف</dt><dd>' + (customer.phone ? escapeHtml(customer.phone) : "غير مسجل") + '</dd></div>' +
        '<div><dt>العنوان</dt><dd>' + (customer.address ? escapeHtml(customer.address) : "غير مسجل") + '</dd></div>' +
        '<div><dt>الباقي</dt><dd>' + formatMoney(customer.outstandingCents) + '</dd></div>' +
        '<div><dt>الرصيد الدائن المتاح</dt><dd>' + formatMoney(customer.creditAvailableCents) + '</dd></div>' +
        '<div><dt>إجمالي المبالغ المحصلة</dt><dd>' + formatMoney(customer.totalCollectedCents) + '</dd></div>' +
      '</dl>' +
      '<div><h4 class="customer-ledger-title">سجل الفواتير</h4>' +
        (invoices.length === 0
          ? '<p class="panel-hint">لا توجد فواتير مسجلة لهذا العميل.</p>'
          : '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
            '<th>الفاتورة والتاريخ</th><th>الطلعة</th><th>الأصناف والكميات والأسعار</th>' +
            '<th>الإجمالي</th><th>المدفوع</th><th>المبلغ المحصل</th><th>من الرصيد الدائن</th><th>المتبقي</th><th>الحالة</th>' +
            '</tr></thead><tbody>' + invoices.map(function (invoice) {
              var status = invoice.status === "cancelled" ? "ملغاة" :
                (invoice.balanceCents === 0 ? "مدفوعة" :
                  (invoice.paidCents > 0 ? "مدفوعة جزئيًا" : "آجلة"));
              var lines = invoice.items.map(function (line) {
                return escapeHtml(line.name) + " — " + formatQuantity(line.quantityMilli) +
                  " " + escapeHtml(line.unit) + " × " + formatMoney(line.unitPriceCents) +
                  " = " + formatMoney(line.amountCents);
              }).join("<br>");
              return '<tr><td><strong>' + escapeHtml(invoice.number) + '</strong><br>' +
                escapeHtml(new Date(invoice.date).toLocaleString("ar-EG")) + '</td><td>' +
                (invoice.tripNumber ? escapeHtml(invoice.tripNumber) : "بيع مباشر") +
                '</td><td>' + lines + (invoice.cancellationReason
                  ? '<br>سبب الإلغاء: ' + escapeHtml(invoice.cancellationReason) : '') +
                '</td><td>' + formatMoney(invoice.totalCents) + '</td><td>' +
                formatMoney(invoice.paidCents) + '</td><td>' +
                formatMoney(invoice.tripCollectedCents || 0) + '</td><td>' +
                formatMoney(invoice.creditAppliedCents) + '</td><td>' + formatMoney(invoice.balanceCents) +
                '</td><td>' + status + '</td></tr>';
            }).join("") + '</tbody></table></div>') +
      '</div>' +
      '<div><h4 class="customer-ledger-title">سجل التحصيلات</h4>' +
        (payments.length === 0
          ? '<p class="panel-hint">لا توجد تحصيلات مسجلة لهذا العميل.</p>'
          : '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
            '<th>رقم التحصيل</th><th>التاريخ</th><th>المبلغ المحصل</th><th>طريقة الدفع</th>' +
            '<th>الفاتورة</th><th>ملاحظات</th></tr></thead><tbody>' +
            payments.map(function (payment) {
              var notes = payment.notes || "";
              if (payment.creditCents > 0) {
                notes += (payment.notes ? " — " : "") +
                  "المسدد على الفاتورة: " + formatMoney(payment.appliedCents) +
                  "، والرصيد الدائن: " + formatMoney(payment.creditCents);
              }
              if (!notes) {
                notes = "—";
              }
              return '<tr><td>' + escapeHtml(payment.number) + '</td><td>' +
                escapeHtml(new Date(payment.createdAt).toLocaleString("ar-EG")) + '</td><td>' +
                formatMoney(payment.amountCents) + '</td><td>' + escapeHtml(payment.method) +
                '</td><td>' + (payment.invoiceNumber ? escapeHtml(payment.invoiceNumber) : "تحصيل دين سابق") +
                '</td><td>' + escapeHtml(notes) + '</td></tr>';
            }).join("") + '</tbody></table></div>') +
      '</div>' +
      '<div><h4 class="customer-ledger-title">حركة الحساب</h4>' +
        (entries.length === 0
          ? '<p class="panel-hint">لا توجد حركات حساب مسجلة بعد. ستظهر الفواتير والتحصيلات هنا عند تنفيذ الأقسام المرتبطة.</p>'
          : '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
            '<th>نوع الحركة</th><th>التفاصيل</th><th>قيمة الحركة</th><th>أثرها على الرصيد</th><th>الرصيد بعد الحركة</th><th>التاريخ والوقت</th>' +
            '</tr></thead><tbody>' +
            entries.map(function (entry) {
              var description = entry.description || "—";
              if (entry.invoiceItems && entry.invoiceItems.length) {
                description += " — " + entry.invoiceItems.map(function (line) {
                  return line.name + " " + formatQuantity(line.quantityMilli) + " " + line.unit +
                    " × " + formatMoney(line.unitPriceCents);
                }).join("، ");
              }
              if (entry.tripNumber) {
                description += " — الطلعة " + entry.tripNumber;
              }
              if (entry.paymentMethod) {
                description += " — " + entry.paymentMethod;
              }
              if (entry.invoicePaymentNumber) {
                description += " — فاتورة " + entry.invoicePaymentNumber;
              }
              if (entry.invoiceNumber) {
                description += " — فاتورة " + entry.invoiceNumber;
              }
              if (entry.paymentNotes) {
                description += " — " + entry.paymentNotes;
              }
              return '<tr><td>' + (entryLabels[entry.kind] || "حركة") + '</td>' +
                '<td>' + escapeHtml(description) + '</td>' +
                '<td>' + formatMoney(entry.amountCents) + '</td>' +
                '<td>' + formatMoney(entry.balanceDeltaCents) + '</td>' +
                '<td>' + formatMoney(entry.balanceAfterCents) + '</td>' +
                '<td>' + escapeHtml(new Date(entry.createdAt).toLocaleString("ar-EG")) + '</td></tr>';
            }).join("") +
            '</tbody></table></div>') +
      '</div>' +
      (customer.outstandingCents > 0
        ? '<form data-form="customer-payment" data-customer-id="' + escapeHtml(customer.id) + '">' +
          '<h4 class="customer-ledger-title">تسجيل تحصيل دين سابق</h4>' +
          '<input type="hidden" name="requestId" value="' + escapeHtml(createPaymentRequestId()) + '">' +
          '<div class="trip-form-grid"><label>المبلغ المحصل<input name="amount" type="number" min="0.01" ' +
            'step="0.01" max="' + (customer.outstandingCents / 100).toFixed(2) + '" required></label>' +
            '<label>طريقة الدفع<select name="method" required><option value="">اختر الطريقة</option>' +
              '<option value="نقدي">نقدي</option><option value="تحويل بنكي">تحويل بنكي</option>' +
              '<option value="محفظة إلكترونية">محفظة إلكترونية</option><option value="شيك">شيك</option></select></label>' +
            '<label>ملاحظات<input name="notes" maxlength="240"></label>' +
            '<button class="button button--primary" type="submit">حفظ التحصيل</button></div></form>' : "");
  }

  function formatQuantity(milli) {
    return (milli / 1000).toLocaleString("ar-EG", { maximumFractionDigits: 3 });
  }

  function bindEvents(container) {
    var form = container.querySelector("#customer-form");
    var search = container.querySelector("#customer-search");

    search.addEventListener("input", function () {
      try {
        container.querySelector("#customer-rows").innerHTML =
          customerRows(customerService.getCustomers(), search.value);
      } catch (error) {
        showNotice(container, error.message, "error");
      }
    });

    if (!container.customerClickHandlerBound) {
      container.customerClickHandlerBound = true;
      container.addEventListener("click", function (event) {
        var button = event.target.closest("[data-action]");
        var action;
        var customerId;
        var currentForm = container.querySelector("#customer-form");
        var formPanel = container.querySelector("#customer-form-panel");

        if (!button || !container.contains(button) ||
            container.getAttribute("data-module") !== "customers") {
          return;
        }
        action = button.getAttribute("data-action");
        customerId = button.getAttribute("data-id");

        try {
          if (action === "new") {
            currentForm.reset();
            currentForm.elements.customerId.value = "";
            container.querySelector("#customer-form-title").textContent = "إضافة عميل";
            formPanel.hidden = false;
            currentForm.elements.name.focus();
            return;
          }
          if (action === "cancel-form") {
            formPanel.hidden = true;
            return;
          }
          if (action === "close-account") {
            container.querySelector("#customer-account-panel").hidden = true;
            return;
          }
          if (action === "edit") {
            var customer = customerService.getCustomer(customerId);
            currentForm.reset();
            currentForm.elements.customerId.value = customer.id;
            currentForm.elements.name.value = customer.name;
            currentForm.elements.phone.value = customer.phone;
            currentForm.elements.address.value = customer.address;
            container.querySelector("#customer-form-title").textContent = "تعديل بيانات العميل";
            formPanel.hidden = false;
            currentForm.elements.name.focus();
            return;
          }
          if (action === "account") {
            showAccount(container, customerId);
            return;
          }
          if (action === "toggle") {
            var nextActive = button.getAttribute("data-active") === "true";
            if (!nextActive && !global.confirm("سيتم تعطيل العميل مع الاحتفاظ بكوده وسجل حسابه. هل تريد المتابعة؟")) {
              return;
            }
            customerService.setActive(customerId, nextActive);
            render(container);
            showNotice(container, nextActive ? "تم تفعيل العميل." : "تم تعطيل العميل مع الاحتفاظ بسجله.", "success");
          }
        } catch (error) {
          showNotice(container, error.message, "error");
        }
      });

      container.addEventListener("submit", function (event) {
        var paymentForm = event.target;
        var selectedCustomerId;
        if (container.getAttribute("data-module") !== "customers" ||
            !paymentForm.matches('[data-form="customer-payment"]')) {
          return;
        }
        event.preventDefault();
        selectedCustomerId = paymentForm.getAttribute("data-customer-id");
        try {
          invoiceService.addCustomerPayment(selectedCustomerId, {
            amount: paymentForm.elements.amount.value,
            method: paymentForm.elements.method.value,
            notes: paymentForm.elements.notes.value,
            requestId: paymentForm.elements.requestId.value
          });
          render(container);
          showAccount(container, selectedCustomerId);
          showNotice(container, "تم حفظ تحصيل الدين السابق وتحديث الرصيد وكشف الحساب.", "success");
        } catch (error) {
          showNotice(container, error.message, "error");
        }
      });
    }

    form.addEventListener("submit", function (event) {
      var customerId = form.elements.customerId.value;
      var input = {
        name: form.elements.name.value,
        phone: form.elements.phone.value,
        address: form.elements.address.value
      };

      event.preventDefault();
      try {
        if (customerId) {
          customerService.updateCustomer(customerId, input);
        } else {
          customerService.addCustomer(input);
        }
        render(container);
        showNotice(container, customerId ? "تم تعديل بيانات العميل." : "تم حفظ العميل وكوده الثابت.", "success");
      } catch (error) {
        showNotice(container, error.message, "error");
      }
    });
  }

  global.PepsiApp.customerModule = {
    render: render
  };
}(window));
