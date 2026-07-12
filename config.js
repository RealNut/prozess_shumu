// 权限与仓库配置（代码文件，随站点部署）
// 覆盖层数据文件（tags.json / trans_overrides.json / year_overrides.json）由网页端经
// GitHub 令牌直接管理，不属于"代码"，deploy.py 永不推送 —— 因此代码部署不会覆盖你的修改。
window.BIB_CONFIG = {
  // 加盐哈希盐值（与下方 PASS_HASH 配套）；改口令时须同步重算 PASS_HASH 并重新部署本文件。
  SALT: "biblio_salt_v3_",
  // SHA-256(SALT + 口令) 的十六进制。当前对应口令 "lzh12580"。
  PASS_HASH: "c2f32950e27f886e49fcd121916802bf2d97bebfc3f93c6863fcb25f523ed815",
  // 覆盖层数据文件所在的 GitHub 仓库与分支
  REPO: "RealNut/prozess_shumu",
  BRANCH: "main"
};
