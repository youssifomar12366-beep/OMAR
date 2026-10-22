(function (global) {
  "use strict";

  var purchaseService = global.PepsiApp.purchaseService;
  var bonusService = global.PepsiApp.bonusService;
  var inventoryService = global.PepsiApp.inventoryService;
  var requestCounter = 0;

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
    return (cents / 100).toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatQuantity(milli) {
    return (milli / 1000).toLocaleString("ar-EG", { maximumFractionDigits: 3 });
  }

  function nextRequestId() {
    requestCounter += 1;
    return "purchase-request-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + requestCounter.toString(36);
  }

  function nextBonusRequestId() {
    requestCounter += 1;
    return "bonus-request-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + requestCounter.toString(36);
  }

  function productOptions(products) {
    return '<option value="">اختر الصنف</option>' + products.filter(function (product) {
      return product.active;
    }).map(function (product) {
      return '<option value="' + escapeHtml(product.id) + '">' +
        escapeHtml(product.name) + ' (' + escapeHtml(product.code) + ')</option>';
    }).join("");
  }

  function lineMarkup(products) {
    return '<tr data-purchase-line>' +
      '<td><select data-purchase-product required>' + productOptions(products) + '</select></td>' +
      '<td><input data-purchase-quantity type="number" min="0.001" step="0.001" required></td>' +
      '<td><input data-purchase-price type="number" min="0" step="0.01" required></td>' +
      '<td><input data-sale-price type="number" min="0" step="0.01" required></td>' +
      '<td data-line-total>0.00</td>' +
      '<td><button class="text-button text-button--danger" type="button" data-action="remove-line">حذف</button></td>' +
    '</tr>';
  }

  function renderLines(container) {
    var products = inventoryService.getProducts();
    container.querySelector("#purchase-lines").innerHTML = lineMarkup(products);
    container.querySelector("#add-purchase-line").disabled = products.filter(function (product) {
      return product.active;
    }).length === 0;
  }

  function calculatePreview(container) {
    var totalCents = 0;
    var form = container.querySelector("#purchase-form");
    if (!form) {
      return;
    }
    form.querySelectorAll("[data-purchase-line]").forEach(function (row) {
      var quantity = Number(row.querySelector("[data-purchase-quantity]").value);
      var price = Number(row.querySelector("[data-purchase-price]").value);
      var lineCents = 0;
      if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price >= 0) {
        lineCents = Math.round(
          Math.round(quantity * 1000) * Math.round(price * 100) / 1000
        );
        if (Number.isSafeInteger(lineCents)) {
          totalCents += lineCents;
        } else {
          lineCents = 0;
        }
      }
      row.querySelector("[data-line-total]").textContent = formatMoney(lineCents);
    });
    if (!Number.isSafeInteger(totalCents)) {
      totalCents = 0;
    }
    var paidValue = form.elements.paidAmount.value.trim();
    var paidCents = paidValue === "" ? 0 : Math.round(Number(paidValue) * 100);
    if (!Number.isSafeInteger(paidCents) || paidCents < 0) {
      paidCents = 0;
    }
    form.querySelector("#purchase-total").textContent = formatMoney(totalCents);
    form.querySelector("#purchase-balance").textContent =
      formatMoney(Math.max(0, totalCents - paidCents));
  }

  function purchaseRows(purchases) {
    if (purchases.length === 0) {
      return '<tr><td class="table-empty" colspan="6">لا توجد طلبيات مسجلة بعد.</td></tr>';
    }
    return purchases.map(function (purchase) {
      var items = purchase.items.map(function (item) {
        return escapeHtml(item.productName) + " × " + formatQuantity(item.quantityMilli) +
          " @ " + formatMoney(item.purchasePriceCents);
      }).join("<br>");
      return '<tr><td><strong>' + escapeHtml(purchase.number) + '</strong><br>' +
        escapeHtml(new Date(purchase.createdAt).toLocaleString("ar-EG")) + '</td>' +
        '<td>' + escapeHtml(purchase.supplierName) + '</td><td>' + items + '</td>' +
        '<td>' + formatMoney(purchase.totalCents) + '</td><td>' +
        formatMoney(purchase.paidCents) + '</td><td>' +
        formatMoney(purchase.balanceCents) + '</td></tr>';
    }).join("");
  }

  function bonusRows(bonuses) {
    if (bonuses.length === 0) {
      return '<tr><td class="table-empty" colspan="4">لا توجد بونصات مسجلة بعد.</td></tr>';
    }
    return bonuses.map(function (bonus) {
      var settledCents = Number.isSafeInteger(bonus.settledCents) ? bonus.settledCents : 0;
      var profitCents = Number.isSafeInteger(bonus.profitCents)
        ? bonus.profitCents : bonus.amountCents;
      return '<tr><td>' + escapeHtml(new Date(bonus.createdAt).toLocaleString("ar-EG")) +
        '</td><td>' + formatMoney(bonus.amountCents) + ' ج.م</td><td>' +
        formatMoney(settledCents) + ' ج.م</td><td>' +
        formatMoney(profitCents) + ' ج.م</td></tr>';
    }).join("");
  }

  function render(container) {
    var summary;
    var purchases;
    var bonuses;
    var bonusTotalCents;
    var supplier;
    try {
      summary = purchaseService.getSummary();
      purchases = purchaseService.getPurchases();
      bonuses = bonusService.getBonuses();
      bonusTotalCents = bonuses.reduce(function (total, bonus) {
        var nextTotal = total + (Number.isSafeInteger(bonus.profitCents)
          ? bonus.profitCents : bonus.amountCents);
        if (!Number.isSafeInteger(nextTotal)) {
          throw new Error("إجمالي البونصات تجاوز الحد الآمن للحساب.");
        }
        return nextTotal;
      }, 0);
      supplier = purchaseService.getSupplier();
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل المشتريات</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.setAttribute("data-module", "purchases");
    container.innerHTML =
      '<section class="inventory-heading"><div><p class="inventory-eyebrow">إدارة التوريدات</p>' +
        '<h2>المشتريات والموردون</h2><p class="inventory-description">تسجيل الطلبيات والكميات المستلمة والمدفوعات للشركة.</p></div></section>' +
      '<div class="purchase-summary">' +
        '<article class="purchase-summary__card"><h3>إجمالي قيمة البضاعة</h3><p>' +
          formatMoney(summary.totalCents) + '</p></article>' +
        '<article class="purchase-summary__card"><h3>إجمالي المبلغ المدفوع للشركات</h3><p>' +
          formatMoney(summary.paidCents) + '</p></article>' +
        '<article class="purchase-summary__card"><h3>إجمالي المديونية</h3><p>' +
          formatMoney(summary.balanceCents) + '</p></article>' +
      '</div>' +
      '<div class="purchase-actions"><button class="button button--primary" type="button" data-action="new-purchase">+ إضافة طلبية جديدة</button>' +
        '<button class="button button--primary" type="button" data-action="new-bonus">إضافة بونص</button></div>' +
      '<div class="notice" id="purchase-notice" role="status" aria-live="polite" hidden></div>' +
      '<section class="inventory-panel bonus-form-panel" id="bonus-panel" hidden>' +
        '<div class="panel-heading"><div><h3>إضافة بونص من الشركة</h3>' +
          '<p class="panel-hint">أدخل المبلغ الذي حصل عليه المخزن من الشركة بالجنيه المصري (ج.م).</p></div></div>' +
        '<form id="bonus-form" data-form="bonus" novalidate>' +
          '<input type="hidden" name="requestId" value="' + escapeHtml(nextBonusRequestId()) + '">' +
          '<label for="bonus-amount">مبلغ البونص (ج.م)' +
            '<input id="bonus-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>' +
          '<div class="form-actions"><button class="button button--primary" type="submit">حفظ البونص</button>' +
            '<button class="button button--quiet" type="button" data-action="cancel-bonus">إلغاء</button></div>' +
        '</form>' +
      '</section>' +
      '<section class="inventory-panel purchase-form-panel" id="purchase-panel" hidden>' +
        '<div class="panel-heading"><div><h3>طلبية جديدة</h3><p class="panel-hint">المورد: <strong>' +
          escapeHtml(supplier.name) + '</strong></p></div></div>' +
        '<form id="purchase-form" data-form="purchase">' +
          '<input type="hidden" name="requestId" value="' + escapeHtml(nextRequestId()) + '">' +
            '<label>المورد<select name="supplierId" required><option value="' +
              escapeHtml(supplier.id) + '">' + escapeHtml(supplier.name) + '</option></select></label>' +
          '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
            '<th>الصنف</th><th>الكمية المستلمة</th><th>سعر الشراء الجديد للوحدة</th>' +
            '<th>سعر البيع الجديد للوحدة</th><th>إجمالي الصنف</th><th>إجراء</th>' +
          '</tr></thead><tbody id="purchase-lines"></tbody></table></div>' +
          '<button class="button button--quiet" id="add-purchase-line" type="button" data-action="add-line">+ إضافة صنف</button>' +
          '<div class="purchase-totals"><strong>إجمالي الطلبية: <span id="purchase-total">0.00</span></strong>' +
            '<label>المبلغ المدفوع فعليًا<input name="paidAmount" type="number" min="0" step="0.01" value="0" required></label>' +
            '<strong>المتبقي المستحق: <span id="purchase-balance">0.00</span></strong></div>' +
          '<div class="form-actions"><button class="button button--primary" type="submit">تأكيد الطلبية</button>' +
            '<button class="button button--quiet" type="button" data-action="cancel-purchase">إلغاء</button></div>' +
        '</form>' +
      '</section>' +
      '<section class="inventory-panel"><div class="inventory-toolbar"><div><h3>سجل بونصات الشركة</h3>' +
        '<p class="panel-hint">إجمالي ما أُضيف إلى صافي الربح: <strong>' + formatMoney(bonusTotalCents) +
        ' ج.م</strong></p></div></div><div class="table-wrap"><table class="inventory-table">' +
        '<thead><tr><th>التاريخ والوقت</th><th>مبلغ البونص</th><th>المسوّى من المديونية</th>' +
        '<th>المضاف لصافي الربح</th></tr></thead><tbody>' +
        bonusRows(bonuses) + '</tbody></table></div></section>' +
      '<section class="inventory-panel"><div class="inventory-toolbar"><div><h3>سجل الطلبيات</h3>' +
        '<p class="panel-hint">عدد الطلبيات المسجلة: <strong>' + purchases.length.toLocaleString("ar-EG") +
        '</strong></p></div></div><div class="table-wrap"><table class="inventory-table">' +
        '<thead><tr><th>الطلبية والتاريخ</th><th>المورد</th><th>الأصناف والكميات وسعر الشراء</th>' +
        '<th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>' +
        purchaseRows(purchases) + '</tbody></table></div></section>';
    renderLines(container);
    bindEvents(container);
  }

  function showNotice(container, message, type) {
    var notice = container.querySelector("#purchase-notice");
    notice.hidden = false;
    notice.className = "notice notice--" + type;
    notice.textContent = message;
  }

  function bindEvents(container) {
    if (container.purchaseEventsBound) {
      return;
    }
    container.purchaseEventsBound = true;
    container.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      var action;
      if (!button || !container.contains(button) ||
          container.getAttribute("data-module") !== "purchases") {
        return;
      }
      action = button.getAttribute("data-action");
      if (action === "new-purchase") {
        container.querySelector("#purchase-panel").hidden = false;
        container.querySelector("#purchase-panel").scrollIntoView({ block: "nearest" });
      } else if (action === "new-bonus") {
        container.querySelector("#bonus-panel").hidden = false;
        container.querySelector("#bonus-panel").scrollIntoView({ block: "nearest" });
        container.querySelector("#bonus-amount").focus();
      } else if (action === "cancel-purchase") {
        container.querySelector("#purchase-panel").hidden = true;
      } else if (action === "cancel-bonus") {
        container.querySelector("#bonus-panel").hidden = true;
      } else if (action === "add-line") {
        var products = inventoryService.getProducts();
        var rowHost = container.querySelector("#purchase-lines");
        rowHost.insertAdjacentHTML("beforeend", lineMarkup(products));
        rowHost.lastElementChild.querySelector("[data-purchase-product]").focus();
      } else if (action === "remove-line") {
        var rows = container.querySelectorAll("[data-purchase-line]");
        if (rows.length > 1) {
          button.closest("[data-purchase-line]").remove();
          calculatePreview(container);
        }
      }
    });

    container.addEventListener("input", function (event) {
      if (container.getAttribute("data-module") === "purchases" &&
          (event.target.matches("[data-purchase-quantity]") ||
           event.target.matches("[data-purchase-price]") ||
           event.target.matches("[data-sale-price]") ||
           event.target.matches('[name="paidAmount"]'))) {
        calculatePreview(container);
      }
    });

    container.addEventListener("submit", function (event) {
      var form = event.target;
      var lines;
      var purchase;
      var submitButton;
      if (form.getAttribute("data-form") !== "purchase" &&
          form.getAttribute("data-form") !== "bonus") {
        return;
      }
      event.preventDefault();
      if (form.getAttribute("data-saving") === "true") {
        return;
      }
      form.setAttribute("data-saving", "true");
      submitButton = form.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        if (form.getAttribute("data-form") === "bonus") {
        bonusService.createBonus({
            requestId: form.elements.requestId.value,
            amount: form.elements.amount.value
          });
          render(container);
          showNotice(container, "تم حفظ البونص وإضافته إلى صافي الربح.", "success");
          return;
        }
        lines = Array.prototype.map.call(form.querySelectorAll("[data-purchase-line]"), function (row) {
          return {
            productId: row.querySelector("[data-purchase-product]").value,
            quantity: row.querySelector("[data-purchase-quantity]").value,
            purchasePrice: row.querySelector("[data-purchase-price]").value,
            salePrice: row.querySelector("[data-sale-price]").value
          };
        });
        purchase = purchaseService.createPurchase({
          requestId: form.elements.requestId.value,
          supplierId: form.elements.supplierId.value,
          items: lines,
          paidAmount: form.elements.paidAmount.value
        });
        render(container);
        showNotice(container, "تم حفظ الطلبية " + purchase.number +
          " وتحديث المخزون والأسعار.", "success");
      } catch (error) {
        form.removeAttribute("data-saving");
        submitButton.disabled = false;
        showNotice(container, error.message, "error");
      }
    });
  }

  global.PepsiApp.purchaseModule = { render: render };
}(window));
