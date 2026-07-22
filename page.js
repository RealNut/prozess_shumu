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

  /** 聚合已有标签词表：基础全部标签 + 网页覆盖层（pending）新增标签。 */
  function buildVocab() {
    var seen = {};
    (window.BIB_ALL_TAGS || []).forEach(function (t) { if (t) seen[t] = 1; });
    if (global.BibPub) {
      var lt = global.BibPub.getLocal(global.BibPub.LS.tags);
      for (var k in lt) (lt[k] || []).forEach(function (t) { if (t) seen[t] = 1; });
    }
    return Object.keys(seen);
  }

  /* ---------- 搜索（结果面板 + 仅扫描关键列） ---------- */
  function rowText(tr) {
    // 仅取关键单元格文本，避免 innerText 触发布局重排（384 行表尤明显）
    return [".vol", ".au", ".de", ".zh", ".yr", ".tags"].map(function (sel) {
      var el = tr.querySelector(sel); return el ? el.textContent : "";
    }).join(" ").toLowerCase();
  }
  /** 把表格内某行定位到可视区中央并高亮（供结果面板点击调用）。 */
  function locateInTable(id) {
    var tr = null, rows = document.querySelectorAll("tr[data-id]");
    for (var i = 0; i < rows.length; i++) { if (rows[i].getAttribute("data-id") === id) { tr = rows[i]; break; } }
    if (!tr) return;
    tr.scrollIntoView({ block: "center" });
    tr.classList.add("cell-saved");
    setTimeout(function () { tr.classList.remove("cell-saved"); }, 800);
  }
  function doSearch() {
    var q = document.getElementById("q").value.trim().toLowerCase();
    var resBox = document.getElementById("results");
    var c = document.getElementById("cnt");
    var all = document.querySelectorAll("tr[data-id]");
    if (!q) {                       // 无查询：隐藏结果面板，计数显示全部
      resBox.hidden = true; resBox.innerHTML = "";
      if (c) c.textContent = all.length;
      return;
    }
    // 表格始终保持完整（不被过滤），结果面板单独承载命中项，二者独立滚动。
    var matches = [];
    all.forEach(function (tr) { if (rowText(tr).indexOf(q) >= 0) matches.push(tr); });
    var html = '<div class="rhead">🔍 找到 ' + matches.length + ' 条结果（点击定位到表格）</div>' + matches.map(function (tr) {
      var vol = tr.querySelector(".vol").textContent;
      var au = tr.querySelector(".au").textContent;
      var de = tr.querySelector(".de").textContent;
      var zhEl = tr.querySelector(".zhtext");
      var zh = zhEl ? zhEl.textContent : "";
      return '<div class="ritem" data-id="' + esc(tr.getAttribute("data-id")) + '">' +
        '<span class="rvol">' + esc(vol) + '</span>' + esc(au) + ' · ' + esc(de) +
        (zh ? ' <span class="rzh">(' + esc(zh) + ')</span>' : '') + '</div>';
    }).join("");
    resBox.innerHTML = html;
    resBox.hidden = false;
    resBox.scrollTop = 0;
    if (c) c.textContent = matches.length;
  }
  function debounce(fn, ms) {
    var h;
    return function () {
      var ctx = this, a = arguments;
      clearTimeout(h);
      h = setTimeout(function () { fn.apply(ctx, a); }, ms);
    };
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
    var civ = tc.querySelector(".civilbtn");   // 保留民事诉讼标注按钮，避免被 innerHTML 重建冲掉
    var id = tr.getAttribute("data-id");
    var pendingTags = hasPendingTags(id);
    // 每个标签 chip 内嵌「✎」编辑和「×」删除按钮（仅 owner 解锁后可见）。
    tc.innerHTML = dispTags(tr).map(function (t) {
      return '<span class="tag' + (pendingTags ? ' tag-pending' : '') + '" data-t="' + esc(t) + '"><span class="tname">' + esc(t) + '</span>' +
        '<button class="tagedit owner-only" type="button" title="修改该标签">\u270E</button>' +
        '<button class="tagdel owner-only" type="button" title="删除该标签">\u00D7</button></span>';
    }).join("") + " ";
    if (ed) tc.appendChild(ed);
    if (civ) tc.appendChild(civ);       // 重建后把 🟢 标注按钮加回（保持其 owner-only / .on 状态）
  }
  function renderAll() { document.querySelectorAll("tr[data-id]").forEach(renderRow); highlightPending(); applyHighlights(); }

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
      restore(); renderRow(tr); highlightPending(); updatePending();
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

  /* ---------- 标签弹层编辑器（增/删/改 + 相似标签建议） ---------- */
  var tagEditor = null;
  function openTagEditor(tr) {
    if (!global.BibGate.require()) return;
    closeTagEditor();
    var id = tr.getAttribute("data-id");
    var VOCAB = buildVocab();
    var box = document.createElement("div"); box.className = "tageditor";
    box.innerHTML =
      '<div class="te-title">标签（<span class="te-count">0</span>）</div>' +
      '<div class="te-list"></div>' +
      '<div class="te-add"><input id="te-in" placeholder="输入标签后回车添加"><button type="button" id="te-addbtn">添加</button></div>' +
      '<div class="te-sug" id="te-sug"></div>';
    document.body.appendChild(box);
    tagEditor = box;

    var listEl = box.querySelector(".te-list");
    var inputEl = box.querySelector("#te-in");
    var sugEl = box.querySelector("#te-sug");
    var curArr = [];   // 当前显示标签（供删除/改名闭包引用）

    /** 渲染相似已有标签建议（随输入 / 已有标签变化刷新）。 */
    function renderSug() {
      var sug = global.BibCommon.suggestTags(inputEl.value, VOCAB, { limit: 6, exclude: curArr });
      if (!sug.length) { sugEl.style.display = "none"; sugEl.innerHTML = ""; return; }
      sugEl.style.display = "block";
      sugEl.innerHTML = '<div class="te-sug-hint">相似已有标签：</div>' + sug.map(function (s) {
        return '<button type="button" class="te-sug-item" data-v="' + esc(s.tag) + '">' + esc(s.tag) + '</button>';
      }).join("");
      sugEl.querySelectorAll(".te-sug-item").forEach(function (b) {
        b.onclick = function () { add(b.getAttribute("data-v")); inputEl.focus(); };
      });
    }

    function draw() {
      curArr = dispTags(tr);
      listEl.innerHTML = curArr.map(function (t, i) {
        return '<span class="te-chip" data-i="' + i + '"><span class="te-name">' + esc(t) + '</span><button type="button" class="te-x">×</button></span>';
      }).join("");
      box.querySelector(".te-count").textContent = curArr.length;
      bindChips();
      renderSug();   // 已有标签变化 → 重新计算建议
    }

    function bindChips() {
      listEl.querySelectorAll(".te-x").forEach(function (b) {
        b.onclick = function () {
          var i = +b.parentElement.getAttribute("data-i");
          curArr.splice(i, 1);
          global.BibPub.setTagPending(id, curArr);
          draw(); renderRow(tr); updatePending();
        };
      });
      listEl.querySelectorAll(".te-name").forEach(function (nm) {
        nm.onclick = function (e) {
          e.stopPropagation();
          var chip = nm.parentElement;
          if (chip._editing) return;
          chip._editing = true;
          var i = +chip.getAttribute("data-i");
          var oldVal = curArr[i];
          var inp = document.createElement("input");
          inp.type = "text"; inp.value = oldVal;
          inp.className = "te-edit-inp";
          inp.style.width = Math.max(60, Math.min(120, oldVal.length * 14)) + "px";
          var sv = document.createElement("button"); sv.textContent = "✓"; sv.className = "te-edit-save";
          var cc = document.createElement("button"); cc.textContent = "✕"; cc.className = "te-edit-cancel";
          nm.replaceWith(inp);
          chip.insertBefore(sv, chip.querySelector(".te-x"));
          chip.insertBefore(cc, chip.querySelector(".te-x"));
          inp.focus(); inp.select();
          function done(ok) {
            var nv = inp.value.trim();
            if (ok && nv && nv !== oldVal) {
              curArr[i] = nv;
              global.BibPub.setTagPending(id, curArr);
              flash("✓ 标签「" + oldVal + "」已改为「" + nv + "」（待发布）");
            }
            chip._editing = false;
            draw(); renderRow(tr); updatePending();
          }
          sv.onclick = function () { done(true); };
          cc.onclick = function () { done(false); };
          inp.onkeydown = function (ev) { if (ev.key === "Enter") done(true); if (ev.key === "Escape") done(false); };
        };
      });
    }

    function add(val) {
      var v = (val !== undefined ? val : inputEl.value).trim();
      if (!v) return;
      var arr = dispTags(tr);
      if (arr.indexOf(v) < 0) arr.push(v);
      global.BibPub.setTagPending(id, arr);
      inputEl.value = "";
      draw(); renderRow(tr); flash("✓ 标签已保存（待发布）"); updatePending();
    }

    box.querySelector("#te-addbtn").onclick = function () { add(); };
    inputEl.onkeydown = function (e) {
      if (e.key === "Enter") { add(); }
      else if (e.key === "Escape") {
        var sug = global.BibCommon.suggestTags(inputEl.value, VOCAB, { limit: 6, exclude: curArr });
        if (sug.length && sugEl.style.display !== "none") add(sug[0].tag);  // Esc 采纳首项建议
        else closeTagEditor();
      }
    };
    inputEl.oninput = renderSug;
    draw();
  }
  function closeTagEditor() { if (tagEditor) { tagEditor.remove(); tagEditor = null; } }

  /* ---------- 事件委托 ---------- */
  document.addEventListener("click", function (e) {
    // 行内 🟢 民事诉讼标记开关（优先于其它行内控件）
    var civ = e.target.closest(".civilbtn");
    if (civ) { e.stopPropagation(); toggleCivil(civ.closest("tr")); return; }
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
      doSearch();
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
    return (id in lt) || (id in ltr) || (id in ly) || hasPendingHL(id);
  }
  function hasPendingHL(id) {
    if (!global.BibPub) return false;
    var lh = global.BibPub.getLocal(global.BibPub.LS.hl);
    return (id in lh) && lh[id] && lh[id].length;
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

  /* ---------- 民事诉讼高亮（独立标记，与标签解耦） ---------- */
  /** 给带 civil 标记的行/搜索结果项上浅绿底，并同步行内标注按钮的按下态。
   *  读取覆盖层(mergedHighlights)，故读者模式(已发布)下同样可见。 */
  function applyHighlights() {
    if (!global.BibPub) return;
    document.querySelectorAll("tr[data-id]").forEach(function (tr) {
      var id = tr.getAttribute("data-id");
      var hl = global.BibPub.mergedHighlights(id);
      var on = !!(hl && hl.indexOf("civil") >= 0);
      tr.classList.toggle("hl-civil", on);
      var btn = tr.querySelector(".civilbtn");
      if (btn) btn.classList.toggle("on", on);
    });
    document.querySelectorAll("#results .ritem[data-id]").forEach(function (el) {
      var id = el.getAttribute("data-id");
      var hl = global.BibPub.mergedHighlights(id);
      el.classList.toggle("hl-civil", !!(hl && hl.indexOf("civil") >= 0));
    });
  }

  /** 切换某书的民事诉讼标记（写入 pending，不立即发布）。 */
  function toggleCivil(tr) {
    if (!global.BibGate.require()) return;
    var id = tr.getAttribute("data-id");
    var cur = global.BibPub.mergedHighlights(id) || [];
    var has = cur.indexOf("civil") >= 0;
    var next = has ? cur.filter(function (x) { return x !== "civil"; }) : cur.concat(["civil"]);
    global.BibPub.setHighlightPending(id, next);
    applyHighlights(); updatePending();
    flash(has ? "已取消民事诉讼相关标记（待发布）" : "✓ 已标记为民事诉讼相关（待发布）");
  }

  /* ---------- 待发布计数 ---------- */
  function updatePending() {
    var n = 0;
    if (global.BibPub) {
      var t = global.BibPub.getLocal(global.BibPub.LS.tags);
      var r = global.BibPub.getLocal(global.BibPub.LS.trans);
      var y = global.BibPub.getLocal(global.BibPub.LS.year);
      var h = global.BibPub.getLocal(global.BibPub.LS.hl);
      for (var k in t) if (t[k] && t[k].length) n++;
      for (var k in r) if (r[k]) n++;
      for (var k in y) if (y[k]) n++;
      for (var k in h) if (h[k] && h[k].length) n++;
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
    document.getElementById("q").addEventListener("input", debounce(doSearch, 200));
    document.getElementById("results").addEventListener("click", function (e) {
      var item = e.target.closest(".ritem");
      if (item) locateInTable(item.getAttribute("data-id"));
    });
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
