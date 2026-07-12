# 法学书目库 / Legal Bibliography

两个德语法学丛书系列的德中 / 德英对照书目，可在线查阅与分享。

## 包含书目

| 文件 | 丛书 | 卷数 | 说明 |
|---|---|---|---|
| `prozessrecht.html` | Duncker & Humblot · *Schriften zum Prozessrecht* | 315 | 诉讼法丛书（德英对照书目） |
| `vverfr.html` | Mohr Siebeck · *Veröffentlichungen zum Verfahrensrecht (VVerfR)* | 234 | 程序法丛书（德中对照书目） |

## 站点结构

- `index.html` — 导航首页
- `prozessrecht.html` / `vverfr.html` — 两套丛书对照表
- `.nojekyll` — 禁止 GitHub Pages 的 Jekyll 处理，保证 HTML 原样显示

## 本地预览

```bash
cd bibliography-site
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 修订说明

书目由脚本抓取出版社数据并自动生成对照译名，原始数据可重新生成后覆盖对应 HTML，
再 `git commit` / `git push` 即可更新线上站点。
