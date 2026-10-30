# 2026-10-24 中文播客精读站接入（cnpodcast）

Target: `rss.qiaomu.ai` on `qiaomu-hostinger:/opt/qiaomu-apps/qmreader`

## Changes

- `lib/sources.js`
  - 新增 8 个精读源 `<slug>-zh`（zhangxiaojun / 42zhangjing / latetalk / crossing / aialchemy / 35huan / zhixing / mianji），
    读取 `https://<slug>.qiaomu.ai/feed.xml`（正文即精读全文，附节目音频），`limit: 20`，`autoRewrite: false`，6 小时兜底刷新；
    各站每日追新部署后会 `POST /api/sources/<slug>-zh/refresh-hint`
  - 新增 5 个小宇宙原始源（crossing / aialchemy / 35huan / zhixing / mianji），供 Get笔记 worker 归档逐字稿，仍只给管理员看
  - 原有 zhangxiaojun / 42zhangjing / latetalk 改为 `autoRewrite: false`，精读由精读站提供，避免重复花费
- Get笔记 worker、逐字稿改写 worker、私人笔记页、前端管理员入口：节目名单加入上述 5 档
- 并入线上已有但未入库的热修：nexttoken 改用官方 nexttoken.tv 文字稿（worker 不再为它提交 Get笔记；
  `scripts/nexttoken-official-transcript.js` 目前只在服务器上）

## 线上与仓库的其他差异（本次未动）

部署前比对发现线上还有这些文件与 DEPLOYED_COMMIT 不一致，属于另一次部署，本次只做定点同步、不覆盖：
`.env.example`、`.gitignore`、`README.md`、`lib/ai-spend-guard.js`、`lib/deepseek.js`、`lib/site-magpie.js`。

## Local Verification

- `npm test`：124 pass / 0 fail

## Deployment

- 备份 → 只同步本次涉及的 6 个文件 → 导入 cnpodcast 已取得的 Get笔记逐字稿到 `/var/lib/qmreader-podcast-notes`（避免重复提交）
  → `systemctl restart qmreader` → `/healthz` → 对 8 个精读源发 refresh-hint
