/**
 * 首页前端逻辑（从 gen_index.py 内联 JS 外置，架构评审 P0-1）。
 *
 * 职责：跨丛书标签云渲染 / 标签筛选列表 / 全局标签管理（重命名·删除）/
 *      发布。共享工具（flash/工具栏/解锁回调）见 common.js。
 *
 * 数据注入：META / FILES 由 gen_index.py 在本脚本之前用一个极小内联
 * <script> 注入（仅数据，无逻辑），故此处直接以全局名引用。
 *
 * 依赖加载顺序：config.js → gate.js → publish.js → common.js → 本文件。
 */
(function (global) {
  "use strict";
  var flash = global.BibCommon.flash;

  var PUBCOLOR = {
    dh: { bg: "#dbeafe", c: "#1e40af", label: "D&H" },
    mohr: { bg: "#dcfce7", c: "#166534", label: "Mohr" }
  };
  var BOOKS = {};      // id -> {de,zh,author,link,series,tags[]}
  var TAGCOUNT = {};   // 标签 -> 出现次数（基础 tags 计数，仅用于初始）

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  // 当前"显示值"标签图：覆盖层(pending+PUB) 优先，其次基础 tags
  function buildDisplayedTagMap() {
    var map = {};
    for (var id in BOOKS) {
      var m = global.BibPub ? global.BibPub.mergedTags(id) : null;
      map[id] = (m !== null) ? m : (BOOKS[id].tags || []);
    }
    return map;
  }

  // META / FILES 由前置内联数据脚本注入（全局）
  var FILESRef = (typeof FILES !== "undefined") ? FILES : {};
  var loads = Object.keys(FILESRef).map(function (k) {
    return fetch(FILESRef[k]).then(function (r) { return r.json(); }).then(function (arr) {
      arr.forEach(function (b) {
        var s = (b.id || "").split(":")[0];
        var tags = (b.tags || []);
        BOOKS[b.id] = { de: b.de, zh: b.zh, author: b.author, link: b.de_link, series: s, tags: tags };
        tags.forEach(function (t) { TAGCOUNT[t] = (TAGCOUNT[t] || 0) + 1; });
      });
    });
  });

  function renderCloud() {
    var map = buildDisplayedTagMap();
    var cnt = {};
    for (var id in map) map[id].forEach(function (t) { cnt[t] = (cnt[t] || 0) + 1; });
    var ks = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    var cloud = document.getElementById("cloud");
    if (!ks.length) { cloud.innerHTML = '<span class="empty">还没有标签。</span>'; return; }
    cloud.innerHTML = ks.map(function (t) {
      return '<span class="tag" data-t="' + esc(t) + '">' + esc(t) + '<span class="c">' + cnt[t] + '</span>' +
        '<button class="tedit owner-only" type="button" title="重命名">✎</button>' +
        '<button class="tdel owner-only" type="button" title="删除">×</button></span>';
    }).join("");
    cloud.querySelectorAll(".tag").forEach(function (el) {
      var t = el.getAttribute("data-t");
      el.querySelector(".tedit").onclick = function (e) { e.stopPropagation(); renameTag(t); };
      el.querySelector(".tdel").onclick = function (e) { e.stopPropagation(); deleteTag(t); };
      el.onclick = function () { showTag(t); };
    });
  }

  function showTag(tag) {
    var ids = Object.keys(BOOKS).filter(function (id) { return (BOOKS[id].tags || []).includes(tag); });
    var box = document.getElementById("results");
    if (!ids.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="sec-title">含标签「' + esc(tag) + '」的书（' + ids.length + '）</div>' +
      ids.map(function (id) {
        var b = BOOKS[id] || {}; var meta = (typeof META !== "undefined" && META[b.series]) || {};
        var pc = PUBCOLOR[meta.pub] || { bg: "#eee", c: "#333", label: "" };
        return '<div class="ritem"><span class="badge" style="background:' + pc.bg + ";color:" + pc.c + '">' + esc(meta.short || b.series) + '</span>' +
          '<a href="' + esc(b.link || meta.html || "#") + '" target="_blank" rel="noopener">' + esc(b.de || id) + '</a>' +
          '<span class="zh">' + esc(b.zh || "") + '</span>' +
          '<span class="au">' + esc(b.author || "") + '</span></div>';
      }).join("");
    box.scrollIntoView({ behavior: "smooth" });
  }

  // 全局标签操作
  function deleteTag(tag) {
    if (!global.BibGate.require()) return;
    if (!confirm("确定删除标签「" + tag + "」？\n将同步从所有 " + countTag(tag) + " 本书中移除。此操作不可撤销。")) return;
    global.BibPub.globalTagOp("delete", tag, null, buildDisplayedTagMap()).then(function (r) {
      if (r.mode === "published") flash("✅ 已删除标签「" + tag + "」并发布");
      else flash("已复制更新后的 tags.json，请发到 WorkBuddy 项目对话让我代推");
      renderCloud();
    }).catch(function (e) { flash("操作失败：" + (e.message || e)); });
  }
  function renameTag(tag) {
    if (!global.BibGate.require()) return;
    var nv = prompt("将标签「" + tag + "」重命名为：", tag);
    if (nv === null) return; var nn = nv.trim();
    if (!nn || nn === tag) return;
    global.BibPub.globalTagOp("rename", tag, nn, buildDisplayedTagMap()).then(function (r) {
      if (r.mode === "published") flash("✅ 已重命名为「" + nn + "」并发布");
      else flash("已复制更新后的 tags.json，请发到 WorkBuddy 项目对话让我代推");
      renderCloud();
    }).catch(function (e) { flash("操作失败：" + (e.message || e)); });
  }
  function countTag(tag) { var n = 0; var m = buildDisplayedTagMap(); for (var id in m) if (m[id].includes(tag)) n++; return n; }

  // 发布
  function doPublish() {
    if (!global.BibGate.require()) return;
    var pubbtn = document.getElementById("pubbtn");
    if (pubbtn) { pubbtn.disabled = true; pubbtn.textContent = "\u23F3 发布中\u2026"; }
    global.BibPub.publishAll().then(function (r) {
      if (pubbtn) { pubbtn.disabled = false; pubbtn.textContent = "\uD83D\uDE80 发布修改"; }
      if (r.mode === "published") {
        global.BibCommon.startPublishCountdown(60, function () {
          if (global.BibPub) {
            global.BibPub.fetchPub().then(function () {
              renderCloud();
              flash("\u2705 页面已刷新，显示最新发布状态");
            }).catch(function () {
              flash("\u26A0\uFE0F 拉取最新数据失败，请手动刷新页面");
            });
          }
        });
      } else {
        flash("已复制修改 JSON，请发到 WorkBuddy 项目对话让我代推上线");
        renderCloud();
      }
    }).catch(function (e) {
      if (pubbtn) { pubbtn.disabled = false; pubbtn.textContent = "\uD83D\uDE80 发布修改"; }
      flash("发布失败：" + (e.message || e) + "（需填 GitHub 令牌，或复制发我代推）");
    });
  }

  // 加载基础数据 → 拉取覆盖层 → 渲染标签云
  Promise.all(loads)
    .then(function () { if (global.BibPub) return global.BibPub.fetchPub().then(function () {}).catch(function () {}); })
    .then(function () { renderCloud(); })
    .catch(function (e) {
      document.getElementById("cloud").innerHTML = '<span class="empty">数据加载失败（请用 https 链接打开，或本地起服务器）。</span>';
      console.warn(e);
    });

  document.addEventListener("DOMContentLoaded", function () {
    global.BibCommon.setupLockButton(renderCloud, renderCloud);
    global.BibCommon.setupTokenButton();
    global.BibCommon.setupPublishButton(doPublish);
  });
})(window);
