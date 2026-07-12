/* publish.js — 标签 / 译文 直发到 GitHub（无需复制粘贴）。
 * 机制：owner 在浏览器填一个仅存本机的 GitHub 令牌（fine-grained，仅该仓库 contents:write）。
 *   - 有令牌：点“发布”直接调 GitHub Contents API，把本地待发布合并进 tags.json / trans_overrides.json 并写回仓库，立刻生效。
 *   - 无令牌：降级为复制 JSON，发到 WorkBuddy 项目对话，由站长手动推。
 * 注意：令牌只在你本机浏览器 localStorage，不会发往任何第三方。
 * 兼容两套页面：书目页用 PUBLISHED/updatePend/loadJSON；首页用 PUB/renderPend/LJ。
 */
(function () {
  "use strict";
  var GH_REPO = "RealNut/prozess_shumu";
  var GH_TOKEN_KEY = "gh_token";

  // ---- 跨页面兼容的存取解析 ----
  function esc(s) {
    if (typeof window.esc === "function") return window.esc(s);
    var d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }
  function loadJSON(k) {
    if (typeof window.loadJSON === "function") return window.loadJSON(k);
    if (typeof window.LJ === "function") return window.LJ(k);
    try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; }
  }
  function saveJSON(k, v) {
    if (typeof window.saveJSON === "function") return window.saveJSON(k, v);
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function pendTagsKey() { return window.LS_PEND || "shumu_pending_v1"; }
  function locTagsKey() { return window.LS_LOCAL || "shumu_local_v1"; }
  function pendTransKey() { return window.LS_TRANS_PEND || "shumu_trans_pending_v1"; }
  function locTransKey() { return window.LS_TRANS_LOCAL || "shumu_trans_local_v1"; }
  function pubStore() { return window.PUBLISHED || window.PUB || {}; }
  function setPubStore(o) { if ("PUBLISHED" in window) window.PUBLISHED = o; if ("PUB" in window) window.PUB = o; }
  function renderPub() { if (typeof window.updatePend === "function") window.updatePend(); else if (typeof window.renderPend === "function") window.renderPend(); }
  function showHintFn(m) { if (typeof window.showHint === "function") window.showHint(m); else alert(m.replace(/<[^>]+>/g, "")); }

  function getToken() { try { return localStorage.getItem(GH_TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(GH_TOKEN_KEY, t); else localStorage.removeItem(GH_TOKEN_KEY); } catch (e) {} }
  function hasToken() { return !!getToken(); }

  function b64u(str) { return btoa(unescape(encodeURIComponent(str))); }
  function unb64u(b64) { return decodeURIComponent(escape(atob(b64))); }

  // 读取仓库当前文件内容并合并后写回。mergeFn(curObj) -> newObj
  function syncFile(path, mergeFn) {
    var tok = getToken();
    if (!tok) return Promise.reject(new Error("no-token"));
    var base = "https://api.github.com/repos/" + GH_REPO + "/contents/" + path;
    var h = { "Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json" };
    return fetch(base, { method: "GET", headers: h }).then(function (g) {
      if (!g.ok) return g.json().catch(function () { return {}; }).then(function (e) { throw new Error("读取 " + path + " 失败：" + (e.message || g.status)); });
      return g.json();
    }).then(function (cur) {
      var curObj = {};
      try { curObj = JSON.parse(unb64u(cur.content)); } catch (e) { curObj = {}; }
      var newObj = mergeFn(curObj || {});
      var body = JSON.stringify({
        message: "sync " + path + " (from browser)",
        content: b64u(JSON.stringify(newObj, null, 1)),
        sha: cur.sha,
        branch: "main"
      });
      return fetch(base, { method: "PUT", headers: h, body: body }).then(function (p) {
        if (!p.ok) return p.json().catch(function () { return {}; }).then(function (e) { throw new Error("写入 " + path + " 失败：" + (e.message || p.status)); });
        return newObj;
      });
    });
  }

  // ---- 标签直发 / 兜底 ----
  function doPublishTags() {
    var Pn = loadJSON(pendTagsKey());
    if (!Pn || !Object.keys(Pn).length) { showHintFn("没有待发布标签，无需同步。"); return; }
    if (!hasToken()) { return fallbackCopy("tags"); }
    syncFile("tags.json", function (pub) {
      for (var k in Pn) {
        var have = pub[k] || [];
        Pn[k].forEach(function (t) { if (have.indexOf(t) < 0) have.push(t); });
        pub[k] = have;
      }
      return pub;
    }).then(function (merged) {
      try { localStorage.removeItem(pendTagsKey()); localStorage.removeItem(locTagsKey()); } catch (e) {}
      setPubStore(merged); renderPub();
      if (typeof window.renderAll === "function") window.renderAll();
      showHintFn("✅ 标签已直接同步到网站！刷新任意页面即可见，无需手动推送。");
    }).catch(function (e) {
      showHintFn("❌ 直发失败：" + (e.message || e) + "。可改用下方“复制”发到 WorkBuddy 项目让我代推。");
    });
  }

  // ---- 译文直发 / 兜底 ----
  function doPublishTrans() {
    var Pn = loadJSON(pendTransKey());
    if (!Pn || !Object.keys(Pn).length) { showHintFn("没有待发布译文，无需同步。"); return; }
    if (!hasToken()) { return fallbackCopy("trans"); }
    syncFile("trans_overrides.json", function (pub) {
      for (var k in Pn) pub[k] = Pn[k];
      return pub;
    }).then(function (merged) {
      try { localStorage.removeItem(pendTransKey()); localStorage.removeItem(locTransKey()); } catch (e) {}
      if ("PUB_TRANS" in window) window.PUB_TRANS = merged;
      if (typeof window.applyTrans === "function") window.applyTrans();
      if (typeof window.updatePendTrans === "function") window.updatePendTrans();
      if (typeof window.renderAll === "function") window.renderAll();
      showHintFn("✅ 译文已直接同步到网站！刷新任意页面即可见，无需手动推送。");
    }).catch(function (e) {
      showHintFn("❌ 直发失败：" + (e.message || e) + "。可改用下方“复制”发到 WorkBuddy 项目让我代推。");
    });
  }

  function fallbackCopy(kind) {
    var ta = document.getElementById(kind === "tags" ? "pendjson" : "pendtransjson");
    if (!ta) return;
    var obj = loadJSON(kind === "tags" ? pendTagsKey() : pendTransKey());
    ta.value = JSON.stringify(obj, null, 1);
    ta.select();
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
    showHintFn("✅ 已复制待发布" + (kind === "tags" ? "标签" : "译文") + "到剪贴板。把它发到 <b>WorkBuddy 项目对话</b>，我就会写入仓库并重新推送，让所有人看到。");
  }

  // ---- 标签全局重命名 / 删除（首页标签云用，作用到所有书） ----
  function applyGlobalTag(mergeFn, okMsg) {
    if (hasToken()) {
      syncFile("tags.json", mergeFn).then(function (merged) {
        if (typeof window.applyPublishedTags === "function") window.applyPublishedTags(merged);
        else { setPubStore(merged); if (typeof window.renderCloud === "function") window.renderCloud(); }
        showHintFn(okMsg + " 已直接同步到网站，刷新任意页面即见。");
      }).catch(function (e) {
        showHintFn("❌ 直发失败：" + (e.message || e) + "。可改用复制模式发到 WorkBuddy 项目让我代推。");
      });
    } else {
      fetch("tags.json?_=" + Date.now()).then(function (r) { return r.json(); }).then(function (cur) {
        var newObj = mergeFn(cur || {});
        // 无令牌：先在本地刷新标签云，让用户立刻看到改动（网站尚未真正变更）
        if (typeof window.applyPublishedTags === "function") window.applyPublishedTags(newObj);
        else if (typeof window.renderCloud === "function") window.renderCloud();
        var text = JSON.stringify(newObj, null, 1);
        if (navigator.clipboard) navigator.clipboard.writeText(text);
        var ta = document.getElementById("pendjson");
        if (ta) { ta.value = text; ta.select(); }
        showHintFn("⚠️ 未填 GitHub 令牌，<b>本地标签云已更新但不代表网站已改</b>。已复制<b>完整 tags.json</b>到剪贴板，请发到 <b>WorkBuddy 项目对话</b>，我替换后重新推送，所有访客才看得到。" + okMsg);
      }).catch(function (e) { showHintFn("❌ 读取 tags.json 失败：" + (e.message || e)); });
    }
  }
  function publishTagRename(oldT, newT) {
    oldT = (oldT || "").trim(); newT = (newT || "").trim();
    if (!oldT || !newT || oldT === newT) return;
    applyGlobalTag(function (pub) {
      Object.keys(pub).forEach(function (id) {
        var arr = pub[id] || [], out = [];
        arr.forEach(function (t) { var nt = (t === oldT) ? newT : t; if (out.indexOf(nt) < 0) out.push(nt); });
        if (out.length) pub[id] = out; else delete pub[id];
      });
      return pub;
    }, "✅ 标签「" + oldT + "」已全局重命名为「" + newT + "」。");
  }
  function publishTagRemove(t) {
    t = (t || "").trim(); if (!t) return;
    applyGlobalTag(function (pub) {
      Object.keys(pub).forEach(function (id) {
        var arr = (pub[id] || []).filter(function (x) { return x !== t; });
        if (arr.length) pub[id] = arr; else delete pub[id];
      });
      return pub;
    }, "🗑 标签「" + t + "」已全局删除。");
  }
  window.publishTagRename = publishTagRename;
  window.publishTagRemove = publishTagRemove;

  // ---- 令牌 UI（仅 owner 区可见） ----
  function renderTokenUI() {
    var wrap = document.getElementById("tokenWrap");
    if (!wrap) return;
    var tok = getToken();
    wrap.innerHTML =
      'GitHub 令牌（仅存本机，用于一键直发）：' +
      '<input id="tok" type="password" size="22" placeholder="fine-grained 令牌" value="' + esc(tok) + '">' +
      ' <button id="toks">保存</button> <span class="tstate">' +
      (tok ? "✅ 已保存" : "") + '</span>' +
      ' <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener" style="color:#57606a">如何生成？</a>';
    var btn = document.getElementById("toks");
    if (btn) btn.onclick = function () {
      var v = document.getElementById("tok").value.trim();
      setToken(v);
      wrap.querySelector(".tstate").textContent = v ? "✅ 已保存（仅存本机）" : "已清除";
      showHintFn(v ? "✅ 令牌已保存。现在点“发布”会直接同步到网站。" : "令牌已清除，发布将回到复制模式。");
    };
  }

  window.doPublishTags = doPublishTags;
  window.doPublishTrans = doPublishTrans;
  window.renderTokenUI = renderTokenUI;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderTokenUI);
  } else {
    renderTokenUI();
  }
})();
