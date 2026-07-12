/* 标签门禁：默认锁定“加标签 / 发布”入口；只有输入正确口令（SHA-256 校验）解锁后
   才显示。解锁状态记在 localStorage（bib_unlocked_v1），本浏览器只需输一次。
   普通访客看不到也加不了标签——他们点🔒按钮会被要求输口令，不知道就进不去。
   注意：纯静态站点无真正账号体系，此为“防随手乱加”的轻量门禁，非强鉴权。 */
(function () {
  var LS_LOCK = "bib_unlocked_v1";

  function setLocked() {
    document.body.classList.add("locked");
    document.body.classList.remove("unlocked");
  }
  function setUnlocked() {
    document.body.classList.add("unlocked");
    document.body.classList.remove("locked");
    try { localStorage.setItem(LS_LOCK, "1"); } catch (e) {}
  }

  window.BIB = window.BIB || {};
  window.BIB.isUnlocked = function () { return localStorage.getItem(LS_LOCK) === "1"; };
  window.BIB.lockNow = setLocked;
  window.BIB.unlockNow = setUnlocked;
  window.BIB.sha256 = function (s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf),
          function (x) { return x.toString(16).padStart(2, "0"); }).join("");
      });
  };
  window.BIB.tryUnlock = function (pass) {
    var want = (window.BIB_CONFIG && window.BIB_CONFIG.tagPasshash) || "";
    return window.BIB.sha256(pass).then(function (h) {
      if (h === want) { setUnlocked(); return true; }
      return false;
    });
  };

  // 初始状态
  if (window.BIB.isUnlocked()) setUnlocked(); else setLocked();

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("lockbtn");
    if (!btn) return;
    function refresh() {
      if (window.BIB.isUnlocked()) {
        btn.textContent = "🔓 已解锁（点此锁定）";
        btn.classList.add("on");
      } else {
        btn.textContent = "🔒 加标签已锁定";
        btn.classList.remove("on");
      }
    }
    refresh();
    btn.onclick = function () {
      if (window.BIB.isUnlocked()) { setLocked(); refresh(); return; }
      var p = prompt("输入口令以解锁“加标签”功能：");
      if (p == null) return;
      window.BIB.tryUnlock(p).then(function (ok) {
        if (ok) { refresh(); alert("已解锁，可以给书加标签了（本浏览器会记住）。"); }
        else { alert("口令错误。"); }
      });
    };
  });
})();
