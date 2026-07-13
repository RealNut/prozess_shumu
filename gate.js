// 口令门禁：解锁后才显示 owner-only 编辑入口。
// 安全说明：纯静态站点无法做服务端鉴权，此为"轻量门禁"——口令以加盐 SHA-256 存储于本文件，
// 校验在浏览器本地完成。它能挡住随手乱改与简单猜测（含失败锁定），但源码可见故非银行级安全；
// 适合个人站点。真正的"防暴力破解"靠下方失败次数锁定（指数退避）。
(function () {
  var CFG = window.BIB_CONFIG || { SALT: "", PASS_HASH: "" };
  var LS_ATT = "bib_attempts_v2";
  var LS_LOCK = "bib_lock_until_v2";
  var SS_UNLOCK = "bib_unlocked_v2";
  var MAX_TRIES = 5;

  function now() { return Date.now(); }
  function getAttempts() { return parseInt(localStorage.getItem(LS_ATT) || "0", 10) || 0; }
  function setAttempts(n) { localStorage.setItem(LS_ATT, String(n)); }
  function getLock() { return parseInt(localStorage.getItem(LS_LOCK) || "0", 10) || 0; }
  function setLock(t) { localStorage.setItem(LS_LOCK, String(t)); }

  function sha256(msg) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      });
  }

  function showGate() {
    var el = document.getElementById("bib-gate");
    if (el) return;
    el = document.createElement("div");
    el.id = "bib-gate";
    el.className = "bib-gate";
    el.innerHTML =
      '<div class="bib-gate-box">' +
      '<div class="bib-gate-title">🔒 编辑功能已锁定</div>' +
      '<div class="bib-gate-sub">输入口令以解锁：标签 / 译名 / 年份 编辑</div>' +
      '<input id="bib-pass" type="password" placeholder="口令" autocomplete="off">' +
      '<button id="bib-pass-go" type="button">解锁</button>' +
      '<div id="bib-gate-msg" class="bib-gate-msg"></div>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById("bib-pass").addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryUnlock();
    });
    document.getElementById("bib-pass-go").addEventListener("click", tryUnlock);
    setTimeout(function () { var i = document.getElementById("bib-pass"); if (i) i.focus(); }, 50);
  }
  function hideGate() { var el = document.getElementById("bib-gate"); if (el) el.remove(); }

  function tryUnlock() {
    var lock = getLock();
    if (lock > now()) {
      var sec = Math.ceil((lock - now()) / 1000);
      var m = document.getElementById("bib-gate-msg");
      if (m) m.textContent = "已锁定，请 " + sec + " 秒后重试";
      return;
    }
    var inp = document.getElementById("bib-pass");
    var val = inp ? inp.value : "";
    sha256(CFG.SALT + val).then(function (h) {
      var msg = document.getElementById("bib-gate-msg");
      if (h === CFG.PASS_HASH) {
        sessionStorage.setItem(SS_UNLOCK, "1");
        setAttempts(0); setLock(0);
        hideGate();
        document.body.classList.add("unlocked");
        if (window.onBibUnlock) window.onBibUnlock();
      } else {
        var a = getAttempts() + 1; setAttempts(a);
        if (a >= MAX_TRIES) {
          var backoff = 30000 * Math.pow(2, a - MAX_TRIES); // 30s,60s,120s...
          setLock(now() + backoff);
          if (msg) msg.textContent = "尝试过多，已锁定 " + (backoff / 1000) + " 秒";
        } else {
          if (msg) msg.textContent = "口令错误，还可尝试 " + (MAX_TRIES - a) + " 次";
        }
      }
    });
  }

  window.BibGate = {
    isUnlocked: function () { return sessionStorage.getItem(SS_UNLOCK) === "1"; },
    require: function () {
      if (!window.BibGate.isUnlocked()) { showGate(); return false; }
      return true;
    },
    lockNow: function () {
      sessionStorage.removeItem(SS_UNLOCK);
      document.body.classList.remove("unlocked");
      if (window.onBibLock) window.onBibLock();
    },
    open: showGate
  };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("lockbtn");
    if (btn) btn.style.display = "inline-block";
    if (window.BibGate.isUnlocked()) {
      document.body.classList.add("unlocked");
      if (window.onBibUnlock) window.onBibUnlock();
    }
  });
})();
