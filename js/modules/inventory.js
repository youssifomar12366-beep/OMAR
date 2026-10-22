(function (global) {
  "use strict";

  var service = global.PepsiApp.inventoryService;

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
    if (cents === null || typeof cents === "undefined") {
      return "—";
    }
    return (cents / 100).toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatQuantity(milli) {
    return (milli / 1000).toLocaleString("ar-EG", {
      maximumFractionDigits: 3
    });
  }

  function formatDate(value) {
    return new Date(value).toLocaleString("ar-EG");
  }

  function productRows(products, search) {
    var query = search.trim().toLocaleLowerCase();
    var filtered = products.filter(function (product) {
      return product.name.toLocaleLowerCase().indexOf(query) !== -1 ||
        product.code.toLocaleLowerCase().indexOf(query) !== -1;
    });

    if (filtered.length === 0) {
      return '<tr><td class="table-empty" colspan="8">' +
        (products.length === 0 ? "لا توجد أصناف. أضف أول صنف للبدء." : "لا توجد نتائج مطابقة للبحث.") +
        "</td></tr>";
    }

    return filtered.map(function (product) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(product.code) + '</strong></td>' +
        '<td>' + escapeHtml(product.name) + '</td>' +
        '<td>' + escapeHtml(product.unit) + '</td>' +
        '<td><span class="' + (product.lowStockThresholdMilli > 0 &&
          product.stockQuantityMilli <= product.lowStockThresholdMilli ? "stock-value stock-value--low" : "stock-value") +
          '">' + formatQuantity(product.stockQuantityMilli) + '</span></td>' +
        '<td>' + formatMoney(product.purchasePriceCents) + '</td>' +
        '<td>' + formatMoney(product.salePriceCents) + '</td>' +
        '<td><span class="status-label ' + (product.active ? "status-label--active" : "status-label--inactive") + '">' +
          (product.active ? "نشط" : "معطل") + '</span></td>' +
        '<td class="table-actions">' +
          '<button class="text-button" type="button" data-action="replenish" data-id="' + escapeHtml(product.id) + '">تزويد</button>' +
          '<button class="text-button" type="button" data-action="edit" data-id="' + escapeHtml(product.id) + '">تعديل</button>' +
          '<button class="text-button" type="button" data-action="movements" data-id="' + escapeHtml(product.id) + '">الحركة</button>' +
          '<button class="text-button" type="button" data-action="toggle" data-active="' + (!product.active) + '" data-id="' + escapeHtml(product.id) + '">' +
            (product.active ? "تعطيل" : "تفعيل") + '</button>' +
        '</td>' +
      '</tr>';
    }).join("");
  }

  function formMarkup() {
    return '<section class="inventory-panel inventory-form-panel" id="inventory-form-panel" hidden>' +
      '<div class="panel-heading"><div><h3 id="form-title">إضافة صنف</h3>' +
      '<p class="panel-hint">الرصيد الافتتاحي يُسجل كحركة، ولا يتغير عند تعديل بيانات الصنف.</p></div></div>' +
      '<form class="inventory-form" id="inventory-form">' +
        '<input type="hidden" name="productId">' +
        '<label>كود الصنف<input name="code" maxlength="40" autocomplete="off" required></label>' +
        '<label>اسم الصنف<input name="name" maxlength="120" autocomplete="off" required></label>' +
        '<label>وحدة القياس<input name="unit" maxlength="40" placeholder="مثل: كرتونة أو عبوة" required></label>' +
        '<label>سعر الشراء<input name="purchasePrice" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
        '<label>سعر البيع<input name="salePrice" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
        '<label data-opening-field>الرصيد الافتتاحي<input name="openingQuantity" type="number" min="0" step="0.001" inputmode="decimal" required></label>' +
        '<label>حد تنبيه انخفاض المخزون<input name="lowStockThreshold" type="number" min="0" step="0.001" value="0" inputmode="decimal" required></label>' +
        '<div class="form-actions">' +
          '<button class="button button--primary" type="submit">حفظ الصنف</button>' +
          '<button class="button button--quiet" type="button" data-action="cancel-form">إلغاء</button>' +
        '</div>' +
      '</form>' +
    '</section>';
  }

  function replenishmentFormMarkup() {
    return '<section class="inventory-panel inventory-form-panel" id="replenishment-panel" hidden>' +
      '<div class="panel-heading"><div><h3>تزويد المخزون</h3>' +
      '<p class="panel-hint">الصنف: <strong id="replenishment-product-name"></strong></p></div></div>' +
      '<form class="inventory-form" id="replenishment-form" novalidate>' +
        '<input type="hidden" name="productId">' +
        '<label>الكمية المضافة<input name="quantity" type="number" min="1" step="1" inputmode="numeric" required></label>' +
        '<div class="form-actions">' +
          '<button class="button button--primary" type="submit">تأكيد التزويد</button>' +
          '<button class="button button--quiet" type="button" data-action="cancel-replenishment">إلغاء</button>' +
        '</div>' +
      '</form>' +
    '</section>';
  }

  function render(container) {
    var products;
    container.setAttribute("data-module", "inventory");

    try {
      products = service.getProducts();
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل الأصناف</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.innerHTML =
      '<section class="inventory-heading">' +
        '<div><p class="inventory-eyebrow">إدارة المخزون</p><h2>الأصناف</h2>' +
        '<p class="inventory-description">أضف الأصناف وأسعارها ورصيدها الافتتاحي. رصيد المخزون محسوب من سجل الحركات.</p></div>' +
        '<button class="button button--primary" type="button" data-action="new">إضافة صنف</button>' +
      '</section>' +
      '<div class="notice" id="inventory-notice" role="status" aria-live="polite" hidden></div>' +
      formMarkup() +
      replenishmentFormMarkup() +
      '<section class="inventory-panel">' +
        '<div class="inventory-toolbar"><div><h3>قائمة الأصناف</h3>' +
          '<p class="panel-hint">عدد الأصناف المسجلة: <strong id="product-count">' + products.length + '</strong></p>' +
          '</div>' +
          '<label class="search-field">بحث<input id="product-search" type="search" placeholder="ابحث بالاسم أو الكود" autocomplete="off"></label>' +
        '</div>' +
        '<div class="table-wrap"><table class="inventory-table">' +
          '<thead><tr><th>الكود</th><th>اسم الصنف</th><th>الوحدة</th><th>الرصيد</th><th>الشراء</th><th>البيع</th><th>الحالة</th><th>الإجراءات</th></tr></thead>' +
          '<tbody id="product-rows">' + productRows(products, "") + '</tbody>' +
        '</table></div>' +
      '</section>' +
      '<section class="inventory-panel movement-panel" id="movement-panel" hidden></section>';

    bindEvents(container);
  }

  function bindEvents(container) {
    var form = container.querySelector("#inventory-form");
    var formPanel = container.querySelector("#inventory-form-panel");
    var replenishmentPanel = container.querySelector("#replenishment-panel");
    var search = container.querySelector("#product-search");

    search.addEventListener("input", function () {
      try {
        container.querySelector("#product-rows").innerHTML =
          productRows(service.getProducts(), search.value);
      } catch (error) {
        showNotice(container, error.message, "error");
      }
    });

    if (!container.inventoryClickHandlerBound) {
      container.inventoryClickHandlerBound = true;
      container.addEventListener("click", function (event) {
        var button = event.target.closest("[data-action]");
        var action;
        var productId;
        var product;
        var currentForm = container.querySelector("#inventory-form");
        var currentFormPanel = container.querySelector("#inventory-form-panel");
        var replenishmentPanel = container.querySelector("#replenishment-panel");

        if (!button || !container.contains(button) ||
            container.getAttribute("data-module") !== "inventory") {
          return;
        }

        action = button.getAttribute("data-action");
        productId = button.getAttribute("data-id");

        if (action === "new") {
          currentForm.reset();
          currentForm.elements.productId.value = "";
          currentForm.elements.lowStockThreshold.value = "0";
          currentForm.elements.openingQuantity.required = true;
          currentForm.querySelector("[data-opening-field]").hidden = false;
          container.querySelector("#form-title").textContent = "إضافة صنف";
          currentFormPanel.hidden = false;
          currentForm.elements.code.focus();
          return;
        }

        if (action === "cancel-form") {
          currentFormPanel.hidden = true;
          return;
        }

        if (action === "cancel-replenishment") {
          replenishmentPanel.hidden = true;
          return;
        }

        try {
          if (action === "clear-test-data") {
            if (!global.confirm("سيتم حذف جميع بيانات الاختبار المحلية نهائيًا. لا تستخدم هذا الخيار مع بيانات فعلية. هل تريد المتابعة؟")) {
              return;
            }
            service.clearTestData();
            render(container);
            showNotice(container, "تم مسح بيانات الاختبار المحلية.", "success");
            return;
          }

          if (action === "replenish") {
            product = service.getProducts().find(function (item) {
              return item.id === productId;
            });
            if (!product) {
              throw new Error("الصنف المطلوب غير موجود.");
            }

            currentFormPanel.hidden = true;
            container.querySelector("#movement-panel").hidden = true;
            var replenishmentForm = container.querySelector("#replenishment-form");
            replenishmentForm.reset();
            replenishmentForm.removeAttribute("data-saving");
            replenishmentForm.querySelector('[type="submit"]').disabled = false;
            replenishmentForm.elements.productId.value = product.id;
            container.querySelector("#replenishment-product-name").textContent = product.name;
            replenishmentPanel.hidden = false;
            replenishmentForm.elements.quantity.focus();
            return;
          }

          if (action === "edit") {
            product = service.getProducts().find(function (item) {
              return item.id === productId;
            });
            if (!product) {
              throw new Error("الصنف المطلوب غير موجود.");
            }

            currentForm.reset();
            currentForm.elements.productId.value = product.id;
            currentForm.elements.code.value = product.code;
            currentForm.elements.name.value = product.name;
            currentForm.elements.unit.value = product.unit;
            currentForm.elements.purchasePrice.value = product.purchasePriceCents === null
              ? "" : (product.purchasePriceCents / 100).toFixed(2);
            currentForm.elements.salePrice.value = product.salePriceCents === null
              ? "" : (product.salePriceCents / 100).toFixed(2);
            currentForm.elements.lowStockThreshold.value = (product.lowStockThresholdMilli / 1000).toFixed(3);
            currentForm.elements.openingQuantity.required = false;
            currentForm.querySelector("[data-opening-field]").hidden = true;
            container.querySelector("#form-title").textContent = "تعديل بيانات الصنف";
            currentFormPanel.hidden = false;
            currentForm.elements.name.focus();
            return;
          }

          if (action === "toggle") {
            var nextActive = button.getAttribute("data-active") === "true";
            product = service.getProducts().find(function (item) {
              return item.id === productId;
            });
            if (!nextActive && !global.confirm("سيتم تعطيل الصنف مع الاحتفاظ بسجله. هل تريد المتابعة؟")) {
              return;
            }
            service.setActive(productId, nextActive);
            render(container);
            showNotice(container, nextActive ? "تم تفعيل الصنف." : "تم تعطيل الصنف.", "success");
            return;
          }

          if (action === "movements") {
            showMovements(container, productId);
          }
        } catch (error) {
          showNotice(container, error.message, "error");
        }
      });

      container.querySelector("#replenishment-form").addEventListener("submit", function (event) {
        var replenishmentForm = event.currentTarget;
        var submitButton = replenishmentForm.querySelector('[type="submit"]');
        var productId;
        var quantity;
        var replenishmentSaved = false;

        event.preventDefault();
        if (replenishmentForm.getAttribute("data-saving") === "true") {
          return;
        }

        replenishmentForm.setAttribute("data-saving", "true");
        submitButton.disabled = true;
        productId = replenishmentForm.elements.productId.value;
        quantity = replenishmentForm.elements.quantity.value;

        try {
          service.replenishStock(productId, quantity);
          replenishmentSaved = true;
          container.querySelector("#product-rows").innerHTML =
            productRows(service.getProducts(), search.value);
          replenishmentForm.reset();
          replenishmentPanel.hidden = true;
          showNotice(container, "تم تزويد الصنف وتحديث رصيده.", "success");
        } catch (error) {
          if (replenishmentSaved) {
            replenishmentPanel.hidden = true;
            showNotice(container, "تم حفظ التزويد، لكن تعذر تحديث عرض الأصناف: " + error.message, "error");
          } else {
            replenishmentForm.removeAttribute("data-saving");
            submitButton.disabled = false;
            showNotice(container, error.message, "error");
          }
        }
      });
    }

    form.addEventListener("submit", function (event) {
      var productId;
      var input;

      event.preventDefault();
      productId = form.elements.productId.value;
      input = {
        code: form.elements.code.value,
        name: form.elements.name.value,
        unit: form.elements.unit.value,
        purchasePrice: form.elements.purchasePrice.value,
        salePrice: form.elements.salePrice.value,
        openingQuantity: form.elements.openingQuantity.value,
        lowStockThreshold: form.elements.lowStockThreshold.value
      };

      try {
        if (productId) {
          service.updateProduct(productId, input);
        } else {
          service.addProduct(input);
        }
        render(container);
        showNotice(container, productId
          ? "تم تعديل بيانات الصنف دون تغيير رصيده."
          : "تم حفظ الصنف ورصيده الافتتاحي.", "success");
      } catch (error) {
        showNotice(container, error.message, "error");
      }
    });
  }

  function showNotice(container, message, type) {
    var notice = container.querySelector("#inventory-notice");
    if (!notice) {
      return;
    }
    notice.hidden = false;
    notice.className = "notice notice--" + type;
    notice.textContent = message;
  }

  function showMovements(container, productId) {
    var products = service.getProducts();
    var product = products.find(function (item) {
      return item.id === productId;
    });
    var movements = service.getMovements(productId);
    var panel = container.querySelector("#movement-panel");

    if (!product) {
      throw new Error("الصنف المطلوب غير موجود.");
    }

    panel.hidden = false;
    panel.innerHTML =
      '<div class="inventory-toolbar"><div><h3>حركة مخزون: ' + escapeHtml(product.name) + '</h3>' +
        '<p class="panel-hint">الرصيد الحالي: <strong>' + formatQuantity(product.stockQuantityMilli) + ' ' + escapeHtml(product.unit) + '</strong></p></div>' +
        '<button class="button button--quiet" type="button" data-action="close-movements">إغلاق</button></div>' +
      (movements.length === 0
        ? '<p class="panel-hint">لا توجد حركات مسجلة لهذا الصنف.</p>'
        : '<div class="table-wrap"><table class="inventory-table"><thead><tr><th>نوع الحركة</th><th>الكمية</th><th>المرجع</th><th>التاريخ والوقت</th></tr></thead><tbody>' +
          movements.map(function (movement) {
            var movementTypes = {
              opening: "رصيد افتتاحي",
              stock_replenishment: "تزويد مخزون",
              trip_issue: "صرف لطلعة",
              trip_replenishment: "تزويد طلعة",
              trip_return: "راجع طلعة"
            };
            var movementType = movementTypes[movement.type] || movement.type;
            return '<tr><td>' + escapeHtml(movementType) + '</td><td>' +
              formatQuantity(movement.quantityMilli) + ' ' + escapeHtml(product.unit) + '</td><td>' +
              escapeHtml(movement.reference) + '</td><td>' + escapeHtml(formatDate(movement.createdAt)) + '</td></tr>';
          }).join("") +
          '</tbody></table></div>');

    panel.querySelector('[data-action="close-movements"]').addEventListener("click", function () {
      panel.hidden = true;
    });
  }

  global.PepsiApp.inventoryModule = {
    render: render
  };
}(window));
