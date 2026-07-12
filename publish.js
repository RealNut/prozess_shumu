// 发布与 GitHub 直写（覆盖层数据文件）。依赖 window.BIB_CONFIG。
// 设计要点（数据/代码分离）：
//  - 覆盖层文件 tags.json / trans_overrides.json / year_overrides.json 是"用户数据"，
//    由本脚本经 GitHub Contents API 直接读写，deploy.py 永不推送它们 → 代码部署不覆盖网页修改。
//  - 显示值 = 本地待发布(pending) 优先，其次已发布覆盖层(PUB)，再次基础 JSON 默认值。
(function () {
  var CFG = window.BIB_CONFIG || { REPO: "RealNut/prozess_shumu", BRANCH: "main" };
  var TOKEN_KEY = "gh_token_v2";
  var LS_TAGS = "shumu_tags_v2", LS_TRANS = "shumu_trans_v2", LS_YEAR = "shumu_year_v2";

  function getLocal(k) { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } }
  function setLocal(k, o) { localStorage.setItem(k, JSON.stringify(o)); }

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

  // 已发布覆盖层（从仓库拉取）
  var PUB = { tags: {}, trans: {}, year: {} };
  function getJson(path) {
    return fetch(path + "?_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }
  function fetchPub() {
    return Promise.all([getJson("tags.json"), getJson("trans_overrides.json"), getJson("year_overrides.json")])
      .then(function (a) { PUB.tags = a[0] || {}; PUB.trans = a[1] || {}; PUB.year = a[2] || {}; });
  }

  // 合并：本地 pending 优先
  function mergedTags(id) { var lt = getLocal(LS_TAGS); if (id in lt) return lt[id]; if (id in PUB.tags) return PUB.tags[id]; return null; }
  function mergedTrans(id) { var lt = getLocal(LS_TRANS); if (id in lt) return lt[id]; if (id in PUB.trans) return PUB.trans[id]; return null; }
  function mergedYear(id) { var lt = getLocal(LS_YEAR); if (id in lt) return lt[id]; if (id in PUB.year) return PUB.year[id]; return null; }

  function setTagPending(id, arr) { var lt = getLocal(LS_TAGS); if (arr && arr.length) lt[id] = arr; else delete lt[id]; setLocal(LS_TAGS, lt); }
  function setTransPending(id, zh) { var lt = getLocal(LS_TRANS); zh = (zh || "").trim(); if (zh) lt[id] = zh; else delete lt[id]; setLocal(LS_TRANS, lt); }
  function setYearPending(id, y) { var lt = getLocal(LS_YEAR); y = String(y || "").trim(); if (y) lt[id] = y; else delete lt[id]; setLocal(LS_YEAR, lt); }

  function b64(obj) {
    // UTF-8 安全的 base64
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }

  // GitHub Contents API 直写（GET sha + PUT 合并）
  function ghPut(path, obj) {
    var token = getToken();
    if (!token) return Promise.reject(new Error("no-token"));
    var url = "https://api.github.com/repos/" + CFG.REPO + "/contents/" + path + "?ref=" + CFG.BRANCH;
    return fetch(url, { cache: "no-store", headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var body = { message: "Update " + path + " via web editor", content: b64(obj), branch: CFG.BRANCH };
        if (j && j.sha) body.sha = j.sha;
        return fetch(url, {
          method: "PUT", cache: "no-store",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
          body: JSON.stringify(body)
        });
      })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error("put-failed:" + r.status + " " + t); }); return true; });
  }

  function copy(t) { if (navigator.clipboard) navigator.clipboard.writeText(t); }

  // 发布全部本地 pending：合并进仓库覆盖层
  function publishAll() {
    var token = getToken();
    var lt = getLocal(LS_TAGS), ltr = getLocal(LS_TRANS), ly = getLocal(LS_YEAR);
    var tags = Object.assign({}, PUB.tags, lt);
    var trans = Object.assign({}, PUB.trans, ltr);
    var year = Object.assign({}, PUB.year, ly);
    if (token) {
      return ghPut("tags.json", tags)
        .then(function () { return ghPut("trans_overrides.json", trans); })
        .then(function () { return ghPut("year_overrides.json", year); })
        .then(function () {
          setLocal(LS_TAGS, {}); setLocal(LS_TRANS, {}); setLocal(LS_YEAR, {});
          PUB = { tags: tags, trans: trans, year: year };
          return { ok: true, mode: "published" };
        });
    }
    copy(JSON.stringify({ tags: tags, trans: trans, year: year }, null, 2));
    return Promise.resolve({ ok: true, mode: "copied" });
  }

  // 全局标签操作（删除 / 重命名）。displayedMap: {id: 当前显示标签数组}
  function globalTagOp(op, tag, newTag, displayedMap) {
    if (!displayedMap) return Promise.reject(new Error("no-map"));
    var tags = JSON.parse(JSON.stringify(PUB.tags));
    var lt = getLocal(LS_TAGS);
    for (var id in lt) tags[id] = lt[id]; // 合并本地 pending
    for (var bid in displayedMap) {
      var arr = (bid in tags) ? tags[bid] : displayedMap[bid];
      if (!arr || arr.indexOf(tag) < 0) continue;
      var na = arr.filter(function (x) { return x !== tag; });
      if (op === "rename") na = na.concat([newTag]);
      if (na.length) tags[bid] = na; else delete tags[bid];
    }
    if (getToken()) {
      return ghPut("tags.json", tags)
        .then(function () { setLocal(LS_TAGS, {}); PUB.tags = tags; return { ok: true, mode: "published", tags: tags }; });
    }
    copy(JSON.stringify(tags, null, 2));
    return Promise.resolve({ ok: true, mode: "copied", tags: tags });
  }

  window.BibPub = {
    getToken: getToken, setToken: setToken,
    fetchPub: fetchPub,
    mergedTags: mergedTags, mergedTrans: mergedTrans, mergedYear: mergedYear,
    setTagPending: setTagPending, setTransPending: setTransPending, setYearPending: setYearPending,
    publishAll: publishAll, globalTagOp: globalTagOp,
    getLocal: getLocal, LS: { tags: LS_TAGS, trans: LS_TRANS, year: LS_YEAR },
    PUB: PUB
  };
})();
