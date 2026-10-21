# 2026-10-21 乔木播客中文精读源接入

Target: `rss.qiaomu.ai` on `myvps:/opt/qiaomu-apps/qmreader`

## Changes

- `lib/sources.js` 新增 6 个播客类源，均为乔木自建站点的 RSS（正文即中文精读全文，附官方音频）：
  `lex-zh`、`allin-zh`、`nopriors-zh`、`cogrev-zh`、`trainingdata-zh`、`unsupervised-zh`。
  - `limit: 20`（各站 RSS 输出最近 20～30 期，这里统一显示最近 20 期）
  - `autoRewrite: false`：内容已是精读，不再调用 AI 改写
  - 刷新策略 6 小时兜底；各站每日追新部署后会 `POST /api/sources/<id>/refresh-hint` 主动通知
- 英文原版 `lexfridman`、`allin` 保留（新期提醒），改为 `autoRewrite: false`，避免与精读源重复花费。

## Local Verification

- `npm test`：124 pass / 0 fail
- 在服务器临时目录（`/tmp/qmtest`，复用线上 node_modules，独立 `QMREADER_DATA_DIR`）用 `fetcher.fetchSource` 抓取 6 个源：
  均为 `status=ok`、20 条，正文为完整 HTML（含 h2 / blockquote），音频附件可用。
  本机经代理时 `*.qiaomu.ai` 解析到内网假 IP，会被 SSRF 防护拦截，属本机环境问题。

## Deployment

- Backup → sync `lib/sources.js` → `systemctl restart qmreader` → `/healthz` → 对 6 个源发 refresh-hint。
