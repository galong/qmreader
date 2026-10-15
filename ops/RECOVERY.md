# 网站源码、部署与故障恢复

网站源码由 https://github.com/joeseesun/qmreader 管理；Obsidian 插件与边缘 DR 在 https://github.com/joeseesun/qiaomu-ai-rss 管理。网站、插件、iOS 分别发版，不能拿插件版本代替网站部署版本。

## 发布

只在独立干净 worktree 中发布。分支 PR 合并且检查通过后，取 GitHub main 的完整提交：

```sh
git fetch origin
git checkout --detach origin/main
python3 scripts/deploy-release.py --commit <完整40位提交>
```

脚本核对远端 main、通过 `npm run package` 从 Git 提交打包、校验压缩包摘要。在服务器临时目录先安装依赖和检查语法，再备份、短暂停服务、替换代码、启动、验证版本/抓取健康和每个源码摘要；失败自动恢复旧代码和依赖。它不覆盖 `.env`、`data/`、队列、私人转写文稿、systemd 配置和凭据。外部 DR 中间件从版本化的 lib/dr 同步，保持原挂载路径及删除票据安全门。

检查线上版本：`GET https://rss.qiaomu.ai/api/version`。检查抓取健康：`GET /api/health`，抓取成功时间与文章发布时间分别判断。

## 回滚

每次成功部署返回 `/opt/qiaomu-backups/qmreader-web-<时间>-<提交>`。在主机运行：

```sh
python3 /opt/qiaomu-apps/qmreader/scripts/apply-release.py --rollback /opt/qiaomu-backups/qmreader-web-<时间>-<提交>
```

回滚后检查 `/api/version`、`/api/health` 和匿名文章。备份只覆盖该次改动的代码、依赖和外部中间件；不倒退业务数据库。

## 整机恢复边界

有 GitHub 源码可重建服务，不能仅靠代码恢复账号与历史内容。还必须从加密的独立备份恢复：

- `data/`（SQLite 必须使用 SQLite backup 或停写后的完整数据库，不能单独拷贝活跃 WAL 主文件）、来源缓存、链接任务。
- `/var/lib/qmreader-*` 的私人笔记和转写任务、`/var/lib/qiaomu-rss-*` 的抓取/快照状态。
- 服务器环境文件、Get笔记/Podscribe/AI 凭据、SSH 限制身份、systemd 单元/定时器、Nginx/TLS 和 DR SafetyGate 配置。

这些私人材料不得进入 GitHub。Vultr 公共阅读快照与独立抓取不是账号数据库的可写主机，也不是完整 ASR 凭据备份。本次未演练整机销毁恢复，不承诺具体 RTO/RPO。

新服务器具备 Node >=22.22、Python3 后可从本仓库安装应用；没有既有 DR 外部目录时使用 lib/dr 自带代码。重要删除/管理写操作在缺少 DR 控制配置时仍返回 503，不能为“恢复”而绕过安全门。
