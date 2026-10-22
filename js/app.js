(function () {
  "use strict";

  var pageTitles = {
    dashboard: "لوحة التحكم",
    inventory: "الأصناف والمخزون",
    trips: "الطلعات",
    customers: "العملاء",
    purchases: "المشتريات والموردون",
    expenses: "المصروفات",
    reports: "التقارير والتصفية"
  };
  var navigation = document.querySelector(".navigation");
  var pageTitle = document.getElementById("page-title");
  var pageContent = document.getElementById("page-content");
  var dashboardMetrics = [
    { id: "sales", label: "إجمالي مبيعات اليوم", key: "salesCents", color: "#1976D2" },
    { id: "collections", label: "تحصيلات اليوم", key: "collectionsCents", color: "#16A34A" },
    { id: "debt", label: "المتبقي على التجار", key: "debtCents", color: "#D97706" },
    { id: "expenses", label: "مصاريف اليوم", key: "expensesCents", color: "#8B5CF6" },
    { id: "profit", label: "صافي ربح اليوم", key: "profitCents", color: "#0891B2" }
  ];
  var dashboardChartCircumference = 2 * Math.PI * 70;
  var dashboardChartGap = 2.5;
  var dashboardChartShares = dashboardMetrics.map(function () { return 0; });
  var dashboardChartFrame = 0;

  function showPage(page) {
    var title = pageTitles[page];
    var activeButton;

    if (!title) {
      return;
    }

    activeButton = navigation.querySelector('[data-page="' + page + '"]');
    navigation.querySelectorAll(".navigation__item").forEach(function (button) {
      button.classList.toggle("is-active", button === activeButton);
      if (button === activeButton) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    pageTitle.textContent = title;

    if (page === "dashboard") {
      renderDashboard();
      return;
    }

    if (page === "inventory") {
      window.PepsiApp.inventoryModule.render(pageContent);
      return;
    }

    if (page === "trips") {
      window.PepsiApp.tripModule.render(pageContent);
      return;
    }

    if (page === "customers") {
      window.PepsiApp.customerModule.render(pageContent);
      return;
    }

    if (page === "purchases") {
      window.PepsiApp.purchaseModule.render(pageContent);
      return;
    }

    if (page === "expenses") {
      window.PepsiApp.expenseModule.render(pageContent);
      return;
    }

    if (page === "reports") {
      window.PepsiApp.reportModule.render(pageContent);
      return;
    }

    pageContent.innerHTML =
      '<section class="section-placeholder" aria-labelledby="placeholder-title">' +
        '<h2 id="placeholder-title">' + title + '</h2>' +
        '<p>هذا القسم ضمن مراحل التنفيذ التالية. لم تُضف إليه وظائف أو بيانات بعد.</p>' +
      '</section>';
  }

  function formatMoney(cents) {
    return cents === null ? "غير متاح" : (cents / 100).toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function metricValue(summary, metric) {
    return formatMoney(summary[metric.key]);
  }

  function getDashboardChartShares(summary) {
    var values = dashboardMetrics.map(function (metric) {
      var value = summary[metric.key];
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    });
    var total = values.reduce(function (sum, value) { return sum + value; }, 0);
    return total > 0 ? values.map(function (value) { return value / total; }) :
      values.map(function () { return 0; });
  }

  function chartSegmentGeometry(shares, index) {
    var offset = shares.slice(0, index).reduce(function (sum, share) {
      return sum + share * dashboardChartCircumference;
    }, 0);
    var length = Math.max(0, shares[index] * dashboardChartCircumference -
      (shares[index] > 0 ? dashboardChartGap : 0));
    return { length: length, offset: offset + (shares[index] > 0 ? dashboardChartGap / 2 : 0) };
  }

  function updateDashboardChart(shares) {
    pageContent.querySelectorAll(".dashboard-chart__segment").forEach(function (segment, index) {
      var geometry = chartSegmentGeometry(shares, index);
      segment.setAttribute("stroke-dasharray",
        geometry.length.toFixed(3) + " " +
        (dashboardChartCircumference - geometry.length).toFixed(3));
      segment.setAttribute("stroke-dashoffset", (-geometry.offset).toFixed(3));
    });
  }

  function animateDashboardChart(targetShares) {
    var fromShares = dashboardChartShares.slice();
    var startTime;
    var duration = 650;
    var reducedMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (dashboardChartFrame) {
      window.cancelAnimationFrame(dashboardChartFrame);
    }
    if (reducedMotion) {
      dashboardChartShares = targetShares.slice();
      updateDashboardChart(dashboardChartShares);
      return;
    }

    function step(timestamp) {
      var progress;
      var easedProgress;
      if (typeof startTime === "undefined") {
        startTime = timestamp;
      }
      progress = Math.min(1, (timestamp - startTime) / duration);
      easedProgress = progress * progress * (3 - 2 * progress);
      dashboardChartShares = fromShares.map(function (share, index) {
        return share + (targetShares[index] - share) * easedProgress;
      });
      updateDashboardChart(dashboardChartShares);
      if (progress < 1) {
        dashboardChartFrame = window.requestAnimationFrame(step);
      } else {
        dashboardChartShares = targetShares.slice();
        dashboardChartFrame = 0;
      }
    }

    dashboardChartFrame = window.requestAnimationFrame(step);
  }

  function renderDashboard(selectedMetricId) {
    var summary;
    var selectedIndex;
    var selectedMetric;
    var today;
    var metricsMarkup;
    var cardsMarkup;
    var targetChartShares;

    try {
      summary = window.PepsiApp.reportService.getDailySummary();
    } catch (error) {
      pageContent.innerHTML =
        '<section class="empty-state" role="alert"><h2>تعذر تحميل ملخص البيانات</h2><p></p></section>';
      pageContent.querySelector("p").textContent = error.message;
      return;
    }

    selectedIndex = dashboardMetrics.findIndex(function (metric) {
      return metric.id === selectedMetricId;
    });
    if (selectedIndex < 0) {
      selectedIndex = 0;
    }
    selectedMetric = dashboardMetrics[selectedIndex];
    today = new Date(summary.dateKey + "T12:00:00");
    targetChartShares = getDashboardChartShares(summary);
    metricsMarkup = dashboardMetrics.map(function (metric, index) {
      var geometry = chartSegmentGeometry(dashboardChartShares, index);
      return '<circle class="dashboard-chart__segment' +
        (index === selectedIndex ? " is-selected" : "") +
        '" cx="80" cy="80" r="70" fill="none" stroke="' + metric.color +
        '" stroke-dasharray="' + geometry.length.toFixed(3) + " " +
        (dashboardChartCircumference - geometry.length).toFixed(3) +
        '" stroke-dashoffset="' + (-geometry.offset).toFixed(3) +
        '" data-chart-metric="' + metric.id + '"></circle>';
    }).join("");
    cardsMarkup = dashboardMetrics.map(function (metric) {
      var value = metricValue(summary, metric);
      return '<article class="dashboard-stat-card dashboard-stat-card--' + metric.id + '">' +
        '<h3>' + metric.label + '</h3><p>' + value +
        (summary[metric.key] === null ? "" : ' <span>ج.م</span>') + '</p></article>';
    }).join("");

    pageContent.innerHTML =
      '<section class="welcome-panel" aria-labelledby="welcome-title">' +
        '<div>' +
          '<p class="welcome-panel__eyebrow">ملخص يوم ' +
            today.toLocaleDateString("ar-EG", { weekday: "long" }) + '</p>' +
          '<h2 id="welcome-title">إحصائيات اليوم</h2>' +
          '<p class="welcome-panel__text">' +
            (summary.tripCount === 0 && summary.salesCents === 0 &&
              summary.collectionsCents === 0 && summary.expensesCents === 0
              ? "لا توجد معاملات مسجلة اليوم حتى الآن."
              : "ملخص مباشر للحركات المسجلة بتاريخ اليوم.") +
          '</p>' +
        '</div>' +
        '<div class="welcome-panel__illustration" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '</section>' +
      '<section class="dashboard-panel" aria-labelledby="daily-chart-title">' +
        '<div class="dashboard-panel__heading"><div><p class="inventory-eyebrow">الأداء المالي</p>' +
          '<h2 id="daily-chart-title">مؤشرات اليوم</h2></div>' +
          '<span class="dashboard-date">' +
            today.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" }) +
          '</span></div>' +
        '<div class="dashboard-chart-layout">' +
          '<div class="dashboard-chart" role="img" aria-label="رسم يوضح نسبة كل مؤشر إلى مجموع القيم الموجبة المعروضة">' +
            '<svg class="dashboard-chart__svg" viewBox="0 0 160 160" aria-hidden="true">' +
              '<circle class="dashboard-chart__track" cx="80" cy="80" r="70"></circle>' +
              metricsMarkup +
            '</svg>' +
            '<div class="dashboard-chart__center" aria-live="polite">' +
              '<span>' + selectedMetric.label + '</span>' +
              '<strong>' + metricValue(summary, selectedMetric) + '</strong>' +
              (summary[selectedMetric.key] === null ? "" : '<small>ج.م</small>') +
            '</div>' +
          '</div>' +
          '<div class="dashboard-legend" aria-label="اختر مؤشرًا لعرض قيمته">' +
            dashboardMetrics.map(function (metric) {
              return '<button class="dashboard-legend__item' +
                (metric.id === selectedMetric.id ? " is-selected" : "") +
                '" type="button" data-dashboard-metric="' + metric.id + '">' +
                '<span class="dashboard-legend__dot" style="--metric-color:' + metric.color +
                '" aria-hidden="true"></span><span class="dashboard-legend__label">' +
                metric.label + '</span><strong>' + metricValue(summary, metric) +
                (summary[metric.key] === null ? "" : ' <small>ج.م</small>') +
                '</strong></button>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<p class="dashboard-chart-note">يعرض الرسم النسبة من مجموع القيم الموجبة للمؤشرات؛ القيم السالبة وغير المتاحة لا تكوّن قطاعًا.</p>' +
      '</section>' +
      '<section class="dashboard-stats" aria-label="تفاصيل المؤشرات المالية اليومية">' +
        cardsMarkup +
      '</section>' +
      (summary.profitCents === null
        ? '<p class="report-note" role="note">صافي الربح غير متاح بدقة لوجود مبيعات لا تتوفر لها تكلفة بضاعة موثقة.</p>'
        : (summary.hasEstimatedCost
          ? '<p class="report-note" role="note">صافي الربح تقديري لبعض الكميات وفقًا لطريقة حساب التقارير الحالية.</p>'
          : "")) +
      '<section class="dashboard-trip-card" aria-label="عدد طلعات اليوم">' +
        '<span class="dashboard-trip-card__icon" aria-hidden="true">🚚</span>' +
        '<div><h2>عدد طلعات اليوم</h2><p>حسب تاريخ بدء الطلعة المسجل</p></div>' +
        '<strong>' + summary.tripCount.toLocaleString("ar-EG") + '</strong>' +
      '</section>';

    bindDashboardEvents();
    animateDashboardChart(targetChartShares);
  }

  function bindDashboardEvents() {
    if (pageContent.dashboardEventsBound) {
      return;
    }
    pageContent.dashboardEventsBound = true;
    pageContent.addEventListener("click", function (event) {
      var button = event.target.closest("[data-dashboard-metric]");
      if (button && pageContent.contains(button)) {
        renderDashboard(button.getAttribute("data-dashboard-metric"));
      }
    });
  }

  function scheduleDashboardRefresh() {
    var now = new Date();
    var nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var delay = Math.max(1, nextDay.getTime() - now.getTime() + 100);
    window.setTimeout(function () {
      if (navigation.querySelector('[data-page="dashboard"]').classList.contains("is-active")) {
        renderDashboard();
      }
      scheduleDashboardRefresh();
    }, delay);
  }

  navigation.addEventListener("click", function (event) {
    var button = event.target.closest("[data-page]");
    if (button) {
      showPage(button.getAttribute("data-page"));
    }
  });

  window.addEventListener("storage", function (event) {
    if (event.key === "pepsi_inventory_frontend_v1" &&
        navigation.querySelector('[data-page="dashboard"]').classList.contains("is-active")) {
      renderDashboard();
    }
  });
  window.addEventListener("focus", function () {
    if (navigation.querySelector('[data-page="dashboard"]').classList.contains("is-active")) {
      renderDashboard();
    }
  });
  renderDashboard();
  scheduleDashboardRefresh();
}());
