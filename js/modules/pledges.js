(function (global) {
  "use strict";

  var service = global.PepsiApp.pledgeService;

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

  function pledgeRows(pledges) {
    if (pledges.length === 0) {
      return '<tr><td class="table-empty" colspan="5">لا توجد رهون نشطة مسجلة.</td></tr>';
    }
    return pledges.map(function (pledge, index) {
      return '<tr><td>' + (index + 1).toLocaleString("ar-EG") + '</td><td>' +
        escapeHtml(pledge.name) + '</td><td>' + formatMoney(pledge.amountCents) +
        ' ج.م</td><td>' + escapeHtml(new Date(pledge.createdAt).toLocaleString("ar-EG")) +
        '</td><td><button class="button button--quiet" type="button" data-action="settle" data-id="' +
        escapeHtml(pledge.id) + '">تم السداد</button></td></tr>';
    }).join("");
  }

  function render(container) {
    var pledges;
    try {
      pledges = service.getPledges();
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل سجلات الرهن</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.setAttribute("data-module", "pledges");
    container.innerHTML =
      '<section class="inventory-heading"><div><p class="inventory-eyebrow">السجلات المستقلة</p>' +
        '<h2>الرهن</h2><p class="inventory-description">إدارة المبالغ المرهونة للأشخاص بصورة مستقلة عن حسابات المخزن.</p></div>' +
        '<button class="button button--primary" type="button" data-action="add">إضافة رهن</button></section>' +
      '<div class="notice" id="pledge-notice" role="status" aria-live="polite" hidden></div>' +
      '<section class="inventory-panel"><div class="inventory-toolbar"><div><h3>الرهون النشطة</h3>' +
        '<p class="panel-hint">عدد السجلات النشطة: <strong>' + pledges.length.toLocaleString("ar-EG") +
        '</strong></p></div></div><div class="table-wrap"><table class="inventory-table">' +
        '<thead><tr><th>م.</th><th>اسم الشخص</th><th>المبلغ المرهون (ج.م)</th>' +
        '<th>تاريخ تسجيل الرهن</th><th>الإجراءات</th></tr></thead><tbody>' +
        pledgeRows(pledges) + '</tbody></table></div></section>' +
      '<dialog class="pledge-dialog" aria-labelledby="pledge-dialog-title">' +
        '<div class="panel-heading"><div><h3 id="pledge-dialog-title">إضافة رهن</h3></div></div>' +
        '<form id="pledge-form" novalidate>' +
          '<label for="pledge-name">اسم الشخص' +
            '<input id="pledge-name" name="name" type="text" maxlength="120" required></label>' +
          '<label for="pledge-amount">المبلغ المرهون (ج.م)' +
            '<input id="pledge-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>' +
          '<div class="pledge-dialog__actions"><button class="button button--primary" type="submit">حفظ</button>' +
            '<button class="button button--quiet" type="button" data-action="cancel">إلغاء</button></div>' +
        '</form>' +
      '</dialog>';
    bindEvents(container);
  }

  function showNotice(container, message, type) {
    var notice = container.querySelector("#pledge-notice");
    notice.hidden = false;
    notice.className = "notice notice--" + type;
    notice.textContent = message;
  }

  function bindEvents(container) {
    if (container.pledgeEventsBound) {
      return;
    }
    container.pledgeEventsBound = true;
    container.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      var action;
      var dialog;
      if (!button || !container.contains(button) ||
          container.getAttribute("data-module") !== "pledges") {
        return;
      }
      action = button.getAttribute("data-action");
      if (action === "add") {
        dialog = container.querySelector(".pledge-dialog");
        dialog.showModal();
        dialog.querySelector('[name="name"]').focus();
      } else if (action === "cancel") {
        container.querySelector(".pledge-dialog").close();
      } else if (action === "settle") {
        if (!global.confirm("هل تؤكد استلام الشخص لرهنه وإغلاق هذا السجل؟")) {
          return;
        }
        try {
          if (service.settlePledge(button.getAttribute("data-id"))) {
            render(container);
            showNotice(container, "تم إغلاق سجل الرهن بعد استلام الشخص لمبلغه.", "success");
          }
        } catch (error) {
          showNotice(container, error.message, "error");
        }
      }
    });

    container.addEventListener("submit", function (event) {
      var form = event.target;
      var submitButton;
      if (form.id !== "pledge-form") {
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
        service.createPledge({
          name: form.elements.name.value,
          amount: form.elements.amount.value
        });
        render(container);
        showNotice(container, "تم حفظ سجل الرهن بنجاح.", "success");
      } catch (error) {
        form.removeAttribute("data-saving");
        submitButton.disabled = false;
        showNotice(container, error.message, "error");
      }
    });

    container.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && event.target.closest(".pledge-dialog")) {
        event.preventDefault();
        container.querySelector(".pledge-dialog").close();
      }
    });
  }

  global.PepsiApp.pledgeModule = { render: render };
}(window));
