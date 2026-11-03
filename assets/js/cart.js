(function () {
  "use strict";

  var CONFIG = {
    paypal: "zonetech4eva@gmail.com",
    whatsapp: "18768432416",
    site: "https://techzone4eva.store/",
    usdToJmd: 159
  };

  var STORE_KEY = "techzone-cart:v1";
  var MAX_QTY = 99;
  var items = readCart();
  var dialog = null;
  var listEl = null;
  var emptyEl = null;
  var footEl = null;
  var usdEl = null;
  var jmdEl = null;
  var paypalLink = null;
  var whatsappLink = null;
  var clearBtn = null;
  var toggleBtn = null;
  var countEl = null;

  function money(value) {
    var parts = (Math.round(value * 100) / 100).toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function money0(value) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function slug(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function cleanItem(item) {
    if (!item || typeof item !== "object") return null;
    var name = typeof item.name === "string" ? item.name.slice(0, 120) : "";
    var price = Number(item.price);
    var qty = Math.round(Number(item.qty));
    if (!name || !isFinite(price) || price <= 0) return null;
    if (!isFinite(qty) || qty < 1) qty = 1;
    var stock = Number(item.stock);
    if (item.stock === null || item.stock === undefined || !isFinite(stock) || stock < 0) {
      stock = null;
    } else {
      stock = Math.min(9999, Math.round(stock));
    }
    return {
      id: String(item.id || slug(name)).slice(0, 160),
      name: name,
      price: Math.round(price * 100) / 100,
      qty: Math.min(MAX_QTY, qty),
      stock: stock,
      image:
        typeof item.image === "string" && item.image.indexOf("data:") !== 0
          ? item.image.slice(0, 300)
          : "",
      href: typeof item.href === "string" ? item.href.slice(0, 300) : ""
    };
  }

  function readCart() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(data)) return [];
      return data.map(cleanItem).filter(Boolean).slice(0, 50);
    } catch (err) {
      return [];
    }
  }

  function saveCart() {
    try {
      if (!items.length) {
        localStorage.removeItem(STORE_KEY);
      } else {
        localStorage.setItem(STORE_KEY, JSON.stringify(items));
      }
    } catch (err) {
      /* storage unavailable */
    }
    render();
  }

  function findItem(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function total() {
    var sum = 0;
    items.forEach(function (item) {
      sum += item.price * item.qty;
    });
    return sum;
  }

  function totalQty() {
    var count = 0;
    items.forEach(function (item) {
      count += item.qty;
    });
    return count;
  }

  function safeHref(href) {
    if (!href) return "";
    if (/^https?:\/\//i.test(href)) return href;
    if (/^[a-z0-9][a-z0-9._-]*\.html(?:[?#].*)?$/i.test(href)) return href;
    return "";
  }

  /* ---------- Header toggle ---------- */

  function injectToggle() {
    var actions = document.querySelector(".site-header__actions");
    if (!actions) return;

    toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "cart-toggle";
    toggleBtn.setAttribute("data-cart-open", "");
    toggleBtn.setAttribute("data-editor-ui", "");
    toggleBtn.setAttribute("aria-label", "Open cart");
    toggleBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>' +
      '<span class="cart-toggle__label">Cart</span>' +
      '<span class="cart-toggle__count" data-cart-count aria-live="polite" hidden>0</span>';
    actions.insertBefore(toggleBtn, actions.firstChild);
    countEl = toggleBtn.querySelector("[data-cart-count]");
  }

  function updateBadge() {
    if (!countEl || !toggleBtn) return;
    var qty = totalQty();
    countEl.textContent = String(qty);
    countEl.hidden = qty === 0;
    toggleBtn.setAttribute(
      "aria-label",
      qty ? "Open cart, " + qty + " item" + (qty === 1 ? "" : "s") : "Open cart"
    );
  }

  /* ---------- Add to cart buttons ---------- */

  function cardStock(card) {
    if (!card || !card.hasAttribute("data-stock")) return null;
    var stock = Number(card.getAttribute("data-stock"));
    if (!isFinite(stock) || stock < 0) return null;
    return Math.min(9999, Math.round(stock));
  }

  function flashButton(button, text) {
    var label = button.textContent;
    button.textContent = text;
    button.classList.add("is-added");
    clearTimeout(button._cartTimer);
    button._cartTimer = setTimeout(function () {
      button.textContent = label;
      button.classList.remove("is-added");
    }, 1400);
  }

  function addButtons() {
    if (document.body.getAttribute("data-page") !== "shop") return;

    var cards = document.querySelectorAll(".product-card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.querySelector("[data-add-to-cart]")) continue;
      var body = card.querySelector(".product-card__body");
      var cta = card.querySelector(".product-card__cta");
      var nameEl = card.querySelector(".product-card__name");
      if (!body || !cta || !nameEl) continue;
      var productName = nameEl.textContent.replace(/\s+/g, " ").trim();
      var stock = cardStock(card);

      var row = document.createElement("div");
      row.className = "cart-add-row";
      row.setAttribute("data-editor-ui", "");

      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--primary btn--sm cart-add";
      button.setAttribute("data-add-to-cart", "");
      if (stock === 0) {
        button.disabled = true;
        button.classList.add("is-sold-out");
        button.textContent = "Sold out";
        button.setAttribute("aria-label", productName + " is sold out");
      } else {
        button.setAttribute("aria-label", "Add " + productName + " to cart");
        button.textContent = "Add to cart";
      }

      row.appendChild(button);
      body.insertBefore(row, cta);
    }
  }

  function addFromCard(card, button) {
    var nameEl = card.querySelector(".product-card__name");
    var priceEl = card.querySelector(".product-card__price");
    var imgEl = card.querySelector(".product-card__media img");
    var linkEl = card.querySelector(".product-card__name a");
    var name = nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : "";
    var price = priceEl
      ? parseFloat((priceEl.textContent || "").replace(/,/g, "").replace(/[^0-9.]/g, ""))
      : 0;
    if (!name || !isFinite(price) || price <= 0) return;

    var stock = cardStock(card);
    if (stock === 0) return;
    var cap = stock === null ? MAX_QTY : Math.min(MAX_QTY, stock);
    var id = slug(name);
    var existing = findItem(id);
    if (existing) {
      if (stock !== null) existing.stock = stock;
      if (existing.qty >= cap) {
        flashButton(button, stock === null ? "Cart is full" : "Only " + cap + " left");
        return;
      }
      existing.qty = Math.min(cap, existing.qty + 1);
    } else {
      items.push({
        id: id,
        name: name.slice(0, 120),
        price: Math.round(price * 100) / 100,
        qty: 1,
        stock: stock,
        image:
          imgEl && imgEl.getAttribute("src").indexOf("data:") !== 0
            ? imgEl.getAttribute("src")
            : "",
        href: linkEl ? linkEl.getAttribute("href") : ""
      });
    }
    saveCart();
    flashButton(button, "Added to cart");
  }

  /* ---------- Cart dialog ---------- */

  function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "cart";
    dialog.setAttribute("data-editor-ui", "");
    dialog.setAttribute("aria-labelledby", "cart-title");
    dialog.innerHTML =
      '<div class="cart__panel">' +
        '<header class="cart__head">' +
          '<p class="cart__eyebrow">Checkout</p>' +
          '<h2 class="cart__title" id="cart-title">Your cart</h2>' +
          '<button class="cart__close" type="button" data-cart-close aria-label="Close cart">&times;</button>' +
        "</header>" +
        '<div class="cart__empty" data-cart-empty hidden>' +
          "<h3>Your cart is empty</h3>" +
          "<p>Add a piece from the collection and it will appear here.</p>" +
          '<a class="btn btn--ghost btn--sm" href="shop.html">Browse the shop</a>' +
        "</div>" +
        '<ul class="cart__items" data-cart-items></ul>' +
        '<footer class="cart__foot" data-cart-foot>' +
          '<div class="cart__total">' +
            '<span class="cart__total-label">Subtotal</span>' +
            "<strong data-cart-usd></strong>" +
            '<span class="cart__jmd" data-cart-jmd></span>' +
          "</div>" +
          '<p class="cart__note">Prices are in USD. Delivery or pickup is arranged after payment — we confirm the details by WhatsApp.</p>' +
          '<div class="cart__actions">' +
            '<a class="btn btn--primary" data-cart-paypal target="_blank" rel="noopener">Checkout with PayPal</a>' +
            '<a class="btn btn--ghost" data-cart-whatsapp target="_blank" rel="noopener">Bank transfer or pickup</a>' +
          "</div>" +
          '<button class="cart__clear" type="button" data-cart-clear>Clear cart</button>' +
        "</footer>" +
      "</div>";

    document.body.appendChild(dialog);

    listEl = dialog.querySelector("[data-cart-items]");
    emptyEl = dialog.querySelector("[data-cart-empty]");
    footEl = dialog.querySelector("[data-cart-foot]");
    usdEl = dialog.querySelector("[data-cart-usd]");
    jmdEl = dialog.querySelector("[data-cart-jmd]");
    paypalLink = dialog.querySelector("[data-cart-paypal]");
    whatsappLink = dialog.querySelector("[data-cart-whatsapp]");
    clearBtn = dialog.querySelector("[data-cart-clear]");

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeCart();
    });

    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("cart-open");
    });
  }

  function itemRow(item) {
    var li = document.createElement("li");
    li.className = "cart-item";
    li.setAttribute("data-cart-id", item.id);

    var media = document.createElement("div");
    media.className = "cart-item__media";
    if (item.image) {
      var img = document.createElement("img");
      img.src = item.image;
      img.alt = "";
      img.width = 64;
      img.height = 64;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        if (img.parentNode === media) media.removeChild(img);
      });
      media.appendChild(img);
    }
    li.appendChild(media);

    var info = document.createElement("div");
    info.className = "cart-item__info";

    var href = safeHref(item.href);
    var name;
    if (href) {
      name = document.createElement("a");
      name.className = "cart-item__name";
      name.href = href;
    } else {
      name = document.createElement("span");
      name.className = "cart-item__name";
    }
    name.textContent = item.name;
    info.appendChild(name);

    var price = document.createElement("p");
    price.className = "cart-item__meta";
    price.textContent = "$" + money(item.price) + " each";
    info.appendChild(price);

    var qty = document.createElement("div");
    qty.className = "cart-item__qty";

    var dec = document.createElement("button");
    dec.type = "button";
    dec.setAttribute("data-cart-action", "dec");
    dec.setAttribute("aria-label", "Remove one " + item.name);
    dec.textContent = "\u2212";

    var count = document.createElement("span");
    count.textContent = String(item.qty);
    count.setAttribute("aria-live", "polite");

    var inc = document.createElement("button");
    inc.type = "button";
    inc.setAttribute("data-cart-action", "inc");
    inc.setAttribute("aria-label", "Add one " + item.name);
    inc.textContent = "+";
    if (item.stock !== null && item.qty >= Math.min(MAX_QTY, item.stock)) {
      inc.disabled = true;
    }

    qty.appendChild(dec);
    qty.appendChild(count);
    qty.appendChild(inc);
    info.appendChild(qty);
    li.appendChild(info);

    var end = document.createElement("div");
    end.className = "cart-item__end";

    var line = document.createElement("strong");
    line.textContent = "$" + money(item.price * item.qty);
    end.appendChild(line);

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cart-item__remove";
    remove.setAttribute("data-cart-action", "remove");
    remove.setAttribute("aria-label", "Remove " + item.name + " from cart");
    remove.textContent = "\u00d7";
    end.appendChild(remove);

    li.appendChild(end);
    return li;
  }

  function paypalUrl() {
    var dest = (CONFIG.paypal || "").trim();
    if (!dest) return "";

    if (/^https?:\/\//i.test(dest)) {
      return dest.replace(/\/+$/, "") + "/" + total().toFixed(2) + "USD";
    }

    var pairs = [
      ["cmd", "_cart"],
      ["upload", "1"],
      ["business", dest],
      ["currency_code", "USD"],
      ["no_shipping", "2"],
      ["no_note", "0"],
      ["cn", "Delivery or pickup details"],
      ["charset", "utf-8"],
      ["return", CONFIG.site + "shop.html?paid=1"],
      ["cancel_return", CONFIG.site + "shop.html"]
    ];

    items.forEach(function (item, index) {
      var n = index + 1;
      pairs.push(["item_name_" + n, item.name]);
      pairs.push(["item_number_" + n, item.id]);
      pairs.push(["amount_" + n, item.price.toFixed(2)]);
      pairs.push(["quantity_" + n, String(item.qty)]);
    });

    return (
      "https://www.paypal.com/cgi-bin/webscr?" +
      pairs
        .map(function (pair) {
          return pair[0] + "=" + encodeURIComponent(pair[1]);
        })
        .join("&")
    );
  }

  function whatsappUrl() {
    var lines = ["Hi TechZone, I'd like to order from the website:"];
    items.forEach(function (item) {
      lines.push(
        "- " + item.qty + " \u00d7 " + item.name + " \u2014 $" + money(item.price * item.qty) + " USD"
      );
    });
    var sum = total();
    lines.push("");
    lines.push(
      "Subtotal: $" +
        money(sum) +
        " USD (\u2248 J$" +
        money0(sum * CONFIG.usdToJmd) +
        " at J$" +
        CONFIG.usdToJmd +
        " per US$1)"
    );
    lines.push("I'd prefer bank transfer or cash on pickup.");
    return "https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(lines.join("\n"));
  }

  function render() {
    updateBadge();
    if (!dialog) return;

    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    items.forEach(function (item) {
      listEl.appendChild(itemRow(item));
    });

    var empty = items.length === 0;
    listEl.hidden = empty;
    emptyEl.hidden = !empty;
    footEl.hidden = empty;
    if (empty) return;

    var sum = total();
    usdEl.textContent = "$" + money(sum) + " USD";
    jmdEl.textContent =
      "\u2248 J$" +
      money0(sum * CONFIG.usdToJmd) +
      " at J$" +
      CONFIG.usdToJmd +
      " per US$1";
    paypalLink.href = paypalUrl() || whatsappUrl();
    paypalLink.textContent = paypalUrl()
      ? "Checkout with PayPal"
      : "Ask for a payment link";
    whatsappLink.href = whatsappUrl();
  }

  function openCart() {
    if (!dialog) buildDialog();
    render();
    document.documentElement.classList.add("cart-open");
    dialog.showModal();
  }

  function closeCart() {
    if (dialog && dialog.open) dialog.close();
  }

  /* ---------- Events ---------- */

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var addButton = target.closest("[data-add-to-cart]");
    if (addButton) {
      addFromCard(addButton.closest(".product-card"), addButton);
      return;
    }

    if (target.closest("[data-cart-open]")) {
      openCart();
      return;
    }

    if (target.closest("[data-cart-close]")) {
      closeCart();
      return;
    }

    if (target.closest("[data-cart-clear]")) {
      if (window.confirm("Remove everything from the cart?")) {
        items = [];
        saveCart();
      }
      return;
    }

    var action = target.closest("[data-cart-action]");
    if (!action || !dialog) return;
    var row = action.closest("[data-cart-id]");
    var item = row ? findItem(row.getAttribute("data-cart-id")) : null;
    if (!item) return;

    var kind = action.getAttribute("data-cart-action");
    if (kind === "inc") {
      var cap =
        item.stock === null ? MAX_QTY : Math.min(MAX_QTY, item.stock);
      item.qty = Math.max(1, Math.min(cap, item.qty + 1));
    } else if (kind === "dec") {
      item.qty = Math.max(1, item.qty - 1);
    } else if (kind === "remove") {
      items = items.filter(function (entry) {
        return entry !== item;
      });
    } else {
      return;
    }
    saveCart();
  });

  window.addEventListener("storage", function (event) {
    if (event.key !== STORE_KEY) return;
    items = readCart();
    render();
  });

  /* ---------- PayPal return ---------- */

  function showPaidNotice() {
    if (!/[?&]paid=1\b/.test(location.search)) return;

    items = [];
    saveCart();

    var notice = document.createElement("div");
    notice.className = "cart-done";
    notice.setAttribute("data-editor-ui", "");
    notice.setAttribute("role", "status");
    notice.innerHTML =
      '<p class="cart-done__text"><strong>Payment sent?</strong> Message us your PayPal receipt and delivery or pickup details, and we\'ll confirm your order.</p>' +
      '<a class="btn btn--primary btn--sm" target="_blank" rel="noopener">Message TechZone</a>' +
      '<button class="cart-done__close" type="button" aria-label="Dismiss">&times;</button>';

    notice.querySelector("a").href =
      "https://wa.me/" +
      CONFIG.whatsapp +
      "?text=" +
      encodeURIComponent(
        "Hi TechZone, I just paid for my website order. Here are my receipt and delivery details:"
      );
    notice.querySelector(".cart-done__close").addEventListener("click", function () {
      notice.remove();
    });
    document.body.appendChild(notice);

    var url = new URL(location.href);
    url.searchParams.delete("paid");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  injectToggle();
  addButtons();
  document.addEventListener("tz:shop-updated", addButtons);
  render();
  showPaidNotice();
})();
