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

  /* ---------- 标签相似度匹配（加标签时避免重复/错别字） ---------- */
  /** 归一化：小写 + 去空白 + 去常见标点，使「欧 盟 法」「欧盟法」可比对。 */
  function normalizeTag(s) {
    return (s || "").toLowerCase().replace(/\s+/g, "").replace(/[_\-–—()（）.,。、]/g, "");
  }

  /** Levenshtein 编辑距离（中文字符为单元，故可抓错别字）。 */
  function levenshtein(a, b) {
    if (!a) return b.length;
    if (!b) return a.length;
    var m = a.length, n = b.length;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j, t;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  /**
   * 返回与输入最相似的已有标签（用于加标签时提示复用）。
   * @param {string} input  当前输入
   * @param {Array}  vocab  已有标签词表
   * @param {object} opts   { limit=6, exclude=[] }  exclude=该书已有的标签
   * @returns {Array<{tag:string, score:number}>}  score ∈ (0,1]，降序
   */
  function suggestTags(input, vocab, opts) {
    opts = opts || {};
    var limit = opts.limit || 6;
    var exclude = opts.exclude || [];
    var q = (input || "").trim();
    if (!q) return [];
    var nq = normalizeTag(q);
    if (!nq) return [];
    var exSet = {};
    exclude.forEach(function (t) { exSet[normalizeTag(t)] = 1; });
    var scored = [];
    (vocab || []).forEach(function (tag) {
      var nt = normalizeTag(tag);
      if (!nt || exSet[nt]) return;            // 跳过空标签 / 该书已有标签
      var score;
      if (nt === nq) score = 1.0;              // 完全相同（复用另一本书的同名标签）
      else if (nt.indexOf(nq) >= 0 || nq.indexOf(nt) >= 0) {
        var longer = Math.max(nt.length, nq.length);
        score = 0.6 + 0.35 * (Math.min(nt.length, nq.length) / longer); // 包含关系
      } else {
        var d = levenshtein(nq, nt);
        var mx = Math.max(nq.length, nt.length);
        score = 1 - d / mx;
        if (score < 0.55) return;              // 太不相似（含不同法律分支的误触），丢弃
      }
      scored.push({ tag: tag, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit);
  }

  global.BibCommon = {
    flash: flash,
    syncLockBtn: syncLockBtn,
    setupLockButton: setupLockButton,
    setupTokenButton: setupTokenButton,
    setupPublishButton: setupPublishButton,
    startPublishCountdown: startPublishCountdown,
    suggestTags: suggestTags,
    normalizeTag: normalizeTag
  };
})(window);
