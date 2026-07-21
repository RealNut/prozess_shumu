# 法学书目库 / Legal Bibliography

德语法学丛书的德中 / 德英对照书目，可在线查阅、检索与分享。覆盖 **2 家出版社、13 套丛书、共 2862 册**，书名均附中文译名（部分含出版年与标签）。

## 🌐 书目网页（线上访问入口）

本仓库对应的**可访问书目网页**已部署于 GitHub Pages，开箱即用，无需本地搭建：

| 页面 | 地址 |
|---|---|
| **书目主页** | **https://realnut.github.io/prozess_shumu/** |
| 读者指南 | https://realnut.github.io/prozess_shumu/guide-reader.html |

> 站点为纯静态页面，所有书目数据随仓库更新自动重建发布。

<!--UPDATED-->
## 🕒 最后更新

- 代码最后更新：2026-07-21 23:16
<!--/UPDATED-->

## 包含书目

| 文件 | 出版社 | 丛书（德文标题） | 卷数 | 中文丛书名 |
|---|---|---|---|---|
| `prozessrecht.html` | Duncker & Humblot | *Schriften zum Prozessrecht* | 315 | 诉讼法丛书 |
| `studien.html` | Duncker & Humblot | *Studien zum vergleichenden Privatrecht* | 35 | 比较私法研究 |
| `buergerlichen.html` | Duncker & Humblot | *Schriften zum bürgerlichen Recht* | 614 | 民法丛书 |
| `ssa.html` | Duncker & Humblot | *Schriften zum Sozial- und Arbeitsrecht* | 384 | 社会法与劳动法丛书 |
| `vverfr.html` | Mohr Siebeck | *Veröffentlichungen zum Verfahrensrecht* | 234 | 程序法出版物 |
| `juspriv.html` | Mohr Siebeck | *Jus Privatum* | 297 | 私法丛书 |
| `btripr.html` | Mohr Siebeck | *Beiträge zum ausländischen und internationalen Privatrecht* | 133 | 外国与国际私法论丛 |
| `barbr.html` | Mohr Siebeck | *Beiträge zum Arbeitsrecht* | 28 | 劳动法论丛 |
| `r.html` | Mohr Siebeck | *Schriften zum Recht der Digitalisierung* | 60 | 数字化法丛书 |
| `m.html` | Mohr Siebeck | *Materialien zum ausländischen und internationalen Privatrecht* | 39 | 外国与国际私法资料丛书 |
| `o.html` | Mohr Siebeck | *Schriften zum Ostasiatischen Privatrecht* | 13 | 东亚私法丛书 |
| `u.html` | Mohr Siebeck | *Studien zum Privatrecht* | 147 | 私法研究 |
| `t.html` | Mohr Siebeck | *Studien zum ausländischen und internationalen Privatrecht* | 563 | 外国与国际私法研究 |

## 站点结构

- `index.html` — 导航首页（按出版社分区卡片 + 跨全部丛书的标签云）
- `prozessrecht.html` / `vverfr.html` / … 等 13 个丛书页 — 各套丛书对照表（卷号 / 作者 / 德文书名 / 中文译名 / 出版年 / 标签）
- `guide-reader.html` — **读者指南**（公开页，介绍如何使用本站）
- `.nojekyll` — 禁止 GitHub Pages 的 Jekyll 处理，保证 HTML 原样显示

## 本地预览

```bash
cd bibliography-site
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 修订说明

书目由脚本抓取出版社数据并自动生成对照译名：

- **基础 JSON**（各丛书 `*.json`）是「代码 / 默认值」，由 WorkBuddy 部署。
- **网页端覆盖层**（`tags.json` / `trans_overrides.json` / `year_overrides.json`）是「用户数据」，由网页经 GitHub 令牌直接读写，部署脚本 `deploy.py` 永不推送它们 → 代码部署不会覆盖网页上的修改。
- 渲染时合并显示：本地待发布（pending） > 已发布覆盖层（PUB） > 基础 JSON 默认值。

如需改动基础书目数据，更新对应 `*.json` 后运行 `gen_pages.py` / `gen_index.py` 重新生成页面，再 `deploy.py` 部署即可。

## 相关文档

- **书目网页**：https://realnut.github.io/prozess_shumu/ （线上主站，含全部丛书与检索）
- 读者视角的站点使用说明见 **[读者指南](https://realnut.github.io/prozess_shumu/guide-reader.html)**。
- 修改模式（解锁、译名 / 年份 / 标签编辑、发布流程）的内部指南见 `docs/修订指南.md`。
