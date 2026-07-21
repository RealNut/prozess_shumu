/**
 * 发布与 GitHub 直写（覆盖层数据文件）。依赖 window.BIB_CONFIG。
 *
 * 设计要点（数据/代码分离 + 原子写入，与 deploy.py 同源思路）：
 *  • 覆盖层文件 tags.json / trans_overrides.json / year_overrides.json 是「用户数据」，
 *    由本脚本经 GitHub Git Database API 直接提交；deploy.py 永不推送它们 → 部署不覆盖网页修改。
 *  • 写入采用「base_tree 原子提交」：仅在当前仓库树的基础上替换这 3 个文件，
 *    因此本脚本【只能改动覆盖层】，绝不会触碰/删除任何代码或其它文件 —— 结构性隔离。
 *  • 显示值优先级：本地待发布(pending) > 已发布覆盖层(PUB) > 基础 JSON 默认值。
 *  • 健壮性：网络/服务端抖动自动重试（指数退避）；引用冲突(409)自动基于最新 base 整体重试。
 *
 * 暴露：window.BibPub { getToken, setToken, fetchPub, mergedTags, mergedTrans, mergedYear,
 *                       setTagPending, setTransPending, setYearPending,
 *                       publishAll, globalTagOp, getLocal, LS, PUB, ALLOWED }
 */
(function (global) {
  "use strict";

  var CFG = global.BIB_CONFIG || {
    REPO: "RealNut/prozess_shumu", BRANCH: "main",
    OVERRIDE_FILES: ["tags.json", "trans_overrides.json", "year_overrides.json"]
  };
  var TOKEN_KEY = "gh_token_v2";
  var LS_TAGS = "shumu_tags_v2", LS_TRANS = "shumu_trans_v2", LS_YEAR = "shumu_year_v2";
  var LS_ORDER = "shumu_order_v2";  // 丛书左右顺序（pending 草稿，发布后写入 series_order.json）
  var LS_HL = "shumu_hl_v1";        // 高亮标记覆盖层：{ "前缀:ISBN": ["civil", ...] }
  var LS_FL = "shumu_fl_v1";        // 站长推荐书单覆盖层：[{ id, name, books:[ids], showOnHome:bool }]
  // 可写白名单：任何写入都只接受这些路径，从根本上杜绝误改代码文件。
  var ALLOWED = (CFG.OVERRIDE_FILES && CFG.OVERRIDE_FILES.slice()) ||
                ["tags.json", "trans_overrides.json", "year_overrides.json", "series_order.json", "highlights.json", "featured_lists.json"];

  // ---------- 本地存储（待发布 + 令牌）----------
  function getLocal(k) { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } }
  function setLocal(k, o) { localStorage.setItem(k, JSON.stringify(o)); }
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

  // 已发布覆盖层（运行期缓存，随 fetchPub 刷新）
  var PUB = { tags: {}, trans: {}, year: {}, order: null, hl: {}, fl: [] };
  function fetchPub() {
    function getJson(path) {
      return fetch(path + "?_=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return Promise.all([getJson("tags.json"), getJson("trans_overrides.json"), getJson("year_overrides.json"), getJson("series_order.json"), getJson("highlights.json"), getJson("featured_lists.json")])
      .then(function (a) {
        PUB.tags = a[0] || {}; PUB.trans = a[1] || {}; PUB.year = a[2] || {};
        PUB.order = (a[3] && a[3].order && a[3].order.length) ? a[3].order : null;
        PUB.hl = a[4] || {};
        PUB.fl = (a[5] && Array.isArray(a[5])) ? a[5] : [];
      });
  }

  /**
   * 主动验证当前令牌是否有效（GET /user）。用于填写令牌后立即反馈，避免发布时才发现无效。
   * @returns Promise<{ok:boolean, reason?:string}>  reason: "empty" | "invalid" | "status:N" | "network"
   */
  function verifyToken() {
    var token = getToken();
    if (!token) return Promise.resolve({ ok: false, reason: "empty" });
    return fetch("https://api.github.com/user", {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" }
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 401) return { ok: false, reason: "invalid" };
      return { ok: false, reason: "status:" + r.status };
    }).catch(function () { return { ok: false, reason: "network" }; });
  }

  // ---------- 显示值合并（pending > PUB > 基础默认）----------
  function mergedTags(id) { var lt = getLocal(LS_TAGS); if (id in lt) return lt[id]; if (id in PUB.tags) return PUB.tags[id]; return null; }
  function mergedTrans(id) { var lt = getLocal(LS_TRANS); if (id in lt) return lt[id]; if (id in PUB.trans) return PUB.trans[id]; return null; }
  function mergedYear(id) { var lt = getLocal(LS_YEAR); if (id in lt) return lt[id]; if (id in PUB.year) return PUB.year[id]; return null; }
  // 高亮标记：pending > PUB > 基础空数组。返回标记类型数组（如 ["civil"]）。
  function mergedHighlights(id) { var lh = getLocal(LS_HL); if (id in lh) return lh[id]; if (id in PUB.hl) return PUB.hl[id]; return null; }
  // 书单数组：pending（整段草稿）> PUB > 基础空数组。
  function mergedFeatured() { var lf = getLocal(LS_FL); if (lf && lf.length) return lf; if (PUB.fl && PUB.fl.length) return PUB.fl; return []; }

  // ---------- 待发布（本地）----------
  function setTagPending(id, arr) { var lt = getLocal(LS_TAGS); if (arr !== undefined && arr !== null) lt[id] = arr; else delete lt[id]; setLocal(LS_TAGS, lt); }
  function setTransPending(id, zh) { var lt = getLocal(LS_TRANS); zh = (zh || "").trim(); if (zh) lt[id] = zh; else delete lt[id]; setLocal(LS_TRANS, lt); }
  function setYearPending(id, y) { var lt = getLocal(LS_YEAR); y = String(y || "").trim(); if (y) lt[id] = y; else delete lt[id]; setLocal(LS_YEAR, lt); }
  // 高亮标记：传非空数组写入；空数组/undefined 则清除（删除该书所有高亮）。
  function setHighlightPending(id, arr) {
    var lh = getLocal(LS_HL);
    arr = (arr || []).filter(function (x) { return x; });
    if (arr.length) lh[id] = arr; else delete lh[id];
    setLocal(LS_HL, lh);
  }
  // 书单数组：整段写入 pending（任何增删改都走这里，发布后整体覆盖 PUB.fl）。
  function setFeaturedPending(arr) {
    if (arr && arr.length) setLocal(LS_FL, arr);
    else { try { localStorage.removeItem(LS_FL); } catch (e) {} }
  }
  // 丛书左右顺序：传入有序 prefix 数组写入 pending；传 null/空则清除草稿
  function setOrderPending(arr) {
    if (arr && arr.length) setLocal(LS_ORDER, arr);
    else { try { localStorage.removeItem(LS_ORDER); } catch (e) {} }
  }
  function getOrderPending() { var v = getLocal(LS_ORDER); return (v && v.length) ? v : null; }

  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function copy(t) { if (global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(t); }

  // ---------- GitHub Git Database API（带重试）----------
  // 单次请求：401/403/404 等致命错误立即抛出；422/5xx 自动退避重试；
  // 409（引用已被改动）作为特殊信号抛出，交由 commitFiles 整体重试。
  function gh(method, path, body, attempt) {
    attempt = attempt || 0;
    var url = "https://api.github.com/repos/" + CFG.REPO + "/" + path;
    var opts = {
      method: method, cache: "no-store",
      headers: { Authorization: "Bearer " + getToken(), Accept: "application/vnd.github+json" }
    };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      if (r.status === 409) return r.text().then(function (t) { throw new Error("gh:409 " + t); });
      if (r.status === 422 || r.status >= 500) return r.text().then(function (t) { throw new Error("retry:" + r.status + " " + t); });
      if (!r.ok) return r.text().then(function (t) { throw new Error("gh:" + r.status + " " + t); });
      var ct = r.headers.get("content-type") || "";
      return ct.indexOf("application/json") >= 0 ? r.json() : r.text();
    }).catch(function (err) {
      if (String(err.message).indexOf("retry:") === 0 && attempt < 3) {
        return new Promise(function (res) { setTimeout(res, 600 * (attempt + 1)); })
          .then(function () { return gh(method, path, body, attempt + 1); });
      }
      throw err;
    });
  }

  /**
   * 原子提交一组文件（仅限覆盖层白名单）。files: { path: contentString }
   * 仅基于当前 base_tree 替换指定文件，其余条目原样保留 → 结构性数据/代码分离。
   * 引用冲突(409)时整体基于最新 base 重试（最多 2 次）。
   */
  function commitFiles(files, message) {
    var token = getToken();
    if (!token) return Promise.reject(new Error("no-token"));
    // 只允许白名单路径，过滤任何越权写入尝试
    var safe = {};
    for (var p in files) if (ALLOWED.indexOf(p) >= 0) safe[p] = files[p];
    if (!Object.keys(safe).length) return Promise.reject(new Error("no-allowed-files"));

    function run(left) {
      return gh("GET", "git/refs/heads/" + CFG.BRANCH).then(function (ref) {
        var baseSha = ref.object.sha;
        return gh("GET", "git/commits/" + baseSha).then(function (commit) {
          var baseTreeSha = commit.tree.sha;
          var paths = Object.keys(safe);
          return Promise.all(paths.map(function (path) {
            return gh("POST", "git/blobs", { content: b64(safe[path]), encoding: "base64" })
              .then(function (b) { return { path: path, sha: b.sha }; });
          })).then(function (blobs) {
            var treeEntries = blobs.map(function (b) {
              return { path: b.path, mode: "100644", type: "blob", sha: b.sha };
            });
            return gh("POST", "git/trees", { base_tree: baseTreeSha, tree: treeEntries });
          }).then(function (tree) {
            return gh("POST", "git/commits", { message: message, tree: tree.sha, parents: [baseSha] });
          }).then(function (commitObj) {
            return gh("PATCH", "git/refs/heads/" + CFG.BRANCH, { sha: commitObj.sha, force: false });
          });
        });
      }).catch(function (err) {
        // 引用冲突：base 已被改动，基于最新 base 整体重试
        if (String(err.message).indexOf("gh:409") === 0 && left > 0) {
          return new Promise(function (res) { setTimeout(res, 400); }).then(function () { return run(left - 1); });
        }
        throw err;
      });
    }
    return run(2);
  }

  // ---------- 发布全部待发布 ----------
  function publishAll() {
    var lt = getLocal(LS_TAGS), ltr = getLocal(LS_TRANS), ly = getLocal(LS_YEAR);
    var lo = getLocal(LS_ORDER), lh = getLocal(LS_HL), lf = getLocal(LS_FL);
    var tags = Object.assign({}, PUB.tags, lt);
    var trans = Object.assign({}, PUB.trans, ltr);
    var year = Object.assign({}, PUB.year, ly);
    var hl = Object.assign({}, PUB.hl, lh);
    var fl = (lf && lf.length) ? lf : PUB.fl;
    if (getToken()) {
      var files = {
        "tags.json": JSON.stringify(tags, null, 2),
        "trans_overrides.json": JSON.stringify(trans, null, 2),
        "year_overrides.json": JSON.stringify(year, null, 2),
        "highlights.json": JSON.stringify(hl, null, 2),
        "featured_lists.json": JSON.stringify(fl, null, 2)
      };
      if (lo && lo.length) files["series_order.json"] = JSON.stringify({ order: lo }, null, 2);
      return commitFiles(files, "Update overlay data via web editor").then(function () {
        setLocal(LS_TAGS, {}); setLocal(LS_TRANS, {}); setLocal(LS_YEAR, {});
        setLocal(LS_HL, {}); setLocal(LS_FL, {});
        if (lo && lo.length) { PUB.order = lo; setOrderPending(null); }
        PUB.tags = tags; PUB.trans = trans; PUB.year = year; PUB.hl = hl; PUB.fl = fl;
        return { ok: true, mode: "published" };
      });
      // 失败时向上 reject，由调用方 .catch 统一提示
    }
    copy(JSON.stringify({ tags: tags, trans: trans, year: year, highlights: hl, featured: fl }, null, 2));
    return Promise.resolve({ ok: true, mode: "copied" });
  }

  // ---------- 全局标签操作（删除 / 重命名）----------
  // displayedMap: { id: 当前显示标签数组 }；返回 Promise<{ok,mode,tags}>
  function globalTagOp(op, tag, newTag, displayedMap) {
    if (!displayedMap) return Promise.reject(new Error("no-map"));
    var tags = JSON.parse(JSON.stringify(PUB.tags));
    var lt = getLocal(LS_TAGS);
    for (var id in lt) tags[id] = lt[id]; // 合并本地待发布
    for (var bid in displayedMap) {
      var arr = (bid in tags) ? tags[bid] : displayedMap[bid];
      if (!arr || arr.indexOf(tag) < 0) continue;
      var na = arr.filter(function (x) { return x !== tag; });
      if (op === "rename") na = na.concat([newTag]);
      if (na.length) tags[bid] = na; else delete tags[bid];
    }
    if (getToken()) {
      return commitFiles({ "tags.json": JSON.stringify(tags, null, 2) }, "Global tag " + op + ": " + tag)
        .then(function () { setLocal(LS_TAGS, {}); PUB.tags = tags; return { ok: true, mode: "published", tags: tags }; });
    }
    copy(JSON.stringify(tags, null, 2));
    return Promise.resolve({ ok: true, mode: "copied", tags: tags });
  }

  global.BibPub = {
    getToken: getToken, setToken: setToken,
    verifyToken: verifyToken,
    fetchPub: fetchPub,
    mergedTags: mergedTags, mergedTrans: mergedTrans, mergedYear: mergedYear,
    mergedHighlights: mergedHighlights, mergedFeatured: mergedFeatured,
    setTagPending: setTagPending, setTransPending: setTransPending, setYearPending: setYearPending,
    setHighlightPending: setHighlightPending, setFeaturedPending: setFeaturedPending,
    setOrderPending: setOrderPending, getOrderPending: getOrderPending,
    publishAll: publishAll, globalTagOp: globalTagOp,
    getLocal: getLocal, LS: { tags: LS_TAGS, trans: LS_TRANS, year: LS_YEAR, order: LS_ORDER, hl: LS_HL, fl: LS_FL },
    PUB: PUB, ALLOWED: ALLOWED
  };
})(window);
