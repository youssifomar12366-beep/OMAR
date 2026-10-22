(function (global) {
  "use strict";

  var expenseService = global.PepsiApp.expenseService;
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

  function requestId(prefix) {
    requestCounter += 1;
    return prefix + "-" + Date.now().toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFF).toString(36) + "-" + requestCounter.toString(36);
  }

  function peopleOptions(people, selectedId) {
    return '<option value="">اختر الشخص</option>' + people.map(function (person) {
      return '<option value="' + escapeHtml(person.id) + '"' +
        (person.id === selectedId ? " selected" : "") + '>' +
        escapeHtml(person.name) + '</option>';
    }).join("");
  }

  function peopleRows(people) {
    if (people.length === 0) {
      return '<tr><td class="table-empty" colspan="5">لا يوجد أشخاص مسجلون بعد.</td></tr>';
    }
    return people.map(function (person) {
      return '<tr><td><strong>' + escapeHtml(person.name) + '</strong></td>' +
        '<td>' + formatMoney(person.takenCents) + '</td>' +
        '<td>' + formatMoney(person.repaidCents) + '</td>' +
        '<td><strong>' + formatMoney(person.balanceCents) + '</strong></td>' +
        '<td><button class="text-button" type="button" data-action="details" data-person-id="' +
          escapeHtml(person.id) + '">عرض التفاصيل</button></td></tr>';
    }).join("");
  }

  function historyRows(history) {
    if (history.length === 0) {
      return '<tr><td class="table-empty" colspan="5">لا توجد عمليات مسجلة لهذا الشخص.</td></tr>';
    }
    return history.map(function (transaction) {
      return '<tr><td>' + escapeHtml(new Date(transaction.createdAt).toLocaleString("ar-EG")) + '</td>' +
        '<td>' + (transaction.type === "taken" ? "مبلغ أخذه" : "مبلغ سدده") + '</td>' +
        '<td>' + formatMoney(transaction.amountCents) + '</td>' +
        '<td>' + (transaction.description ? escapeHtml(transaction.description) : "—") + '</td>' +
        '<td><strong>' + formatMoney(transaction.balanceCents) + '</strong></td></tr>';
    }).join("");
  }

  function render(container, selectedPersonId) {
    var people;
    var selectedPerson = null;
    var history = [];
    try {
      people = expenseService.getPeople();
      selectedPerson = people.find(function (person) {
        return person.id === selectedPersonId;
      }) || null;
      if (selectedPerson) {
        history = expenseService.getHistory(selectedPerson.id);
      }
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل المصروفات</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.setAttribute("data-module", "expenses");
    container.innerHTML =
      '<section class="inventory-heading"><div><p class="inventory-eyebrow">إدارة المصروفات</p>' +
        '<h2>حسابات الأشخاص</h2><p class="inventory-description">سجل مستقل للمبالغ التي يأخذها الأشخاص وما يسددونه.</p></div>' +
        '<button class="button button--primary" type="button" data-action="show-expense">+ إضافة مصروف</button></section>' +
      '<div class="notice" id="expense-notice" role="status" aria-live="polite" hidden></div>' +
      '<section class="inventory-panel expense-form-panel" id="expense-form-panel" hidden>' +
        '<div class="panel-heading"><div><h3>تسجيل مبلغ أخذه شخص</h3></div></div>' +
        '<form id="expense-form" data-form="taken">' +
          '<input type="hidden" name="requestId" value="' + escapeHtml(requestId("expense-taken")) + '">' +
          '<label>الشخص<select name="personId" required>' + peopleOptions(people, "") + '</select></label>' +
          '<button class="button button--quiet expense-add-person-trigger" type="button" data-action="show-person-form">+ إضافة شخص جديد</button>' +
          '<label>المبلغ الذي أخذه<input name="amount" type="number" min="0.01" step="0.01" required></label>' +
          '<label>وصف المصروف أو السبب (اختياري)<input name="description" maxlength="240"></label>' +
          '<div class="form-actions"><button class="button button--primary" type="submit">حفظ</button>' +
            '<button class="button button--quiet" type="button" data-action="hide-expense">إلغاء</button></div>' +
        '</form>' +
        '<form id="expense-person-form" data-form="person" hidden>' +
          '<label>اسم الشخص<input name="name" maxlength="120" required></label>' +
          '<div class="form-actions"><button class="button button--primary" type="submit">حفظ الشخص</button>' +
            '<button class="button button--quiet" type="button" data-action="hide-person-form">إلغاء</button></div>' +
        '</form>' +
      '</section>' +
      '<section class="inventory-panel"><div class="inventory-toolbar"><div><h3>الأشخاص ومديونياتهم</h3>' +
        '<p class="panel-hint">عدد الأشخاص: <strong>' + people.length.toLocaleString("ar-EG") +
        '</strong></p></div></div><div class="table-wrap"><table class="inventory-table">' +
        '<thead><tr><th>اسم الشخص</th><th>إجمالي ما أخذه</th><th>إجمالي ما سدده</th>' +
        '<th>المديونية الحالية</th><th>التفاصيل</th></tr></thead><tbody>' +
        peopleRows(people) + '</tbody></table></div></section>' +
      (selectedPerson ? '<section class="inventory-panel expense-account-panel">' +
        '<div class="panel-heading"><div><h3>حساب ' + escapeHtml(selectedPerson.name) +
          '</h3><p class="panel-hint">المديونية الحالية: <strong>' +
          formatMoney(selectedPerson.balanceCents) + '</strong></p></div>' +
          '<button class="text-button" type="button" data-action="close-details">إغلاق التفاصيل</button></div>' +
        '<form id="repayment-form" data-form="repaid" data-person-id="' + escapeHtml(selectedPerson.id) + '">' +
          '<input type="hidden" name="requestId" value="' + escapeHtml(requestId("expense-repaid")) + '">' +
          '<h4>تسجيل سداد</h4><label>المبلغ المسدد<input name="amount" type="number" min="0.01" step="0.01" required></label>' +
          '<label>وصف السداد (اختياري)<input name="description" maxlength="240"></label>' +
          '<div class="form-actions"><button class="button button--primary" type="submit">حفظ السداد</button></div>' +
        '</form><h4 class="expense-history-title">سجل العمليات</h4>' +
        '<div class="table-wrap"><table class="inventory-table"><thead><tr>' +
          '<th>تاريخ العملية</th><th>نوع العملية</th><th>المبلغ</th><th>الوصف</th><th>الرصيد بعد العملية</th>' +
        '</tr></thead><tbody>' + historyRows(history) + '</tbody></table></div></section>' : "");
    bindEvents(container);
  }

  function showNotice(container, message, type) {
    var notice = container.querySelector("#expense-notice");
    notice.hidden = false;
    notice.className = "notice notice--" + type;
    notice.textContent = message;
  }

  function bindEvents(container) {
    if (container.expenseEventsBound) {
      return;
    }
    container.expenseEventsBound = true;
    container.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      var panel;
      if (!button || !container.contains(button) ||
          container.getAttribute("data-module") !== "expenses") {
        return;
      }
      panel = container.querySelector("#expense-form-panel");
      switch (button.getAttribute("data-action")) {
      case "show-expense":
        panel.hidden = false;
        panel.scrollIntoView({ block: "nearest" });
        break;
      case "hide-expense":
        panel.hidden = true;
        break;
      case "show-person-form":
        container.querySelector("#expense-person-form").hidden = false;
        break;
      case "hide-person-form":
        container.querySelector("#expense-person-form").hidden = true;
        break;
      case "details":
        render(container, button.getAttribute("data-person-id"));
        break;
      case "close-details":
        render(container);
        break;
      }
    });

    container.addEventListener("submit", function (event) {
      var form = event.target;
      var transaction;
      var person;
      if (!form.matches('[data-form="taken"], [data-form="repaid"], [data-form="person"]') ||
          container.getAttribute("data-module") !== "expenses") {
        return;
      }
      event.preventDefault();
      if (form.getAttribute("data-saving") === "true") {
        return;
      }
      form.setAttribute("data-saving", "true");
      var submitButton = form.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        if (form.getAttribute("data-form") === "person") {
          person = expenseService.addPerson({ name: form.elements.name.value });
          render(container);
          container.querySelector("#expense-form-panel").hidden = false;
          container.querySelector('#expense-form [name="personId"]').value = person.id;
          container.querySelector("#expense-person-form").hidden = true;
          showNotice(container, "تم حفظ الشخص. إذا كان مسجلًا من قبل، تم استخدام سجله الحالي.", "success");
          return;
        }
        transaction = expenseService.recordTransaction({
          requestId: form.elements.requestId.value,
          personId: form.getAttribute("data-form") === "repaid"
            ? form.getAttribute("data-person-id") : form.elements.personId.value,
          type: form.getAttribute("data-form"),
          amount: form.elements.amount.value,
          description: form.elements.description.value
        });
        render(container, transaction.type === "repaid"
          ? transaction.personId : undefined);
        showNotice(container, transaction.type === "taken"
          ? "تم تسجيل المبلغ الذي أخذه الشخص."
          : "تم تسجيل السداد وتحديث المديونية.", "success");
      } catch (error) {
        form.removeAttribute("data-saving");
        submitButton.disabled = false;
        showNotice(container, error.message, "error");
      }
    });
  }

  global.PepsiApp.expenseModule = { render: render };
}(window));
