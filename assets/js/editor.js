(function () {
  "use strict";

  var EDIT_FLAG = "techzone-editor-on";
  var HIDE_FLAG = "techzone-editor-hidden";
  var isLocal =
    location.protocol === "file:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  var params = new URLSearchParams(location.search);
  var editParam = params.has("edit") ? params.get("edit") : null;
  var remembered = false;
  var editorHidden = false;

  try {
    remembered = localStorage.getItem(EDIT_FLAG) === "1";
    editorHidden = localStorage.getItem(HIDE_FLAG) === "1";
  } catch (err) {
    /* storage unavailable */
  }

  if (editParam !== null) {
    remembered = editParam !== "0";
    try {
      localStorage.setItem(EDIT_FLAG, remembered ? "1" : "0");
    } catch (err) {
      /* storage unavailable */
    }
    if (remembered) {
      editorHidden = false;
      try {
        localStorage.removeItem(HIDE_FLAG);
      } catch (err) {
        /* storage unavailable */
      }
    }
  }

  if (!isLocal && !remembered) {
    // Ctrl+Shift+E turns editing on for this browser only.
    document.addEventListener("keydown", function (event) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      try {
        localStorage.setItem(EDIT_FLAG, "1");
        localStorage.removeItem(HIDE_FLAG);
      } catch (err) {
        /* storage unavailable */
      }
      location.reload();
    });
  }

  var canEdit = isLocal || remembered;
  var FILE = location.pathname.split("/").pop() || "index.html";
  var STORE_KEY = "techzone-edits:" + location.pathname;
  var IMAGE_CACHE_KEY = "techzone-published-images:" + location.pathname;
  var PRODUCTS_KEY = "techzone-products:" + location.pathname;
  var PRODUCT_CATEGORY_KEY = "techzone-product-category";
  var PASS_KEY = "techzone-publish-pass";
  var PUBLISH_ENDPOINT = "api/publish.php";
  var PRODUCT_CATEGORIES = [
    "computer",
    "computer-accessories",
    "cellphones",
    "cellphone-accessories",
    "cellphone-parts",
    "jewelry-perfume",
    "random-stuff"
  ];
  var PRODUCT_CATEGORY_LABELS = {
    computer: "Electronics",
    "computer-accessories": "Computer / Accessories",
    cellphones: "Cellphones",
    "cellphone-accessories": "Cellphone Accessories",
    "cellphone-parts": "Cellphone Parts",
    "jewelry-perfume": "Jewelry / Perfume",
    "random-stuff": "Random Stuff"
  };
  var MAX_PRODUCTS = 60;
  var addedProducts = [];
  var publishedProducts = [];
  var hasProductDraft = false;
  var productDialog = null;
  var productForm = null;
  var productEditId = "";
  var productCardIndex = null;
  var productPhoto = "";
  var productOrigPhoto = "";
  var lastProductCategory = "";
  var productStatusEl = null;
  var productThumbEl = null;
  var productFileInput = null;
  var SKIP = {
    HTML: 1, BODY: 1, MAIN: 1, HEADER: 1, FOOTER: 1, SECTION: 1, DIV: 1,
    NAV: 1, UL: 1, OL: 1, ARTICLE: 1, FORM: 1, TABLE: 1, THEAD: 1,
    TBODY: 1, TFOOT: 1, TR: 1, SELECT: 1, OPTION: 1, OPTGROUP: 1,
    BUTTON: 1, SVG: 1, PATH: 1, CIRCLE: 1, RECT: 1, LINE: 1,
    POLYLINE: 1, POLYGON: 1, SCRIPT: 1, STYLE: 1, NOSCRIPT: 1,
    BR: 1, HR: 1, IMG: 1, INPUT: 1, TEXTAREA: 1, I: 1
  };

  var edits = {
    text: {},
    images: {},
    links: {},
    removed: {},
    removedImages: {}
  };
  var textItems = [];
  var imageItems = [];
  var linkItems = [];
  var textKeys = new Map();
  var imageKeys = new Map();
  var linkKeys = new Map();
  var staleSaved = false;
  var skippedSaved = 0;
  var editing = false;
  var supportsPlainText = (function () {
    var probe = document.createElement("div");
    probe.setAttribute("contenteditable", "plaintext-only");
    return probe.contentEditable === "plaintext-only";
  })();
  var pendingImage = null;
  var saveTimer = null;
  var detailState = [];
  var published = emptyState();
  var publishedKnown = false;
  var publishBusy = false;
  var pendingPass = "";
  var canPublish = location.protocol === "http:" || location.protocol === "https:";

  var ui, launchBtn, panel, statusEl, fileInput;
  var linkHandle, linkPop, linkInput, linkTarget = null;
  var imagePop, imageThumb, imageTarget = null;

  function collectText() {
    var items = [];
    var seen = new Set();
    var all = document.querySelectorAll("body *");

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var isFilterTab =
        el.tagName === "BUTTON" && el.hasAttribute("data-filter");
      if (SKIP[el.tagName] && !isFilterTab) continue;
      if (el.closest("[data-editor-ui]")) continue;
      if (el.closest("[data-tz-product]")) continue;
      if (el.closest("svg")) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (el.classList.contains("skip-link")) continue;
      if (el.hasAttribute("data-no-edit")) continue;

      var hasDirectText = false;
      for (var j = 0; j < el.childNodes.length; j++) {
        var node = el.childNodes[j];
        if (node.nodeType === 3 && node.nodeValue.replace(/\s+/g, "").length) {
          hasDirectText = true;
          break;
        }
      }
      if (!hasDirectText) continue;

      var ancestor = el.parentElement;
      var nested = false;
      while (ancestor && ancestor !== document.body) {
        if (seen.has(ancestor)) {
          nested = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (nested) continue;

      seen.add(el);
      items.push(el);
    }
    return items;
  }

  function collectImages() {
    var all = document.querySelectorAll("img");
    var items = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].closest("[data-editor-ui]") && !all[i].closest("[data-tz-product]")) {
        items.push(all[i]);
      }
    }
    return items;
  }

  function collectLinks() {
    var all = document.querySelectorAll("a[href]");
    var items = [];
    for (var i = 0; i < all.length; i++) {
      var link = all[i];
      if (link.closest("[data-editor-ui]")) continue;
      if (link.closest("[data-tz-product]")) continue;
      if (FILE === "shop.html" && link.classList.contains("product-card__media")) continue;
      if (link.classList.contains("skip-link")) continue;
      if (link.closest('[aria-hidden="true"]')) continue;
      if (link.hasAttribute("data-no-edit")) continue;
      items.push(link);
    }
    return items;
  }

  function normalise(value) {
    return (value || "").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function assignKeys() {
    var seen = Object.create(null);
    function next(signature) {
      seen[signature] = (seen[signature] || 0) + 1;
      return signature + "#" + seen[signature];
    }
    textItems.forEach(function (el) {
      textKeys.set(
        el,
        next("t|" + el.tagName + "|" + normalise(el.textContent))
      );
    });
    imageItems.forEach(function (img) {
      imageKeys.set(img, next("i|" + (img.getAttribute("src") || "")));
    });
    linkItems.forEach(function (a) {
      linkKeys.set(
        a,
        next(
          "l|" + (a.getAttribute("href") || "") + "|" + normalise(a.textContent)
        )
      );
    });
  }

  function resolveByKey(items, keys) {
    var map = new Map();
    items.forEach(function (el) {
      var key = keys.get(el);
      if (key) map.set(key, el);
    });
    return map;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && typeof data === "object" ? data : null;
    } catch (err) {
      return null;
    }
  }

  function readImageCache() {
    try {
      var raw = localStorage.getItem(IMAGE_CACHE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!isObject(data)) return null;
      var images = {};
      var count = 0;
      Object.keys(data).forEach(function (key) {
        var value = data[key];
        if (typeof value === "string" && value.indexOf("data:") !== 0) {
          images[key] = value;
          count++;
        }
      });
      return count ? images : null;
    } catch (err) {
      return null;
    }
  }

  function writeImageCache(images) {
    try {
      if (!images || !Object.keys(images).length) {
        localStorage.removeItem(IMAGE_CACHE_KEY);
      } else {
        localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(images));
      }
    } catch (err) {
      /* storage unavailable */
    }
  }

  function emptyState() {
    return {
      v: 2,
      text: {},
      images: {},
      links: {},
      removed: {},
      removedImages: {}
    };
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function normalize(data) {
    var clean = emptyState();
    if (!isObject(data)) return clean;
    clean.text = isObject(data.text) ? data.text : {};
    clean.images = isObject(data.images) ? data.images : {};
    clean.links = isObject(data.links) ? data.links : {};
    clean.removed = isObject(data.removed) ? data.removed : {};
    clean.removedImages = isObject(data.removedImages) ? data.removedImages : {};
    return clean;
  }

  function migrateV1(saved) {
    if (
      saved.count !== textItems.length ||
      saved.linkCount !== linkItems.length ||
      saved.imageCount !== imageItems.length
    ) {
      staleSaved = true;
      return null;
    }
    var migrated = {
      v: 2,
      text: {},
      images: {},
      links: {},
      removed: {},
      removedImages: {}
    };
    Object.keys(saved.text || {}).forEach(function (index) {
      var el = textItems[Number(index)];
      if (el) migrated.text[textKeys.get(el)] = saved.text[index];
    });
    Object.keys(saved.images || {}).forEach(function (index) {
      var img = imageItems[Number(index)];
      if (img) migrated.images[imageKeys.get(img)] = saved.images[index];
    });
    Object.keys(saved.links || {}).forEach(function (index) {
      var link = linkItems[Number(index)];
      if (link) migrated.links[linkKeys.get(link)] = saved.links[index];
    });
    Object.keys(saved.removed || {}).forEach(function (index) {
      var link = linkItems[Number(index)];
      if (link) migrated.removed[linkKeys.get(link)] = true;
    });
    Object.keys(saved.removedImages || {}).forEach(function (index) {
      var img = imageItems[Number(index)];
      if (img) migrated.removedImages[imageKeys.get(img)] = true;
    });
    return migrated;
  }

  function applyData(data, track) {
    var textByKey = resolveByKey(textItems, textKeys);
    var imagesByKey = resolveByKey(imageItems, imageKeys);
    var linksByKey = resolveByKey(linkItems, linkKeys);
    var missing = 0;

    Object.keys(data.text || {}).forEach(function (key) {
      var el = textByKey.get(key);
      if (!el) {
        missing++;
        return;
      }
      el.innerHTML = data.text[key];
      if (track) edits.text[key] = data.text[key];
    });

    Object.keys(data.images || {}).forEach(function (key) {
      var img = imagesByKey.get(key);
      if (!img) {
        missing++;
        return;
      }
      if (!img.dataset.tzFallbackSrc) {
        img.dataset.tzFallbackSrc = img.getAttribute("src") || "";
        img.addEventListener("error", function () {
          var fallback = img.dataset.tzFallbackSrc;
          if (fallback && img.getAttribute("src") !== fallback) {
            img.src = fallback;
          }
        });
      }
      img.removeAttribute("srcset");
      if (img.getAttribute("src") !== data.images[key]) {
        img.src = data.images[key];
      }
      if (track) edits.images[key] = data.images[key];
    });

    Object.keys(data.removedImages || {}).forEach(function (key) {
      var img = imagesByKey.get(key);
      if (img && img.parentNode) removeImageElement(img);
      if (track) edits.removedImages[key] = true;
    });

    Object.keys(data.links || {}).forEach(function (key) {
      var link = linksByKey.get(key);
      if (!link) {
        missing++;
        return;
      }
      link.setAttribute("href", data.links[key]);
      if (track) edits.links[key] = data.links[key];
    });

    Object.keys(data.removed || {}).forEach(function (key) {
      var link = linksByKey.get(key);
      if (link && link.parentNode) removeLinkElement(link);
      if (track) edits.removed[key] = true;
    });

    return missing;
  }

  function applySaved(saved) {
    if (!saved) return;
    if (saved.v !== 2) saved = migrateV1(saved);
    if (!saved) return;

    edits.text = {};
    edits.images = {};
    edits.links = {};
    edits.removed = {};
    edits.removedImages = {};
    skippedSaved = applyData(saved, true);
  }

  function persist() {
    var hasText = Object.keys(edits.text).length > 0;
    var hasImages = Object.keys(edits.images).length > 0;
    var hasLinks = Object.keys(edits.links).length > 0;
    var hasRemoved = Object.keys(edits.removed).length > 0;
    var hasRemovedImages = Object.keys(edits.removedImages).length > 0;
    try {
      if (!hasText && !hasImages && !hasLinks && !hasRemoved && !hasRemovedImages) {
        localStorage.removeItem(STORE_KEY);
      } else {
        localStorage.setItem(
          STORE_KEY,
          JSON.stringify({
            v: 2,
            text: edits.text,
            images: edits.images,
            links: edits.links,
            removed: edits.removed,
            removedImages: edits.removedImages,
            savedAt: Date.now()
          })
        );
      }
      setStatus("Saved in this browser · " + timeNow(), "ok");
    } catch (err) {
      setStatus("This page is too large to autosave. Use Save to file.");
    }
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }

  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    persist();
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    if (tone) statusEl.setAttribute("data-tone", tone);
    else statusEl.removeAttribute("data-tone");
  }

  function buildUI() {
    ui = document.createElement("div");
    ui.className = "tzedit";
    ui.setAttribute("data-editor-ui", "");
    ui.innerHTML =
      '<button class="tzedit-launch" type="button" aria-label="Edit this page">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 5.5l3 3"/></svg>' +
      "<span>Edit page</span></button>" +
      '<div class="tzedit-panel" role="region" aria-label="Page editor" tabindex="-1" hidden>' +
      '<div class="tzedit-panel__head">' +
      '<span class="tzedit-panel__title">Editing</span>' +
      '<button class="tzedit-btn tzedit-btn--done" type="button" data-tzedit="done">Done</button>' +
      "</div>" +
      '<p class="tzedit-hint">Click any text on this page to change it. Click a photo to replace or remove it. Hover a link and choose Link to change its address or remove it. Changes stay in this browser until you press Publish — Publish updates the live site for every device. Save to file writes an HTML copy of ' +
      FILE +
      " instead.</p>" +
      '<div class="tzedit-panel__actions">' +
      '<button class="tzedit-btn tzedit-btn--primary" type="button" data-tzedit="publish">Publish</button>' +
      '<button class="tzedit-btn" type="button" data-tzedit="save">Save to file</button>' +
      '<button class="tzedit-btn" type="button" data-tzedit="reset">Reset</button>' +
      '<button class="tzedit-btn tzedit-btn--danger" type="button" data-tzedit="unpublish">Unpublish</button>' +
      "</div>" +
      '<p class="tzedit-status" role="status" aria-live="polite"></p>' +
      "</div>" +
      '<button class="tzedit-link-handle" type="button" aria-label="Change this link address" hidden>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
      '<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.4 1.4"/>' +
      '<path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.4-1.4"/></svg>' +
      "<span>Link</span></button>" +
      '<div class="tzedit-linkpop" role="dialog" aria-label="Link address" hidden>' +
      '<label class="tzedit-linkpop__label" for="tzedit-link-field">Link address</label>' +
      '<input class="tzedit-linkpop__input" id="tzedit-link-field" type="text" autocomplete="off" spellcheck="false" placeholder="shop.html, https://…, tel:…, mailto:…">' +
      '<p class="tzedit-linkpop__hint">Use a page name like shop.html, a full https:// address, or tel:/mailto: for phone and email.</p>' +
      '<div class="tzedit-linkpop__actions">' +
      '<button class="tzedit-btn tzedit-btn--primary" type="button" data-tzedit="link-apply">Apply</button>' +
      '<button class="tzedit-btn" type="button" data-tzedit="link-cancel">Cancel</button>' +
      '<button class="tzedit-btn tzedit-btn--danger" type="button" data-tzedit="link-remove">Remove</button>' +
      "</div></div>" +
      '<div class="tzedit-imgpop" role="dialog" aria-label="Photo options" hidden>' +
      '<div class="tzedit-imgpop__head">' +
      '<img class="tzedit-imgpop__thumb" alt="">' +
      '<span class="tzedit-imgpop__title">Photo</span>' +
      "</div>" +
      '<div class="tzedit-imgpop__actions">' +
      '<button class="tzedit-btn tzedit-btn--primary" type="button" data-tzedit="image-replace">Replace</button>' +
      '<button class="tzedit-btn" type="button" data-tzedit="image-cancel">Cancel</button>' +
      '<button class="tzedit-btn tzedit-btn--danger" type="button" data-tzedit="image-remove">Remove</button>' +
      "</div></div>" +
      '<input class="tzedit-file" type="file" accept="image/*" hidden>';
    document.body.appendChild(ui);
    if (!editorHidden) document.documentElement.classList.add("has-editor");

    launchBtn = ui.querySelector(".tzedit-launch");
    if (editorHidden) launchBtn.hidden = true;
    panel = ui.querySelector(".tzedit-panel");
    statusEl = ui.querySelector(".tzedit-status");
    fileInput = ui.querySelector(".tzedit-file");
    linkHandle = ui.querySelector(".tzedit-link-handle");
    linkPop = ui.querySelector(".tzedit-linkpop");
    linkInput = ui.querySelector(".tzedit-linkpop__input");
    imagePop = ui.querySelector(".tzedit-imgpop");
    imageThumb = ui.querySelector(".tzedit-imgpop__thumb");

    launchBtn.addEventListener("click", enter);
    panel.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-tzedit]");
      if (!btn) return;
      var action = btn.getAttribute("data-tzedit");
      if (action === "done") exit();
      else if (action === "save") saveFile();
      else if (action === "reset") resetPage();
      else if (action === "publish") publishPage();
      else if (action === "unpublish") unpublishPage();
      else if (action === "add-product") openProductDialog();
    });
    if (!canPublish) {
      var hidePublish = ui.querySelector('[data-tzedit="publish"]');
      var hideUnpublish = ui.querySelector('[data-tzedit="unpublish"]');
      if (hidePublish) hidePublish.hidden = true;
      if (hideUnpublish) hideUnpublish.hidden = true;
    }
    fileInput.addEventListener("change", onFilePicked);

    if (onShopPage()) {
      var actions = ui.querySelector(".tzedit-panel__actions");
      var publishBtn = actions.querySelector('[data-tzedit="publish"]');
      var addProductBtn = document.createElement("button");
      addProductBtn.type = "button";
      addProductBtn.className = "tzedit-btn";
      addProductBtn.setAttribute("data-tzedit", "add-product");
      addProductBtn.textContent = "Add product";
      if (publishBtn) actions.insertBefore(addProductBtn, publishBtn.nextSibling);
      else actions.appendChild(addProductBtn);

      buildCardChips();

      var shopGrid = document.querySelector(".product-grid--shop");
      if (shopGrid) {
        shopGrid.addEventListener(
          "click",
          function (event) {
            var editBtn = event.target.closest("[data-tzprod-edit]");
            if (editBtn) {
              event.preventDefault();
              event.stopPropagation();
              openProductDialog(editBtn.getAttribute("data-tzprod-edit"));
              return;
            }
            var cardBtn = event.target.closest("[data-tz-card-edit]");
            if (cardBtn && editing) {
              event.preventDefault();
              event.stopPropagation();
              openCardProductDialog(cardBtn.closest(".product-card"));
              return;
            }
            if (!editing) return;
            var card = event.target.closest(".product-card");
            if (!card || !event.target.closest(".product-card__media")) return;
            event.preventDefault();
            event.stopPropagation();
            if (card.hasAttribute("data-tz-product")) {
              openProductDialog(card.getAttribute("data-tz-product"));
            } else {
              openCardProductDialog(card);
            }
          },
          true
        );
      }
    }

    linkHandle.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (linkTarget) openLinkPopover(linkTarget);
    });
    linkPop.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-tzedit]");
      if (!btn) return;
      var action = btn.getAttribute("data-tzedit");
      if (action === "link-apply") applyLink();
      else if (action === "link-cancel") closeLinkPopover();
      else if (action === "link-remove") removeLink();
    });
    linkInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyLink();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeLinkPopover();
      }
    });
    imagePop.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-tzedit]");
      if (!btn) return;
      var action = btn.getAttribute("data-tzedit");
      if (action === "image-replace") {
        var target = imageTarget;
        closeImagePopover();
        if (target) startImagePicker(target);
      } else if (action === "image-remove") {
        removeImage();
      } else if (action === "image-cancel") {
        closeImagePopover();
      }
    });
  }

  function enter() {
    if (editing) return;
    editing = true;
    document.documentElement.classList.add("tz-editing");
    document.documentElement.classList.add("has-editor");

    textItems.forEach(function (el) {
      el.classList.add("tzedit-text");
      el.setAttribute(
        "contenteditable",
        supportsPlainText ? "plaintext-only" : "true"
      );
      el.setAttribute("spellcheck", "false");
      el.addEventListener("input", onTextInput);
    });

    imageItems.forEach(function (img) {
      img.addEventListener("click", onImageClick);
    });

    document.addEventListener("click", guardLinks, true);
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("mouseover", onDocHover);
    document.addEventListener("focusin", onDocFocus);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    openDetails();
    launchBtn.hidden = true;
    panel.hidden = false;
    if (staleSaved) {
      setStatus("Edits saved for an older version of this page were skipped.");
    } else if (skippedSaved) {
      setStatus(
        skippedSaved + " saved edit(s) no longer match this page and were skipped."
      );
    } else {
      setStatus("");
    }
    panel.focus({ preventScroll: true });
  }

  function exit() {
    if (!editing) return;
    flushSave();
    editing = false;
    document.documentElement.classList.remove("tz-editing");

    textItems.forEach(function (el) {
      el.classList.remove("tzedit-text");
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
      el.removeEventListener("input", onTextInput);
    });

    imageItems.forEach(function (img) {
      img.removeEventListener("click", onImageClick);
    });

    document.removeEventListener("click", guardLinks, true);
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("mouseover", onDocHover);
    document.removeEventListener("focusin", onDocFocus);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    closeLinkPopover();
    closeImagePopover();
    closeProductDialog();
    hideLinkHandle(true);
    restoreDetails();
    panel.hidden = true;
    launchBtn.hidden = true;
    editorHidden = true;
    document.documentElement.classList.remove("has-editor");
    try {
      localStorage.setItem(HIDE_FLAG, "1");
    } catch (err) {
      /* storage unavailable */
    }
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  function showLauncher() {
    if (!canEdit || editing || !launchBtn) return;
    editorHidden = false;
    try {
      localStorage.removeItem(HIDE_FLAG);
    } catch (err) {
      /* storage unavailable */
    }
    launchBtn.hidden = false;
    document.documentElement.classList.add("has-editor");
    launchBtn.focus({ preventScroll: true });
  }

  function guardLinks(event) {
    if (!editing) return;
    var target = event.target;
    if (!target.closest) return;
    if (target.closest("[data-editor-ui]")) return;

    var tab = target.closest("[data-filter]");
    if (tab) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    var link = target.closest("a");
    if (link) event.preventDefault();
  }

  function showLinkHandle(anchor) {
    if (!editing || !anchor || !linkKeys.has(anchor)) return;
    if (!linkPop.hidden) return;
    var rect = anchor.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    linkTarget = anchor;
    linkHandle.hidden = false;
    var hw = linkHandle.offsetWidth;
    var hh = linkHandle.offsetHeight;
    var left = Math.min(Math.max(8, rect.right - hw), window.innerWidth - hw - 8);
    var top = rect.top - hh - 8;
    if (top < 8) top = rect.bottom + 8;
    if (top + hh > window.innerHeight - 8) {
      top = Math.max(8, rect.top - hh - 8);
    }
    linkHandle.style.left = Math.round(left) + "px";
    linkHandle.style.top = Math.round(top) + "px";
  }

  function hideLinkHandle(force) {
    if (!linkHandle) return;
    if (!force && !linkPop.hidden) return;
    linkHandle.hidden = true;
    if (force) linkTarget = null;
  }

  function openLinkPopover(anchor) {
    closeImagePopover();
    linkTarget = anchor;
    linkInput.value = anchor.getAttribute("href") || "";
    linkHandle.hidden = true;
    linkPop.hidden = false;
    var rect = anchor.getBoundingClientRect();
    var pw = linkPop.offsetWidth;
    var ph = linkPop.offsetHeight;
    var left = Math.min(Math.max(12, rect.left), window.innerWidth - pw - 12);
    var top = rect.bottom + 10;
    if (top + ph > window.innerHeight - 12) {
      top = Math.max(12, rect.top - ph - 10);
    }
    linkPop.style.left = Math.round(left) + "px";
    linkPop.style.top = Math.round(top) + "px";
    linkInput.focus();
    linkInput.select();
  }

  function closeLinkPopover() {
    if (!linkPop) return;
    linkPop.hidden = true;
    linkTarget = null;
    if (document.activeElement === linkInput) linkInput.blur();
  }

  function applyLink() {
    var anchor = linkTarget;
    if (!anchor) return;
    var value = linkInput.value.trim();
    if (!value) {
      setStatus("Enter a link address first.");
      linkInput.focus();
      return;
    }
    if (/^\s*javascript:/i.test(value)) {
      setStatus("That address isn't allowed. Use a page or https:// link.");
      linkInput.focus();
      return;
    }
    var key = linkKeys.get(anchor);
    anchor.setAttribute("href", value);
    if (key !== undefined) {
      edits.links[key] = value;
      persist();
    }
    closeLinkPopover();
    setStatus("Link address saved in this browser.", "ok");
  }

  function removeLink() {
    var anchor = linkTarget;
    if (!anchor) return;
    var key = linkKeys.get(anchor);
    if (key === undefined) return;
    edits.removed[key] = true;
    closeLinkPopover();
    removeLinkElement(anchor);
    hideLinkHandle(true);
    persist();
    setStatus("Link removed. Reset restores it.", "ok");
  }

  function removeLinkElement(anchor) {
    var target = anchor;
    var parent = anchor.parentElement;
    if (parent && parent.tagName === "LI" && parent.querySelectorAll("a").length === 1) {
      var other = false;
      for (var i = 0; i < parent.childNodes.length; i++) {
        var node = parent.childNodes[i];
        if (node === anchor) continue;
        if (node.nodeType === 3 && node.nodeValue.replace(/\s+/g, "").length) {
          other = true;
          break;
        }
        if (node.nodeType === 1 && node.textContent.trim().length) {
          other = true;
          break;
        }
      }
      if (!other) target = parent;
    }
    if (target.parentNode) target.parentNode.removeChild(target);
  }

  function onDocHover(event) {
    if (!editing) return;
    var target = event.target;
    if (!target.closest) return;
    if (target.closest("[data-editor-ui]")) {
      if (!target.closest(".tzedit-link-handle")) hideLinkHandle();
      return;
    }
    var link = target.closest("a[href]");
    if (link && linkKeys.has(link)) showLinkHandle(link);
    else hideLinkHandle();
  }

  function onDocClick(event) {
    if (!editing) return;
    var target = event.target;
    if (!target.closest) return;
    var inUI = !!target.closest("[data-editor-ui]");
    if (!inUI && !linkPop.hidden) {
      closeLinkPopover();
      return;
    }
    if (!inUI && !imagePop.hidden && target.tagName !== "IMG") {
      closeImagePopover();
      return;
    }
    if (inUI || target.tagName === "IMG") return;
    var link = target.closest("a[href]");
    if (link && linkKeys.has(link)) showLinkHandle(link);
    else hideLinkHandle();
  }

  function onDocFocus(event) {
    if (!editing) return;
    var target = event.target;
    if (!target.closest) return;
    if (target.closest("[data-editor-ui]")) return;
    var link = target.closest("a[href]");
    if (link && linkKeys.has(link)) showLinkHandle(link);
  }

  function onViewportChange() {
    if (!editing) return;
    if (!linkPop.hidden) closeLinkPopover();
    if (!imagePop.hidden) closeImagePopover();
    hideLinkHandle(true);
  }

  function onTextInput(event) {
    var el = event.currentTarget;
    var key = textKeys.get(el);
    if (!key) return;
    edits.text[key] = el.innerHTML;
    setStatus("Saving…");
    queueSave();
  }

  function onImageClick(event) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    openImagePopover(event.currentTarget);
  }

  function startImagePicker(img) {
    pendingImage = img;
    fileInput.value = "";
    fileInput.click();
  }

  function openImagePopover(img) {
    if (!editing || !imageKeys.has(img)) return;
    imageTarget = img;
    closeLinkPopover();
    hideLinkHandle(true);
    imageThumb.src = img.currentSrc || img.src;
    imagePop.hidden = false;
    var rect = img.getBoundingClientRect();
    var pw = imagePop.offsetWidth;
    var ph = imagePop.offsetHeight;
    var left = Math.min(Math.max(12, rect.left), window.innerWidth - pw - 12);
    var top = rect.bottom + 10;
    if (top + ph > window.innerHeight - 12) {
      top = Math.max(12, rect.top - ph - 10);
    }
    imagePop.style.left = Math.round(left) + "px";
    imagePop.style.top = Math.round(top) + "px";
    var first = imagePop.querySelector('[data-tzedit="image-replace"]');
    if (first) first.focus({ preventScroll: true });
  }

  function closeImagePopover() {
    if (!imagePop) return;
    imagePop.hidden = true;
    imageTarget = null;
    if (imagePop.contains(document.activeElement)) document.activeElement.blur();
  }

  function removeImage() {
    var img = imageTarget;
    if (!img) return;
    var key = imageKeys.get(img);
    if (!key) return;
    edits.removedImages[key] = true;
    delete edits.images[key];
    closeImagePopover();
    if (img.parentNode) removeImageElement(img);
    persist();
    setStatus("Photo removed. Reset restores it.", "ok");
  }

  function removeImageElement(img) {
    var parent = img.parentElement;
    if (
      parent &&
      parent.tagName === "A" &&
      parent.querySelectorAll("img").length === 1 &&
      !parent.textContent.trim()
    ) {
      var extra = false;
      for (var i = 0; i < parent.childNodes.length; i++) {
        var node = parent.childNodes[i];
        if (node === img) continue;
        if (node.nodeType === 1) {
          extra = true;
          break;
        }
        if (node.nodeType === 3 && node.nodeValue.replace(/\s+/g, "").length) {
          extra = true;
          break;
        }
      }
      if (!extra && parent.parentNode) {
        parent.parentNode.removeChild(parent);
        return;
      }
    }
    img.parentNode.removeChild(img);
  }

  function onFilePicked() {
    var file = fileInput.files && fileInput.files[0];
    if (!file || !pendingImage) return;
    var target = pendingImage;
    pendingImage = null;
    setStatus("Preparing photo…");

    encodeImage(file)
      .then(function (dataUrl) {
        target.removeAttribute("srcset");
        target.removeAttribute("sizes");
        target.src = dataUrl;
        var key = imageKeys.get(target);
        if (key) {
          edits.images[key] = dataUrl;
          persist();
        }
        setStatus("Photo replaced — saved in this browser.", "ok");
      })
      .catch(function () {
        setStatus("That photo format is not supported. Save it as a JPG or PNG and try again.");
      });
  }

  var PUBLISH_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  var MAX_PUBLISH_BYTES = 2500000;

  function dataUrlMime(url) {
    var match = /^data:([^;,]+)/.exec(url || "");
    return match ? match[1].toLowerCase() : "";
  }

  function dataUrlBytes(url) {
    var comma = (url || "").indexOf(",");
    if (comma === -1) return 0;
    var body = (url || "").slice(comma + 1);
    if (url.slice(0, comma).indexOf("base64") === -1) return body.length;
    return Math.floor((body.replace(/\s+/g, "").length * 3) / 4);
  }

  function renderImage(img, type) {
    var max = 1600;
    var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    var ctx = canvas.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#0a0b0d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    var out = canvas.toDataURL(type, 0.85);
    if (type === "image/png" && dataUrlBytes(out) > MAX_PUBLISH_BYTES) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#0a0b0d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      out = canvas.toDataURL("image/jpeg", 0.82);
    }
    return out;
  }

  function prepareDataUrl(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onerror = function () {
        resolve(null);
      };
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) {
          resolve(null);
          return;
        }
        try {
          resolve(renderImage(img, "image/jpeg"));
        } catch (err) {
          resolve(null);
        }
      };
      img.src = url;
    });
  }

  function encodeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var original = reader.result;
        var type = (file.type || dataUrlMime(original)).toLowerCase();
        var supported = PUBLISH_IMAGE_TYPES.indexOf(type) !== -1;
        if (supported && file.size < 300 * 1024) {
          resolve(original);
          return;
        }

        var img = new Image();
        img.onerror = function () {
          if (supported && file.size <= MAX_PUBLISH_BYTES) {
            resolve(original);
          } else {
            reject(new Error("unsupported image format"));
          }
        };
        img.onload = function () {
          var max = 1600;
          var scale = Math.min(
            1,
            max / Math.max(img.naturalWidth, img.naturalHeight)
          );
          if (supported && scale === 1 && file.size < 900 * 1024) {
            resolve(original);
            return;
          }

          try {
            var keepPng = type === "image/png" || type === "image/svg+xml";
            resolve(renderImage(img, keepPng ? "image/png" : "image/jpeg"));
          } catch (err) {
            if (supported && file.size <= MAX_PUBLISH_BYTES) {
              resolve(original);
            } else {
              reject(err);
            }
          }
        };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- Shop products ---------- */

  function onShopPage() {
    return !!document.body && document.body.getAttribute("data-page") === "shop";
  }

  function productHref(name) {
    return "contact.html?product=" + encodeURIComponent(name);
  }

  function priceLabel(price) {
    var parts = (Math.round(price * 100) / 100).toFixed(2).split(".");
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts[1] === "00" ? "$" + whole : "$" + whole + "." + parts[1];
  }

  function newProductId() {
    return (
      "p-" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  function findAddedProduct(id) {
    for (var i = 0; i < addedProducts.length; i++) {
      if (addedProducts[i].id === id) return addedProducts[i];
    }
    return null;
  }

  function indexOfProduct(id) {
    for (var i = 0; i < addedProducts.length; i++) {
      if (addedProducts[i].id === id) return i;
    }
    return -1;
  }

  function normalizeProducts(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = {};
    list.slice(0, MAX_PRODUCTS).forEach(function (item) {
      if (!isObject(item)) return;
      var id = typeof item.id === "string" ? item.id.toLowerCase() : "";
      if (!/^p-[a-z0-9]{4,24}$/.test(id) || seen[id]) return;
      var name = String(item.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!name) return;
      var price = Number(item.price);
      if (!isFinite(price) || price <= 0) return;
      var category =
        PRODUCT_CATEGORIES.indexOf(item.category) !== -1 ? item.category : "";
      if (!category) return;
      var description = String(item.description || "").trim().slice(0, 400);
      var qty = Math.round(Number(item.qty));
      if (!isFinite(qty) || qty < 0) qty = 1;
      qty = Math.min(9999, qty);
      var image = typeof item.image === "string" ? item.image : "";
      if (
        image &&
        image.indexOf("data:image/") !== 0 &&
        !/^api\/media\.php\?f=[A-Za-z0-9][A-Za-z0-9._-]*$/.test(image) &&
        !/^[A-Za-z0-9][A-Za-z0-9._~\-/]*$/.test(image)
      ) {
        image = "";
      }
      var href = typeof item.href === "string" ? item.href.trim() : "";
      if (!href || /^\s*javascript:/i.test(href)) href = productHref(name);
      seen[id] = true;
      out.push({
        id: id,
        name: name,
        price: Math.round(price * 100) / 100,
        category: category,
        description: description,
        qty: qty,
        image: image,
        href: href
      });
    });
    return out;
  }

  function readProductDraft() {
    if (!onShopPage()) return null;
    try {
      var raw = localStorage.getItem(PRODUCTS_KEY);
      if (raw === null) return null;
      var list = normalizeProducts(JSON.parse(raw));
      hasProductDraft = true;
      return list;
    } catch (err) {
      return null;
    }
  }

  function writeProductDraft() {
    hasProductDraft = true;
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(addedProducts));
      return true;
    } catch (err) {
      return false;
    }
  }

  function buildProductCard(product) {
    var card = document.createElement("article");
    card.className = "product-card";
    card.setAttribute("data-category", product.category);
    card.setAttribute("data-tz-product", product.id);
    card.setAttribute("data-stock", String(product.qty));

    var media = document.createElement("a");
    media.className = "product-card__media";
    media.setAttribute("href", product.href);
    media.setAttribute("aria-label", "Enquire about " + product.name);
    function showPlaceholder() {
      media.className += " product-card__media--placeholder";
      var initial = document.createElement("span");
      initial.setAttribute("aria-hidden", "true");
      initial.textContent = product.name.charAt(0).toUpperCase();
      media.appendChild(initial);
    }
    if (product.image) {
      var img = document.createElement("img");
      img.src = product.image;
      img.alt = product.name;
      img.width = 900;
      img.height = 900;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        if (img.parentNode !== media) return;
        media.removeChild(img);
        showPlaceholder();
      });
      media.appendChild(img);
    } else {
      showPlaceholder();
    }
    card.appendChild(media);

    var body = document.createElement("div");
    body.className = "product-card__body";

    var meta = document.createElement("div");
    meta.className = "product-card__meta";
    var categoryEl = document.createElement("span");
    categoryEl.textContent =
      PRODUCT_CATEGORY_LABELS[product.category] || product.category;
    var priceEl = document.createElement("span");
    priceEl.className = "product-card__price";
    priceEl.textContent = priceLabel(product.price);
    meta.appendChild(categoryEl);
    meta.appendChild(priceEl);
    body.appendChild(meta);

    var stockEl = document.createElement("p");
    stockEl.className = "product-card__stock";
    if (product.qty === 0) {
      stockEl.classList.add("is-out");
      stockEl.textContent = "Sold out";
    } else {
      stockEl.textContent = product.qty + " in stock";
    }
    body.appendChild(stockEl);

    var heading = document.createElement("h3");
    heading.className = "product-card__name";
    var nameLink = document.createElement("a");
    nameLink.setAttribute("href", product.href);
    nameLink.textContent = product.name;
    heading.appendChild(nameLink);
    body.appendChild(heading);

    if (product.description) {
      var desc = document.createElement("p");
      desc.className = "product-card__desc";
      desc.textContent = product.description;
      body.appendChild(desc);
    }

    var cta = document.createElement("a");
    cta.className = "product-card__cta";
    cta.setAttribute("href", product.href);
    cta.innerHTML =
      'Enquire <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    body.appendChild(cta);
    card.appendChild(body);

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "tzprod-edit";
    editBtn.setAttribute("data-tzprod-edit", product.id);
    editBtn.setAttribute("data-editor-ui", "");
    editBtn.textContent = "Edit product";
    card.appendChild(editBtn);

    return card;
  }

  function staticShopCards() {
    var grid = document.querySelector(".product-grid--shop");
    if (!grid) return [];
    var cards = [];
    for (var i = 0; i < grid.children.length; i++) {
      var el = grid.children[i];
      if (!el.classList || !el.classList.contains("product-card")) continue;
      if (el.hasAttribute("data-tz-product")) continue;
      if (!el.hasAttribute("data-tz-card")) {
        el.setAttribute("data-tz-card", String(cards.length));
      }
      cards.push(el);
    }
    cards.sort(function (a, b) {
      return Number(a.getAttribute("data-tz-card")) - Number(b.getAttribute("data-tz-card"));
    });
    return cards;
  }

  function renderProducts() {
    if (!onShopPage()) return;
    var grid = document.querySelector(".product-grid--shop");
    if (!grid) return;
    var statics = staticShopCards();
    statics.forEach(function (card) {
      card.classList.remove("is-managed-source");
    });
    var old = grid.querySelectorAll("[data-tz-product]");
    for (var i = 0; i < old.length; i++) {
      if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    }
    addedProducts.forEach(function (product) {
      var card = buildProductCard(product);
      var match = /^p-card(\d+)$/.exec(product.id);
      var source = match ? statics[Number(match[1])] : null;
      if (source) {
        source.classList.add("is-managed-source");
        source.parentNode.insertBefore(card, source.nextSibling);
      } else {
        grid.appendChild(card);
      }
    });
    document.dispatchEvent(new CustomEvent("tz:shop-updated"));
  }

  function buildCardChips() {
    if (!onShopPage()) return;
    staticShopCards().forEach(function (card) {
      if (card.querySelector("[data-tz-card-edit]")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tzprod-edit";
      btn.setAttribute("data-tz-card-edit", card.getAttribute("data-tz-card"));
      btn.setAttribute("data-editor-ui", "");
      btn.textContent = "Edit product";
      card.appendChild(btn);
    });
  }

  function setProductStatus(text, tone) {
    if (!productStatusEl) return;
    productStatusEl.textContent = text || "";
    if (tone) productStatusEl.setAttribute("data-tone", tone);
    else productStatusEl.removeAttribute("data-tone");
  }

  function renderProductThumb() {
    if (!productThumbEl) return;
    productThumbEl.innerHTML = "";
    var hasPhoto = !!productPhoto;
    if (hasPhoto) {
      var img = document.createElement("img");
      img.src = productPhoto;
      img.alt = "Product photo";
      img.addEventListener("error", function () {
        if (img.parentNode !== productThumbEl) return;
        productThumbEl.innerHTML = "";
        var missing = document.createElement("span");
        missing.setAttribute("aria-hidden", "true");
        missing.textContent = "!";
        productThumbEl.appendChild(missing);
      });
      productThumbEl.appendChild(img);
    } else {
      var span = document.createElement("span");
      span.textContent = "+";
      productThumbEl.appendChild(span);
    }
    if (productDialog) {
      var photoBtn = productDialog.querySelector('[data-tzprod="photo"]');
      var cancelBtn = productDialog.querySelector('[data-tzprod="cancel-photo"]');
      var removeBtn = productDialog.querySelector('[data-tzprod="nophoto"]');
      if (photoBtn) {
        photoBtn.textContent = hasPhoto ? "Replace" : "Choose photo";
        photoBtn.setAttribute(
          "aria-label",
          hasPhoto ? "Replace product photo" : "Choose product photo"
        );
      }
      if (cancelBtn) cancelBtn.hidden = !hasPhoto;
      if (removeBtn) removeBtn.hidden = !hasPhoto;
    }
  }

  function ensureProductDialog() {
    if (productDialog) return;
    productDialog = document.createElement("dialog");
    productDialog.className = "tzprod";
    productDialog.setAttribute("data-editor-ui", "");
    productDialog.setAttribute("aria-labelledby", "tzprod-title");
    productDialog.innerHTML =
      '<form class="tzprod__form" novalidate>' +
      '<div class="tzprod__head">' +
      '<p class="tzprod__eyebrow">Shop product</p>' +
      '<h2 class="tzprod__title" id="tzprod-title">Add product</h2>' +
      '<button class="tzprod__close" type="button" data-tzprod="close" aria-label="Close">&times;</button>' +
      "</div>" +
      '<div class="tzprod__photo">' +
      '<div class="tzprod__thumb" data-tzprod-thumb><span>+</span></div>' +
      '<div class="tzprod__photo-actions">' +
      '<button class="tzedit-btn tzedit-btn--primary" type="button" data-tzprod="photo">Choose photo</button> ' +
      '<button class="tzedit-btn" type="button" data-tzprod="cancel-photo" hidden>Cancel</button> ' +
      '<button class="tzedit-btn tzedit-btn--danger" type="button" data-tzprod="nophoto" hidden>Remove</button> ' +
      '<p class="tzprod__hint">JPG, PNG or WebP. Photos are resized automatically.</p>' +
      "</div>" +
      '<input type="file" accept="image/*" data-tzprod-file hidden>' +
      "</div>" +
      '<label class="tzprod__field"><span>Product name</span>' +
      '<input name="name" type="text" maxlength="80" required autocomplete="off"></label>' +
      '<div class="tzprod__row tzprod__row--amount">' +
      '<label class="tzprod__field"><span>Price (USD)</span>' +
      '<input name="price" type="text" inputmode="decimal" required autocomplete="off" placeholder="649"></label>' +
      '<label class="tzprod__field"><span>Qnty</span>' +
      '<input name="qty" type="text" inputmode="numeric" maxlength="4" required autocomplete="off" placeholder="1"></label>' +
      "</div>" +
      '<label class="tzprod__field"><span>Category</span><select name="category"></select></label>' +
      '<label class="tzprod__field"><span>Short description <em>optional</em></span>' +
      '<textarea name="description" rows="3" maxlength="400"></textarea></label>' +
      '<p class="tzprod__status" role="status" aria-live="polite"></p>' +
      '<div class="tzprod__actions">' +
      '<button class="tzedit-btn tzedit-btn--primary" type="submit">Save product</button>' +
      '<button class="tzedit-btn" type="button" data-tzprod="close">Cancel</button>' +
      '<button class="tzedit-btn tzedit-btn--danger" type="button" data-tzprod="remove" hidden>Remove product</button>' +
      "</div></form>";
    document.body.appendChild(productDialog);

    productForm = productDialog.querySelector(".tzprod__form");
    productStatusEl = productDialog.querySelector(".tzprod__status");
    productThumbEl = productDialog.querySelector(".tzprod__thumb");
    productFileInput = productDialog.querySelector("[data-tzprod-file]");

    var select = productForm.elements.category;
    PRODUCT_CATEGORIES.forEach(function (value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = PRODUCT_CATEGORY_LABELS[value];
      select.appendChild(option);
    });

    productDialog.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-tzprod]");
      if (!btn) return;
      var action = btn.getAttribute("data-tzprod");
      if (action === "close") closeProductDialog();
      else if (action === "photo") productFileInput.click();
      else if (action === "cancel-photo") {
        productPhoto = productOrigPhoto;
        renderProductThumb();
        setProductStatus("Photo change cancelled.");
      } else if (action === "nophoto") {
        productPhoto = "";
        renderProductThumb();
        setProductStatus("Photo removed — save the product to apply it.");
      } else if (action === "remove") removeProduct();
    });

    productDialog.addEventListener("close", function () {
      setProductStatus("");
    });

    productForm.addEventListener("submit", saveProduct);

    productFileInput.addEventListener("change", function () {
      var file = productFileInput.files && productFileInput.files[0];
      if (!file) return;
      setProductStatus("Preparing photo…");
      encodeImage(file)
        .then(function (url) {
          productPhoto = url;
          renderProductThumb();
          setProductStatus("");
        })
        .catch(function () {
          setProductStatus(
            "That photo format is not supported. Save it as a JPG or PNG and try again.",
            "error"
          );
        });
      productFileInput.value = "";
    });
  }

  function openCardProductDialog(card) {
    if (!editing || !onShopPage() || !card) return;
    ensureProductDialog();
    var nameEl = card.querySelector(".product-card__name");
    var priceEl = card.querySelector(".product-card__price");
    var descEl = card.querySelector(".product-card__desc");
    var imgEl = card.querySelector(".product-card__media img");
    var name = nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : "";
    var price = priceEl
      ? parseFloat((priceEl.textContent || "").replace(/,/g, "").replace(/[^0-9.]/g, ""))
      : 0;
    var category = card.getAttribute("data-category");
    var stock = card.hasAttribute("data-stock")
      ? Number(card.getAttribute("data-stock"))
      : null;
    productEditId = "";
    productCardIndex = Number(card.getAttribute("data-tz-card"));
    productPhoto = imgEl ? imgEl.getAttribute("src") || "" : "";
    productOrigPhoto = productPhoto;
    productForm.reset();
    productForm.elements.name.value = name;
    productForm.elements.price.value = isFinite(price) && price > 0 ? String(price) : "";
    productForm.elements.qty.value =
      stock !== null && isFinite(stock) && stock >= 0 ? String(Math.round(stock)) : "1";
    productForm.elements.category.value =
      PRODUCT_CATEGORIES.indexOf(category) !== -1 ? category : PRODUCT_CATEGORIES[0];
    productForm.elements.description.value = descEl ? descEl.textContent.trim() : "";
    productDialog.querySelector(".tzprod__title").textContent = "Edit product";
    productDialog.querySelector('[data-tzprod="remove"]').hidden = true;
    setProductStatus("");
    renderProductThumb();
    productDialog.showModal();
    productForm.elements.name.focus();
  }

  function activeProductCategory() {
    var category = document.documentElement.getAttribute("data-tz-filter-chosen");
    return PRODUCT_CATEGORIES.indexOf(category) !== -1 ? category : "";
  }

  function readLastProductCategory() {
    try {
      var value = localStorage.getItem(PRODUCT_CATEGORY_KEY);
      return PRODUCT_CATEGORIES.indexOf(value) !== -1 ? value : "";
    } catch (err) {
      return "";
    }
  }

  function rememberProductCategory(category) {
    lastProductCategory = category;
    try {
      localStorage.setItem(PRODUCT_CATEGORY_KEY, category);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function openProductDialog(id) {
    if (!editing || !onShopPage()) return;
    ensureProductDialog();
    var product = id ? findAddedProduct(id) : null;
    productEditId = product ? product.id : "";
    productCardIndex = null;
    productPhoto = product ? product.image : "";
    productOrigPhoto = productPhoto;
    productForm.reset();
    productForm.elements.name.value = product ? product.name : "";
    productForm.elements.price.value = product ? String(product.price) : "";
    productForm.elements.qty.value = product ? String(product.qty) : "1";
    productForm.elements.category.value = product
      ? product.category
      : activeProductCategory() ||
        lastProductCategory ||
        readLastProductCategory() ||
        PRODUCT_CATEGORIES[0];
    productForm.elements.description.value = product
      ? product.description
      : "";
    productDialog.querySelector(".tzprod__title").textContent = product
      ? "Edit product"
      : "Add product";
    var removeBtn = productDialog.querySelector('[data-tzprod="remove"]');
    removeBtn.hidden = !product;
    removeBtn.textContent =
      product && /^p-card\d+$/.test(product.id)
        ? "Restore original card"
        : "Remove product";
    setProductStatus("");
    renderProductThumb();
    productDialog.showModal();
    productForm.elements.name.focus();
  }

  function closeProductDialog() {
    if (productDialog && productDialog.open) productDialog.close();
    productEditId = "";
    productCardIndex = null;
  }

  function saveProduct(event) {
    event.preventDefault();
    var name = productForm.elements.name.value.replace(/\s+/g, " ").trim();
    var price = parseFloat(
      productForm.elements.price.value.replace(/,/g, "").replace(/[^0-9.]/g, "")
    );
    var category = productForm.elements.category.value;
    var qtyRaw = productForm.elements.qty.value.trim();
    var qty = Number(qtyRaw);
    if (!name) {
      setProductStatus("Enter a product name.", "error");
      productForm.elements.name.focus();
      return;
    }
    if (!isFinite(price) || price <= 0) {
      setProductStatus("Enter a price greater than zero.", "error");
      productForm.elements.price.focus();
      return;
    }
    if (
      qtyRaw === "" ||
      !isFinite(qty) ||
      Math.round(qty) !== qty ||
      qty < 0 ||
      qty > 9999
    ) {
      setProductStatus(
        "Enter the quantity you have in stock (0 to 9999). Use 0 for sold out.",
        "error"
      );
      productForm.elements.qty.focus();
      return;
    }
    if (PRODUCT_CATEGORIES.indexOf(category) === -1) {
      setProductStatus("Choose a category.", "error");
      return;
    }

    var wasEditing = !!productEditId;
    var id = wasEditing
      ? productEditId
      : productCardIndex !== null
        ? "p-card" + productCardIndex
        : newProductId();
    var wasAdopting = !wasEditing && productCardIndex !== null;
    if (!wasEditing && !findAddedProduct(id) && addedProducts.length >= MAX_PRODUCTS) {
      setProductStatus(
        "You can add up to " + MAX_PRODUCTS + " products. Remove one first.",
        "error"
      );
      return;
    }

    rememberProductCategory(category);
    var product = {
      id: id,
      name: name.slice(0, 80),
      price: Math.round(price * 100) / 100,
      category: category,
      description: productForm.elements.description.value.trim().slice(0, 400),
      qty: qty,
      image: productPhoto,
      href: productHref(name)
    };
    var index = wasEditing || wasAdopting ? indexOfProduct(product.id) : -1;
    if (index === -1) addedProducts.push(product);
    else addedProducts[index] = product;

    var draftSaved = writeProductDraft();
    renderProducts();
    closeProductDialog();
    var categoryLabel = PRODUCT_CATEGORY_LABELS[category] || category;
    if (draftSaved) {
      setStatus(
        (wasEditing || wasAdopting ? "Product updated in " : "Product added to ") +
          categoryLabel +
          " — press Publish to put it on the live site.",
        "ok"
      );
    } else {
      setStatus(
        "Product saved in this tab, but the browser is out of storage. " +
          "Press Publish now — it will be lost if you close this page.",
        "error"
      );
    }
    var savedCard = document.querySelector('[data-tz-product="' + id + '"]');
    if (savedCard && !savedCard.classList.contains("is-hidden")) {
      savedCard.scrollIntoView({ block: "center" });
    }
  }

  function removeProduct() {
    var product = findAddedProduct(productEditId);
    if (!product) return;
    var isOriginal = /^p-card\d+$/.test(product.id);
    if (
      !window.confirm(
        isOriginal
          ? 'Stop using the managed version of "' +
              product.name +
              '"? The original card comes back. Press Publish to apply it to the live site.'
          : 'Remove "' +
              product.name +
              '" from the shop? Press Publish to apply it to the live site.'
      )
    ) {
      return;
    }
    var index = indexOfProduct(product.id);
    if (index !== -1) addedProducts.splice(index, 1);
    var draftSaved = writeProductDraft();
    renderProducts();
    closeProductDialog();
    if (draftSaved) {
      setStatus(
        (isOriginal ? "Original card restored" : "Product removed") +
          " — press Publish to update the live site.",
        "ok"
      );
    } else {
      setStatus(
        "Change saved in this tab, but the browser is out of storage. " +
          "Press Publish now — it will be lost if you close this page.",
        "error"
      );
    }
  }

  function openDetails() {
    detailState = [];
    document.querySelectorAll("details").forEach(function (detail) {
      detailState.push([detail, detail.open]);
      detail.open = true;
    });
  }

  function restoreDetails() {
    detailState.forEach(function (pair) {
      pair[0].open = pair[1];
    });
    detailState = [];
  }

  function serialize() {
    var root = document.documentElement.cloneNode(true);
    root.classList.remove("tz-editing");

    var uiNodes = root.querySelectorAll("[data-editor-ui]");
    for (var i = 0; i < uiNodes.length; i++) {
      if (uiNodes[i].parentNode) uiNodes[i].parentNode.removeChild(uiNodes[i]);
    }

    var marked = root.querySelectorAll(".tzedit-text");
    for (var j = 0; j < marked.length; j++) {
      marked[j].classList.remove("tzedit-text");
      marked[j].removeAttribute("contenteditable");
      marked[j].removeAttribute("spellcheck");
    }

    return "<!DOCTYPE html>\n" + root.outerHTML;
  }

  function saveFile() {
    if (!editing) return;
    var html = serialize();
    setStatus("Choose a location for " + FILE + "…");

    if (typeof window.showSaveFilePicker !== "function") {
      download(html, altName());
      setStatus("Downloaded — replace your page file with it.", "ok");
      return;
    }

    window
      .showSaveFilePicker({
        suggestedName: FILE,
        types: [{ description: "HTML page", accept: { "text/html": [".html"] } }]
      })
      .then(function (handle) {
        return handle
          .createWritable()
          .then(function (writable) {
            return writable
              .write(new Blob([html], { type: "text/html;charset=utf-8" }))
              .then(function () {
                return writable.close();
              });
          })
          .then(function () {
            setStatus("Saved to " + handle.name + ". The file is updated.", "ok");
          });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          setStatus("Save cancelled.");
          return;
        }
        download(html, altName());
        setStatus("Downloaded instead — move it into your site folder.", "ok");
      });
  }

  function altName() {
    return FILE.replace(/\.html?$/i, "") + "-edited.html";
  }

  function download(html, name) {
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("timeout"));
      }, ms);
      promise.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (err) {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function fetchWithTimeout(url, options, ms) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = null;
    if (controller) {
      options.signal = controller.signal;
      timer = setTimeout(function () {
        controller.abort();
      }, ms);
    }
    return fetch(url, options).then(
      function (response) {
        if (timer) clearTimeout(timer);
        return response;
      },
      function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === "AbortError") {
          var error = new Error(
            "The site server did not respond. Your edits are still saved in this browser — try again in a few minutes."
          );
          error.timeout = true;
          throw error;
        }
        throw err;
      }
    );
  }

  function loadPublished() {
    if (!window.fetch) {
      return Promise.reject(new Error("This browser cannot load published edits."));
    }
    return fetchWithTimeout(
      PUBLISH_ENDPOINT + "?page=" + encodeURIComponent(FILE),
      {
        cache: "no-store",
        credentials: "same-origin"
      },
      8000
    )
      .then(function (response) {
        if (!response.ok) {
          throw new Error("The site answered with " + response.status + ".");
        }
        return response.json();
      })
      .then(function (json) {
        if (!json || !json.ok) {
          throw new Error("The site sent an unexpected answer.");
        }
        published = normalize(json.edits);
        publishedProducts = normalizeProducts(
          json.edits && json.edits.products
        );
        publishedKnown = true;
        return published;
      });
  }

  function readPass() {
    var saved = "";
    try {
      saved = localStorage.getItem(PASS_KEY) || "";
    } catch (err) {
      /* storage unavailable */
    }
    if (saved) return saved;
    var entered = window.prompt(
      "Enter the TechZone publish passphrase.\nIt is remembered on this device after a successful publish."
    );
    if (entered === null) return "";
    pendingPass = entered.trim();
    return pendingPass;
  }

  function keepPass() {
    if (!pendingPass) return;
    try {
      localStorage.setItem(PASS_KEY, pendingPass);
    } catch (err) {
      /* storage unavailable */
    }
    pendingPass = "";
  }

  function forgetPass() {
    pendingPass = "";
    try {
      localStorage.removeItem(PASS_KEY);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function mergeMap(base, local) {
    var out = {};
    Object.keys(base || {}).forEach(function (key) {
      out[key] = base[key];
    });
    Object.keys(local || {}).forEach(function (key) {
      out[key] = local[key];
    });
    return out;
  }

  function mergeForPublish() {
    return {
      text: mergeMap(published.text, edits.text),
      images: mergeMap(published.images, edits.images),
      links: mergeMap(published.links, edits.links),
      removed: mergeMap(published.removed, edits.removed),
      removedImages: mergeMap(published.removedImages, edits.removedImages),
      products: addedProducts.slice()
    };
  }

  function prepareImagesForPublish(map) {
    var out = {};
    var skipped = 0;
    return Object.keys(map || {})
      .reduce(function (chain, key) {
        return chain.then(function () {
          var value = map[key];
          if (typeof value !== "string" || value.indexOf("data:image/") !== 0) {
            out[key] = value;
            return;
          }
          if (
            PUBLISH_IMAGE_TYPES.indexOf(dataUrlMime(value)) !== -1 &&
            dataUrlBytes(value) <= MAX_PUBLISH_BYTES
          ) {
            out[key] = value;
            return;
          }
          return prepareDataUrl(value).then(function (fixed) {
            if (fixed) out[key] = fixed;
            else skipped++;
          });
        });
      }, Promise.resolve())
      .then(function () {
        return { images: out, skipped: skipped };
      });
  }

  function prepareProductsForPublish() {
    var out = [];
    var skipped = 0;
    return addedProducts
      .reduce(function (chain, product) {
        return chain.then(function () {
          var copy = {
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
            description: product.description,
            qty: product.qty,
            image: product.image,
            href: product.href
          };
          if (
            typeof copy.image === "string" &&
            copy.image.indexOf("data:image/") === 0 &&
            (PUBLISH_IMAGE_TYPES.indexOf(dataUrlMime(copy.image)) === -1 ||
              dataUrlBytes(copy.image) > MAX_PUBLISH_BYTES)
          ) {
            return prepareDataUrl(copy.image).then(function (fixed) {
              if (fixed) copy.image = fixed;
              else {
                copy.image = "";
                skipped++;
              }
              out.push(copy);
            });
          }
          out.push(copy);
        });
      }, Promise.resolve())
      .then(function () {
        return { products: out, skipped: skipped };
      });
  }

  function postPublish(body) {
    return fetchWithTimeout(
      PUBLISH_ENDPOINT + "?page=" + encodeURIComponent(FILE),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body)
      },
      25000
    ).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (json) {
          if (!response.ok || !json.ok) {
            var error = new Error(
              json.error || "The site did not accept the changes. Please try again."
            );
            error.status = response.status;
            throw error;
          }
          return json;
        });
    });
  }

  function setPublishBusy(busy) {
    publishBusy = busy;
    if (!panel) return;
    var btn = panel.querySelector('[data-tzedit="publish"]');
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy ? "Publishing…" : "Publish";
    }
  }

  function clearLocalEdits() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    edits.text = {};
    edits.images = {};
    edits.links = {};
    edits.removed = {};
    edits.removedImages = {};
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (err) {
      /* storage unavailable */
    }
    hasProductDraft = false;
    try {
      localStorage.removeItem(PRODUCTS_KEY);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function publishPage() {
    if (!editing || publishBusy) return;
    var pass = readPass();
    if (!pass) {
      setStatus("Publishing needs the passphrase.");
      return;
    }
    setPublishBusy(true);
    var ready = publishedKnown
      ? Promise.resolve()
      : loadPublished().catch(function () {
          throw new Error(
            "The site server did not respond, so there was nothing to publish against. Your edits are still saved in this browser — try again in a few minutes."
          );
        });
    if (!publishedKnown) setStatus("Checking the live site…");
    var skippedPhotos = 0;
    ready
      .then(function () {
        setStatus("Preparing photos…");
        var merged = mergeForPublish();
        return prepareImagesForPublish(merged.images)
          .then(function (prepared) {
            skippedPhotos = prepared.skipped;
            merged.images = prepared.images;
            return prepareProductsForPublish();
          })
          .then(function (prepared) {
            skippedPhotos += prepared.skipped;
            merged.products = prepared.products;
            return merged;
          });
      })
      .then(function (merged) {
        setStatus("Publishing to the live site…");
        return postPublish({
          action: "publish",
          page: FILE,
          pass: pass,
          edits: merged
        });
      })
      .then(function (json) {
        published = normalize(json.edits);
        publishedProducts = normalizeProducts(
          json.edits && json.edits.products
        );
        keepPass();
        writeImageCache(published.images);
        if (!skippedPhotos) {
          clearLocalEdits();
          addedProducts = publishedProducts.slice();
          renderProducts();
        }
        setPublishBusy(false);
        if (skippedPhotos) {
          setStatus(
            "Published, but " +
              skippedPhotos +
              " photo could not be included. Save that photo as a JPG or PNG, replace it again, and publish.",
            "error"
          );
        } else {
          setStatus("Published — open the site on your phone to check.", "ok");
        }
      })
      .catch(function (err) {
        setPublishBusy(false);
        if (err && err.status === 401) {
          forgetPass();
          setStatus(
            "Wrong passphrase — nothing was published. Press Publish to try again.",
            "error"
          );
          return;
        }
        setStatus(
          (err && err.message) ||
            "Publish failed. Check the connection and try again.",
          "error"
        );
      });
  }

  function unpublishPage() {
    if (!editing || publishBusy) return;
    if (
      !window.confirm(
        "Remove everything published for this page? Visitors will see the original page again, and unpublished changes in this browser are cleared too."
      )
    ) {
      return;
    }
    var pass = readPass();
    if (!pass) {
      setStatus("Unpublishing needs the passphrase.");
      return;
    }
    setPublishBusy(true);
    setStatus("Removing published edits…");
    postPublish({ action: "clear", page: FILE, pass: pass })
      .then(function () {
        published = emptyState();
        publishedProducts = [];
        writeImageCache(null);
        clearLocalEdits();
        location.reload();
      })
      .catch(function (err) {
        setPublishBusy(false);
        if (err && err.status === 401) {
          forgetPass();
          setStatus("Wrong passphrase — nothing was removed.", "error");
          return;
        }
        setStatus(
          (err && err.message) ||
            "Unpublish failed. Check the connection and try again.",
          "error"
        );
      });
  }

  function resetPage() {
    if (
      !window.confirm(
        "Discard changes saved in this browser? Published edits stay on the live site — use Unpublish to remove those."
      )
    ) {
      return;
    }
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(PRODUCTS_KEY);
    } catch (err) {
      /* nothing to clear */
    }
    location.reload();
  }

  document.addEventListener("keydown", function (event) {
    if (!editing) {
      if (
        canEdit &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "e"
      ) {
        event.preventDefault();
        showLauncher();
      }
      return;
    }
    if (productDialog && productDialog.open) return;
    if (
      !isLocal &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "e"
    ) {
      event.preventDefault();
      try {
        localStorage.setItem(EDIT_FLAG, "0");
      } catch (err) {
        /* storage unavailable */
      }
      location.reload();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveFile();
      return;
    }
    if (!linkPop.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLinkPopover();
      }
      return;
    }
    if (!imagePop.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImagePopover();
      }
      return;
    }
    if (event.key === "Escape") {
      if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      } else {
        exit();
      }
    }
  });

  function init() {
    textItems = collectText();
    imageItems = collectImages();
    linkItems = collectLinks();
    assignKeys();

    var saved = readStore();
    var cachedImages = readImageCache();
    if (cachedImages) applyData({ images: cachedImages }, false);

    if (canEdit) {
      var productDraft = readProductDraft();
      if (productDraft) {
        addedProducts = productDraft;
        renderProducts();
      }
    }

    withTimeout(loadPublished(), 5000)
      .catch(function () {
        publishedKnown = false;
        return null;
      })
      .then(function (data) {
        if (data) {
          applyData(data, false);
          writeImageCache(data.images);
        }
        if (!hasProductDraft && onShopPage()) {
          addedProducts = publishedProducts.slice();
          renderProducts();
        }
        if (!canEdit) return;
        applySaved(saved);
        buildUI();
        window.addEventListener("pagehide", flushSave);
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) flushSave();
        });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__tzEditor = {
    enter: enter,
    exit: exit,
    serialize: serialize,
    edits: edits,
    get textItems() {
      return textItems;
    },
    get linkItems() {
      return linkItems;
    }
  };
})();
