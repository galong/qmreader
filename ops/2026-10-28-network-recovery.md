# RSS 阅读网络恢复

更新时间：2026-10-28 14:38（北京时间）。用户反馈 DSH 在 TUN 模式无法加载，并明确要求同时优化 DSH、Obsidian、网页端。

## 范围与验收

- 保留 rss.qiaomu.ai 直连，增加 rss-edge.qiaomu.ai 公开只读备用线路。只转发有限阅读路径，不转发 Cookie、Authorization、AI 密钥、写操作或自定义服务地址。
- 保留源站 no-store 与删除/隐藏即时验证；现有源站内存缓存和客户端正文缓存继续使用，不将公开文章无限保存在 CDN。
- DSH 正文不等待译文和改写；版本逐步返回，保留用户手动选择，切换文章后拒绝迟到结果。
- 各端读取合并、限时恢复、近期有效线路复用；Obsidian 保留实际未完成请求的并发槽位和全局重试预算。
- 验证正常读取、主线连接失败/超时、备用失败、404/权限/限流不重试、取消和迟到结果、自定义源隔离；分别记录自动测试、真实宿主、线上线路、公开资产。
- 实际反馈用户的代理节点和 TUN 配置未知，不能用受控故障测试宣称该用户现场已经修复。

## 基线

- DSH 002ee57 / 0.9.1；Obsidian d30a42a / 0.32.9；QMReader 24106cf / 1.0.7。
- 隔离工作区：/Users/joe/Documents/ChatGPT/qiaomu-rss-network-20261028/{dsh,obsidian,web}；原工作区未提交改动保留。
- DSH getArticle 在正文后串行等待 translation 与 rewrite，每段最多 20 秒。
- 最新源站 response-cache 使用数据变更戳失效，明确禁止共享 CDN 存储；此边界继续保留。
- 生产目录没有 .git，部署前必须逐文件核对当前代码与主分支，使用已有可回滚部署流程。

## 发布结果

| 端 | 版本与公开发布 | 合并与部署证据 |
| --- | --- | --- |
| DSH | [0.9.2](https://github.com/joeseesun/qiaomu-rss-dsh/releases/tag/v0.9.2) | [PR #16](https://github.com/joeseesun/qiaomu-rss-dsh/pull/16)，main 7f2deb7ed9583675927663de74d97f70b277c52e，候选 693b41d0b137e49b21eab765046951032fd3a220 |
| Obsidian | [0.32.10](https://github.com/joeseesun/qiaomu-ai-rss/releases/tag/0.32.10) | [PR #98](https://github.com/joeseesun/qiaomu-ai-rss/pull/98)，main ad578be，发布 tag d1958aee9cb590708a21232336c74cbee1befeab |
| 网页 | [1.0.8](https://github.com/joeseesun/qmreader/releases/tag/v1.0.8) | [PR #48](https://github.com/joeseesun/qmreader/pull/48)，生产 DEPLOYED_COMMIT=d6985d877a9879da5562771e9bdb5f3ee1eddcc7，api/version=1.0.8 |

- 三端最终 CI 通过；DSH 完整 check 通过，Obsidian 328 个 Vitest 与其余完整 check 通过，网页 160 个测试通过。
- DSH 对正文故障不再用列表元数据伪装成空内容成功；失败保留重试入口。原文返回后，译文与改写独立读取，不再串行阻塞。
- 备用 DNS 已开启 Cloudflare 代理，源站证书已签发；06:07 UTC 从 VPS 访问返回 server=cloudflare、cf-ray、Cache-Control=no-store、CF-Cache-Status=DYNAMIC。
- 公开只读/私密参数/凭据/写操作矩阵符合预期。此域名与主站共用源站，仅提供网络路径备用，不代表源站故障切换。
- 部署前 97 个文件与 24106cf 基线摘要一致；部署后 98 个文件通过校验，systemd 服务运行。回滚包位于 /opt/qiaomu-backups/qmreader-web-20261028-061435-d6985d877a98。

## 真实宿主与公开下载

- DSH：在官方 RC3 的独立 profile 安装最终候选并重启后，读取目录、列表、正文与改写成功。另从公开 Release 匿名下载，在全新 public-check profile 安装，9 个打包文件逐个一致，真实页面原文/改写均成功。未测试 RC2 运行时。
- DSH 本机 desktop profile：已安装 0.9.2，9 个文件与公开包一致，收藏等 storage 保留，安装包保存到 ~/.dsh/plugin-packages。原宿主仍缓存旧开发目录，热重载报旧目录依赖缺失；退出提示当前有运行任务，已取消退出。需任务结束后重启 DSH，不能将此桌面进程声称为新版运行验收。
- Obsidian：1.14.5 真实桌面宿主，独立库全新安装和 0.32.9→0.32.10 升级均成功阅读。设置、收藏、已读、订阅、笔记、语音进度、保存文章字段升级前后相同，正文缓存保留。
- rockfish：安装前备份，复制发布文件时 136 个数据/缓存文件摘要未变；插件管理显示 0.32.10，单独停用/启用后恢复原选中文章并成功显示正文。原始开发工作区未提交改动保留。
- 网页：线上列表和文章原文通过真实浏览器验证。正文列表使用紧凑响应，认证用户/私有配置/写操作保持原路径。
- Obsidian 最终 SHA 官方预扫描 Completed、无 Error；公开包三个文件匿名下载均 HTTP 200 且与构建一致；14:38 正式 0.32.10 扫描 Completed、无 Error，构建 main.js 与发布文件逐字节一致，官方 Current release 已显示 0.32.10。既有源代码、CSS 和行为 Warning 仍保留，不能称为零告警。

公开下载 SHA-256：

```text
DSH qiaomu-rss-dsh-0.9.2.tgz
ed87e0e6714018e0cd1bec83006b2b7fc0143a9e273b035873ed8c4892307db4
Obsidian main.js
255df5d5dfe3451f4f2af2a0ae440ac677421ae6e131672baf0001cec5f41f63
Obsidian manifest.json
a21c3c660e58cb3c15952ee1c15c03957663fa26ff14c13df73d70e40da24e6f
Obsidian styles.css
91dc5ccf1bec8660e29b68f3a7b1228278da67de59957d8b1fd4a5c1987b17c1
Web qmreader-1.0.8-d6985d877a98.tar.gz
67c3d2966cb915aeeca5bae32e4b37691f60ed9b63f09494e2e32a731f063ef0
```

## 证据边界与后续

- 受控测试覆盖主路径失败、超时后备用成功、404/鉴权/限流终止、自定义源不跨域、取消与迟到响应、并发合并和渐进正文。不能据此保证所有代理节点与 TUN 配置均可用。
- 06:09–06:10 UTC 源站目录/列表出现过 12 秒上游超时；本机也曾观察到 TLS 超时，随后不改变代理设置即可正常读文章。没有反馈用户的日志/节点/配置，无法将反馈唯一归因于未使用 Cloudflare。
- 06:36 UTC 默认 Python urllib 探测得到 Cloudflare 1010，正常标识的诊断请求、本机 curl、VPS curl 与 DSH 同类 Node fetch 均返回 200。依据 [Cloudflare 1010 官方说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)，这是客户端标识检查；没有关闭全站防护。Node 的目录请求确实返回 Cloudflare 响应，不能将 Python 专有阻断当作应用失败，也不能承诺所有客户端标识均被接受。
- 部署后 api/health HTTP 200，但 feed/refresh 状态仍为 degraded；阅读请求已验证，采集积压不在本次网络恢复变更范围。
- 若反馈用户升级后仍失败，下一步采集实际失败路径、错误码、时间、代理分流规则与 DNS/TUN 行为，以同一文章对照开关 TUN。不要让客户端默认扫描多个未知代理地址，也不要绕过鉴权或缓存删除语义。
