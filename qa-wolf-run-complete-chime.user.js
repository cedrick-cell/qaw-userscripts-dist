// ==UserScript==
// @name         QA Wolf — run finished chime
// @namespace    http://tampermonkey.net/
// @version      1.16
// @description  Short sound when a code run finishes. Records last run duration, current run start time (for live elapsed in investigation notes). Click the page once if the browser blocks audio until gesture.
// @match        https://app.qawolf.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-run-complete-chime.user.js
// @downloadURL  https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-run-complete-chime.user.js
// ==/UserScript==
"use strict";
(() => {
  // src/qa-wolf-run-complete-chime.ts
  var CHIME_BANNER = `// ==UserScript==
// @name         QA Wolf \u2014 run finished chime
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Short sound when a code run finishes. Records last run duration, current run start time (for live elapsed in investigation notes). Click the page once if the browser blocks audio until gesture.
// @match        https://app.qawolf.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==`;
  var SEL_STOP = '[data-e2e="stop-run-button"]';
  var SETTLE_MS = 500;
  var POLL_MS = 250;
  var RUN_CHIME_METRICS_KEY = "_qawRunChimeMetrics";
  var CHIME_FIRED_KEY = "_qawChimeFired";
  var TAB_ID = Math.random().toString(36).slice(2);
  try {
    _ss = sessionStorage.getItem("_qawTabId");
    if (_ss) TAB_ID = _ss;
    else sessionStorage.setItem("_qawTabId", TAB_ID);
  } catch (e) {
  }
  var _ss;
  function markChimeFired(fileName) {
    try {
      localStorage.setItem(CHIME_FIRED_KEY, JSON.stringify({ file: fileName || "", t: Date.now(), tabId: TAB_ID }));
    } catch (e) {
    }
  }
  function otherTabAlreadyChimed(fileName) {
    try {
      var raw = localStorage.getItem(CHIME_FIRED_KEY);
      if (!raw) return false;
      var o = JSON.parse(raw);
      if (!o || o.tabId === TAB_ID) return false;
      if (Date.now() - o.t > 3e3) return false;
      return (o.file || "") === (fileName || "");
    } catch (e) {
      return false;
    }
  }
  var wasRunning = false;
  var settleTimer = null;
  var audioUnlocked = false;
  var runSegmentStart = null;
  var runSegmentFile = null;
  function getActiveFlowFileName() {
    var tabs = document.querySelectorAll('[class*="styles_tab__"]');
    var active = null;
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (typeof t.className === "string" && t.className.indexOf("styles_tabActive__") !== -1) {
        active = t;
        break;
      }
    }
    if (!active) return null;
    var clone = active.cloneNode(true);
    var cbs = clone.querySelectorAll('[class*="styles_closeButton__"]');
    for (var j = 0; j < cbs.length; j++) cbs[j].remove();
    var text = (clone.innerText || clone.textContent || "").trim().replace(/\s+/g, " ");
    if (!text) return null;
    var parts = text.split(/[/\\]/);
    var name = parts[parts.length - 1].trim();
    if (!name || name.length > 200) return null;
    return /flow\.(js|ts)$/i.test(name) ? name : null;
  }
  function stopVisible() {
    var el = document.querySelector(SEL_STOP);
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var st = window.getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") return false;
    return true;
  }
  function readMetrics() {
    try {
      var raw = localStorage.getItem(RUN_CHIME_METRICS_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }
  function writeFileMetrics(fileName, partial) {
    var m = readMetrics();
    if (!m.byFile || typeof m.byFile !== "object") m.byFile = {};
    if (!m.byFile[fileName] || typeof m.byFile[fileName] !== "object") m.byFile[fileName] = {};
    var slot = m.byFile[fileName];
    for (var k in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) slot[k] = partial[k];
    }
    m.lastUpdatedIso = (/* @__PURE__ */ new Date()).toISOString();
    try {
      localStorage.setItem(RUN_CHIME_METRICS_KEY, JSON.stringify(m));
    } catch (e) {
    }
    try {
      window.dispatchEvent(new CustomEvent("qaw-run-chime-metrics", { detail: m }));
    } catch (e2) {
    }
  }
  function isFlowPassed() {
    try {
      var panel = document.getElementById("gitwolf-file-editor-panel") || document.body;
      return (panel.innerText || panel.textContent || "").toLowerCase().indexOf("flow passed") !== -1;
    } catch (e) {
      return false;
    }
  }
  function playChime(passed) {
    try {
      let tone2 = function(freq, start, dur, vol) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, t0 + start);
        g.gain.setValueAtTime(1e-4, t0 + start);
        g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.02);
        g.gain.exponentialRampToValueAtTime(1e-4, t0 + start + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0 + start);
        o.stop(t0 + start + dur + 0.05);
      };
      var tone = tone2;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      if (ctx.state === "suspended") ctx.resume();
      var t0 = ctx.currentTime;
      if (passed) {
        tone2(523, 0, 0.1, 0.1);
        tone2(659, 0.09, 0.12, 0.11);
        tone2(784, 0.19, 0.3, 0.12);
      } else {
        tone2(494, 0, 0.16, 0.08);
        tone2(392, 0.14, 0.24, 0.07);
      }
      setTimeout(function() {
        try {
          ctx.close();
        } catch (e) {
        }
      }, 900);
    } catch (e) {
    }
  }
  function unlockAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      ctx.resume().catch(function() {
      });
      setTimeout(function() {
        try {
          ctx.close();
        } catch (e) {
        }
      }, 100);
    } catch (e) {
    }
  }
  document.addEventListener("click", unlockAudioOnce, true);
  document.addEventListener("keydown", unlockAudioOnce, true);
  function onPoll() {
    var running = stopVisible();
    if (running) {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (!wasRunning) {
        runSegmentStart = Date.now();
        runSegmentFile = getActiveFlowFileName();
        wasRunning = true;
        if (runSegmentFile) {
          writeFileMetrics(runSegmentFile, { currentRunStartedAt: runSegmentStart });
        }
      }
      return;
    }
    if (!wasRunning) return;
    if (settleTimer) return;
    settleTimer = setTimeout(function() {
      settleTimer = null;
      if (stopVisible()) return;
      if (!wasRunning) return;
      var durationMs = runSegmentStart != null && Number.isFinite(runSegmentStart) ? Date.now() - runSegmentStart : null;
      var endedAt = Date.now();
      if (runSegmentFile) {
        writeFileMetrics(runSegmentFile, {
          currentRunStartedAt: null,
          completedRunDurationMs: durationMs,
          completedRunEndedAt: endedAt
        });
      }
      if (!otherTabAlreadyChimed(runSegmentFile)) {
        markChimeFired(runSegmentFile);
        playChime(isFlowPassed());
      }
      wasRunning = false;
      runSegmentStart = null;
      runSegmentFile = null;
    }, SETTLE_MS);
  }
  wasRunning = stopVisible();
  if (wasRunning) {
    runSegmentStart = Date.now();
    runSegmentFile = getActiveFlowFileName();
    if (runSegmentFile) {
      writeFileMetrics(runSegmentFile, { currentRunStartedAt: runSegmentStart });
    }
  }
  setInterval(onPoll, POLL_MS);
  var mo = new MutationObserver(function() {
    onPoll();
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "disabled", "hidden"]
  });
})();
