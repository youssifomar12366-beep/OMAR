(function (global) {
  "use strict";

  var reportService = global.PepsiApp.reportService;

  function formatMoney(cents) {
    return (cents / 100).toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function render(container, period) {
    var selectedPeriod = period || "month";
    var summary;
    try {
      summary = reportService.getSummary(selectedPeriod);
    } catch (error) {
      container.innerHTML = '<section class="empty-state" role="alert"><h2>تعذر تحميل التقرير</h2><p></p></section>';
      container.querySelector("p").textContent = error.message;
      return;
    }

    container.setAttribute("data-module", "reports");
    container.setAttribute("data-period", selectedPeriod);
    container.innerHTML =
      '<section class="inventory-heading"><div><p class="inventory-eyebrow">الأداء المالي</p>' +
        '<h2>التقرير والتصفية</h2><p class="inventory-description">ملخص العمليات المسجلة خلال الفترة المحددة.</p></div>' +
        '<label class="report-period">الفترة الزمنية<select id="report-period" aria-label="الفترة الزمنية">' +
          '<option value="month"' + (selectedPeriod === "month" ? " selected" : "") + '>آخر شهر</option>' +
          '<option value="year"' + (selectedPeriod === "year" ? " selected" : "") + '>آخر سنة</option>' +
        '</select></label></section>' +
      '<section class="report-cards" aria-label="الملخص المالي">' +
        '<article class="report-card"><h3>إجمالي قيمة البضاعة المشتراة من الشركة</h3><p>' +
          formatMoney(summary.purchasesCents) + '</p></article>' +
        '<article class="report-card"><h3>إجمالي المبيعات</h3><p>' +
          formatMoney(summary.salesCents) + '</p></article>' +
        '<article class="report-card"><h3>إجمالي المصروفات</h3><p>' +
          formatMoney(summary.expensesCents) + '</p></article>' +
        '<article class="report-card"><h3>صافي الربح</h3><p class="' +
          (summary.profitCents > 0 ? "report-profit-amount--positive" :
            summary.profitCents < 0 ? "report-profit-amount--negative" : "") + '">' +
          (summary.profitCents === null ? "غير متاح" : formatMoney(summary.profitCents)) + '</p></article>' +
        '<article class="report-card"><h3>إجمالي المبالغ المدفوعة للشركة</h3><p>' +
          formatMoney(summary.companyPaymentsCents) + '</p></article>' +
      '</section>' +
      (summary.hasUncostedSales
        ? '<p class="report-note" role="note">صافي الربح غير متاح بدقة: توجد مبيعات من مخزون لا يحتوي النظام على تكلفة شراء تاريخية موثقة له.</p>'
        : (summary.hasEstimatedCost
          ? '<p class="report-note" role="note">صافي الربح تقديري لبعض الكميات؛ لعدم توفر تكلفة تاريخية لها، استُخدم سعر الشراء الحالي المسجل للصنف.</p>'
          : ""));
    bindEvents(container);
  }

  function bindEvents(container) {
    if (container.reportEventsBound) {
      return;
    }
    container.reportEventsBound = true;
    container.addEventListener("change", function (event) {
      if (event.target.matches("#report-period") &&
          container.getAttribute("data-module") === "reports") {
        render(container, event.target.value);
      }
    });
  }

  global.PepsiApp.reportModule = { render: render };
}(window));
