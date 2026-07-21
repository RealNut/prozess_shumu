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

  // ---------- 丛书左右顺序（修订模式可拖拽重排，发布后生效）----------
  // 已发布顺序来自 series_order.json（PUB.order）；本地草稿来自 LS_ORDER。
  function getPublishedOrder() {
    var po = (global.BibPub && global.BibPub.PUB) ? global.BibPub.PUB.order : null;
    return (po && po.length) ? po : DEFAULT_ORDER;
  }
  // 卡片当前应显示的顺序：修订模式下优先用本地草稿（即时预览），否则用已发布顺序。
  function getCardOrder() {
    if (document.body.classList.contains("unlocked")) {
      var pend = global.BibPub.getOrderPending();
      if (pend && pend.length) return pend;
    }
    return getPublishedOrder();
  }
  // 按 order 重排每个 .cards 容器内的卡片（仅同组内相对顺序改变）。
  function applyCardOrder() {
    var order = getCardOrder();
    var idx = {};
    order.forEach(function (p, i) { idx[p] = i; });
    document.querySelectorAll(".cards").forEach(function (cont) {
      var cards = Array.prototype.slice.call(cont.querySelectorAll(".card"));
      cards.sort(function (a, b) {
        var pa = a.getAttribute("data-prefix"), pb = b.getAttribute("data-prefix");
        return (idx[pa] == null ? 1e9 : idx[pa]) - (idx[pb] == null ? 1e9 : idx[pb]);
      });
      cards.forEach(function (c) { cont.appendChild(c); });
    });
  }
  // 修订模式开关：设置卡片 draggable + 应用当前顺序（锁定态回退到已发布顺序）。
  function syncEditMode() {
    var unlocked = document.body.classList.contains("unlocked");
    document.querySelectorAll(".card").forEach(function (c) { c.draggable = unlocked; });
    applyCardOrder();
  }

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
        BOOKS[b.id] = { de: b.de, zh: b.zh, author: b.author, link: b.de_link, series: s, tags: tags, vol: b.vol || "" };
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

  var currentTag = null; // 记录当前选中的标签，删标签后重渲染用

  function showTag(tag) {
    currentTag = tag;
    var map = buildDisplayedTagMap();
    var ids = Object.keys(BOOKS).filter(function (id) { return map[id].includes(tag); });
    // 按已发布丛书顺序排序（发布后顺序变更才会反映到这里）
    var order = getPublishedOrder();
    var idx = {};
    order.forEach(function (p, i) { idx[p] = i; });
    ids.sort(function (a, b) {
      var sa = (BOOKS[a] || {}).series || "", sb = (BOOKS[b] || {}).series || "";
      return (idx[sa] == null ? 1e9 : idx[sa]) - (idx[sb] == null ? 1e9 : idx[sb]);
    });
    var box = document.getElementById("results");
    if (!ids.length) {
      box.innerHTML = '<div class="sec-title">含标签「' + esc(tag) + '」的书（0）</div><span class="empty">没有匹配的书。</span>';
      return;
    }
    box.innerHTML = '<div class="sec-title">含标签「' + esc(tag) + '」的书（' + ids.length + '）</div>' +
      '<div class="results-hint owner-only">觉得某本不该有此标签？点右侧 × 移除</div>' +
      ids.map(function (id) {
        var b = BOOKS[id] || {}; var meta = (typeof META !== "undefined" && META[b.series]) || {};
        var pc = PUBCOLOR[meta.pub] || { bg: "#eee", c: "#333", label: "" };
        var pend = hasBookPending(id);
        return '<div class="ritem' + (pend ? " ritem-pending" : "") + '" data-id="' + esc(id) + '">' +
          '<span class="badge" style="background:' + pc.bg + ";color:" + pc.c + '">' + esc(meta.short || b.series) + '</span>' +
          '<a href="' + esc(b.link || meta.html || "#") + '" target="_blank" rel="noopener">' + esc(b.de || id) + '</a>' +
          '<span class="zh">' + esc(b.zh || "") + '</span>' +
          '<span class="au">' + esc(b.author || "") + '</span>' +
          '<button class="rtag-del owner-only" type="button" title="从该书移除标签「' + esc(tag) + '」" data-id="' + esc(id) + '">×</button>' +
          '</div>';
      }).join("");
    // 绑定删除按钮
    box.querySelectorAll(".rtag-del").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        removeTagFromBook(btn.getAttribute("data-id"), tag);
      };
    });
    box.scrollIntoView({ behavior: "smooth" });
  }

  /** 从首页检索结果中移除某书的某标签（写入 pending，不立即发布）。 */
  function removeTagFromBook(id, tag) {
    var map = buildDisplayedTagMap();
    var cur = map[id] || [];
    var na = cur.filter(function (t) { return t !== tag; });
    global.BibPub.setTagPending(id, na);
    flash("已从该书移除标签「" + tag + "」（待发布）");
    renderCloud();
    if (currentTag) showTag(currentTag); // 重渲染结果列表（该书会消失）
    updatePending();
  }

  /** 检测某书是否有 pending 修改（标签/译名/年份）。 */
  function hasBookPending(id) {
    var lt = global.BibPub.getLocal(global.BibPub.LS.tags);
    var ltr = global.BibPub.getLocal(global.BibPub.LS.trans);
    var ly = global.BibPub.getLocal(global.BibPub.LS.year);
    return (id in lt) || (id in ltr) || (id in ly);
  }

  /** 更新待发布计数徽章。 */
  function updatePending() {
    var lt = global.BibPub.getLocal(global.BibPub.LS.tags);
    var ltr = global.BibPub.getLocal(global.BibPub.LS.trans);
    var ly = global.BibPub.getLocal(global.BibPub.LS.year);
    var lh = global.BibPub.getLocal(global.BibPub.LS.hl);
    var lfl = global.BibPub.getLocal(global.BibPub.LS.fl);
    var ids = {};
    for (var k in lt) ids[k] = 1;
    for (var k in ltr) ids[k] = 1;
    for (var k in ly) ids[k] = 1;
    for (var k in lh) ids[k] = 1;
    var n = Object.keys(ids).length;
    if (lfl && lfl.length) n += 1; // 书单为整体草稿，计为 1 项待发布
    var b = document.getElementById("pending-badge");
    if (!b) return;
    if (n > 0) { b.textContent = "待发布 " + n; b.className = "pending-badge show"; }
    else { b.textContent = ""; b.className = "pending-badge"; }
  }

  // ---------- 丛书卡片拖拽重排（仅同出版社组内）----------
  var dragSrc = null;
  // 取指针最近的卡片，按左右/上下位置决定插入到其前还是其后
  function getDragAfterElement(container, x, y) {
    var els = Array.prototype.slice.call(container.querySelectorAll(".card:not(.dragging)"));
    var closest = { dist: Infinity, el: null };
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dist < closest.dist) { closest.dist = dist; closest.el = el; }
    });
    if (!closest.el) return null;
    var r = closest.el.getBoundingClientRect();
    return (x < r.left + r.width / 2 || y < r.top + r.height / 2) ? closest.el : closest.el.nextSibling;
  }
  // 从 DOM 现有顺序重建完整 prefix 顺序数组并写入 pending（草稿，发布后生效）
  function saveOrderFromDom() {
    var order = [];
    document.querySelectorAll(".cards").forEach(function (cont) {
      cont.querySelectorAll(".card").forEach(function (c) { order.push(c.getAttribute("data-prefix")); });
    });
    global.BibPub.setOrderPending(order);
  }
  function setupCardDrag() {
    document.querySelectorAll(".cards").forEach(function (cont) {
      cont.addEventListener("dragover", function (e) {
        if (!dragSrc || cont !== dragSrc.parentElement) return; // 仅同组内重排
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      cont.addEventListener("drop", function (e) {
        if (!dragSrc || cont !== dragSrc.parentElement) return;
        e.preventDefault();
        var after = getDragAfterElement(cont, e.clientX, e.clientY);
        if (after == null) cont.appendChild(dragSrc);
        else cont.insertBefore(dragSrc, after);
        dragSrc.classList.remove("dragging");
        dragSrc = null;
        saveOrderFromDom();
        applyCardOrder();
        flash("已调整丛书顺序（待发布，发布后生效）");
      });
    });
    document.querySelectorAll(".card").forEach(function (card) {
      card.addEventListener("dragstart", function (e) {
        if (!document.body.classList.contains("unlocked")) return; // 仅修订模式可拖
        dragSrc = card;
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", card.getAttribute("data-prefix")); } catch (_) {}
      });
      card.addEventListener("dragend", function () {
        card.classList.remove("dragging");
        dragSrc = null;
      });
    });
  }

  // 全局标签操作
  function deleteTag(tag) {
    if (!global.BibGate.require()) return;
    if (!confirm("确定删除标签「" + tag + "」？\n将同步从所有 " + countTag(tag) + " 本书中移除。此操作不可撤销。")) return;
    global.BibPub.globalTagOp("delete", tag, null, buildDisplayedTagMap()).then(function (r) {
      if (r.mode === "published") flash("✅ 已删除标签「" + tag + "」并发布");
      else flash("已复制更新后的 tags.json，请发到 WorkBuddy 项目对话让我代推");
      renderCloud(); updatePending();
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
      renderCloud(); updatePending();
    }).catch(function (e) { flash("操作失败：" + (e.message || e)); });
  }
  function countTag(tag) { var n = 0; var m = buildDisplayedTagMap(); for (var id in m) if (m[id].includes(tag)) n++; return n; }

  // ---------- 站长推荐书单（覆盖层 featured_lists.json）----------
  /** 某书是否被标记民事诉讼（用于推荐区块同步上色）。 */
  function isCivil(id) {
    var hl = global.BibPub ? global.BibPub.mergedHighlights(id) : null;
    return !!(hl && hl.indexOf("civil") >= 0);
  }
  /** 当前应显示的书单数组：pending(整段草稿) > PUB > 空。 */
  function getFeatured() { return (global.BibPub && global.BibPub.mergedFeatured) ? global.BibPub.mergedFeatured() : []; }
  /** 写入书单草稿并刷新区块/管理面板/待发布计数。 */
  function saveFeatured(arr) {
    global.BibPub.setFeaturedPending(arr);
    renderFeatured(); renderManage(); updatePending();
  }
  /** 生成书单内单本书的 ritem HTML（含系列徽章、外链、民事诉讼上色）。 */
  function bookRitem(id) {
    var b = BOOKS[id] || {};
    var meta = (typeof META !== "undefined" && META[b.series]) || {};
    var pc = PUBCOLOR[meta.pub] || { bg: "#eee", c: "#333", label: "" };
    return '<div class="ritem' + (isCivil(id) ? " hl-civil" : "") + '" data-id="' + esc(id) + '">' +
      '<span class="badge" style="background:' + pc.bg + ";color:" + pc.c + '">' + esc(meta.short || b.series) + '</span>' +
      '<a href="' + esc(b.link || meta.html || "#") + '" target="_blank" rel="noopener">' + esc(b.de || id) + '</a>' +
      '<span class="zh">' + esc(b.zh || "") + '</span>' +
      '<span class="au">' + esc(b.author || "") + '</span>' +
      '</div>';
  }

  /** 渲染首页「⭐ 站长推荐」区块：读者仅见 showOnHome 的书单；owner 额外预览隐藏书单。 */
  function renderFeatured() {
    var sec = document.getElementById("featured-sec");
    if (!sec) return;
    var lists = getFeatured();
    var unlocked = document.body.classList.contains("unlocked");
    var visible = lists.filter(function (l) { return unlocked || l.showOnHome; });
    var html = '<div class="sec-title">⭐ 站长推荐' +
      (unlocked ? ' <button id="fl-toggle" class="owner-only fl-toggle" type="button">📚 管理书单</button>' : '') +
      '</div>';
    if (!visible.length) {
      html += '<div class="empty">' + (unlocked ? '还没有书单。点「📚 管理书单」新建并检索添加图书。' : '站长暂未推荐书单。') + '</div>';
    } else {
      html += visible.map(function (l) {
        var hiddenTag = (unlocked && !l.showOnHome) ? ' <span class="fl-hidden">🙈 首页隐藏</span>' : '';
        var books = (l.books || []).map(bookRitem).join("");
        return '<div class="fl-list"><div class="fl-name">' + esc(l.name || "未命名书单") + hiddenTag + '</div>' +
          (books || '<div class="empty">该书单还没有书。</div>') + '</div>';
      }).join("");
    }
    sec.innerHTML = html;
    if (unlocked) {
      var t = document.getElementById("fl-toggle");
      if (t) t.onclick = function () { toggleManage(); };
    }
  }

  /** 书单管理面板：新建/改名/首页展示开关/检索添加/移除/删除。仅 owner 可打开（按钮 owner-only）。 */
  function renderManage() {
    var panel = document.getElementById("fl-manage");
    if (!panel || panel.style.display === "none") return;
    var lists = getFeatured();
    var html = '<div class="flm-head">📚 书单管理' +
      ' <button id="fl-new" type="button">＋ 新建书单</button>' +
      ' <button id="fl-close" type="button">关闭</button></div>';
    if (!lists.length) html += '<div class="empty">还没有书单。点上方「＋ 新建书单」开始。</div>';
    html += lists.map(function (l) {
      var books = (l.books || []).map(function (id) {
        var b = BOOKS[id] || {};
        return '<span class="flm-book" data-id="' + esc(id) + '">' + esc(b.de || id) +
          (b.zh ? '（' + esc(b.zh) + '）' : '') +
          ' <button class="flm-rm" type="button" title="移出书单">×</button></span>';
      }).join("");
      return '<div class="flm-list" data-id="' + esc(l.id) + '">' +
        '<div class="flm-row">' +
        '<input class="flm-name" value="' + esc(l.name || "") + '" aria-label="书单名称">' +
        '<label class="flm-show"><input type="checkbox" ' + (l.showOnHome ? "checked" : "") + '> 在首页展示</label>' +
        '<button class="flm-del" type="button" title="删除书单">🗑</button>' +
        '</div>' +
        '<div class="flm-add"><input class="flm-search" placeholder="检索库内图书（书名/译名/作者/卷号）添加…" aria-label="检索添加图书"><div class="flm-results"></div></div>' +
        '<div class="flm-books">' + (books || '<span class="empty">还没有书。</span>') + '</div>' +
        '</div>';
    }).join("");
    panel.innerHTML = html;
    var newBtn = document.getElementById("fl-new");
    if (newBtn) newBtn.onclick = function () {
      var arr = getFeatured().slice();
      arr.push({ id: "fl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: "新书单", books: [], showOnHome: false });
      saveFeatured(arr);
      // 重开面板以显示新条目
      panel.style.display = "block";
      renderManage();
    };
    var closeBtn = document.getElementById("fl-close");
    if (closeBtn) closeBtn.onclick = function () { panel.style.display = "none"; };
  }

  /** 打开/关闭管理面板。 */
  function toggleManage() {
    if (!global.BibGate.require()) return;
    var panel = document.getElementById("fl-manage");
    if (!panel) return;
    if (panel.style.display === "block") { panel.style.display = "none"; return; }
    panel.style.display = "block";
    renderManage();
  }

  /** 管理面板内事件委托：改名/开关/删除/移除/检索添加。 */
  function bindManage() {
    var panel = document.getElementById("fl-manage");
    if (!panel) return;
    panel.addEventListener("click", function (e) {
      var listEl = e.target.closest(".flm-list");
      if (!listEl) return;
      var lid = listEl.getAttribute("data-id");
      var arr = getFeatured().slice();
      var li = -1;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === lid) { li = i; break; }
      if (li < 0) return;
      var rm = e.target.closest(".flm-rm");
      if (rm) {
        e.stopPropagation();
        var bid = rm.parentElement.getAttribute("data-id");
        arr[li].books = (arr[li].books || []).filter(function (x) { return x !== bid; });
        saveFeatured(arr); panel.style.display = "block"; renderManage();
        return;
      }
      var dl = e.target.closest(".flm-del");
      if (dl) {
        e.stopPropagation();
        if (!confirm("确定删除书单「" + (arr[li].name || "") + "」？此操作不可撤销。")) return;
        arr.splice(li, 1);
        saveFeatured(arr); panel.style.display = "block"; renderManage();
        return;
      }
      var rb = e.target.closest(".flm-res-item");
      if (rb) {
        e.stopPropagation();
        var addId = rb.getAttribute("data-id");
        if (arr[li].books.indexOf(addId) < 0) arr[li].books.push(addId);
        saveFeatured(arr); panel.style.display = "block"; renderManage();
        return;
      }
    });
    // 改写（改名/开关）失焦即存；检索仅在结果区局部刷新，不整面板重渲染以保留焦点
    panel.addEventListener("change", function (e) {
      var listEl = e.target.closest(".flm-list");
      if (!listEl) return;
      var lid = listEl.getAttribute("data-id");
      var arr = getFeatured().slice();
      var li = -1;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === lid) { li = i; break; }
      if (li < 0) return;
      if (e.target.classList.contains("flm-name")) {
        arr[li].name = e.target.value.trim() || "未命名书单";
        global.BibPub.setFeaturedPending(arr); renderFeatured(); updatePending();
      } else if (e.target.classList.contains("flm-show")) {
        arr[li].showOnHome = e.target.checked;
        global.BibPub.setFeaturedPending(arr); renderFeatured(); updatePending();
      }
    });
    panel.addEventListener("input", function (e) {
      if (!e.target.classList.contains("flm-search")) return;
      var listEl = e.target.closest(".flm-list");
      if (!listEl) return;
      var lid = listEl.getAttribute("data-id");
      var arr = getFeatured();
      var cur = null;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === lid) { cur = arr[i]; break; }
      var have = (cur && cur.books) || [];
      var q = e.target.value.trim().toLowerCase();
      var box = listEl.querySelector(".flm-results");
      if (!box) return;
      if (!q) { box.style.display = "none"; box.innerHTML = ""; return; }
      var hits = [];
      for (var id in BOOKS) {
        if (have.indexOf(id) >= 0) continue;
        var b = BOOKS[id];
        var hay = (b.de + " " + (b.zh || "") + " " + (b.author || "") + " " + (b.vol || "")).toLowerCase();
        if (hay.indexOf(q) >= 0) hits.push(id);
        if (hits.length >= 20) break;
      }
      if (!hits.length) { box.style.display = "block"; box.innerHTML = '<div class="empty">库内无匹配图书。</div>'; return; }
      box.style.display = "block";
      box.innerHTML = hits.map(function (id) {
        var b = BOOKS[id] || {};
        return '<div class="flm-res-item" data-id="' + esc(id) + '">' + esc(b.de || id) +
          (b.zh ? ' <span class="zh">(' + esc(b.zh) + ')</span>' : '') +
          (b.author ? ' · ' + esc(b.author) : '') + '</div>';
      }).join("");
    });
  }

  // 发布
  function doPublish() {
    if (!global.BibGate.require()) return;
    var pubbtn = document.getElementById("pubbtn");
    if (pubbtn) { pubbtn.disabled = true; pubbtn.textContent = "\u23F3 发布中\u2026"; }
    global.BibPub.publishAll().then(function (r) {
      if (pubbtn) { pubbtn.disabled = false; pubbtn.textContent = "\uD83D\uDE80 发布修改"; }
      if (r.mode === "published") {
        global.BibCommon.startPublishCountdown(20, function () {
          if (global.BibPub) {
            global.BibPub.fetchPub().then(function () {
              renderCloud();
              if (currentTag) showTag(currentTag);
              updatePending();
              syncEditMode(); // 发布后按新顺序重排卡片 + 刷新标签云顺序
              renderFeatured(); // 发布后刷新推荐书单（含读者可见性）
              flash("\u2705 页面已刷新，显示最新发布状态");
            }).catch(function () {
              flash("\u26A0\uFE0F 拉取最新数据失败，请手动刷新页面");
            });
          }
        });
      } else {
        flash("已复制修改 JSON，请发到 WorkBuddy 项目对话让我代推上线");
        renderCloud();
        updatePending();
      }
    }).catch(function (e) {
      if (pubbtn) { pubbtn.disabled = false; pubbtn.textContent = "\uD83D\uDE80 发布修改"; }
      flash("发布失败：" + (e.message || e) + "（需填 GitHub 令牌，或复制发我代推）");
    });
  }

  // 加载基础数据 → 拉取覆盖层 → 渲染标签云 + 推荐书单
  Promise.all(loads)
    .then(function () { if (global.BibPub) return global.BibPub.fetchPub().then(function () {}).catch(function () {}); })
    .then(function () { renderCloud(); setupCardDrag(); syncEditMode(); renderFeatured(); bindManage(); })
    .catch(function (e) {
      document.getElementById("cloud").innerHTML = '<span class="empty">数据加载失败（请用 https 链接打开，或本地起服务器）。</span>';
      console.warn(e);
    });

  document.addEventListener("DOMContentLoaded", function () {
    global.BibCommon.setupLockButton(
      function () { renderCloud(); updatePending(); syncEditMode(); renderFeatured(); bindManage(); },
      function () { renderCloud(); updatePending(); syncEditMode(); renderFeatured(); var p = document.getElementById("fl-manage"); if (p) p.style.display = "none"; });
    global.BibCommon.setupTokenButton();
    global.BibCommon.setupPublishButton(doPublish);
  });
})(window);
