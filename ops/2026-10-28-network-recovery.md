# RSS 阅读网络恢复

更新时间：2026-10-28（北京时间）。用户反馈 DSH 在 TUN 模式无法加载，并明确要求同时优化 DSH、Obsidian、网页端。

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

## 进展

- 三端实现完成：DSH 完整 check 与打包/独立 profile 安装一致；Obsidian 328 Vitest 与完整 check 通过；网页 160 个测试通过。
- 备用 DNS 已开启代理，源站证书已签发；2026-10-28 06:07 UTC 从 VPS 访问返回 server=cloudflare、cf-ray、Cache-Control=no-store、CF-Cache-Status=DYNAMIC。
- 公开只读/私密参数/凭据/写操作矩阵符合预期；97 个生产部署文件与 24106cf 基线摘要一致。
- Obsidian 最终候选 d1958aee9cb590708a21232336c74cbee1befeab 已推分支并提交官方预扫描，未公开版本。
- 宿主验证进行中；观察到 06:09 UTC 源站对目录与列表产生过 12 秒上游超时，不能将此归为纯客户端路由故障。
- 尚未发布应用代码。
