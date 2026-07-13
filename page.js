/**
 * 丛书页前端逻辑（从 gen_pages.py 内联 JS 外置，架构评审 P0-1）。
 *
 * 职责：搜索 / 合并渲染 / 译名·年份编辑 / 标签编辑（弹层 + 行内 × 删除）/
 *      待发布计数 / 发布。共享工具（flash/工具栏/解锁回调）见 common.js。
 *
 * 依赖加载顺序：config.js → gate.js → publish.js → common.js → 本文件。
 */
(function (global) {
  "use strict";
  var flash = global.BibCommon.flash;

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ---------- 搜索 ---------- */
  function doSearch() {
    var q = document.getElementById("q").value.trim().toLowerCase();
    var n = 0;
    document.querySelectorAll("tr[data-id]").forEach(function (tr) {
      var ok = !q || tr.innerText.toLowerCase().includes(q);
      tr.style.display = ok ? "" : "none";
      if (ok) n++;
    });
    var c = document.getElementById("cnt");
    if (c) c.textContent = n;
  }

  /* ---------- 合并渲染 ---------- */
  function baseTags(tr) { try { return JSON.parse(tr.getAttribute("data-basetags") || "[]"); } catch (e) { return []; } }
  function dispZh(tr) { var id = tr.getAttribute("data-id"); var m = global.BibPub.mergedTrans(id); return m !== null ? m : tr.getAttribute("data-basezh"); }
  function dispYear(tr) { var id = tr.getAttribute("data-id"); var m = global.BibPub.mergedYear(id); return m !== null ? m : tr.getAttribute("data-baseyear"); }
  function dispTags(tr) { var id = tr.getAttribute("data-id"); var m = global.BibPub.mergedTags(id); return m !== null ? m : baseTags(tr); }

  function renderRow(tr) {
    /* 防御：编辑中的行（editText 已把 .zhtext/.yrtext 替换为 input）跳过，
       等 cancel/save 回调自行 renderRow(tr) 即可。 */
    var zh = tr.querySelector(".zhtext"); if (zh) zh.textContent = dispZh(tr);
    var yr = tr.querySelector(".yrtext"); if (yr) yr.textContent = dispYear(tr);
    var tc = tr.querySelector(".tags"); if (!tc) return;
    var ed = tc.querySelector(".edittags");
    var id = tr.getAttribute("data-id");
    var pendingTags = hasPendingTags(id);
    // 每个标签 chip 内嵌「✎」编辑和「×」删除按钮（仅 owner 解锁后可见）。
    tc.innerHTML = dispTags(tr).map(function (t) {
      return '<span class="tag' + (pendingTags ? ' tag-pending' : '') + '" data-t="' + esc(t) + '"><span class="tname">' + esc(t) + '</span>' +
        '<button class="tagedit owner-only" type="button" title="修改该标签">\u270E</button>' +
        '<button class="tagdel owner-only" type="button" title="删除该标签">\u00D7</button></span>';
    }).join("") + " ";
    if (ed) tc.appendChild(ed);
  }
  function renderAll() { document.querySelectorAll("tr[data-id]").forEach(renderRow); highlightPending(); }

  /* ---------- 编辑：译名 / 年份 ---------- */
  function editText(tr, sel, getter, setter) {
    if (!global.BibGate.require()) return;
    var cell = tr.querySelector(sel); var span = cell.querySelector("span");
    var cur = getter(tr);
    // 窄列（如年份 66px）编辑时临时加宽并禁止换行，确保 ✓/✕ 按钮可见
    cell.style.width = "auto"; cell.style.whiteSpace = "nowrap";
    var inp = document.createElement("input"); inp.type = "text"; inp.value = cur; inp.className = "cellinput"; inp.style.width = "120px";
    var save = document.createElement("button"); save.textContent = "✓"; save.className = "cellsave";
    var cancel = document.createElement("button"); cancel.textContent = "✕"; cancel.className = "cellcancel";
    cell.innerHTML = ""; cell.append(inp, save, cancel); inp.focus();
    function restore() { cell.style.width = ""; cell.style.whiteSpace = ""; }
    function done(ok) {
      if (ok) { setter(tr.getAttribute("data-id"), inp.value); cell.classList.add("cell-saved"); flash("✓ 已保存（待发布）"); }
      restore(); renderRow(tr); renderAll(); updatePending();
      if (ok) setTimeout(function () { cell.classList.remove("cell-saved"); }, 800);
    }
    save.onclick = function () { done(true); };
    cancel.onclick = function () { done(false); };
    inp.onkeydown = function (e) { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
  }

  /* ---------- 行内删除标签（新功能） ---------- */
  function removeRowTag(tr, tag) {
    if (!global.BibGate.require()) return;
    var id = tr.getAttribute("data-id");
    var arr = dispTags(tr).slice();   // slice 避免改动覆盖层缓存
    var i = arr.indexOf(tag);
    if (i < 0) return;
    arr.splice(i, 1);
    global.BibPub.setTagPending(id, arr);
    renderRow(tr); updatePending();
    flash("✓ 已删除标签「" + tag + "」（待发布）");
  }

  /* ---------- 行内修改标签（新功能） ---------- */
  function editRowTag(tagEl, tr) {
    if (!global.BibGate.require()) return;
    var oldTag = tagEl.getAttribute("data-t");
    var tname = tagEl.querySelector(".tname");
    var edBtn = tagEl.querySelector(".tagedit");
    var delBtn = tagEl.querySelector(".tagdel");
    if (!tname || tagEl._editing) return;
    tagEl._editing = true;
    var inp = document.createElement("input");
    inp.type = "text"; inp.value = oldTag;
    inp.className = "tag-edit-inp";
    inp.style.width = Math.max(60, Math.min(120, oldTag.length * 14)) + "px";
    var save = document.createElement("button");
    save.textContent = "✓"; save.className = "tag-edit-save owner-only";
    var cancel = document.createElement("button");
    cancel.textContent = "✕"; cancel.className = "tag-edit-cancel owner-only";
    tname.replaceWith(inp);
    if (edBtn) edBtn.style.display = "none";
    if (delBtn) delBtn.style.display = "none";
    tagEl.appendChild(save);
    tagEl.appendChild(cancel);
    inp.focus(); inp.select();
    function done(ok) {
      var newTag = inp.value.trim();
      if (ok && newTag && newTag !== oldTag) {
        var id = tr.getAttribute("data-id");
        var arr = dispTags(tr).slice();
        var i = arr.indexOf(oldTag);
        if (i >= 0) { arr[i] = newTag; }
        global.BibPub.setTagPending(id, arr);
        flash("✓ 标签「" + oldTag + "」已改为「" + newTag + "」（待发布）");
      }
      tagEl._editing = false;
      renderRow(tr); updatePending();
    }
    save.onclick = function () { done(true); };
    cancel.onclick = function () { done(false); };
    inp.onkeydown = function (e) {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    };
  }

  /* ---------- 标签弹层编辑器（增/删/改） ---------- */
  var tagEditor = null;
  function openTagEditor(tr) {
    if (!global.BibGate.require()) return;
    closeTagEditor();
    var id = tr.getAttribute("data-id");
    var box = document.createElement("div"); box.className = "tageditor";
    function draw() {
      var arr = dispTags(tr);
      box.innerHTML = '<div class="te-title">标签（' + arr.length + '）</div>' +
        arr.map(function (t, i) { return '<span class="te-chip" data-i="' + i + '"><span class="te-name">' + esc(t) + '</span><button type="button" class="te-x">×</button></span>'; }).join("") +
        '<div class="te-add"><input id="te-in" placeholder="输入标签后回车添加"><button type="button" id="te-addbtn">添加</button></div>';
      // × 删除按钮
      box.querySelectorAll(".te-x").forEach(function (b) {
        b.onclick = function () { var i = +b.parentElement.getAttribute("data-i"); arr.splice(i, 1); global.BibPub.setTagPending(id, arr); draw(); renderRow(tr); updatePending(); };
      });
      // 点击标签文字 → 内联编辑
      box.querySelectorAll(".te-name").forEach(function (nm) {
        nm.onclick = function (e) {
          e.stopPropagation();
          var chip = nm.parentElement;
          if (chip._editing) return;
          chip._editing = true;
          var i = +chip.getAttribute("data-i");
          var oldVal = arr[i];
          var inp = document.createElement("input");
          inp.type = "text"; inp.value = oldVal;
          inp.className = "te-edit-inp";
          inp.style.width = Math.max(60, Math.min(120, oldVal.length * 14)) + "px";
          var sv = document.createElement("button");
          sv.textContent = "✓"; sv.className = "te-edit-save";
          var cc = document.createElement("button");
          cc.textContent = "✕"; cc.className = "te-edit-cancel";
          nm.replaceWith(inp);
          chip.insertBefore(sv, chip.querySelector(".te-x"));
          chip.insertBefore(cc, chip.querySelector(".te-x"));
          inp.focus(); inp.select();
          function done(ok) {
            var nv = inp.value.trim();
            if (ok && nv && nv !== oldVal) {
              arr[i] = nv;
              global.BibPub.setTagPending(id, arr);
              flash("✓ 标签「" + oldVal + "」已改为「" + nv + "」（待发布）");
            }
            chip._editing = false;
            draw(); renderRow(tr); updatePending();
          }
          sv.onclick = function () { done(true); };
          cc.onclick = function () { done(false); };
          inp.onkeydown = function (ev) {
            if (ev.key === "Enter") done(true);
            if (ev.key === "Escape") done(false);
          };
        };
      });
      var add = function () {
        var v = box.querySelector("#te-in").value.trim();
        if (!v) return;
        if (arr.indexOf(v) < 0) arr.push(v);
        global.BibPub.setTagPending(id, arr);
        box.querySelector("#te-in").value = "";
        draw(); renderRow(tr); flash("✓ 标签已保存（待发布）"); updatePending();
      };
      box.querySelector("#te-addbtn").onclick = add;
      box.querySelector("#te-in").onkeydown = function (e) { if (e.key === "Enter") add(); };
    }
    draw();
    document.body.appendChild(box);
    tagEditor = box;
  }
  function closeTagEditor() { if (tagEditor) { tagEditor.remove(); tagEditor = null; } }

  /* ---------- 事件委托 ---------- */
  document.addEventListener("click", function (e) {
    // 行内 ✎ 修改标签（优先于删除和搜索）
    var ed = e.target.closest(".tagedit");
    if (ed) { e.stopPropagation(); editRowTag(ed.closest(".tag"), ed.closest("tr")); return; }
    // 行内 × 删标签（优先于点击标签搜索）
    var del = e.target.closest(".tagdel");
    if (del) { e.stopPropagation(); removeRowTag(del.closest("tr"), del.closest(".tag").getAttribute("data-t")); return; }
    // 点击标签 → 搜索
    var tg = e.target.closest(".tag");
    if (tg) {
      document.getElementById("q").value = tg.getAttribute("data-t");
      doSearch(); window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // 编辑按钮
    var z = e.target.closest(".editzh"); if (z) { editText(z.closest("tr"), ".zh", dispZh, function (id, v) { global.BibPub.setTransPending(id, v); }); return; }
    var y = e.target.closest(".edityr"); if (y) { editText(y.closest("tr"), ".yr", dispYear, function (id, v) { global.BibPub.setYearPending(id, v); }); return; }
    var t = e.target.closest(".edittags"); if (t) { openTagEditor(t.closest("tr")); return; }
  });
  document.addEventListener("click", function (e) {
    if (tagEditor && !e.target.closest(".tageditor") && !e.target.closest(".edittags")) closeTagEditor();
  });

  /* ---------- 待发布视觉反馈 ---------- */
  function hasPending(id) {
    if (!global.BibPub) return false;
    var lt = global.BibPub.getLocal(global.BibPub.LS.tags);
    var ltr = global.BibPub.getLocal(global.BibPub.LS.trans);
    var ly = global.BibPub.getLocal(global.BibPub.LS.year);
    return (id in lt) || (id in ltr) || (id in ly);
  }
  function hasPendingTags(id) {
    if (!global.BibPub) return false;
    var lt = global.BibPub.getLocal(global.BibPub.LS.tags);
    return (id in lt) && lt[id] && lt[id].length;
  }
  /** 为所有有待发布修改的行添加高亮样式 */
  function highlightPending() {
    document.querySelectorAll("tr[data-id]").forEach(function (tr) {
      var id = tr.getAttribute("data-id");
      if (hasPending(id)) {
        tr.classList.add("row-pending");
      } else {
        tr.classList.remove("row-pending");
      }
    });
  }

  /* ---------- 待发布计数 ---------- */
  function updatePending() {
    var n = 0;
    if (global.BibPub) {
      var t = global.BibPub.getLocal(global.BibPub.LS.tags);
      var r = global.BibPub.getLocal(global.BibPub.LS.trans);
      var y = global.BibPub.getLocal(global.BibPub.LS.year);
      for (var k in t) if (t[k] && t[k].length) n++;
      for (var k in r) if (r[k]) n++;
      for (var k in y) if (y[k]) n++;
    }
    var b = document.getElementById("pending-badge");
    if (!b) return;
    if (n > 0) { b.textContent = "\uD83D\uDFE2 待发布 " + n + " 项"; b.className = "pending-badge owner-only show"; }
    else { b.textContent = ""; b.className = "pending-badge owner-only"; }
    highlightPending();
  }

  /* ---------- 发布 ---------- */
  function doPublish() {
    if (!global.BibGate.require()) return;
    var pubbtn = document.getElementById("pubbtn");
    if (pubbtn) { pubbtn.disabled = true; pubbtn.textContent = "\u23F3 发布中\u2026"; }
    global.BibPub.publishAll().then(function (r) {
      if (pubbtn) { pubbtn.disabled = false; pubbtn.textContent = "\uD83D\uDE80 发布修改"; }
      if (r.mode === "published") {
        // 发布成功 → 倒计时，等 Pages 构建后自动刷新
        global.BibCommon.startPublishCountdown(20, function () {
          if (global.BibPub) {
            global.BibPub.fetchPub().then(function () {
              renderAll(); updatePending();
              flash("\u2705 页面已刷新，显示最新发布状态");
            }).catch(function () {
              flash("\u26A0\uFE0F 拉取最新数据失败，请手动刷新页面");
            });
          }
        });
      } else {
        flash("已复制修改 JSON，请发到 WorkBuddy 项目对话让我代推上线");
        renderAll(); updatePending();
      }
    }).catch(function (e) {
      if (pubbtn) { pubbtn.disabled = false; pubbtn.textContent = "\uD83D\uDE80 发布修改"; }
      flash("发布失败：" + (e.message || e) + "（需填 GitHub 令牌，或复制发我代推）");
    });
  }

  /* ---------- 初始化 ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("q").addEventListener("input", doSearch);
    global.BibCommon.setupLockButton(
      function () { renderAll(); updatePending(); },   // onUnlock
      function () { renderAll(); }                      // onLock
    );
    global.BibCommon.setupTokenButton();
    global.BibCommon.setupPublishButton(doPublish);
    // 拉取已发布覆盖层并合并渲染
    if (global.BibPub) {
      global.BibPub.fetchPub().then(function () { renderAll(); updatePending(); })
                           .catch(function () { renderAll(); updatePending(); });
    }
    doSearch();
    updatePending();
  });
})(window);
