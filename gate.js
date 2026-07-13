/**
 * 编辑门禁（轻量口令解锁）。
 *
 * 设计：纯静态站点无法做服务端鉴权，故采用「浏览器本地加盐哈希校验 + 失败锁定」。
 * 暴露：window.BibGate { isUnlocked, require, open, lockNow, hashFor }
 *      + 回调 window.onBibUnlock() / window.onBibLock()
 *
 * 健壮性要点：
 *  • 哈希校验依赖 Web Crypto（需安全上下文 https / localhost）；非安全上下文给出明确提示而非静默失败。
 *  • 口令比对用常量时间比较，降低侧信道风险。
 *  • 失败次数达上限即锁定，锁定时间指数退避（30s → 60s → 120s …）。
 *  • 门禁弹层防止重复弹出；已解锁则不再弹出；aria 属性保障基本可访问性。
 */
(function (global) {
  "use strict";

  var CFG = global.BIB_CONFIG || { SALT: "", PASS_HASH: "" };
  var LS_ATTEMPTS = "bib_attempts_v2";   // 失败计数（localStorage，跨会话累计）
  var LS_LOCK_UNTIL = "bib_lock_until_v2"; // 锁定截止时间戳
  var SS_UNLOCK = "bib_unlocked_v2";     // 本次会话已解锁标记（sessionStorage，关页即失效）

  var MAX_ATTEMPTS = 5;     // 达到即触发锁定
  var LOCK_BASE_MS = 30000; // 首次锁定 30s，之后按 2^(n-1) 退避
  var GATE_ID = "bib-gate";

  // ---------- 小工具 ----------
  function now() { return Date.now(); }
  function getAttempts() { return parseInt(localStorage.getItem(LS_ATTEMPTS) || "0", 10) || 0; }
  function setAttempts(n) { localStorage.setItem(LS_ATTEMPTS, String(n)); }
  function getLockUntil() { return parseInt(localStorage.getItem(LS_LOCK_UNTIL) || "0", 10) || 0; }
  function setLockUntil(t) { localStorage.setItem(LS_LOCK_UNTIL, String(t)); }
  function isUnlocked() { return sessionStorage.getItem(SS_UNLOCK) === "1"; }

  // 常量时间字符串比较，避免哈希比对泄漏长度/逐字符信息。
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // Web Crypto SHA-256（仅安全上下文可用），返回 hex 字符串。
  function sha256Hex(msg) {
    if (!(global.crypto && global.crypto.subtle)) {
      return Promise.reject(new Error("crypto-unavailable"));
    }
    return global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        }).join("");
      });
  }

  // ---------- 门禁 UI ----------
  function buildGate() {
    var el = document.createElement("div");
    el.id = GATE_ID;
    el.className = "bib-gate";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "bib-gate-title");
    el.innerHTML =
      '<div class="bib-gate-box">' +
      '<div class="bib-gate-title" id="bib-gate-title">🔒 编辑功能已锁定</div>' +
      '<div class="bib-gate-sub">输入口令以解锁：标签 / 译名 / 年份 编辑</div>' +
      '<input id="bib-pass" type="password" placeholder="口令" autocomplete="off" aria-label="编辑口令">' +
      '<button id="bib-pass-go" type="button">解锁</button>' +
      '<div id="bib-gate-msg" class="bib-gate-msg" aria-live="polite"></div>' +
      '</div>';
    document.body.appendChild(el);
    var input = document.getElementById("bib-pass");
    var go = document.getElementById("bib-pass-go");
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    go.addEventListener("click", tryUnlock);
    setTimeout(function () { if (input) input.focus(); }, 50);
  }
  function showGate() {
    if (isUnlocked()) return;            // 已解锁则不弹
    if (document.getElementById(GATE_ID)) return; // 防止重复弹出
    buildGate();
  }
  function hideGate() { var el = document.getElementById(GATE_ID); if (el) el.remove(); }
  function msg(text) { var m = document.getElementById("bib-gate-msg"); if (m) m.textContent = text || ""; }

  function tryUnlock() {
    var lockUntil = getLockUntil();
    if (lockUntil > now()) {
      msg("已锁定，请 " + Math.ceil((lockUntil - now()) / 1000) + " 秒后重试");
      return;
    }
    var input = document.getElementById("bib-pass");
    var val = input ? input.value : "";
    sha256Hex(CFG.SALT + val).then(function (hash) {
      if (safeEqual(hash, CFG.PASS_HASH)) {
        sessionStorage.setItem(SS_UNLOCK, "1");
        setAttempts(0);
        setLockUntil(0);
        if (input) input.value = "";
        hideGate();
        enterUnlocked();
      } else {
        var a = getAttempts() + 1;
        setAttempts(a);
        if (a >= MAX_ATTEMPTS) {
          var backoff = LOCK_BASE_MS * Math.pow(2, a - MAX_ATTEMPTS);
          setLockUntil(now() + backoff);
          msg("尝试过多，已锁定 " + Math.round(backoff / 1000) + " 秒");
        } else {
          msg("口令错误，还可尝试 " + (MAX_ATTEMPTS - a) + " 次");
        }
      }
    }).catch(function () {
      msg("当前环境不支持加密校验（需 https 或 localhost），无法解锁");
    });
  }

  // ---------- 状态切换 ----------
  function enterUnlocked() {
    document.body.classList.add("unlocked");
    if (typeof global.onBibUnlock === "function") global.onBibUnlock();
  }
  function exitUnlocked() {
    sessionStorage.removeItem(SS_UNLOCK);
    document.body.classList.remove("unlocked");
    if (typeof global.onBibLock === "function") global.onBibLock();
  }

  // ---------- 公共 API ----------
  global.BibGate = {
    isUnlocked: isUnlocked,
    /** 已解锁返回 true；否则弹出门禁并返回 false（用于编辑前守门）。 */
    require: function () { if (!isUnlocked()) { showGate(); return false; } return true; },
    /** 主动弹出门禁（供「解锁编辑」按钮调用）。 */
    open: showGate,
    /** 立即退出解锁态（供「退出编辑」按钮调用）。 */
    lockNow: exitUnlocked,
    /** 控制台辅助：计算口令哈希（改口令用）。 */
    hashFor: function (pass) { return sha256Hex(CFG.SALT + pass); }
  };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("lockbtn");
    if (btn) btn.style.display = "inline-block"; // 始终可见：既是入口也是退出键
    if (isUnlocked()) enterUnlocked();            // 同标签页刷新后保持解锁态
  });
})(window);
