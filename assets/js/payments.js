(function () {
  "use strict";

  var CONFIG = {
    // PayPal business email. A full hosted link (e.g. https://paypal.me/techzone)
    // can be used instead if the account has one.
    paypal: "zonetech4eva@gmail.com",
    whatsapp: "18768432416",
    site: "https://techzone4eva.store/",
    usdToJmd: 159
  };

  var dialog = null;
  var parts = null;

  function money(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function readPrice(card) {
    var el = card.querySelector(".software-card__price");
    if (!el) return 0;
    var text = (el.textContent || "").replace(/,/g, "").replace(/[^0-9.]/g, "");
    var value = parseFloat(text);
    return isFinite(value) && value > 0 ? value : 0;
  }

  function paypalUrl(name, usd) {
    var dest = (CONFIG.paypal || "").trim();
    if (!dest) return "";

    if (/^https?:\/\//i.test(dest)) {
      return dest.replace(/\/+$/, "") + "/" + usd + "USD";
    }

    var pairs = [
      ["cmd", "_xclick"],
      ["business", dest],
      ["item_name", "TechZone " + name + " licence"],
      ["amount", usd.toFixed(2)],
      ["currency_code", "USD"],
      ["no_shipping", "1"],
      ["no_note", "0"],
      ["cn", "Email for delivery"],
      ["charset", "utf-8"],
      ["return", CONFIG.site + "software.html?paid=1"],
      ["cancel_return", CONFIG.site + "software.html"]
    ];

    return "https://www.paypal.com/cgi-bin/webscr?" + pairs
      .map(function (pair) {
        return pair[0] + "=" + encodeURIComponent(pair[1]);
      })
      .join("&");
  }

  function whatsappUrl(text) {
    return "https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(text);
  }

  function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "pay";
    dialog.setAttribute("aria-labelledby", "pay-title");
    dialog.innerHTML =
      '<div class="pay__panel">' +
        '<button class="pay__close" type="button" data-pay-close aria-label="Close checkout">&times;</button>' +
        '<p class="pay__eyebrow">Buy a licence</p>' +
        '<h2 class="pay__title" id="pay-title" data-pay-title></h2>' +
        '<p class="pay__price"><strong data-pay-usd></strong><span data-pay-jmd></span></p>' +
        '<div class="pay__methods">' +
          '<a class="pay__method pay__method--paypal" data-pay-paypal target="_blank" rel="noopener">' +
            '<span class="pay__method-name">Pay with PayPal</span>' +
            '<span class="pay__method-note">Card or PayPal balance</span>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          "</a>" +
          '<a class="pay__method" data-pay-whatsapp target="_blank" rel="noopener">' +
            '<span class="pay__method-name">Bank transfer or pickup</span>' +
            '<span class="pay__method-note">Arrange the JMD total on WhatsApp · pay at the counter</span>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          "</a>" +
        "</div>" +
        '<p class="pay__note">After paying, message us the product name and the email on the receipt. We send the licence and download link by email or WhatsApp — usually the same day.</p>' +
        '<p class="pay__fineprint">PayPal handles the card details. TechZone never sees them.</p>' +
      "</div>";

    document.body.appendChild(dialog);

    parts = {
      title: dialog.querySelector("[data-pay-title]"),
      usd: dialog.querySelector("[data-pay-usd]"),
      jmd: dialog.querySelector("[data-pay-jmd]"),
      paypal: dialog.querySelector("[data-pay-paypal]"),
      whatsapp: dialog.querySelector("[data-pay-whatsapp]")
    };

    dialog.querySelector("[data-pay-close]").addEventListener("click", function () {
      dialog.close();
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("pay-open");
    });
  }

  function openCheckout(card) {
    var titleEl = card.querySelector("h3");
    var name = titleEl ? titleEl.textContent.trim() : "";
    var usd = readPrice(card);
    if (!name || !usd) return;

    if (!dialog) buildDialog();

    var jmd = Math.round(usd * CONFIG.usdToJmd);

    parts.title.textContent = name + " licence";
    parts.usd.textContent = "$" + usd.toFixed(2) + " USD";
    parts.jmd.textContent =
      "≈ J$" + money(jmd) + " at J$" + CONFIG.usdToJmd + " per US$1";

    var paypal = paypalUrl(name, usd);
    parts.paypal.href = paypal || whatsappUrl(
      "Hi TechZone, I'd like the PayPal link for the " + name + " licence ($" + usd.toFixed(2) + " USD)."
    );
    parts.paypal.querySelector(".pay__method-name").textContent = paypal
      ? "Pay with PayPal"
      : "Ask for the PayPal link";

    parts.whatsapp.href = whatsappUrl(
      "Hi TechZone, I'd like to buy the " + name + " licence ($" + usd.toFixed(2) + " USD). " +
      "I'd prefer bank transfer or cash on pickup."
    );

    document.documentElement.classList.add("pay-open");
    dialog.showModal();
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-buy]");
    if (!button) return;
    var card = button.closest(".software-card");
    if (card) openCheckout(card);
  });

  function showPaidNotice() {
    if (!/[?&]paid=1\b/.test(location.search)) return;

    var notice = document.createElement("div");
    notice.className = "pay-done";
    notice.setAttribute("role", "status");
    notice.innerHTML =
      '<button class="pay-done__close" type="button" data-pay-done-close aria-label="Dismiss">&times;</button>' +
      '<p class="pay-done__text"><strong>Payment sent?</strong> Message us the product name and the email on the PayPal receipt, and we\'ll send your licence and download link.</p>' +
      '<a class="btn btn--primary btn--sm" target="_blank" rel="noopener">Message TechZone</a>';

    notice.querySelector("a").href = whatsappUrl(
      "Hi TechZone, I just paid for a software licence on the website. Here are my details:"
    );
    notice.querySelector("[data-pay-done-close]").addEventListener("click", function () {
      notice.remove();
    });

    document.body.appendChild(notice);

    var url = new URL(location.href);
    url.searchParams.delete("paid");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  showPaidNotice();
})();
