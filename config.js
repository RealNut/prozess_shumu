/**
 * 书目站点 — 静态配置（随站点部署的「代码」文件，非用户数据）。
 *
 * ── 安全模型（务必先读）──────────────────────────────────────────────
 *  • 本文件是公开代码，任何人查看源码都能看到它的内容，因此这里不可能藏"服务端秘密"。
 *  • 口令不以明文存储，而是以「加盐 SHA-256」哈希形式保存在 PASS_HASH。
 *    校验在浏览器本地用 Web Crypto 完成，明文口令永不离开本机。
 *  • 本门禁用于挡住随手误改与简单猜测；真正的防线是"失败次数锁定 + 指数退避"（见 gate.js）。
 *  • 它属于「个人站点轻量门禁」，并非银行级安全。若需更强保护，应改用真实后端鉴权。
 *
 * ── 修改口令流程 ────────────────────────────────────────────────────
 *  1) 在浏览器控制台执行：`await BibGate.hashFor('你的新口令')` 取得十六进制哈希；
 *  2) 将下方 PASS_HASH 替换为新哈希（SALT 可一并更换，但须重新计算哈希）；
 *  3) 重新部署本文件（deploy.py）。
 *
 * ── 数据 / 代码分离 ────────────────────────────────────────────────
 *  • 覆盖层数据文件（tags.json / trans_overrides.json / year_overrides.json）由网页端经
 *    GitHub 令牌直接读写（见 publish.js），本配置与部署脚本 NEVER 推送它们 → 部署不覆盖网页修改。
 *  • OVERRIDE_FILES 是 publish.js 的「可写白名单」，从架构上保证前端只能改这 3 个文件。
 */
(function (global) {
  "use strict";
  // 单一可信来源：所有前端模块均从 window.BIB_CONFIG 读取，运行时不可被页面其它脚本篡改。
  var CONFIG = Object.freeze({
    /** 哈希盐值：与 PASS_HASH 配套。改口令时建议一并更换并重新计算哈希。 */
    SALT: "biblio_salt_v3_",
    /** SHA-256(SALT + 口令) 的十六进制。口令经 BibGate.hashFor 在本地浏览器派生，明文不存储于此；修改口令见下方「修改口令流程」。 */
    PASS_HASH: "c2f32950e27f886e49fcd121916802bf2d97bebfc3f93c6863fcb25f523ed815",
    /** 覆盖层数据文件所在的 GitHub 仓库（owner/repo）。 */
    REPO: "RealNut/prozess_shumu",
    /** 覆盖层数据文件所在分支（站点也由该分支经 Pages 直接提供）。 */
    BRANCH: "main",
    /** 网页端允许直写的覆盖层文件白名单（publish.js 据此限制可写路径）。 */
    OVERRIDE_FILES: ["tags.json", "trans_overrides.json", "year_overrides.json", "series_order.json"]
  });

  global.BIB_CONFIG = CONFIG;
})(window);
