/**
 * 共享前端工具（index 与各丛书页通用）。
 *
 * 抽取自原 gen_pages/gen_index 内联胶水中重复的部分（flash / 锁定按钮同步 /
 * 工具栏绑定 / 解锁态回调），消除两页之间的重复代码（架构评审 P0-2）。
 *
 * 依赖：先于本脚本加载 config.js / gate.js / publish.js。
 * 暴露：window.BibCommon { flash, syncLockBtn, setupLockButton, setupTokenButton, setupPublishButton }
 *      并统一接管 window.onBibUnlock / window.onBibLock（页面通过回调注入各自的重新渲染）。
 */
(function (global) {
  "use strict";

  /** 顶部/底部 toast 提示，5 秒后自动淡出。 */
  function flash(msg) {
    var t = document.getElementById("bib-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "bib-toast";
      t.className = "bib-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; }, 5000);
  }

  /** 同步「解锁/退出编辑」按钮的文本与样式。 */
  function syncLockBtn() {
    var lb = document.getElementById("lockbtn");
    if (!lb) return;
    if (global.BibGate && global.BibGate.isUnlocked()) {
      lb.textContent = "🔓 退出编辑";
      lb.classList.add("unlocked-btn");
    } else {
      lb.textContent = "🔒 解锁编辑";
      lb.classList.remove("unlocked-btn");
    }
  }

  /**
   * 绑定锁定按钮 + 统一接管 onBibUnlock / onBibLock 回调。
   * @param {function} onUnlock 解锁后页面特有的重新渲染（如 renderAll / renderCloud）
   * @param {function} onLock  退出后页面特有的重新渲染
   */
  function setupLockButton(onUnlock, onLock) {
    var lb = document.getElementById("lockbtn");
    if (lb) {
      lb.onclick = function () {
        if (global.BibGate.isUnlocked()) { global.BibGate.lockNow(); }
        else { global.BibGate.open(); }
      };
    }
    syncLockBtn();
    global.onBibUnlock = function () { syncLockBtn(); if (typeof onUnlock === "function") onUnlock(); };
    global.onBibLock = function () { syncLockBtn(); if (typeof onLock === "function") onLock(); flash("已退出编辑模式"); };
  }

  /** 绑定「🔑 令牌」按钮：弹窗输入并保存 GitHub 令牌到本机。 */
  function setupTokenButton() {
    var tb = document.getElementById("tokenbtn");
    if (!tb) return;
    tb.onclick = function () {
      if (!global.BibGate.require()) return;
      var v = prompt("GitHub fine-grained 令牌（仅本仓库 contents:write，存本机浏览器，不上传）：", global.BibPub.getToken());
      if (v !== null) {
        global.BibPub.setToken(v.trim());
        flash(v.trim() ? "✅ 已保存令牌" : "已清除令牌");
      }
    };
  }

  /** 绑定「🚀 发布修改」按钮到指定处理函数。 */
  function setupPublishButton(doPublish) {
    var pb = document.getElementById("pubbtn");
    if (pb) pb.onclick = doPublish;
  }

  /**
   * 发布成功后倒计时（预估 GitHub Pages 构建时间），倒计时结束后执行回调。
   * @param {number}   secs   倒计时秒数
   * @param {function} onDone 倒计时结束后执行的刷新回调
   */
  function startPublishCountdown(secs, onDone) {
    var t = document.getElementById("bib-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "bib-toast";
      t.className = "bib-toast";
      document.body.appendChild(t);
    }
    var count = secs;
    t.style.opacity = "1";
    function tick() {
      if (count <= 0) {
        t.textContent = "\u23F3 正在拉取最新数据\u2026";
        if (typeof onDone === "function") onDone();
        return;
      }
      t.textContent = "\u2705 已发布到仓库，约 " + count + " 秒后自动刷新\u2026";
      count--;
      setTimeout(tick, 1000);
    }
    tick();
  }

  global.BibCommon = {
    flash: flash,
    syncLockBtn: syncLockBtn,
    setupLockButton: setupLockButton,
    setupTokenButton: setupTokenButton,
    setupPublishButton: setupPublishButton,
    startPublishCountdown: startPublishCountdown
  };
})(window);
