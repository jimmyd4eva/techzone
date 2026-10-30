(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Header ---------- */

  var header = document.querySelector("[data-header]");

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */

  var toggle = document.querySelector("[data-nav-toggle]");
  var menu = document.querySelector("[data-nav-menu]");

  if (toggle && menu) {
    var lastFocused = null;

    function focusables() {
      return [toggle].concat(
        Array.prototype.slice.call(
          menu.querySelectorAll('a[href], button:not([disabled])')
        )
      );
    }

    function openMenu() {
      lastFocused = document.activeElement;
      menu.classList.add("is-open");
      menu.setAttribute("aria-hidden", "false");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
      document.body.classList.add("no-scroll");
      var links = menu.querySelectorAll("nav a");
      if (links.length) {
        window.setTimeout(function () {
          if (menu.classList.contains("is-open")) links[0].focus();
        }, 60);
      }
    }

    function closeMenu(returnFocus) {
      menu.classList.remove("is-open");
      menu.setAttribute("aria-hidden", "true");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      document.body.classList.remove("no-scroll");
      if (returnFocus) toggle.focus();
      else if (lastFocused) lastFocused.focus();
    }

    toggle.addEventListener("click", function () {
      if (toggle.getAttribute("aria-expanded") === "true") closeMenu(true);
      else openMenu();
    });

    document.addEventListener("keydown", function (event) {
      if (!menu.classList.contains("is-open")) return;

      if (event.key === "Escape") {
        closeMenu(true);
        return;
      }

      if (event.key !== "Tab") return;

      var items = focusables();
      var first = items[0];
      var last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        closeMenu(false);
      });
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 900 && menu.classList.contains("is-open")) {
        closeMenu(false);
      }
    });
  }

  /* ---------- Scroll reveals ---------- */

  var revealItems = document.querySelectorAll("[data-reveal]");

  if (revealItems.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach(function (el) {
        el.classList.add("is-in");
      });
    } else {
      document.documentElement.classList.add("reveal-ready");

      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            var delay = el.getAttribute("data-reveal-delay");
            if (delay && !reduceMotion) {
              el.style.transitionDelay = delay + "ms";
            }
            el.classList.add("is-in");
            observer.unobserve(el);
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
      );

      revealItems.forEach(function (el) {
        observer.observe(el);
      });
    }
  }

  /* ---------- Shop filters ---------- */

  var filterButtons = document.querySelectorAll("[data-filter]");
  var productCards = document.querySelectorAll("[data-category]");
  var countEl = document.querySelector("[data-result-count]");
  var emptyState = document.querySelector("[data-empty-state]");

  if (filterButtons.length && productCards.length) {
    function applyFilter(category) {
      var visible = 0;

      productCards.forEach(function (card) {
        var show = category === "all" || card.getAttribute("data-category") === category;
        card.classList.toggle("is-hidden", !show);
        if (show) visible += 1;
      });

      if (countEl) {
        countEl.textContent =
          visible === 1 ? "Showing 1 piece" : "Showing " + visible + " pieces";
      }

      if (emptyState) emptyState.hidden = visible > 0;
    }

    filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        filterButtons.forEach(function (btn) {
          btn.setAttribute("aria-pressed", String(btn === button));
        });
        applyFilter(button.getAttribute("data-filter"));
      });
    });

    applyFilter("all");
  }

  /* ---------- Forms ---------- */

  function setFieldError(input, message) {
    var field = input.closest(".field");
    if (!field) return;
    var errorEl = field.querySelector(".field__error");
    if (message) {
      field.classList.add("has-error");
      input.setAttribute("aria-invalid", "true");
      if (errorEl) errorEl.textContent = message;
    } else {
      field.classList.remove("has-error");
      input.removeAttribute("aria-invalid");
      if (errorEl) errorEl.textContent = "";
    }
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
  }

  var form = document.querySelector("[data-contact-form]");

  if (form) {
    var success = document.querySelector("[data-form-success]");
    var successName = document.querySelector("[data-success-name]");
    var resetBtn = document.querySelector("[data-form-reset]");
    var topicSelect = form.querySelector("#topic");
    var messageField = form.querySelector("#message");
    var nameField = form.querySelector("#name");

    var params = new URLSearchParams(window.location.search);
    var product = params.get("product");
    var topic = params.get("topic");

    if (topicSelect && topic) {
      var match = Array.prototype.some.call(topicSelect.options, function (opt) {
        return opt.value === topic;
      });
      if (match) topicSelect.value = topic;
    }

    if (product) {
      if (topicSelect) topicSelect.value = "product";
      if (messageField && !messageField.value) {
        messageField.value =
          "I'd like to know more about the " +
          product +
          ". Is it available to see in store?";
      }
    }

    function validate() {
      var ok = true;

      if (nameField.value.trim().length < 2) {
        setFieldError(nameField, "Please tell us your name.");
        ok = false;
      } else {
        setFieldError(nameField);
      }

      var emailField = form.querySelector("#email");
      if (!validEmail(emailField.value)) {
        setFieldError(emailField, "Please enter a valid email address.");
        ok = false;
      } else {
        setFieldError(emailField);
      }

      if (topicSelect && !topicSelect.value) {
        setFieldError(topicSelect, "Please choose a topic.");
        ok = false;
      } else if (topicSelect) {
        setFieldError(topicSelect);
      }

      if (messageField.value.trim().length < 10) {
        setFieldError(messageField, "A little more detail helps us help you (10+ characters).");
        ok = false;
      } else {
        setFieldError(messageField);
      }

      return ok;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!validate()) {
        var firstError = form.querySelector(".field.has-error input, .field.has-error select, .field.has-error textarea");
        if (firstError) firstError.focus();
        return;
      }

      if (successName) {
        successName.textContent = nameField.value.trim().split(" ")[0];
      }

      form.hidden = true;
      var intro = document.querySelector("[data-form-intro]");
      if (intro) intro.hidden = true;
      if (success) {
        success.hidden = false;
        success.focus();
      }
    });

    form.querySelectorAll("input, select, textarea").forEach(function (input) {
      input.addEventListener("input", function () {
        setFieldError(input);
      });
      input.addEventListener("change", function () {
        setFieldError(input);
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        form.reset();
        form.hidden = false;
        var intro = document.querySelector("[data-form-intro]");
        if (intro) intro.hidden = false;
        if (success) success.hidden = true;
        nameField.focus();
      });
    }
  }

  /* ---------- Affiliate application ---------- */

  var affiliateForm = document.querySelector("[data-affiliate-form]");

  if (affiliateForm) {
    var affiliateSuccess = document.querySelector("[data-affiliate-success]");
    var affiliateName = document.querySelector("[data-affiliate-name]");
    var affiliateIntro = document.querySelector("[data-affiliate-intro]");
    var affiliateReset = document.querySelector("[data-affiliate-reset]");
    var applicantName = affiliateForm.querySelector("#aff-name");
    var applicantEmail = affiliateForm.querySelector("#aff-email");
    var applicantPhone = affiliateForm.querySelector("#aff-phone");
    var applicantOffer = affiliateForm.querySelector("#aff-offer");
    var applicantMessage = affiliateForm.querySelector("#aff-message");

    function validateApplication() {
      var ok = true;

      if (applicantName.value.trim().length < 2) {
        setFieldError(applicantName, "Please tell us your name.");
        ok = false;
      } else {
        setFieldError(applicantName);
      }

      if (!validEmail(applicantEmail.value)) {
        setFieldError(applicantEmail, "Please enter a valid email address.");
        ok = false;
      } else {
        setFieldError(applicantEmail);
      }

      var phone = applicantPhone.value.trim();
      if (phone && phone.replace(/\D/g, "").length < 7) {
        setFieldError(applicantPhone, "Enter a number we can reach you on.");
        ok = false;
      } else {
        setFieldError(applicantPhone);
      }

      if (!applicantOffer.value) {
        setFieldError(applicantOffer, "Please choose what you'd offer.");
        ok = false;
      } else {
        setFieldError(applicantOffer);
      }

      if (applicantMessage.value.trim().length < 10) {
        setFieldError(
          applicantMessage,
          "A sentence or two helps us review your application (10+ characters)."
        );
        ok = false;
      } else {
        setFieldError(applicantMessage);
      }

      return ok;
    }

    affiliateForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!validateApplication()) {
        var firstError = affiliateForm.querySelector(
          ".field.has-error input, .field.has-error select, .field.has-error textarea"
        );
        if (firstError) firstError.focus();
        return;
      }

      if (affiliateName) {
        affiliateName.textContent = applicantName.value.trim().split(" ")[0];
      }

      affiliateForm.hidden = true;
      if (affiliateIntro) affiliateIntro.hidden = true;
      if (affiliateSuccess) {
        affiliateSuccess.hidden = false;
        affiliateSuccess.focus();
      }
    });

    affiliateForm.querySelectorAll("input, select, textarea").forEach(function (input) {
      input.addEventListener("input", function () {
        setFieldError(input);
      });
      input.addEventListener("change", function () {
        setFieldError(input);
      });
    });

    if (affiliateReset) {
      affiliateReset.addEventListener("click", function () {
        affiliateForm.reset();
        affiliateForm.hidden = false;
        if (affiliateIntro) affiliateIntro.hidden = false;
        if (affiliateSuccess) affiliateSuccess.hidden = true;
        applicantName.focus();
      });
    }
  }

  /* ---------- Footer year ---------- */

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- Visitor counter ---------- */

  var visitCount = document.querySelector("[data-visit-count]");

  if (visitCount) {
    var VISIT_ENDPOINT = "https://countapi.mileshilliard.com/api/v1/";
    var VISIT_KEY = "techzone-kingston-visits-7c4b";
    var VISIT_GATE = "techzone-visit-counted";
    var VISIT_WINDOW = 12 * 60 * 60 * 1000;

    var lastCounted = 0;
    try {
      lastCounted = Number(localStorage.getItem(VISIT_GATE)) || 0;
    } catch (err) {
      /* storage blocked: treat this as a new visitor */
    }

    var alreadyCounted = Date.now() - lastCounted < VISIT_WINDOW;

    function visitRequest(action) {
      var options = { cache: "no-store" };
      if (window.AbortSignal && AbortSignal.timeout) {
        options.signal = AbortSignal.timeout(8000);
      }
      return fetch(VISIT_ENDPOINT + action + "/" + VISIT_KEY, options).then(
        function (res) {
          if (!res.ok) throw new Error("visitor counter " + res.status);
          return res.json();
        }
      );
    }

    function paintVisitCount(value) {
      var total = Number(value);
      if (!isFinite(total) || total < 0) throw new Error("bad count");
      visitCount.textContent = total.toLocaleString("en-US");
    }

    function markCounted() {
      try {
        localStorage.setItem(VISIT_GATE, String(Date.now()));
      } catch (err) {
        /* storage blocked */
      }
    }

    function visitCountUnavailable() {
      visitCount.textContent = "\u2014";
      visitCount.setAttribute("title", "Visitor count unavailable");
    }

    if (alreadyCounted) {
      visitRequest("get")
        .then(function (data) {
          paintVisitCount(data.value);
        })
        .catch(function () {
          return visitRequest("hit").then(function (data) {
            markCounted();
            paintVisitCount(data.value);
          });
        })
        .catch(visitCountUnavailable);
    } else {
      visitRequest("hit")
        .then(function (data) {
          markCounted();
          paintVisitCount(data.value);
        })
        .catch(visitCountUnavailable);
    }
  }
})();
