// ==UserScript==
// @name         QA Wolf Shortcuts
// @namespace    http://tampermonkey.net/
// @version      4.176
// @description  Keyboard shortcut hints for app.qawolf.com. Header nav shortcuts live in JSON key __global__ (editable). File tabs: Shift+right-click = Close other tabs. Violet badges = Meta chord. task-wolf.com: Select All button for Bug Revalidation Tasks.
// @author       You
// @match        https://app.qawolf.com/*
// @match        https://www.task-wolf.com/*
// @match        https://task-wolf.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-shortcuts.user.js
// @downloadURL  https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-shortcuts.user.js
// ==/UserScript==
"use strict";
(() => {
  // src/qa-wolf-shortcuts.ts
  var STORAGE_KEY_ACTIVE = "_qaWolfActive";
  var STORAGE_KEY_SHORTCUTS = "_qaWolfShortcuts";
  var STORAGE_KEY_OPEN_TABS = "_qawOpenTabs";
  var STORAGE_KEY_FILE_INDEX = "_qawFileIndex";
  var STORAGE_KEY_SAFE_MODE = "_qawUserscriptsSafeMode";
  var STORAGE_KEY_SAFE_MODE_EVENT = "qaw-userscripts-safe-mode";
  var GLOBAL_PAGE_KEY = "__global__";
  var ANCHOR_THRESHOLD = 120;
  var POLL_INTERVAL = 600;
  function isReportScrapeWindow() {
    try {
      return /^_qaw_(bug|maint)_scrape_/i.test(String(window.name || ""));
    } catch (e) {
      return false;
    }
  }
  function getNavActionRow() {
    var link = document.querySelector('#app-header-navigation a[href*="maintenance"]');
    return link ? link.parentElement : null;
  }
  function getRunAttemptHeader() {
    var back = document.querySelector('[data-e2e="button-back"]');
    var interval = document.querySelector('[data-e2e="RunTimeInterval"]');
    var header = back && back.closest("header") || interval && interval.closest("header");
    if (!header) return null;
    if (!/\/environments\/[^/]+\/runs\/[^/]+\/flows\/[^/]+\/attempt\//.test(window.location.pathname)) return null;
    return header;
  }
  function getToggleHost() {
    var nav = getNavActionRow();
    if (nav) return { el: nav, variant: "nav" };
    var runHeader = getRunAttemptHeader();
    if (runHeader) return { el: runHeader, variant: "runHeader" };
    return null;
  }
  var NAV_SHORTCUTS = [
    { key: "m", selector: '[data-e2e="app-primary-nav-map"]' },
    { key: "a", selector: '[data-e2e="app-primary-nav-automate"]' },
    { key: "r", selector: '[data-e2e="app-primary-nav-runs"]' },
    { key: "b", selector: '[data-e2e="app-primary-nav-bugs"]' },
    { key: "q", selector: '[data-e2e="app-primary-nav-coverage-requests"]' },
    { key: "n", selector: '[data-e2e="app-primary-nav-maintenance"]' }
  ];
  var active = false;
  var editMode = false;
  var activeOverlays = [];
  var toggleBtn = null;
  var dropdown = null;
  var pollTimer = null;
  var editHighlight = null;
  var editHoverTarget = null;
  var assignPromptEl = null;
  var tabContextMenu = null;
  var shortcutsDrawer = null;
  var helpDrawer = null;
  var healthHud = null;
  var healthTimer = null;
  var healthMutationObserver = null;
  var healthMutationCount = 0;
  var healthLog = [];
  var healthRestoreFocus = null;
  var healthRestoreBlur = null;
  var healthDragCleanup = null;
  var safeModeChip = null;
  var safeModeStyle = null;
  var lastOverlaySig = "";
  var _lineChip = null;
  var _lineMenu = null;
  var _isPartialRun = false;
  var _lastExecutingLine = null;
  var _lastExecutingLineSeenAt = 0;
  var _lastExecutingLineRunStartedAt = null;
  var _runStartGlyphSig = null;
  var _waitForRunGlyphTransition = false;
  var _runStartStaleGlyphNodes = /* @__PURE__ */ new Set();
  var _runStartedAt = null;
  var _lastCompletedRunStartedAt = null;
  var _lastRunDurationMs = null;
  var _lastRunPassed = null;
  var _prevHeartbeatIsRunning = false;
  var _lastIndexedModelKey = null;
  var _runMaxLine = 0;
  function isTypingTarget(el) {
    if (!el || el === document.body) return false;
    var tn = el.tagName;
    if (tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT") return true;
    if (el.isContentEditable) return true;
    var role = el.getAttribute && el.getAttribute("role");
    if (role === "textbox" || role === "searchbox") return true;
    return false;
  }
  function isShortcutTargetDisabled(el) {
    if (!el || el === document.body) return false;
    if (el.closest && el.closest("fieldset[disabled]")) return true;
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.disabled === true) return true;
      var ad = cur.getAttribute && cur.getAttribute("aria-disabled");
      if (ad === "true") return true;
      if (cur.hasAttribute && cur.hasAttribute("disabled")) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  function getPageKey() {
    var path = window.location.pathname;
    var m = path.match(/\/environments\/[^/]+\/([^/]+)/);
    if (m) return m[1];
    var m2 = path.match(/\/[^/]+\/([^/]+)$/);
    if (m2) return m2[1];
    return path;
  }
  function loadAllShortcuts() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_SHORTCUTS) || "{}");
    } catch (e) {
      return {};
    }
  }
  function getShortcutsForPage(pageKey) {
    return loadAllShortcuts()[pageKey] || [];
  }
  function setShortcutsForPage(pageKey, shortcuts) {
    var all = loadAllShortcuts();
    all[pageKey] = shortcuts;
    localStorage.setItem(STORAGE_KEY_SHORTCUTS, JSON.stringify(all));
  }
  function getDefaultGlobalShortcuts() {
    return NAV_SHORTCUTS.map(function(s) {
      return { key: s.key, selector: s.selector };
    });
  }
  function getGlobalShortcuts() {
    var stored = loadAllShortcuts()[GLOBAL_PAGE_KEY];
    var defaults = getDefaultGlobalShortcuts();
    if (!stored || !stored.length) {
      return defaults.map(function(x) {
        return { key: x.key, selector: x.selector };
      });
    }
    var out = [];
    var i, j, found;
    for (i = 0; i < defaults.length; i++) {
      found = null;
      for (j = 0; j < stored.length; j++) {
        if (stored[j].selector === defaults[i].selector) {
          found = stored[j];
          break;
        }
      }
      out.push(found ? found : { key: defaults[i].key, selector: defaults[i].selector });
    }
    for (j = 0; j < stored.length; j++) {
      var sx = stored[j];
      var isDef = false;
      for (i = 0; i < defaults.length; i++) {
        if (defaults[i].selector === sx.selector) {
          isDef = true;
          break;
        }
      }
      if (!isDef) out.push(sx);
    }
    return out;
  }
  function shortcutChord(s) {
    return s.meta ? "meta+" + s.key : s.key;
  }
  function formatShortcutBadge(s) {
    return s.meta ? "\u2318" + s.key.toUpperCase() : s.key.toUpperCase();
  }
  function isNavItemActive(selector) {
    var segMap = {
      "app-primary-nav-map": "map",
      "app-primary-nav-automate": "automate",
      "app-primary-nav-runs": "runs",
      "app-primary-nav-bugs": "bug-reports",
      "app-primary-nav-coverage-requests": "coverage-requests",
      "app-primary-nav-maintenance": "maintenance-reports"
    };
    var e2e = selector.replace('[data-e2e="', "").replace('"]', "");
    var seg = segMap[e2e];
    if (!seg) return false;
    return window.location.pathname.indexOf("/" + seg) !== -1;
  }
  function getAllShortcuts() {
    var globalItems = getGlobalShortcuts().filter(function(s) {
      return !isNavItemActive(s.selector);
    });
    return globalItems.concat(getShortcutsForPage(getPageKey()));
  }
  function findShortcutConflict(shortcutLists, k, wantMeta, activeSel, sel, targetEl) {
    var li, i, s, same;
    for (li = 0; li < shortcutLists.length; li++) {
      var list = shortcutLists[li];
      if (!list) continue;
      for (i = 0; i < list.length; i++) {
        s = list[i];
        if (s.key !== k || !!s.meta !== wantMeta) continue;
        same = s.selector === (activeSel || sel) || document.querySelector(s.selector) === targetEl;
        if (!same) return s.label || s.selector;
      }
    }
    return null;
  }
  function cycleTab(dir) {
    var all = Array.prototype.slice.call(
      document.querySelectorAll('[class*="styles_tab__"]')
    );
    if (all.length < 2) return;
    var activeIdx = -1;
    all.forEach(function(el, i) {
      if (Array.prototype.some.call(el.classList, function(c) {
        return c.indexOf("styles_tabActive__") !== -1;
      })) activeIdx = i;
    });
    if (activeIdx === -1) return;
    var next = (activeIdx + dir + all.length) % all.length;
    triggerClick(all[next]);
  }
  function dispatchSyntheticPointerAndClick(el, cx, cy) {
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0
    };
    setTimeout(function() {
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(
          new PointerEvent("pointerdown", Object.assign({}, base, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 1
          }))
        );
      }
      el.dispatchEvent(new MouseEvent("mousedown", Object.assign({}, base, { buttons: 1 })));
      el.dispatchEvent(new MouseEvent("mouseup", Object.assign({}, base, { buttons: 0 })));
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(
          new PointerEvent("pointerup", Object.assign({}, base, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 0
          }))
        );
      }
      el.dispatchEvent(new MouseEvent("click", Object.assign({}, base, { buttons: 0 })));
    }, 0);
  }
  function triggerClick(el) {
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) {
      setTimeout(function() {
        el.focus();
      }, 0);
      return;
    }
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    dispatchSyntheticPointerAndClick(el, cx, cy);
    if (el.getAttribute && el.getAttribute("role") === "tab") {
      var tablist = null;
      var cur = el.parentElement;
      while (cur && cur !== document.body) {
        if (cur.getAttribute && cur.getAttribute("role") === "tablist") {
          tablist = cur;
          break;
        }
        cur = cur.parentElement;
      }
      if (tablist) {
        var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
        var activeTab = tablist.querySelector('[role="tab"][data-state="active"]');
        var fromIdx = activeTab ? tabs.indexOf(activeTab) : -1;
        var toIdx = tabs.indexOf(el);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          tablist.focus();
          var key = toIdx > fromIdx ? "ArrowRight" : "ArrowLeft";
          var steps = Math.abs(toIdx - fromIdx);
          for (var i = 0; i < steps; i++) {
            tablist.dispatchEvent(new KeyboardEvent("keydown", {
              key,
              code: key,
              bubbles: true,
              cancelable: true
            }));
          }
          setTimeout(function() {
            tablist.blur();
          }, 50);
        }
      }
    }
  }
  function flashOverlay(chord) {
    var ovs = document.querySelectorAll('[data-qaw-chord="' + chord + '"]');
    var isMeta = chord.indexOf("meta+") === 0;
    var base = isMeta ? "#7c3aed" : "#FFD700";
    var pop = isMeta ? "#a78bfa" : "#4ade80";
    Array.prototype.forEach.call(ovs, function(ov) {
      ov.animate([
        { transform: "scale(1)", background: base, offset: 0 },
        { transform: "scale(0.78)", background: base, offset: 0.18 },
        { transform: "scale(1.15)", background: pop, offset: 0.52 },
        { transform: "scale(1)", background: base, offset: 1 }
      ], { duration: 475, easing: "ease-out" });
    });
  }
  function showToast(msg) {
    var t = document.createElement("div");
    t.setAttribute("data-qaw-overlay", "1");
    t.textContent = msg;
    t.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "background:#1e293b",
      "color:#4ade80",
      "border:1px solid #475569",
      "border-radius:6px",
      "padding:8px 14px",
      "font-family:monospace",
      "font-size:12px",
      "z-index:2147483647",
      "box-shadow:0 4px 12px rgba(0,0,0,0.4)",
      "pointer-events:none"
    ].join(";");
    document.body.appendChild(t);
    setTimeout(function() {
      t.remove();
    }, 1800);
  }
  function describeEl(el) {
    if (!el) return "(none)";
    if (el === document) return "document";
    if (el === window) return "window";
    var tag = (el.tagName || String(el.nodeName || "node")).toLowerCase();
    var bits = [tag];
    if (el.id) bits.push("#" + el.id);
    if (el.getAttribute) {
      var e2e = el.getAttribute("data-e2e");
      var role = el.getAttribute("role");
      if (e2e) bits.push('[data-e2e="' + e2e + '"]');
      if (role) bits.push('[role="' + role + '"]');
      if (el.getAttribute("data-qaw-overlay")) bits.push("[data-qaw-overlay]");
    }
    var txt = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (txt) bits.push('"' + txt.slice(0, 32) + (txt.length > 32 ? "..." : "") + '"');
    return bits.join("");
  }
  function healthAddLog(msg) {
    var line = (/* @__PURE__ */ new Date()).toISOString().slice(11, 23) + " " + msg;
    healthLog.push(line);
    if (healthLog.length > 160) healthLog = healthLog.slice(healthLog.length - 160);
  }
  function healthCounts() {
    return {
      overlays: document.querySelectorAll("[data-qaw-overlay]").length,
      shortcutBadges: document.querySelectorAll("[data-qaw-chord]").length,
      notePanels: document.querySelectorAll("[data-qaw-inv-notes], [data-qaw-notes-viewer]").length,
      noteEditors: document.querySelectorAll('[data-qaw-single-note-edit], [data-e2e="investigation-notes-single-editor"]').length,
      dropdowns: document.querySelectorAll("[data-qaw-ref-drop], [data-qaw-client-note-ref-drop], .qaw-note-kebab-menu.open").length
    };
  }
  function renderHealthHud() {
    if (!healthHud) return;
    var counts = healthCounts();
    var activeEl = document.activeElement;
    var activeGone = !!(activeEl && activeEl !== document.body && !document.documentElement.contains(activeEl));
    var body = healthHud.querySelector("[data-qaw-health-body]");
    if (!body) return;
    body.textContent = "active: " + describeEl(activeEl) + (activeGone ? " (REMOVED)" : "") + "\nmutations/s: " + healthMutationCount + "\noverlays: " + counts.overlays + "  badges: " + counts.shortcutBadges + "\nnotes: " + counts.notePanels + "  note editors: " + counts.noteEditors + "\ndropdowns: " + counts.dropdowns + "\nsafe mode: " + (isSafeModeEnabled() ? "ON" : "off") + "\n\n" + healthLog.slice(Math.max(0, healthLog.length - 14)).join("\n");
    healthMutationCount = 0;
  }
  function clampHealthHud() {
    if (!healthHud) return;
    var rect = healthHud.getBoundingClientRect();
    var maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    var maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    var left = Math.min(Math.max(8, rect.left), maxLeft);
    var top = Math.min(Math.max(8, rect.top), maxTop);
    healthHud.style.left = Math.round(left) + "px";
    healthHud.style.top = Math.round(top) + "px";
    healthHud.style.right = "auto";
    healthHud.style.bottom = "auto";
  }
  function makeHealthHudDraggable(handle) {
    var dragging = false;
    var dragDx = 0;
    var dragDy = 0;
    function onMouseMove(e) {
      if (!dragging || !healthHud) return;
      healthHud.style.left = Math.round(e.clientX - dragDx) + "px";
      healthHud.style.top = Math.round(e.clientY - dragDy) + "px";
      healthHud.style.right = "auto";
      healthHud.style.bottom = "auto";
    }
    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      clampHealthHud();
    }
    function onResize() {
      clampHealthHud();
    }
    handle.addEventListener("mousedown", function(e) {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      if (!healthHud) return;
      dragging = true;
      var rect = healthHud.getBoundingClientRect();
      dragDx = e.clientX - rect.left;
      dragDy = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onResize);
    return function() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onResize);
      healthDragCleanup = null;
    };
  }
  function startHealthHud() {
    if (healthHud) return;
    healthLog = [];
    healthMutationCount = 0;
    healthAddLog("health HUD started");
    healthHud = document.createElement("div");
    healthHud.setAttribute("data-qaw-overlay", "1");
    healthHud.setAttribute("data-qaw-health-hud", "1");
    healthHud.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "width:420px",
      "max-width:calc(100vw - 24px)",
      "max-height:55vh",
      "z-index:2147483647",
      "background:#020617",
      "color:#cbd5e1",
      "border:1px solid #38bdf8",
      "border-radius:10px",
      "box-shadow:0 10px 32px rgba(0,0,0,0.65)",
      "font:11px ui-monospace,SFMono-Regular,Menlo,monospace",
      "overflow:hidden"
    ].join(";");
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#0f172a;border-bottom:1px solid #1e293b;cursor:move;user-select:none;";
    var title = document.createElement("strong");
    title.textContent = "QAW health";
    title.style.cssText = "color:#7dd3fc;font-size:12px;";
    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";
    function tinyBtn(label, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:5px;padding:3px 7px;cursor:pointer;font:11px monospace;";
      b.addEventListener("click", function(e) {
        e.stopPropagation();
        onClick();
      });
      return b;
    }
    actions.appendChild(tinyBtn("copy", function() {
      fallbackCopy(healthLog.join("\n"));
    }));
    actions.appendChild(tinyBtn("safe", function() {
      enableSafeMode();
    }));
    actions.appendChild(tinyBtn("stop", stopHealthHud));
    head.appendChild(title);
    head.appendChild(actions);
    var pre = document.createElement("pre");
    pre.setAttribute("data-qaw-health-body", "1");
    pre.style.cssText = "margin:0;padding:9px 10px;white-space:pre-wrap;overflow:auto;max-height:calc(55vh - 38px);line-height:1.35;";
    healthHud.appendChild(head);
    healthHud.appendChild(pre);
    document.body.appendChild(healthHud);
    healthDragCleanup = makeHealthHudDraggable(head);
    document.addEventListener("focusin", onHealthFocusIn, true);
    document.addEventListener("focusout", onHealthFocusOut, true);
    healthMutationObserver = new MutationObserver(function(records) {
      healthMutationCount += records.length;
      var ae = document.activeElement;
      if (ae && ae !== document.body && !document.documentElement.contains(ae)) {
        healthAddLog("active element removed: " + describeEl(ae));
      }
    });
    healthMutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    var proto = HTMLElement.prototype;
    var oldFocus = proto.focus;
    var oldBlur = proto.blur;
    proto.focus = function() {
      healthAddLog("focus() " + describeEl(this));
      return oldFocus.apply(this, arguments);
    };
    proto.blur = function() {
      healthAddLog("blur() " + describeEl(this));
      return oldBlur.apply(this, arguments);
    };
    healthRestoreFocus = function() {
      proto.focus = oldFocus;
    };
    healthRestoreBlur = function() {
      proto.blur = oldBlur;
    };
    renderHealthHud();
    healthTimer = setInterval(renderHealthHud, 1e3);
    setTimeout(function() {
      if (healthHud) {
        healthAddLog("auto-stop after 5 minutes");
        stopHealthHud();
      }
    }, 5 * 60 * 1e3);
  }
  function onHealthFocusIn(e) {
    healthAddLog("focusin  " + describeEl(e.target));
  }
  function onHealthFocusOut(e) {
    var related = e.relatedTarget ? " -> " + describeEl(e.relatedTarget) : "";
    healthAddLog("focusout " + describeEl(e.target) + related);
  }
  function stopHealthHud() {
    document.removeEventListener("focusin", onHealthFocusIn, true);
    document.removeEventListener("focusout", onHealthFocusOut, true);
    if (healthMutationObserver) {
      healthMutationObserver.disconnect();
      healthMutationObserver = null;
    }
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (healthRestoreFocus) {
      healthRestoreFocus();
      healthRestoreFocus = null;
    }
    if (healthRestoreBlur) {
      healthRestoreBlur();
      healthRestoreBlur = null;
    }
    if (healthDragCleanup) {
      healthDragCleanup();
    }
    if (healthHud) {
      healthHud.remove();
      healthHud = null;
    }
  }
  function isSafeModeEnabled() {
    return localStorage.getItem(STORAGE_KEY_SAFE_MODE) === "1";
  }
  function removeShortcutUi() {
    activeOverlays.forEach(function(ov) {
      ov.remove();
    });
    activeOverlays = [];
    lastOverlaySig = "";
    closeDropdown();
    closeAssignPrompt();
    closeShortcutsDrawer();
    closeHelpDrawer();
    stopHealthHud();
    if (editMode) stopEditMode();
    if (toggleBtn) {
      toggleBtn.remove();
      toggleBtn = null;
    }
    if (_lineChip) {
      _lineChip.remove();
      _lineChip = null;
    }
    if (_lineMenu) {
      _lineMenu.remove();
      _lineMenu = null;
    }
  }
  function renderSafeModeChip() {
    if (!document.body) return;
    if (safeModeStyle && safeModeStyle.isConnected && safeModeChip && safeModeChip.isConnected) return;
    if (!safeModeStyle) {
      safeModeStyle = document.createElement("style");
      safeModeStyle.setAttribute("data-qaw-safe-mode-style", "1");
      safeModeStyle.textContent = "[data-qaw-overlay]:not([data-qaw-safe-mode-chip]){display:none!important;}";
    }
    if (!safeModeStyle.isConnected) document.head.appendChild(safeModeStyle);
    if (!safeModeChip) {
      safeModeChip = document.createElement("button");
      safeModeChip.type = "button";
      safeModeChip.setAttribute("data-qaw-overlay", "1");
      safeModeChip.setAttribute("data-qaw-safe-mode-chip", "1");
      safeModeChip.textContent = "QAW scripts paused - Resume";
      safeModeChip.title = 'DevTools: localStorage.removeItem("' + STORAGE_KEY_SAFE_MODE + '"); location.reload();';
      safeModeChip.style.cssText = [
        "position:fixed",
        "right:12px",
        "bottom:12px",
        "z-index:2147483647",
        "background:#7f1d1d",
        "color:#fee2e2",
        "border:1px solid #fca5a5",
        "border-radius:999px",
        "padding:7px 12px",
        "font:12px ui-monospace,SFMono-Regular,Menlo,monospace",
        "cursor:pointer",
        "box-shadow:0 6px 20px rgba(0,0,0,0.45)"
      ].join(";");
      safeModeChip.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        disableSafeMode();
      });
    }
    if (!safeModeChip.isConnected) document.body.appendChild(safeModeChip);
  }
  function broadcastSafeMode(enabled) {
    try {
      window.dispatchEvent(new CustomEvent(STORAGE_KEY_SAFE_MODE_EVENT, { detail: { enabled: !!enabled } }));
    } catch (e) {
    }
  }
  function applySafeModeUi(enabled, showResumeToast) {
    if (enabled) {
      active = false;
      window.__qawShortcutsActive = false;
      window.__qawEditMode = false;
      removeShortcutUi();
      renderSafeModeChip();
      return;
    }
    if (safeModeStyle) {
      safeModeStyle.remove();
      safeModeStyle = null;
    }
    if (safeModeChip) {
      safeModeChip.remove();
      safeModeChip = null;
    }
    injectToggleBtn();
    if (showResumeToast) showToast("QAW scripts resumed");
  }
  function enableSafeMode() {
    if (!isSafeModeEnabled()) localStorage.setItem(STORAGE_KEY_SAFE_MODE, "1");
    broadcastSafeMode(true);
    active = false;
    localStorage.setItem(STORAGE_KEY_ACTIVE, "0");
    applySafeModeUi(true, false);
    console.info('QAW userscripts safe mode enabled. To disable from DevTools: localStorage.removeItem("' + STORAGE_KEY_SAFE_MODE + '"); location.reload();');
  }
  function disableSafeMode() {
    if (isSafeModeEnabled()) localStorage.removeItem(STORAGE_KEY_SAFE_MODE);
    broadcastSafeMode(false);
    applySafeModeUi(false, true);
  }
  function getTabEl(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute("data-qaw-inv-notes") === "1") return null;
      if (cur.getAttribute && cur.getAttribute("data-qaw-overlay")) return null;
      if (cur.className && typeof cur.className === "string" && cur.className.indexOf("styles_tab__") !== -1) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function closeTabContextMenu() {
    if (tabContextMenu) {
      tabContextMenu.remove();
      tabContextMenu = null;
    }
  }
  function showTabContextMenu(x, y, tabEl) {
    var menu = document.createElement("div");
    menu.setAttribute("data-qaw-overlay", "1");
    menu.style.cssText = [
      "position:fixed",
      "top:" + y + "px",
      "left:" + x + "px",
      "background:#1e293b",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:6px",
      "overflow:hidden",
      "font-family:monospace",
      "font-size:12px",
      "z-index:2147483647",
      "box-shadow:0 4px 12px rgba(0,0,0,0.4)",
      "min-width:160px"
    ].join(";");
    var item = document.createElement("div");
    item.textContent = "Close other tabs";
    item.style.cssText = "padding:8px 12px;cursor:pointer;";
    item.addEventListener("mouseenter", function() {
      item.style.background = "#334155";
    });
    item.addEventListener("mouseleave", function() {
      item.style.background = "";
    });
    item.addEventListener("click", function(e) {
      e.stopPropagation();
      closeTabContextMenu();
      closeOtherTabs(tabEl);
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    tabContextMenu = menu;
    var mr = menu.getBoundingClientRect();
    if (x + mr.width > window.innerWidth - 8) menu.style.left = window.innerWidth - mr.width - 8 + "px";
    if (y + mr.height > window.innerHeight - 8) menu.style.top = y - mr.height + "px";
    setTimeout(function() {
      function dismissHandler(e) {
        if (menu && !menu.contains(e.target)) {
          closeTabContextMenu();
          document.removeEventListener("click", dismissHandler);
          document.removeEventListener("contextmenu", dismissHandler);
        }
      }
      document.addEventListener("click", dismissHandler);
      document.addEventListener("contextmenu", dismissHandler);
    }, 0);
  }
  function closeOtherTabs(keepTab) {
    var allTabs = Array.prototype.slice.call(document.querySelectorAll('[class*="styles_tab__"]'));
    allTabs.forEach(function(tab) {
      if (tab === keepTab) return;
      var closeBtn = tab.querySelector('[class*="styles_closeButton__"]');
      if (closeBtn) closeBtn.click();
    });
  }
  document.addEventListener("contextmenu", function(e) {
    var tab = getTabEl(e.target);
    if (!tab) return;
    if (!e.shiftKey) return;
    e.preventDefault();
    closeTabContextMenu();
    showTabContextMenu(e.clientX, e.clientY, tab);
  }, true);
  function getTreeRows() {
    var rows = document.querySelectorAll('[class*="treeItemRow__"]');
    if (!rows.length) {
      rows = document.querySelectorAll('[class*="treeItemRow"]');
    }
    return Array.prototype.slice.call(rows);
  }
  function findTreeRow(el) {
    if (!el || typeof el.closest !== "function") return null;
    try {
      return el.closest('[class*="treeItemRow"]');
    } catch (e) {
      return null;
    }
  }
  function findCanonicalTreeRow(el) {
    if (!el) return null;
    var rows = getTreeRows();
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i] === el || rows[i].contains(el)) return rows[i];
    }
    return findTreeRow(el);
  }
  function focusTreeRow(row) {
    row.setAttribute("tabindex", "0");
    row.focus();
  }
  function getRowDepth(row) {
    var level = parseInt(row.getAttribute("aria-level"), 10);
    if (!isNaN(level)) return level;
    return row.getBoundingClientRect().left;
  }
  function clickTreeRowAsInUi(row) {
    var rect = row.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    cx = Math.min(Math.max(cx, 0), window.innerWidth - 1);
    cy = Math.min(Math.max(cy, 0), window.innerHeight - 1);
    var hit = document.elementFromPoint(cx, cy);
    var target = hit && row.contains(hit) ? hit : row;
    dispatchSyntheticPointerAndClick(target, cx, cy);
  }
  function handleTreeNav(row, k) {
    var rows = getTreeRows();
    var idx = rows.indexOf(row);
    if (idx === -1) return;
    if (k === "arrowright") {
      clickTreeRowAsInUi(row);
    } else if (k === "arrowleft") {
      var depth = getRowDepth(row);
      var target = null;
      for (var i = idx - 1; i >= 0; i--) {
        if (getRowDepth(rows[i]) < depth) {
          target = rows[i];
          break;
        }
      }
      focusTreeRow(target || rows[0]);
    } else if (k === "arrowdown") {
      focusTreeRow(rows[(idx + 1) % rows.length]);
    } else if (k === "arrowup") {
      focusTreeRow(rows[(idx - 1 + rows.length) % rows.length]);
    }
  }
  function injectPageScript(fn) {
    var s = document.createElement("script");
    s.textContent = "(" + fn.toString() + ")();";
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
  injectPageScript(function() {
    window.__qawAllKeys = "abcdefghijklmnopqrstuvwxyz0123456789-=[]\\;',./`".split("");
    function __qawIsTypingTarget(el) {
      if (!el || el === document.body) return false;
      var tn = el.tagName;
      if (tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT") return true;
      if (el.isContentEditable) return true;
      var role = el.getAttribute && el.getAttribute("role");
      if (role === "textbox" || role === "searchbox") return true;
      return false;
    }
    function __qawIsLiveBrowserTarget(el) {
      if (!el || el === document.body) return false;
      var cur = el;
      while (cur && cur !== document.body) {
        if (cur.id === "webrtc-viewer") return true;
        var id = (cur.id || "").toLowerCase();
        var cls = (typeof cur.className === "string" ? cur.className : "").toLowerCase();
        var de2e = (cur.getAttribute && cur.getAttribute("data-e2e") || "").toLowerCase();
        var dtest = (cur.getAttribute && cur.getAttribute("data-testid") || "").toLowerCase();
        if (id.indexOf("webrtc") !== -1 || id.indexOf("live-browser") !== -1 || id.indexOf("browser-viewer") !== -1) return true;
        if (cls.indexOf("webrtc") !== -1 || cls.indexOf("live-browser") !== -1 || cls.indexOf("browser-viewer") !== -1) return true;
        if (de2e.indexOf("webrtc") !== -1 || de2e.indexOf("live-browser") !== -1 || de2e.indexOf("browser-viewer") !== -1) return true;
        if (dtest.indexOf("webrtc") !== -1 || dtest.indexOf("live-browser") !== -1 || dtest.indexOf("browser-viewer") !== -1) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    function releaseStrayFocus() {
      setTimeout(function() {
        var ae = document.activeElement;
        if (!ae || ae === document.body) return;
        var role = ae.getAttribute && ae.getAttribute("role");
        var isRadixFocus = role === "tablist" || role === "tab";
        var isIframe = ae.tagName === "IFRAME";
        var isAutoEditor = ae.isContentEditable;
        if (isRadixFocus || isIframe || isAutoEditor) ae.blur();
      }, 100);
    }
    function __qawGetTreeRows() {
      var r = document.querySelectorAll('[class*="treeItemRow__"]');
      if (!r.length) r = document.querySelectorAll('[class*="treeItemRow"]');
      return Array.prototype.slice.call(r);
    }
    function __qawFindTreeRow(el) {
      if (!el) return null;
      var rows = __qawGetTreeRows();
      var i;
      for (i = 0; i < rows.length; i++) {
        if (rows[i] === el || rows[i].contains(el)) return rows[i];
      }
      if (typeof el.closest !== "function") return null;
      try {
        return el.closest('[class*="treeItemRow"]');
      } catch (e2) {
        return null;
      }
    }
    var _origPush = history.pushState.bind(history);
    history.pushState = function() {
      _origPush.apply(history, arguments);
      releaseStrayFocus();
    };
    var _origReplace = history.replaceState.bind(history);
    history.replaceState = function() {
      _origReplace.apply(history, arguments);
      releaseStrayFocus();
    };
    window.addEventListener("popstate", releaseStrayFocus);
    window.addEventListener("keydown", function(e) {
      if (__qawIsLiveBrowserTarget(e.target)) return;
      var focused = document.activeElement;
      if (__qawIsLiveBrowserTarget(focused)) return;
      if (focused && focused.tagName === "IFRAME") return;
      var k = e.key.toLowerCase();
      var isNav = k === "arrowdown" || k === "arrowup" || k === "enter" || k === "escape";
      if (e.altKey && (k === "arrowleft" || k === "arrowright")) {
        if (__qawIsTypingTarget(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent("__qaw_key", { detail: "alt+" + k }));
        return;
      }
      var t = e.target;
      var treeTarget = __qawFindTreeRow(t);
      if (treeTarget) {
        if (__qawIsTypingTarget(t)) return;
        if (k === "arrowleft" || k === "arrowright" || k === "arrowdown" || k === "arrowup") {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.dispatchEvent(new CustomEvent("__qaw_key", { detail: k }));
          return;
        }
      }
      if (window.__qawAllKeys.indexOf(k) === -1 && !isNav) return;
      if (__qawIsTypingTarget(t) || __qawIsTypingTarget(focused)) return;
      var ae = document.activeElement;
      var role = ae && ae.getAttribute && ae.getAttribute("role");
      if (role === "tablist" || role === "tab") ae.blur();
      if (k === "o" && e.metaKey) return;
      if (window.__qawEditMode) {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent("__qaw_key", { detail: k }));
        return;
      }
      if (!window.__qawShortcutsActive && k !== "o" && !window.__qawDropdownOpen) return;
      var detail = k;
      if (e.metaKey && window.__qawAllKeys.indexOf(k) !== -1) detail = "meta+" + k;
      window.__qawLastKeyConsumed = false;
      window.dispatchEvent(new CustomEvent("__qaw_key", { detail }));
      if (window.__qawLastKeyConsumed) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  });
  window.addEventListener("__qaw_key", function(e) {
    handleKey(e.detail);
  });
  function handleKey(k) {
    if (isSafeModeEnabled()) return;
    if (isTypingTarget(document.activeElement)) return;
    if (k === "alt+arrowright") {
      window.__qawLastKeyConsumed = true;
      cycleTab(1);
      return;
    }
    if (k === "alt+arrowleft") {
      window.__qawLastKeyConsumed = true;
      cycleTab(-1);
      return;
    }
    if (k === "escape") {
      if (dropdown) {
        window.__qawLastKeyConsumed = true;
        closeDropdown();
        return;
      }
      if (editMode) {
        window.__qawLastKeyConsumed = true;
        stopEditMode();
        return;
      }
      return;
    }
    if (k === "o") {
      if (toggleBtn && !shortcutTargetUncovered(toggleBtn)) return;
      window.__qawLastKeyConsumed = true;
      if (dropdown) {
        closeDropdown();
        return;
      }
      openDropdown();
      return;
    }
    if (k === "arrowright" || k === "arrowleft" || k === "arrowdown" || k === "arrowup") {
      var treeRow = findCanonicalTreeRow(document.activeElement);
      if (treeRow) {
        window.__qawLastKeyConsumed = true;
        handleTreeNav(treeRow, k);
      }
      return;
    }
    if (editMode) return;
    if (!active) return;
    var all = getAllShortcuts();
    for (var i = 0; i < all.length; i++) {
      if (shortcutChord(all[i]) !== k) continue;
      var btn = document.querySelector(all[i].selector);
      if (!btn || !shortcutTargetUncovered(btn)) continue;
      window.__qawLastKeyConsumed = true;
      flashOverlay(k);
      if (all[i].focus) {
        btn.setAttribute("tabindex", "0");
        btn.focus();
      } else {
        triggerClick(btn);
      }
      return;
    }
  }
  function shortcutTargetUncovered(el) {
    if (!el || !el.isConnected) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    cx = Math.min(Math.max(cx, 0), window.innerWidth - 1);
    cy = Math.min(Math.max(cy, 0), window.innerHeight - 1);
    var topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return false;
    return el === topEl || el.contains(topEl);
  }
  function computeOverlaySig() {
    if (!active && !editMode) return "";
    var muted = isTypingTarget(document.activeElement);
    var parts = [(muted ? "m" : "u") + (editMode ? "e" : "n")];
    if (toggleBtn && toggleBtn.isConnected) {
      var tbR = toggleBtn.getBoundingClientRect();
      parts.push("o:" + Math.round(tbR.bottom) + ":" + Math.round(tbR.left) + ":" + (shortcutTargetUncovered(toggleBtn) ? "1" : "0"));
    }
    getAllShortcuts().forEach(function(s) {
      var btn = document.querySelector(s.selector);
      if (!btn) {
        parts.push(s.key + ":x");
        return;
      }
      var r = btn.getBoundingClientRect();
      parts.push(s.key + ":" + Math.round(r.top) + ":" + Math.round(r.left) + (isShortcutTargetDisabled(btn) ? "d" : "") + (shortcutTargetUncovered(btn) ? "" : "h"));
    });
    return parts.join("|");
  }
  function drawOverlays() {
    activeOverlays.forEach(function(ov) {
      ov.remove();
    });
    activeOverlays = [];
    if (isSafeModeEnabled()) {
      lastOverlaySig = "";
      renderSafeModeChip();
      return;
    }
    if (!active && !editMode) {
      lastOverlaySig = "";
      return;
    }
    var muted = isTypingTarget(document.activeElement);
    if (toggleBtn && shortcutTargetUncovered(toggleBtn)) {
      var tbRect = toggleBtn.getBoundingClientRect();
      var tbOv = document.createElement("div");
      tbOv.innerText = "O";
      tbOv.style.cssText = overlayStyle(tbRect.bottom + 4, tbRect.left + tbRect.width / 2 - 10, false, muted, false);
      tbOv.setAttribute("data-qaw-overlay", "1");
      tbOv.setAttribute("data-qaw-chord", "o");
      document.body.appendChild(tbOv);
      activeOverlays.push(tbOv);
    }
    getAllShortcuts().forEach(function(shortcut) {
      var btn = document.querySelector(shortcut.selector);
      if (!btn) return;
      if (!shortcutTargetUncovered(btn)) return;
      var rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      var nearTop = rect.top < ANCHOR_THRESHOLD;
      var top = nearTop ? rect.bottom + 4 : rect.top - 22;
      var chord = shortcutChord(shortcut);
      var label = formatShortcutBadge(shortcut);
      var estW = label.length * 7 + 12;
      var left = rect.left + rect.width / 2 - estW / 2;
      var ov = document.createElement("div");
      ov.innerText = label;
      var dis = isShortcutTargetDisabled(btn);
      ov.style.cssText = overlayStyle(top, left, !!shortcut.meta, muted, dis);
      ov.setAttribute("data-qaw-overlay", "1");
      ov.setAttribute("data-qaw-chord", chord);
      ov.setAttribute("data-qaw-key", shortcut.key);
      document.body.appendChild(ov);
      activeOverlays.push(ov);
    });
    lastOverlaySig = computeOverlaySig();
  }
  function overlayStyle(top, left, useMetaColors, muted, disabled) {
    var bg;
    var fg;
    var bd;
    var opacity = "1";
    if (muted) {
      bg = "#64748b";
      fg = "#e2e8f0";
      bd = "#334155";
      if (disabled) opacity = "0.55";
    } else if (disabled) {
      bg = "#52525b";
      fg = "#a1a1aa";
      bd = "#3f3f46";
    } else if (useMetaColors) {
      bg = "#7c3aed";
      fg = "#f5f3ff";
      bd = "#5b21b6";
    } else {
      bg = "#FFD700";
      fg = "#000";
      bd = "#000";
    }
    return [
      "position:fixed",
      "top:" + top + "px",
      "left:" + left + "px",
      "background:" + bg,
      "color:" + fg,
      "border:1px solid " + bd,
      "padding:2px 6px",
      "border-radius:4px",
      "font-family:monospace",
      "font-weight:bold",
      "font-size:12px",
      "z-index:2147483646",
      "pointer-events:none",
      "box-shadow:0 2px 4px rgba(0,0,0,0.2)",
      "opacity:" + opacity
    ].join(";");
  }
  function isInvNotesSubtree(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute("data-qaw-inv-notes") === "1") return true;
      cur = cur.parentElement;
    }
    return false;
  }
  function isOurOverlay(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute("data-qaw-overlay")) {
        if (cur.getAttribute("data-qaw-inv-notes") === "1") {
          cur = cur.parentElement;
          continue;
        }
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }
  function onEditBlock(e) {
    if (isOurOverlay(e.target)) return;
    if (isInvNotesSubtree(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onEditClick(e) {
    if (isOurOverlay(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var target = bestCandidate(e.target);
    if (!target) return;
    openAssignPrompt(target);
  }
  function startEditMode() {
    editMode = true;
    window.__qawEditMode = true;
    closeAssignPrompt();
    updateToggleBtn();
    drawOverlays();
    editHighlight = document.createElement("div");
    editHighlight.setAttribute("data-qaw-overlay", "1");
    editHighlight.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "border:2px solid #FFD700",
      "border-radius:3px",
      "background:rgba(255,215,0,0.08)",
      "z-index:2147483645",
      "display:none",
      "box-sizing:border-box"
    ].join(";");
    document.body.appendChild(editHighlight);
    document.addEventListener("mouseover", onEditHover, true);
    document.addEventListener("pointerdown", onEditBlock, true);
    document.addEventListener("mousedown", onEditBlock, true);
    document.addEventListener("pointerup", onEditBlock, true);
    document.addEventListener("click", onEditClick, true);
  }
  function stopEditMode() {
    editMode = false;
    window.__qawEditMode = false;
    document.removeEventListener("mouseover", onEditHover, true);
    document.removeEventListener("pointerdown", onEditBlock, true);
    document.removeEventListener("mousedown", onEditBlock, true);
    document.removeEventListener("pointerup", onEditBlock, true);
    document.removeEventListener("click", onEditClick, true);
    if (editHighlight) {
      editHighlight.remove();
      editHighlight = null;
    }
    editHoverTarget = null;
    closeAssignPrompt();
    updateToggleBtn();
    drawOverlays();
  }
  function bestCandidate(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (isOurOverlay(cur)) return null;
      if (cur.dataset && cur.dataset.e2e) return cur;
      cur = cur.parentElement;
    }
    cur = el;
    while (cur && cur !== document.body) {
      if (isOurOverlay(cur)) return null;
      if (cur.tagName === "BUTTON" || cur.tagName === "A") return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function onEditHover(e) {
    if (isOurOverlay(e.target)) return;
    var target = bestCandidate(e.target);
    if (!target) {
      if (editHighlight) editHighlight.style.display = "none";
      editHoverTarget = null;
      return;
    }
    editHoverTarget = target;
    var rect = target.getBoundingClientRect();
    var allAssigned = getAllShortcuts();
    var sel = target.dataset && target.dataset.e2e ? '[data-e2e="' + target.dataset.e2e + '"]' : null;
    var assigned = null;
    allAssigned.forEach(function(s) {
      if (s.selector === sel || document.querySelector(s.selector) === target) {
        assigned = formatShortcutBadge(s);
      }
    });
    editHighlight.style.display = "block";
    editHighlight.style.top = rect.top + "px";
    editHighlight.style.left = rect.left + "px";
    editHighlight.style.width = rect.width + "px";
    editHighlight.style.height = rect.height + "px";
    editHighlight.style.borderColor = assigned ? "#4ade80" : "#FFD700";
    editHighlight.style.background = assigned ? "rgba(74,222,128,0.08)" : "rgba(255,215,0,0.08)";
  }
  function closeAssignPrompt() {
    if (assignPromptEl) {
      assignPromptEl.remove();
      assignPromptEl = null;
    }
  }
  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function getChildOptions(el) {
    var options = [];
    var seen = {};
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, null, false);
    while (walker.nextNode() && options.length < 8) {
      var cur = walker.currentNode;
      var s = null;
      if (cur.id) {
        s = "#" + CSS.escape(cur.id);
      } else if (cur.dataset && cur.dataset.e2e) {
        s = '[data-e2e="' + cur.dataset.e2e + '"]';
      } else if (typeof cur.className === "string") {
        var cls = cur.className.split(" ").filter(function(c) {
          return c.indexOf("styles_") === 0 && c.indexOf("__") !== -1;
        })[0];
        if (cls) s = '[class*="' + cls.split("__")[0] + '__"]';
      }
      if (s && !seen[s]) {
        seen[s] = true;
        options.push({ sel: s, desc: s });
      }
    }
    return options;
  }
  function getAncestorOptions(el) {
    var options = [];
    var seen = {};
    var cur = el.parentElement;
    while (cur && cur !== document.body && options.length < 8) {
      if (cur.id) {
        var s = "#" + CSS.escape(cur.id);
        if (!seen[s]) {
          seen[s] = true;
          options.push({ sel: s, desc: s });
        }
      }
      if (cur.dataset && cur.dataset.e2e) {
        var s = '[data-e2e="' + cur.dataset.e2e + '"]';
        if (!seen[s]) {
          seen[s] = true;
          options.push({ sel: s, desc: s });
        }
      }
      if (typeof cur.className === "string") {
        cur.className.split(" ").forEach(function(cls) {
          if (cls.indexOf("styles_") === 0 && cls.indexOf("__") !== -1) {
            var prefix = cls.split("__")[0] + "__";
            var s2 = '[class*="' + prefix + '"]';
            if (!seen[s2]) {
              seen[s2] = true;
              options.push({ sel: s2, desc: s2 });
            }
          }
        });
      }
      cur = cur.parentElement;
    }
    return options.slice(0, 8);
  }
  function showDisambiguation(prompt, baseSel, pageKey, pageShortcuts, targetEl, sel, label) {
    var area = prompt.querySelector("[data-qaw-conflict-area]");
    if (!area) return;
    var ancestors = getAncestorOptions(targetEl);
    var chipsHtml = "";
    ancestors.forEach(function(opt) {
      var count = document.querySelectorAll(opt.sel + " " + baseSel).length;
      chipsHtml += '<button data-qaw-ancestor="' + escHtml(opt.sel) + '" style="background:#0f172a;color:#94a3b8;border:1px solid #475569;border-radius:3px;padding:3px 7px;cursor:pointer;font-size:10px;font-family:monospace;margin:2px;white-space:nowrap;">' + escHtml(opt.desc) + ' <span style="color:#64748b">(' + count + ")</span></button>";
    });
    area.innerHTML = '<div style="margin-bottom:6px;color:#fbbf24;font-size:11px;">' + document.querySelectorAll(baseSel).length + ' elements match \u2014 scope to ancestor:</div><div style="display:flex;flex-wrap:wrap;margin-bottom:6px;">' + chipsHtml + '</div><div style="display:flex;gap:6px;align-items:center;"><input data-qaw-ancestor-custom placeholder="custom ancestor selector" style="flex:1;min-width:0;background:#0f172a;color:#f1f5f9;border:1px solid #475569;border-radius:3px;padding:2px 5px;font-family:monospace;font-size:11px;" /><button data-qaw-use-anyway style="background:#334155;color:#94a3b8;border:none;border-radius:3px;padding:3px 7px;cursor:pointer;font-size:10px;font-family:monospace;">Use anyway</button></div>';
    function saveWith(ancestorSel) {
      var finalSel = ancestorSel ? ancestorSel + " " + baseSel : baseSel;
      var shortcuts = prompt._pendingShortcuts != null ? prompt._pendingShortcuts : pageShortcuts;
      assignShortcut(
        pageKey,
        shortcuts,
        prompt._pendingKey,
        targetEl,
        finalSel,
        label,
        prompt._pendingFocus,
        !!prompt._pendingMeta
      );
    }
    area.querySelectorAll("[data-qaw-ancestor]").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        saveWith(btn.getAttribute("data-qaw-ancestor"));
      });
    });
    var customInput = area.querySelector("[data-qaw-ancestor-custom]");
    customInput.addEventListener("keydown", function(e) {
      e.stopImmediatePropagation();
      if (e.key === "Enter" && customInput.value.trim()) saveWith(customInput.value.trim());
      if (e.key === "Escape") closeAssignPrompt();
    });
    area.querySelector("[data-qaw-use-anyway]").addEventListener("click", function(e) {
      e.stopPropagation();
      saveWith("");
    });
    setTimeout(function() {
      customInput.focus();
    }, 50);
  }
  function openAssignPrompt(targetEl) {
    closeAssignPrompt();
    var inHeaderNav = targetEl.closest && targetEl.closest("#app-header-navigation");
    var sel = targetEl.dataset && targetEl.dataset.e2e ? '[data-e2e="' + targetEl.dataset.e2e + '"]' : null;
    var existing = null;
    var existingSource = null;
    var existingEntry = null;
    getGlobalShortcuts().forEach(function(s) {
      if (s.selector === sel || document.querySelector(s.selector) === targetEl) {
        existing = s.key;
        existingSource = "global";
        existingEntry = s;
      }
    });
    if (!existingEntry) {
      getShortcutsForPage(getPageKey()).forEach(function(s) {
        if (s.selector === sel || document.querySelector(s.selector) === targetEl) {
          existing = s.key;
          existingSource = "page";
          existingEntry = s;
        }
      });
    }
    var storageKey = inHeaderNav || existingSource === "global" ? GLOBAL_PAGE_KEY : getPageKey();
    var pageShortcuts = storageKey === GLOBAL_PAGE_KEY ? getGlobalShortcuts() : getShortcutsForPage(getPageKey());
    var label = targetEl.dataset && targetEl.dataset.e2e ? targetEl.dataset.e2e : (targetEl.innerText || "").trim().slice(0, 30);
    var rect = targetEl.getBoundingClientRect();
    var prompt = document.createElement("div");
    prompt.setAttribute("data-qaw-overlay", "1");
    prompt.style.cssText = [
      "position:fixed",
      "background:#1e293b",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:6px",
      "padding:10px 12px",
      "font-family:monospace",
      "font-size:12px",
      "z-index:2147483647",
      "box-shadow:0 4px 12px rgba(0,0,0,0.4)",
      "min-width:220px",
      "max-width:340px"
    ].join(";");
    var html = '<div style="margin-bottom:6px;color:#94a3b8;font-size:11px;">' + escHtml(label) + "</div>";
    if (existing) {
      var curBadge = formatShortcutBadge(existingEntry || { key: existing, meta: false });
      var curColor = existingEntry && existingEntry.meta ? "#c4b5fd" : "#FFD700";
      html += '<div style="margin-bottom:6px;">Current: <b style="color:' + curColor + '">' + escHtml(curBadge) + "</b>";
      if (existingSource === "global") {
        html += ' <span style="color:#94a3b8">(global / header)</span>';
      }
      html += "</div>";
    }
    var activeSel = sel;
    html += "<div data-qaw-conflict-area>";
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += "<span>Press key:</span>";
    html += '<input data-qaw-input="1" maxlength="1" style="width:28px;text-align:center;background:#0f172a;color:#f1f5f9;border:1px solid #475569;border-radius:3px;padding:2px 4px;font-family:monospace;font-size:13px;" />';
    if (existing) {
      html += '<button data-qaw-remove="1" style="margin-left:4px;background:#7f1d1d;color:#fca5a5;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:11px;">Remove</button>';
    }
    html += "</div>";
    html += '<div style="margin-top:6px;display:flex;align-items:center;gap:5px;">';
    html += '<input type="checkbox" data-qaw-focus-chk id="qaw-focus-chk" style="cursor:pointer;accent-color:#60a5fa;" />';
    html += '<label for="qaw-focus-chk" style="font-size:11px;color:#94a3b8;cursor:pointer;">focus instead of click</label>';
    html += "</div>";
    html += '<div style="margin-top:6px;display:flex;align-items:center;gap:5px;">';
    html += '<input type="checkbox" data-qaw-meta-chk id="qaw-meta-chk" ' + (existingEntry && existingEntry.meta ? "checked " : "") + 'style="cursor:pointer;accent-color:#7c3aed;" />';
    html += '<label for="qaw-meta-chk" style="font-size:11px;color:#94a3b8;cursor:pointer;">require \u2318 (Meta) + key</label>';
    html += "</div>";
    html += '<div data-qaw-msg style="margin-top:5px;font-size:11px;color:#f87171;min-height:14px;"></div>';
    html += "</div>";
    html += "<div data-qaw-scope-area></div>";
    html += '<div style="margin-top:5px;display:flex;gap:10px;">';
    html += '<button data-qaw-scope-btn="ancestor" style="background:none;border:none;color:#475569;cursor:pointer;font-size:10px;font-family:monospace;padding:0;text-decoration:underline dotted;">&#8853; ancestor</button>';
    html += '<button data-qaw-scope-btn="child" style="background:none;border:none;color:#475569;cursor:pointer;font-size:10px;font-family:monospace;padding:0;text-decoration:underline dotted;">&#8854; child</button>';
    html += "</div>";
    prompt.innerHTML = html;
    var input = prompt.querySelector("[data-qaw-input]");
    var focusChk = prompt.querySelector("[data-qaw-focus-chk]");
    var metaChk = prompt.querySelector("[data-qaw-meta-chk]");
    var removeBtn = prompt.querySelector("[data-qaw-remove]");
    var scopeArea = prompt.querySelector("[data-qaw-scope-area]");
    var ancestorBtn = prompt.querySelector('[data-qaw-scope-btn="ancestor"]');
    var childBtn = prompt.querySelector('[data-qaw-scope-btn="child"]');
    if (removeBtn) {
      removeBtn.addEventListener("click", function() {
        var effSel = activeSel || sel;
        var updated;
        if (storageKey === GLOBAL_PAGE_KEY) {
          var defEntry = null;
          for (var di = 0; di < NAV_SHORTCUTS.length; di++) {
            if (NAV_SHORTCUTS[di].selector === effSel) {
              defEntry = NAV_SHORTCUTS[di];
              break;
            }
          }
          if (defEntry) {
            updated = pageShortcuts.map(function(s) {
              if (s.selector === defEntry.selector) {
                return { key: defEntry.key, selector: defEntry.selector };
              }
              return s;
            });
          } else {
            updated = pageShortcuts.filter(function(s) {
              return s.selector !== effSel && document.querySelector(s.selector) !== targetEl;
            });
          }
        } else {
          updated = pageShortcuts.filter(function(s) {
            return s.selector !== effSel && document.querySelector(s.selector) !== targetEl;
          });
        }
        setShortcutsForPage(storageKey, updated);
        closeAssignPrompt();
      });
    }
    function showScopeChips(options, buildSel) {
      if (!options.length) {
        scopeArea.innerHTML = '<div style="color:#64748b;font-size:10px;margin-top:3px;">None found</div>';
        return;
      }
      var chipsHtml = '<div style="display:flex;flex-wrap:wrap;margin-top:4px;">';
      options.forEach(function(opt) {
        chipsHtml += '<button data-qaw-scope-chip="' + escHtml(opt.sel) + '" style="background:#0f172a;color:#94a3b8;border:1px solid #475569;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:10px;font-family:monospace;margin:2px;">' + escHtml(opt.desc) + "</button>";
      });
      chipsHtml += "</div>";
      scopeArea.innerHTML = chipsHtml;
      scopeArea.querySelectorAll("[data-qaw-scope-chip]").forEach(function(chip) {
        chip.addEventListener("click", function(e) {
          e.stopPropagation();
          activeSel = buildSel(chip.getAttribute("data-qaw-scope-chip"));
          scopeArea.innerHTML = '<div style="color:#4ade80;font-size:10px;margin-top:3px;word-break:break-all;">&#10003; ' + escHtml(activeSel) + "</div>";
          if (ancestorBtn) ancestorBtn.style.display = "none";
          if (childBtn) childBtn.style.display = "none";
          if (input) input.focus();
        });
      });
      if (input) input.focus();
    }
    if (ancestorBtn && scopeArea) {
      ancestorBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        var baseSel = activeSel || buildSelector(targetEl);
        showScopeChips(getAncestorOptions(targetEl), function(s) {
          return s + " " + baseSel;
        });
      });
    }
    if (childBtn && scopeArea) {
      childBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        var baseSel = activeSel || buildSelector(targetEl);
        showScopeChips(getChildOptions(targetEl), function(s) {
          return baseSel + " " + s;
        });
      });
    }
    if (input) {
      input.addEventListener("keydown", function(e) {
        e.stopImmediatePropagation();
        if (e.key === "Escape") {
          closeAssignPrompt();
          return;
        }
        if (e.key.length !== 1) return;
        var k = e.key.toLowerCase();
        var wantMeta = !!(metaChk && metaChk.checked);
        var listsForConflict = storageKey === GLOBAL_PAGE_KEY ? [pageShortcuts] : [getGlobalShortcuts(), pageShortcuts];
        var conflict = findShortcutConflict(listsForConflict, k, wantMeta, activeSel, sel, targetEl);
        if (conflict) {
          showConflictButtons(
            prompt,
            k,
            conflict,
            storageKey,
            pageShortcuts,
            targetEl,
            activeSel,
            label,
            focusChk && focusChk.checked,
            wantMeta
          );
          return;
        }
        var baseSel = activeSel || buildSelector(targetEl);
        if (document.querySelectorAll(baseSel).length > 1) {
          prompt._pendingKey = k;
          prompt._pendingShortcuts = null;
          prompt._pendingFocus = focusChk && focusChk.checked;
          prompt._pendingMeta = wantMeta;
          showDisambiguation(prompt, baseSel, storageKey, pageShortcuts, targetEl, activeSel, label);
          return;
        }
        assignShortcut(
          storageKey,
          pageShortcuts,
          k,
          targetEl,
          activeSel,
          label,
          focusChk && focusChk.checked,
          wantMeta
        );
      });
      setTimeout(function() {
        input.focus();
      }, 50);
    }
    prompt.style.visibility = "hidden";
    document.body.appendChild(prompt);
    assignPromptEl = prompt;
    var promptRect = prompt.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom - 8;
    var spaceAbove = rect.top - 8;
    var topVal;
    if (spaceAbove > spaceBelow && spaceAbove > 0) {
      topVal = rect.top - promptRect.height - 8;
    } else {
      topVal = rect.bottom + 8;
    }
    topVal = Math.max(8, Math.min(topVal, window.innerHeight - promptRect.height - 8));
    var leftVal = rect.left;
    if (leftVal + promptRect.width > window.innerWidth - 8) {
      leftVal = window.innerWidth - promptRect.width - 8;
    }
    if (leftVal < 8) leftVal = 8;
    prompt.style.top = topVal + "px";
    prompt.style.left = leftVal + "px";
    prompt.style.visibility = "visible";
  }
  function showConflictButtons(prompt, k, conflict, storageKey, pageShortcuts, targetEl, sel, label, focusMode, metaMode) {
    var area = prompt.querySelector("[data-qaw-conflict-area]");
    if (!area) return;
    var chordLbl = formatShortcutBadge({ key: k, meta: metaMode });
    area.innerHTML = '<div style="margin-bottom:8px;color:#fbbf24;font-size:11px;">"' + escHtml(chordLbl) + '" is already used by <b>' + escHtml(conflict) + '</b></div><div style="display:flex;gap:6px;"><button data-qaw-share style="background:#1e40af;color:#bfdbfe;border:none;border-radius:3px;padding:4px 10px;cursor:pointer;font-size:11px;font-family:monospace;">Share (toggle pair)</button><button data-qaw-replace style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:3px;padding:4px 10px;cursor:pointer;font-size:11px;font-family:monospace;">Replace</button></div>';
    function proceedWithShortcuts(shortcutsToUse) {
      var baseSel = sel || buildSelector(targetEl);
      if (document.querySelectorAll(baseSel).length > 1) {
        prompt._pendingKey = k;
        prompt._pendingShortcuts = shortcutsToUse;
        prompt._pendingFocus = focusMode;
        prompt._pendingMeta = metaMode;
        showDisambiguation(prompt, baseSel, storageKey, pageShortcuts, targetEl, sel, label);
      } else {
        assignShortcut(storageKey, shortcutsToUse, k, targetEl, sel, label, focusMode, metaMode);
      }
    }
    area.querySelector("[data-qaw-share]").addEventListener("click", function(e) {
      e.stopPropagation();
      proceedWithShortcuts(pageShortcuts);
    });
    area.querySelector("[data-qaw-replace]").addEventListener("click", function(e) {
      e.stopPropagation();
      if (storageKey !== GLOBAL_PAGE_KEY) {
        var fg = getGlobalShortcuts().filter(function(s) {
          return !(s.key === k && !!s.meta === !!metaMode);
        });
        setShortcutsForPage(GLOBAL_PAGE_KEY, fg);
      }
      var filtered = pageShortcuts.filter(function(s) {
        return !(s.key === k && !!s.meta === !!metaMode);
      });
      proceedWithShortcuts(filtered);
    });
  }
  function assignShortcut(pageKey, currentShortcuts, key, targetEl, sel, label, focusMode, metaMode) {
    var updated = currentShortcuts.filter(function(s) {
      return s.selector !== sel && document.querySelector(s.selector) !== targetEl;
    });
    var finalSel = sel || buildSelector(targetEl);
    var entry = { key, selector: finalSel, label };
    if (focusMode) entry.focus = true;
    if (metaMode) entry.meta = true;
    updated.push(entry);
    setShortcutsForPage(pageKey, updated);
    if (assignPromptEl) {
      var okBadge = formatShortcutBadge({ key, meta: metaMode });
      assignPromptEl.innerHTML = '<div style="padding:4px 0;color:#4ade80;font-size:13px;">&#10003; Assigned to <b>' + escHtml(okBadge) + "</b></div>";
    }
    setTimeout(closeAssignPrompt, 700);
  }
  function buildSelector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    if (el.dataset && el.dataset.e2e) return '[data-e2e="' + el.dataset.e2e + '"]';
    var parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    var idx = Array.prototype.indexOf.call(parent.children, el) + 1;
    return el.tagName.toLowerCase() + ":nth-child(" + idx + ")";
  }
  var KEYBOARD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>';
  function updateToggleBtn() {
    if (!toggleBtn) return;
    var label = editMode ? "Edit" : active ? "On" : "Off";
    toggleBtn.innerHTML = KEYBOARD_SVG + label;
    toggleBtn.style.opacity = active || editMode ? "1" : "0.5";
  }
  function injectToggleBtn() {
    if (isSafeModeEnabled()) {
      removeShortcutUi();
      renderSafeModeChip();
      return;
    }
    var host = getToggleHost();
    if (!host) return;
    if (toggleBtn && host.el.contains(toggleBtn)) {
      toggleBtn.setAttribute("data-qaw-toggle-host", host.variant);
      return;
    }
    if (toggleBtn) toggleBtn.remove();
    toggleBtn = document.createElement("a");
    toggleBtn.setAttribute("data-qaw-overlay", "1");
    toggleBtn.setAttribute("data-qaw-toggle-host", host.variant);
    toggleBtn.className = host.variant === "nav" ? "libraryActionArea ph99vi3 ActionArea-base-1uVdOIRB libraryActionArea ph99vi3" : "";
    toggleBtn.style.cssText = host.variant === "nav" ? "cursor:pointer;user-select:none;" : [
      "cursor:pointer",
      "user-select:none",
      "display:inline-flex",
      "align-items:center",
      "gap:2px",
      "margin-left:auto",
      "padding:4px 8px",
      "border:1px solid #cbd5e1",
      "border-radius:6px",
      "background:#fff",
      "color:#334155",
      "font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace",
      "line-height:1",
      "text-decoration:none"
    ].join(";");
    updateToggleBtn();
    toggleBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (dropdown) closeDropdown();
      else openDropdown();
    });
    host.el.appendChild(toggleBtn);
  }
  function closeDropdown() {
    if (dropdown) {
      if (dropdown._cleanup) dropdown._cleanup();
      dropdown.remove();
      dropdown = null;
    }
    window.__qawDropdownOpen = false;
  }
  function openDropdown() {
    closeDropdown();
    var rect = toggleBtn.getBoundingClientRect();
    dropdown = document.createElement("div");
    dropdown.setAttribute("data-qaw-overlay", "1");
    dropdown.style.cssText = [
      "position:fixed",
      "background:#1e293b",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:6px",
      "overflow:hidden",
      "font-family:monospace",
      "font-size:12px",
      "z-index:2147483647",
      "box-shadow:0 4px 12px rgba(0,0,0,0.4)",
      "min-width:160px"
    ].join(";");
    var items = [
      {
        text: active ? "\u2328 Turn Off (O)" : "\u2328 Turn On (O)",
        action: function() {
          setActive(!active);
        }
      },
      {
        text: editMode ? "\u270F Exit Edit Mode" : "\u270F Edit Shortcuts",
        action: function() {
          if (editMode) stopEditMode();
          else startEditMode();
        }
      },
      {
        text: "\u2630 Show shortcuts",
        action: function() {
          openShortcutsDrawer();
        }
      },
      {
        text: healthHud ? "\u{1FA7A} Hide health HUD" : "\u{1FA7A} Debug focus / health",
        action: function() {
          if (healthHud) stopHealthHud();
          else startHealthHud();
        }
      },
      {
        text: "\u26D4 Emergency safe mode",
        action: function() {
          enableSafeMode();
        }
      },
      {
        text: "\u2753 Help",
        action: function() {
          openHelpDrawer();
        }
      }
    ];
    var dropdownIndex = 0;
    function updateHighlight() {
      Array.prototype.forEach.call(dropdown.children, function(child, i) {
        child.style.background = i === dropdownIndex ? "#334155" : "";
      });
    }
    items.forEach(function(item, i) {
      var el = document.createElement("div");
      el.textContent = item.text;
      el.style.cssText = "padding:8px 12px;cursor:pointer;";
      el.addEventListener("mouseenter", function() {
        dropdownIndex = i;
        updateHighlight();
      });
      el.addEventListener("click", function(e) {
        e.stopPropagation();
        closeDropdown();
        item.action();
      });
      dropdown.appendChild(el);
    });
    updateHighlight();
    document.body.appendChild(dropdown);
    var dropdownW = dropdown.offsetWidth || 160;
    dropdown.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownW - 8)) + "px";
    dropdown.style.top = rect.bottom + 4 + "px";
    window.__qawDropdownOpen = true;
    function onDropdownKey(e) {
      if (!dropdown) {
        window.removeEventListener("__qaw_key", onDropdownKey);
        return;
      }
      var k = e.detail;
      if (k === "arrowdown") {
        dropdownIndex = (dropdownIndex + 1) % items.length;
        updateHighlight();
      } else if (k === "arrowup") {
        dropdownIndex = (dropdownIndex - 1 + items.length) % items.length;
        updateHighlight();
      } else if (k === "enter") {
        var action = items[dropdownIndex].action;
        closeDropdown();
        action();
      } else if (k === "escape" || k === "o") {
        closeDropdown();
      }
    }
    window.addEventListener("__qaw_key", onDropdownKey);
    dropdown._cleanup = function() {
      window.removeEventListener("__qaw_key", onDropdownKey);
    };
    setTimeout(function() {
      document.addEventListener("click", function handler(e) {
        if (dropdown && !dropdown.contains(e.target)) closeDropdown();
        document.removeEventListener("click", handler);
      });
    }, 0);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Shortcuts copied to clipboard");
    } catch (err) {
      showToast("Copy failed \u2014 check console");
      console.log(text);
    }
    ta.remove();
  }
  function closeShortcutsDrawer() {
    if (shortcutsDrawer) {
      shortcutsDrawer.remove();
      shortcutsDrawer = null;
    }
  }
  function closeHelpDrawer() {
    if (helpDrawer) {
      helpDrawer.remove();
      helpDrawer = null;
    }
  }
  function openHelpDrawer() {
    closeHelpDrawer();
    closeShortcutsDrawer();
    var drawer = document.createElement("div");
    drawer.setAttribute("data-qaw-overlay", "1");
    drawer.style.cssText = [
      "position:fixed",
      "top:0",
      "right:0",
      "width:360px",
      "max-width:calc(100vw - 24px)",
      "height:100vh",
      "background:#1e293b",
      "color:#e2e8f0",
      "border-left:1px solid #475569",
      "font-family:monospace",
      "font-size:12px",
      "z-index:2147483647",
      "box-shadow:-4px 0 16px rgba(0,0,0,0.4)",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box"
    ].join(";");
    var header = document.createElement("div");
    header.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "padding:12px 14px",
      "border-bottom:1px solid #334155",
      "flex-shrink:0"
    ].join(";");
    var title = document.createElement("span");
    title.textContent = "QA Wolf Shortcuts \u2014 Help";
    title.style.cssText = "font-weight:bold;font-size:13px;";
    var closeBtn = document.createElement("button");
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0;line-height:1;";
    closeBtn.addEventListener("click", closeHelpDrawer);
    header.appendChild(title);
    header.appendChild(closeBtn);
    drawer.appendChild(header);
    var body = document.createElement("div");
    body.style.cssText = [
      "flex:1",
      "overflow-y:auto",
      "padding:12px 14px 20px",
      "line-height:1.45",
      "box-sizing:border-box"
    ].join(";");
    function section(h, lines) {
      var wrap = document.createElement("div");
      wrap.style.cssText = "margin-bottom:18px;";
      var hh = document.createElement("div");
      hh.textContent = h;
      hh.style.cssText = "font-weight:bold;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;";
      wrap.appendChild(hh);
      lines.forEach(function(line) {
        var p = document.createElement("div");
        p.textContent = line;
        p.style.cssText = "color:#e2e8f0;font-size:12px;margin-bottom:6px;";
        wrap.appendChild(p);
      });
      return wrap;
    }
    body.appendChild(section("Menu (O)", [
      "Press O to open the keyboard menu from anywhere (when not typing in a field).",
      "Turn shortcuts on/off, enter Edit mode, open the JSON shortcut list, or this Help panel.",
      "Inside the menu: \u2191 / \u2193 move, Enter selects, Esc or O closes."
    ]));
    body.appendChild(section("Letter & meta shortcuts", [
      "When shortcuts are On, gold badges show plain keys (e.g. M). Violet badges show \u2318 + letter (hold Meta/\u2318 while pressing the key).",
      "In a text field, editor, or other typing control, badges turn grey: plain keys are left for the app (\u2318C copy, etc.).",
      "Per shortcut you can check \u201Crequire \u2318 + key\u201D when assigning. Header nav items live in JSON under key __global__ (editable like the rest)."
    ]));
    body.appendChild(section("File editor tabs", [
      "Option/Alt + Left or Right arrow: cycle the open file tabs.",
      "Does not run while focus is in an input, textarea, select, or contenteditable (so word-jump / native behavior still works there).",
      "Shift + right-click a file tab: custom menu \u201CClose other tabs\u201D. Normal right-click keeps the built-in tab menu."
    ]));
    body.appendChild(section("File tree (focus on a row)", [
      "Click or focus a row first. Then: \u2191 / \u2193 change row, \u2192 expands, \u2190 jumps to parent (or first row at root).",
      "Works without turning letter shortcuts on; arrow handling is separate."
    ]));
    body.appendChild(section("Edit mode (\u270F)", [
      "Hover highlights a target; click to assign a key, optional \u201Cfocus instead of click\u201D, and optional \u2318.",
      "Ancestor / child links help when many nodes match the same selector. Conflicts offer Share (same key, two targets) or Replace."
    ]));
    body.appendChild(section("Tips", [
      "Json drawer: __global__ merges with default header nav; partial file won\u2019t drop missing nav items.",
      "If the On/Off control disappears after an app update, refresh; it attaches to the header action row."
    ]));
    drawer.appendChild(body);
    document.body.appendChild(drawer);
    helpDrawer = drawer;
  }
  function openShortcutsDrawer() {
    closeShortcutsDrawer();
    closeHelpDrawer();
    var drawer = document.createElement("div");
    drawer.setAttribute("data-qaw-overlay", "1");
    drawer.style.cssText = [
      "position:fixed",
      "top:0",
      "right:0",
      "width:340px",
      "height:100vh",
      "background:#1e293b",
      "color:#f1f5f9",
      "border-left:1px solid #475569",
      "font-family:monospace",
      "font-size:12px",
      "z-index:2147483647",
      "box-shadow:-4px 0 16px rgba(0,0,0,0.4)",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box"
    ].join(";");
    var header = document.createElement("div");
    header.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "padding:12px 14px",
      "border-bottom:1px solid #334155",
      "flex-shrink:0"
    ].join(";");
    var title = document.createElement("span");
    title.textContent = "Shortcuts";
    title.style.cssText = "font-weight:bold;font-size:13px;";
    var closeBtn = document.createElement("button");
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0;line-height:1;";
    closeBtn.addEventListener("click", closeShortcutsDrawer);
    header.appendChild(title);
    header.appendChild(closeBtn);
    drawer.appendChild(header);
    var body = document.createElement("div");
    body.style.cssText = "flex:1;display:flex;flex-direction:column;padding:12px 14px;overflow:hidden;gap:8px;";
    var label = document.createElement("div");
    label.textContent = "All shortcuts (JSON)";
    label.style.cssText = "color:#94a3b8;font-size:11px;flex-shrink:0;";
    body.appendChild(label);
    var textarea = document.createElement("textarea");
    textarea.value = JSON.stringify(loadAllShortcuts(), null, 2);
    textarea.style.cssText = [
      "flex:1",
      "background:#0f172a",
      "color:#f1f5f9",
      "border:1px solid #475569",
      "border-radius:4px",
      "padding:8px",
      "font-family:monospace",
      "font-size:11px",
      "resize:none",
      "outline:none",
      "line-height:1.5",
      "box-sizing:border-box",
      "width:100%"
    ].join(";");
    textarea.addEventListener("keydown", function(e) {
      e.stopImmediatePropagation();
    });
    body.appendChild(textarea);
    var status = document.createElement("div");
    status.style.cssText = "font-size:11px;min-height:16px;flex-shrink:0;color:#4ade80;";
    body.appendChild(status);
    drawer.appendChild(body);
    var footer = document.createElement("div");
    footer.style.cssText = [
      "display:flex",
      "gap:8px",
      "padding:12px 14px",
      "border-top:1px solid #334155",
      "flex-shrink:0"
    ].join(";");
    function setStatus(msg, isError) {
      status.textContent = msg;
      status.style.color = isError ? "#f87171" : "#4ade80";
      setTimeout(function() {
        status.textContent = "";
      }, 2e3);
    }
    var saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.style.cssText = "flex:1;background:#1e40af;color:#bfdbfe;border:none;border-radius:4px;padding:6px 0;cursor:pointer;font-family:monospace;font-size:12px;";
    saveBtn.addEventListener("click", function() {
      try {
        var parsed = JSON.parse(textarea.value);
        localStorage.setItem(STORAGE_KEY_SHORTCUTS, JSON.stringify(parsed));
        setStatus("\u2713 Saved", false);
        if (active && !editMode) drawOverlays();
      } catch (e) {
        setStatus("Invalid JSON", true);
      }
    });
    footer.appendChild(saveBtn);
    var copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.style.cssText = "flex:1;background:#334155;color:#f1f5f9;border:none;border-radius:4px;padding:6px 0;cursor:pointer;font-family:monospace;font-size:12px;";
    copyBtn.addEventListener("click", function() {
      var json = textarea.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function() {
          setStatus("\u2713 Copied", false);
        }).catch(function() {
          fallbackCopy(json);
          setStatus("\u2713 Copied", false);
        });
      } else {
        fallbackCopy(json);
        setStatus("\u2713 Copied", false);
      }
    });
    footer.appendChild(copyBtn);
    drawer.appendChild(footer);
    document.body.appendChild(drawer);
    shortcutsDrawer = drawer;
    setTimeout(function() {
      textarea.focus();
    }, 50);
  }
  function setActive(val) {
    if (isSafeModeEnabled()) {
      active = false;
      localStorage.setItem(STORAGE_KEY_ACTIVE, "0");
      window.__qawShortcutsActive = false;
      updateToggleBtn();
      return;
    }
    if (editMode) stopEditMode();
    active = val;
    window.__qawShortcutsActive = val;
    localStorage.setItem(STORAGE_KEY_ACTIVE, val ? "1" : "0");
    updateToggleBtn();
    if (val) drawOverlays();
    else {
      activeOverlays.forEach(function(ov) {
        ov.remove();
      });
      activeOverlays = [];
      lastOverlaySig = "";
    }
  }
  function getMonacoEditor() {
    var m = window.monaco;
    if (!m || !m.editor) return null;
    var editors = m.editor.getEditors();
    if (!editors || !editors.length) return null;
    return editors[0];
  }
  function _qawPickBottomMost(nodes) {
    var best = null;
    var bestTop = -Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      if (!Number.isFinite(r.top)) continue;
      if (r.top > bestTop) {
        bestTop = r.top;
        best = nodes[i];
      }
    }
    return best;
  }
  function _qawStatusGlyphSignature() {
    var root4 = document.querySelector('div[data-mprt="4"]');
    if (!root4) return { hasAny: false, sig: "none" };
    var icons = ["icon-Loader", "icon-CheckCircleSm", "icon-XCircle", "icon-PriorityUrgent"];
    var counts = {};
    var maxTop = -Infinity;
    var any = false;
    for (var i = 0; i < icons.length; i++) {
      var icon = icons[i];
      var selector = 'div[widgetid="custom.overlay.widget"] div[data-e2e="Status"] svg[data-e2e="' + icon + '"]';
      var nodes = Array.prototype.slice.call(root4.querySelectorAll(selector));
      counts[icon] = nodes.length;
      if (nodes.length) any = true;
      for (var j = 0; j < nodes.length; j++) {
        var _sigNode = nodes[j];
        while (_sigNode && _sigNode !== root4 && !_sigNode.style.top) _sigNode = _sigNode.parentElement;
        var _sigTop = _sigNode && _sigNode !== root4 ? parseFloat(_sigNode.style.top) : NaN;
        if (Number.isFinite(_sigTop) && _sigTop > maxTop) maxTop = _sigTop;
      }
    }
    var topPart = Number.isFinite(maxTop) ? String(Math.round(maxTop)) : "na";
    return {
      hasAny: any,
      sig: icons.map(function(k) {
        return k + ":" + (counts[k] || 0);
      }).join("|") + "|maxTop:" + topPart
    };
  }
  function _qawCanUseRunGlyphs(ed) {
    if (_runStartedAt == null || !_waitForRunGlyphTransition) return true;
    var st = _qawStatusGlyphSignature();
    var changed = st.sig !== (_runStartGlyphSig || "");
    var missing = !st.hasAny;
    if (!changed && !missing) return false;
    _waitForRunGlyphTransition = false;
    return true;
  }
  function _qawLineFromStatusIconsStyleTop(iconValues) {
    var root4 = document.querySelector('div[data-mprt="4"]');
    if (!root4) return null;
    var ed = getMonacoEditor();
    var scrollTop = 0;
    var lineHeight = 19;
    try {
      if (ed) {
        ed.layout();
        scrollTop = Math.max(0, Number(ed.getScrollTop()) || 0);
        lineHeight = Number(ed.getOption(66)) || 19;
      }
    } catch (_e) {
    }
    var bestLine = null;
    for (var i = 0; i < iconValues.length; i++) {
      var sel = 'div[widgetid="custom.overlay.widget"] div[data-e2e="Status"] svg[data-e2e="' + iconValues[i] + '"]';
      var found = Array.prototype.slice.call(root4.querySelectorAll(sel));
      for (var f = 0; f < found.length; f++) {
        var node = found[f];
        while (node && node !== root4 && !node.style.top) {
          node = node.parentElement;
        }
        if (!node || node === root4) continue;
        var top = parseFloat(node.style.top);
        if (!Number.isFinite(top)) continue;
        if (_runStartStaleGlyphTops.has(top)) continue;
        var line = Math.round((top + scrollTop) / lineHeight) + 1;
        if (line < 1) continue;
        if (bestLine === null || line > bestLine) bestLine = line;
      }
    }
    return bestLine;
  }
  function _qawLineFromStatusIcons(iconValues) {
    if (!iconValues || !iconValues.length) return null;
    var root4 = document.querySelector('div[data-mprt="4"]');
    var root3 = document.querySelector('div[data-mprt="3"]');
    if (!root4 || !root3) return null;
    var allMatches = [];
    for (var i = 0; i < iconValues.length; i++) {
      var icon = iconValues[i];
      var selector = 'div[widgetid="custom.overlay.widget"] div[data-e2e="Status"] svg[data-e2e="' + icon + '"]';
      var found = Array.prototype.slice.call(root4.querySelectorAll(selector));
      if (found.length) allMatches = allMatches.concat(found);
    }
    var pick = _qawPickBottomMost(allMatches);
    if (!pick) return null;
    var glyphTop = pick.getBoundingClientRect().top;
    if (!Number.isFinite(glyphTop)) return null;
    var lineNodes = Array.prototype.slice.call(root3.querySelectorAll(".margin-view-overlays .line-numbers"));
    if (!lineNodes.length) return null;
    var bestLine = null;
    var bestDist = Infinity;
    for (var j = 0; j < lineNodes.length; j++) {
      var ln = lineNodes[j];
      var txt = String(ln.textContent || "").trim();
      if (!/^\d+$/.test(txt)) continue;
      var line = Number(txt);
      if (!line || line < 1) continue;
      var top = ln.getBoundingClientRect().top;
      if (!Number.isFinite(top)) continue;
      var d = Math.abs(top - glyphTop);
      if (d < bestDist) {
        bestDist = d;
        bestLine = line;
      }
    }
    return bestLine;
  }
  function getExecutingLine(ed) {
    if (!_qawCanUseRunGlyphs(ed)) return null;
    if (document.hidden) {
      var hiddenLine = _qawLineFromStatusIconsStyleTop(["icon-Loader", "icon-CheckCircleSm", "icon-XCircle", "icon-PriorityUrgent"]);
      if (hiddenLine != null) {
        _lastExecutingLineSeenAt = Date.now();
        return hiddenLine;
      }
      return null;
    }
    var lineFromStatus = _qawLineFromStatusIcons(["icon-Loader", "icon-CheckCircleSm", "icon-XCircle", "icon-PriorityUrgent"]);
    if (lineFromStatus != null) {
      _lastExecutingLineSeenAt = Date.now();
      return lineFromStatus;
    }
    var domNode = null;
    try {
      domNode = ed.getDomNode && ed.getDomNode();
    } catch (e) {
      return null;
    }
    if (!domNode) return null;
    var overlayContainer = domNode.querySelector(".overlayWidgets");
    if (!overlayContainer) return null;
    var glyphs = overlayContainer.querySelectorAll('[class*="ProgressGlyphs"]');
    if (!glyphs.length) return null;
    var glyph = glyphs[glyphs.length - 1];
    var topPx = parseFloat(glyph.style.top);
    if (isNaN(topPx)) topPx = glyph.offsetTop;
    if (!topPx && topPx !== 0) return null;
    var lineHeight = 0;
    try {
      lineHeight = ed.getOption(66);
    } catch (e) {
    }
    if (!lineHeight || lineHeight < 8) {
      var lineEls = domNode.querySelectorAll(".view-line");
      if (lineEls.length >= 2) lineHeight = lineEls[1].offsetTop - lineEls[0].offsetTop;
    }
    if (!lineHeight || lineHeight < 8) lineHeight = 19;
    var line = Math.round(topPx / lineHeight) + 1;
    _lastExecutingLineSeenAt = Date.now();
    return line;
  }
  function _getModelKey(ed) {
    try {
      var m = ed.getModel();
      return m ? m.uri.toString() : null;
    } catch (e) {
      return null;
    }
  }
  function _isFollowEligibleFile(ed) {
    var key = _getModelKey(ed);
    if (!key) return false;
    return /(^|\/)flow\.(ts|js)$/i.test(key) || /\.flow\.(ts|js)$/i.test(key);
  }
  function getEditorLineHeight(ed, domNode) {
    var lineHeight = 0;
    try {
      lineHeight = ed.getOption(66);
    } catch (e) {
    }
    if (!lineHeight || lineHeight < 8) {
      var lineEls = domNode.querySelectorAll(".view-line");
      if (lineEls.length >= 2) lineHeight = lineEls[1].offsetTop - lineEls[0].offsetTop;
    }
    if (!lineHeight || lineHeight < 8) lineHeight = 19;
    return lineHeight;
  }
  function glyphTopPx(g, editorRectTop) {
    var topPx = parseFloat(g.style.top || "");
    if (Number.isFinite(topPx)) return topPx;
    var tr = (g.style.transform || "").trim();
    var m = tr.match(/translate(?:3d)?\(\s*[-\d.]+px,\s*([-\d.]+)px(?:,\s*[-\d.]+px)?\s*\)/i);
    if (m) {
      var ty = parseFloat(m[1]);
      if (Number.isFinite(ty)) return ty;
    }
    var rect = g.getBoundingClientRect();
    if (Number.isFinite(rect.top)) return rect.top - editorRectTop;
    return null;
  }
  function pickLineFromGlyphs(ed, domNode, glyphs) {
    if (!glyphs.length) return null;
    var editorRectTop = domNode.getBoundingClientRect().top;
    var lineHeight = getEditorLineHeight(ed, domNode);
    var bestTop = -Infinity;
    for (var i = 0; i < glyphs.length; i++) {
      var t = glyphTopPx(glyphs[i], editorRectTop);
      if (t == null) continue;
      if (t > bestTop) bestTop = t;
    }
    if (!Number.isFinite(bestTop)) return null;
    return Math.max(1, Math.round(bestTop / lineHeight) + 1);
  }
  function getResultGlyphLine(ed) {
    var lineFromStatus = _qawLineFromStatusIcons(["icon-XCircle", "icon-PriorityUrgent", "icon-CheckCircleSm"]);
    if (lineFromStatus != null) return lineFromStatus;
    var domNode = null;
    try {
      domNode = ed.getDomNode && ed.getDomNode();
    } catch (e) {
      return null;
    }
    if (!domNode) return null;
    var overlayContainer = domNode.querySelector(".overlayWidgets");
    if (!overlayContainer) return null;
    var all = Array.prototype.slice.call(
      overlayContainer.querySelectorAll('[class*="Glyph"], [class*="glyph"], [class*="codicon"]')
    );
    var resultGlyphs = all.filter(function(g) {
      var cls = String(g.className || "").toLowerCase();
      if (!cls) return false;
      if (cls.indexOf("lightbulb") !== -1 || cls.indexOf("suggest") !== -1) return false;
      if (cls.indexOf("progressglyphs") !== -1) return false;
      return cls.indexOf("check") !== -1 || cls.indexOf("pass") !== -1 || cls.indexOf("success") !== -1 || cls.indexOf("error") !== -1 || cls.indexOf("fail") !== -1 || cls.indexOf("close") !== -1 || cls.indexOf("warning") !== -1;
    });
    return pickLineFromGlyphs(ed, domNode, resultGlyphs);
  }
  function getCurrentTargetLine(ed) {
    var isRunning = !!document.querySelector('[data-e2e="stop-run-button"]');
    if (isRunning) {
      var live = getExecutingLine(ed);
      if (live != null) return live;
      if (_lastExecutingLine != null && Date.now() - _lastExecutingLineSeenAt < 1800) return _lastExecutingLine;
      return null;
    }
    var result = getResultGlyphLine(ed);
    if (result != null) return result;
    if (_lastExecutingLine != null) return _lastExecutingLine;
    return null;
  }
  function _glyphFromDecorations(ed, isRunning) {
    var model = null;
    try {
      model = ed.getModel && ed.getModel();
    } catch (e) {
      return null;
    }
    if (!model || typeof model.getAllDecorations !== "function") return null;
    var decos = [];
    try {
      decos = model.getAllDecorations() || [];
    } catch (e) {
      return null;
    }
    if (!decos.length) return null;
    var bestLine = -1;
    var bestCls = "";
    for (var i = 0; i < decos.length; i++) {
      var d = decos[i];
      var o = d && d.options ? d.options : null;
      if (!o) continue;
      var cls = [
        o.glyphMarginClassName || "",
        o.linesDecorationsClassName || "",
        o.className || "",
        o.inlineClassName || ""
      ].join(" ").toLowerCase();
      if (!cls) continue;
      if (cls.indexOf("lightbulb") !== -1 || cls.indexOf("suggest") !== -1) continue;
      var looksLikeRunning = cls.indexOf("progress") !== -1 || cls.indexOf("running") !== -1 || cls.indexOf("loading") !== -1 || cls.indexOf("execut") !== -1 || cls.indexOf("spinner") !== -1;
      var looksLikeResult = cls.indexOf("check") !== -1 || cls.indexOf("pass") !== -1 || cls.indexOf("success") !== -1 || cls.indexOf("error") !== -1 || cls.indexOf("fail") !== -1 || cls.indexOf("close") !== -1 || cls.indexOf("warning") !== -1;
      if (isRunning && !looksLikeRunning || !isRunning && !looksLikeResult) continue;
      var line = d && d.range && d.range.startLineNumber ? Number(d.range.startLineNumber) : 0;
      if (!line || line < 1) continue;
      if (line > bestLine) {
        bestLine = line;
        bestCls = cls;
      }
    }
    if (bestLine < 1) return null;
    var domNode = null;
    try {
      domNode = ed.getDomNode && ed.getDomNode();
    } catch (e) {
      domNode = null;
    }
    var lh = domNode ? getEditorLineHeight(ed, domNode) : 19;
    var absTop = Math.max(0, (bestLine - 1) * lh);
    return { line: bestLine, absTop, cls: bestCls };
  }
  function _installGlyphLocatorProbe() {
    window.__QAWProbeGlyphLocators = function() {
      var ed = getMonacoEditor();
      if (!ed) {
        console.warn("[QAW glyph probe] no monaco editor");
        return;
      }
      var model = null;
      try {
        model = ed.getModel && ed.getModel();
      } catch (e) {
        model = null;
      }
      var domNode = null;
      try {
        domNode = ed.getDomNode && ed.getDomNode();
      } catch (e) {
        domNode = null;
      }
      var isRunning = !!document.querySelector('[data-e2e="stop-run-button"]');
      var byCls = {};
      var rows = [];
      if (model && typeof model.getAllDecorations === "function") {
        try {
          var decos = model.getAllDecorations() || [];
          for (var i = 0; i < decos.length; i++) {
            var d = decos[i];
            var o = d && d.options ? d.options : null;
            if (!o) continue;
            var cls = [
              o.glyphMarginClassName || "",
              o.linesDecorationsClassName || "",
              o.className || "",
              o.inlineClassName || ""
            ].join(" ").trim();
            if (!cls) continue;
            byCls[cls] = (byCls[cls] || 0) + 1;
            rows.push({
              line: d && d.range ? d.range.startLineNumber : null,
              cls
            });
          }
        } catch (e) {
        }
      }
      var domCount = 0;
      var domSample = "";
      if (domNode) {
        var domNodes = domNode.querySelectorAll('[class*="Glyph"], [class*="glyph"], [class*="codicon"], [class*="progress"], [class*="loading"]');
        domCount = domNodes.length;
        if (domNodes.length) domSample = String(domNodes[0].className || "");
      }
      console.log("[QAW glyph probe] state", {
        model: model && model.uri && model.uri.toString ? model.uri.toString() : null,
        isRunning,
        decorationsWithClass: rows.length,
        uniqueDecorationClasses: Object.keys(byCls).length,
        domCandidates: domCount,
        domFirstClass: domSample
      });
      console.table(Object.keys(byCls).map(function(k) {
        return { cls: k, count: byCls[k] };
      }));
      console.table(rows.slice(-40));
      var pick = _glyphFromDecorations(ed, isRunning);
      console.log("[QAW glyph probe] decoration pick", pick);
    };
  }
  function _clearStaleProgressGlyphs() {
  }
  document.addEventListener("click", function(e) {
    var target = e.target;
    var runCodeBtn = target && target.closest('[data-e2e="run-code-button"]');
    if (runCodeBtn) {
      var btnText = (runCodeBtn.textContent || "").trim();
      _isPartialRun = /run\s+\d+\s+line/i.test(btnText);
      if (!_isPartialRun) _clearStaleProgressGlyphs();
    }
  }, true);
  function _updateLineChip() {
    if (!_lineChip) return;
    var ed = getMonacoEditor();
    var hasGlyph = ed ? getCurrentTargetLine(ed) != null : false;
    var jumpPart = _lineChip.querySelector("[data-qaw-jump]");
    var menuPart = _lineChip.querySelector("[data-qaw-menu]");
    if (jumpPart) {
      jumpPart.style.opacity = hasGlyph ? "1" : "0.4";
      jumpPart.style.cursor = hasGlyph ? "pointer" : "default";
      jumpPart.style.pointerEvents = hasGlyph ? "" : "none";
    }
    if (menuPart) {
      menuPart.style.color = "#94a3b8";
      menuPart.title = "Line navigation";
    }
  }
  function startPolling() {
    if (pollTimer) return;
    _installGlyphLocatorProbe();
    pollTimer = setInterval(function() {
      if (isSafeModeEnabled()) {
        removeShortcutUi();
        renderSafeModeChip();
        return;
      }
      injectToggleBtn();
      writeTabHeartbeat();
      if (active && !editMode) {
        var sig = computeOverlaySig();
        if (sig !== lastOverlaySig) drawOverlays();
      }
    }, POLL_INTERVAL);
  }
  if (!window.name || !window.name.startsWith("qaw-tab-")) {
    window.name = "qaw-tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }
  var _tabChannel = null;
  try {
    _tabChannel = new BroadcastChannel("qaw-tabs");
    _tabChannel.onmessage = function(e) {
      if (e.data && e.data.type === "focus" && e.data.target === window.name) {
        window.focus();
      }
    };
  } catch (e) {
  }
  function writeTabHeartbeat() {
    try {
      var ed = getMonacoEditor();
      var modelKey = ed ? _getModelKey(ed) : null;
      var flowName = modelKey ? modelKey.split("/").pop() || "" : "";
      var pathMatch = location.pathname.match(/^\/([^/]+)\/environments\/([^/]+)/);
      var client = pathMatch ? pathMatch[1] : "";
      var envId = pathMatch ? pathMatch[2] : "";
      if (modelKey && client && envId && modelKey !== _lastIndexedModelKey) {
        _lastIndexedModelKey = modelKey;
        try {
          var basename = modelKey.split("/").pop() || "";
          var idx = JSON.parse(localStorage.getItem(STORAGE_KEY_FILE_INDEX) || "{}");
          idx[client + "" + envId + "" + basename] = modelKey;
          localStorage.setItem(STORAGE_KEY_FILE_INDEX, JSON.stringify(idx));
        } catch (e2) {
        }
      }
      var stopBtn = document.querySelector('[data-e2e="stop-run-button"]');
      var runBtn = document.querySelector('[data-e2e="run-code-button"]');
      var isRunning = !!stopBtn;
      if (ed && _isFollowEligibleFile(ed)) {
        var line = getCurrentTargetLine(ed);
        if (line != null) {
          if (isRunning) {
            if (line > _runMaxLine) _runMaxLine = line;
            if (_runMaxLine > 0 && line < _runMaxLine) line = _runMaxLine;
            if (_runStartedAt != null) _lastExecutingLineRunStartedAt = _runStartedAt;
          }
          var shouldUpdate = _lastExecutingLine == null || line >= _lastExecutingLine || !isRunning;
          if (shouldUpdate) {
            _lastExecutingLine = line;
            _lastExecutingLineSeenAt = Date.now();
          }
        }
      }
      var activeBtn = stopBtn || runBtn;
      var runBtnDisabled = activeBtn ? activeBtn.disabled : true;
      if (!_prevHeartbeatIsRunning && isRunning) {
        _runStartedAt = Date.now();
        _lastCompletedRunStartedAt = null;
        _lastRunPassed = null;
        _runMaxLine = 0;
        _runStartGlyphSig = _qawStatusGlyphSignature().sig;
        _waitForRunGlyphTransition = true;
        _runStartStaleGlyphNodes = /* @__PURE__ */ new Set();
        try {
          var _staleNodes = Array.prototype.slice.call(
            document.querySelectorAll('div[data-mprt="4"] div[widgetid="custom.overlay.widget"]')
          );
          for (var _si = 0; _si < _staleNodes.length; _si++) {
            _runStartStaleGlyphNodes.add(_staleNodes[_si]);
          }
        } catch (_staleE) {
        }
        _lastExecutingLine = null;
        _lastExecutingLineSeenAt = 0;
        _lastExecutingLineRunStartedAt = null;
      }
      if (_prevHeartbeatIsRunning && !isRunning) {
        if (_runStartedAt != null) _lastRunDurationMs = Date.now() - _runStartedAt;
        _lastCompletedRunStartedAt = _runStartedAt;
        _runStartedAt = null;
        _runMaxLine = 0;
        if (ed && _isFollowEligibleFile(ed)) {
          var resultLine = getCurrentTargetLine(ed);
          if (resultLine != null) {
            _lastExecutingLine = resultLine;
            _lastExecutingLineSeenAt = Date.now();
          }
        }
        try {
          var panel = document.getElementById("gitwolf-file-editor-panel") || document.body;
          _lastRunPassed = (panel.innerText || panel.textContent || "").toLowerCase().indexOf("flow passed") !== -1;
        } catch (e2) {
          _lastRunPassed = null;
        }
        _runStartGlyphSig = null;
        _waitForRunGlyphTransition = false;
      }
      _prevHeartbeatIsRunning = isRunning;
      var reattemptBtn = document.querySelector('[data-e2e="button-use-as-reattempt"]');
      var reattemptBtnPresent = !!reattemptBtn;
      var reattemptBtnDisabled = reattemptBtn ? reattemptBtn.disabled : true;
      var tabs = JSON.parse(localStorage.getItem(STORAGE_KEY_OPEN_TABS) || "{}");
      tabs[window.name] = {
        url: location.href,
        windowName: window.name,
        lastSeen: Date.now(),
        client,
        envId,
        flowName,
        modelKey,
        currentLine: _lastExecutingLine,
        currentLineSeenAt: _lastExecutingLineSeenAt,
        currentLineRunStartedAt: _lastExecutingLineRunStartedAt,
        runStartedAt: _runStartedAt,
        lastCompletedRunStartedAt: _lastCompletedRunStartedAt,
        lastRunDurationMs: _lastRunDurationMs,
        lastRunPassed: _lastRunPassed,
        isRunning,
        runBtnDisabled,
        reattemptBtnPresent,
        reattemptBtnDisabled
      };
      localStorage.setItem(STORAGE_KEY_OPEN_TABS, JSON.stringify(tabs));
      if (_lineChip) _updateLineChip();
    } catch (e) {
    }
  }
  window.addEventListener("beforeunload", function() {
    try {
      var tabs = JSON.parse(localStorage.getItem(STORAGE_KEY_OPEN_TABS) || "{}");
      delete tabs[window.name];
      localStorage.setItem(STORAGE_KEY_OPEN_TABS, JSON.stringify(tabs));
    } catch (e) {
    }
  });
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) {
      if (active && !editMode) drawOverlays();
      var ae = document.activeElement;
      var role = ae && ae.getAttribute && ae.getAttribute("role");
      if (role === "tablist" || role === "tab") ae.blur();
    }
  });
  document.addEventListener("focusin", function() {
    if (!active && !editMode) return;
    var sig = computeOverlaySig();
    if (sig !== lastOverlaySig) drawOverlays();
  }, true);
  document.addEventListener("focusout", function() {
    if (!active && !editMode) return;
    setTimeout(function() {
      if (!active && !editMode) return;
      var sig = computeOverlaySig();
      if (sig !== lastOverlaySig) drawOverlays();
    }, 0);
  }, true);
  window.addEventListener("storage", function(e) {
    if (e.key === STORAGE_KEY_ACTIVE) {
      var should = e.newValue === "1";
      if (should !== active) setActive(should);
    }
    if (e.key === STORAGE_KEY_SAFE_MODE) {
      applySafeModeUi(e.newValue === "1", false);
    }
  });
  var shortcutsInitialized = false;
  function initShortcutsIfReady() {
    if (isReportScrapeWindow()) {
      shortcutsInitialized = true;
      initObserver.disconnect();
      removeShortcutUi();
      return true;
    }
    if (isSafeModeEnabled()) {
      if (!document.body) return false;
      shortcutsInitialized = true;
      initObserver.disconnect();
      applySafeModeUi(true, false);
      return true;
    }
    if (!getToggleHost()) return false;
    if (shortcutsInitialized) {
      injectToggleBtn();
      return true;
    }
    shortcutsInitialized = true;
    initObserver.disconnect();
    injectToggleBtn();
    if (localStorage.getItem(STORAGE_KEY_ACTIVE) === "1") setActive(true);
    startPolling();
    return true;
  }
  var initObserver = new MutationObserver(function() {
    initShortcutsIfReady();
  });
  initObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-e2e", "class"] });
  (function() {
    var _deadline = Date.now() + 2e3;
    function _initFallback() {
      if (!initShortcutsIfReady()) {
        if (Date.now() < _deadline) setTimeout(_initFallback, 100);
        return;
      }
    }
    _initFallback();
    window.addEventListener("load", _initFallback);
  })();
  if (/task-wolf\.com$/i.test(location.hostname)) {
    (function() {
      function injectBrSelectAll() {
        var brBtns = Array.prototype.slice.call(document.querySelectorAll("button")).filter(function(b) {
          return /Bug Revalidation Tasks/i.test(b.textContent || "");
        });
        for (var i = 0; i < brBtns.length; i++) {
          var brBtn = brBtns[i];
          var relDiv = brBtn.parentElement;
          if (!relDiv) continue;
          if (relDiv.querySelector("[data-qaw-br-select-all]")) continue;
          var siblingBtns = Array.prototype.slice.call(relDiv.querySelectorAll("button"));
          var showHideBtn = siblingBtns.find(function(b) {
            return b !== brBtn && /^(Show All|Hide All)$/.test((b.textContent || "").trim());
          }) || null;
          var btn = document.createElement("button");
          btn.setAttribute("data-qaw-br-select-all", "1");
          btn.textContent = "Select All";
          btn.style.cssText = "font-size:13px;padding:0 12px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-weight:500;margin-right:4px;";
          (function(b) {
            btn.addEventListener("click", function() {
              brSelectAll(b);
            });
          })(brBtn);
          if (showHideBtn) {
            showHideBtn.parentElement.insertBefore(btn, showHideBtn);
          } else {
            relDiv.appendChild(btn);
          }
        }
      }
      function brSelectAll(brBtn) {
        var contentId = brBtn.getAttribute("aria-controls");
        var contentEl = contentId ? document.getElementById(contentId) : null;
        if (!contentEl) return;
        var relDiv = brBtn.parentElement;
        var allBtns = relDiv ? Array.prototype.slice.call(relDiv.querySelectorAll("button")) : [];
        var showHideBtn = allBtns.find(function(b) {
          return b !== brBtn && /^(Show All|Hide All)$/.test((b.textContent || "").trim());
        }) || null;
        var needsShowAll = showHideBtn !== null && (showHideBtn.textContent || "").trim() === "Show All";
        if (needsShowAll) {
          showHideBtn.click();
          setTimeout(function() {
            brExpandAndCheck(contentEl);
          }, 600);
        } else {
          brExpandAndCheck(contentEl);
        }
      }
      function brExpandAndCheck(contentEl) {
        var groups = brGetGroups(contentEl);
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i];
          if (g.dataset.state === "closed") {
            var toggleBtn2 = g.querySelector(":scope > div > button") || g.querySelector(":scope > button");
            if (toggleBtn2) toggleBtn2.click();
          }
        }
        setTimeout(function() {
          var fresh = brGetGroups(contentEl);
          for (var j = 0; j < fresh.length; j++) {
            var cb = fresh[j].querySelector('input[type="checkbox"]');
            if (cb && !cb.disabled && !cb.checked) cb.click();
          }
        }, 500);
      }
      function brGetGroups(contentEl) {
        return Array.prototype.slice.call(contentEl.querySelectorAll("[data-state]")).filter(function(el) {
          var btn = el.querySelector(":scope > div > button") || el.querySelector(":scope > button");
          return btn && (btn.textContent || "").trim().length > 20;
        });
      }
      setInterval(injectBrSelectAll, 500);
    })();
  }
})();
