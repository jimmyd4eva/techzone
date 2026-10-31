(function () {
  "use strict";

  var EDIT_FLAG = "techzone-editor-on";
  var isLocal =
    location.protocol === "file:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  var params = new URLSearchParams(location.search);
  var editParam = params.has("edit") ? params.get("edit") : null;
  var remembered = false;

  try {
    remembered = localStorage.getItem(EDIT_FLAG) === "1";
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
  }

  if (!isLocal && !remembered) {
    // Ctrl+Shift+E turns editing on for this browser only.
    document.addEventListener("keydown", function (event) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      try {
        localStorage.setItem(EDIT_FLAG, "1");
      } catch (err) {
        /* storage unavailable */
      }
      location.reload();
    });
  }

  var canEdit = isLocal || remembered;
  var FILE = location.pathname.split("/").pop() || "index.html";
  var STORE_KEY = "techzone-edits:" + location.pathname;
  var PASS_KEY = "techzone-publish-pass";
  var PUBLISH_ENDPOINT = "api/publish.php";
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
      if (!all[i].closest("[data-editor-ui]")) items.push(all[i]);
    }
    return items;
  }

  function collectLinks() {
    var all = document.querySelectorAll("a[href]");
    var items = [];
    for (var i = 0; i < all.length; i++) {
      var link = all[i];
      if (link.closest("[data-editor-ui]")) continue;
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
      img.removeAttribute("srcset");
      img.src = data.images[key];
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
    document.documentElement.classList.add("has-editor");

    launchBtn = ui.querySelector(".tzedit-launch");
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
    });
    if (!canPublish) {
      var hidePublish = ui.querySelector('[data-tzedit="publish"]');
      var hideUnpublish = ui.querySelector('[data-tzedit="unpublish"]');
      if (hidePublish) hidePublish.hidden = true;
      if (hideUnpublish) hideUnpublish.hidden = true;
    }
    fileInput.addEventListener("change", onFilePicked);

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
    hideLinkHandle(true);
    restoreDetails();
    panel.hidden = true;
    launchBtn.hidden = false;
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
        setStatus("That photo could not be read. Try a JPG or PNG.");
      });
  }

  function encodeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var original = reader.result;
        if (file.type === "image/svg+xml" || file.size < 300 * 1024) {
          resolve(original);
          return;
        }

        var img = new Image();
        img.onerror = function () {
          resolve(original);
        };
        img.onload = function () {
          var max = 1600;
          var scale = Math.min(
            1,
            max / Math.max(img.naturalWidth, img.naturalHeight)
          );
          if (scale === 1 && file.size < 900 * 1024) {
            resolve(original);
            return;
          }

          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var ctx = canvas.getContext("2d");
          var type = file.type === "image/png" ? "image/png" : "image/jpeg";
          if (type === "image/jpeg") {
            ctx.fillStyle = "#0a0b0d";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          try {
            resolve(canvas.toDataURL(type, 0.85));
          } catch (err) {
            resolve(original);
          }
        };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
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

  function loadPublished() {
    if (!window.fetch) {
      return Promise.reject(new Error("This browser cannot load published edits."));
    }
    return fetch(PUBLISH_ENDPOINT + "?page=" + encodeURIComponent(FILE), {
      cache: "no-store",
      credentials: "same-origin"
    })
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
      removedImages: mergeMap(published.removedImages, edits.removedImages)
    };
  }

  function postPublish(body) {
    return fetch(PUBLISH_ENDPOINT + "?page=" + encodeURIComponent(FILE), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (response) {
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
            "Could not load the current published edits. Try again in a moment."
          );
        });
    if (!publishedKnown) setStatus("Checking the live site…");
    ready
      .then(function () {
        setStatus("Publishing to the live site…");
        return postPublish({
          action: "publish",
          page: FILE,
          pass: pass,
          edits: mergeForPublish()
        });
      })
      .then(function (json) {
        published = normalize(json.edits);
        keepPass();
        clearLocalEdits();
        setPublishBusy(false);
        setStatus("Published — open the site on your phone to check.", "ok");
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
    } catch (err) {
      /* nothing to clear */
    }
    location.reload();
  }

  document.addEventListener("keydown", function (event) {
    if (!editing) return;
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

    withTimeout(loadPublished(), 5000)
      .catch(function () {
        publishedKnown = false;
        return null;
      })
      .then(function (data) {
        if (data) applyData(data, false);
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
