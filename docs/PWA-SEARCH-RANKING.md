# PWA、公开检索与热门排序

2026-10-30，版本 1.0.15。

## 用户行为

列表范围、篇数与未读数右侧提供刷新按钮，使用现有 Lucide 图标。单源检查该源的抓取更新，需要登录；其他范围重新同步列表，管理员可以触发全源抓取。进行中显示旋转图标并禁止重复点击，超出轮询窗口报告后台仍在处理，不冒充完成。游客与普通用户的全局刷新不会启动全站抓取。

网站提供 Web App Manifest、192/512px PNG、Apple touch icon、standalone 启动与 Service Worker。安装由浏览器提供；不同浏览器和 iOS 的安装入口各自决定。离线只显示明确的网络提示，不缓存文章、账户、接口和媒体。更新等待旧页面关闭，避免打断阅读。HTTPS 与 `/sw.js`、清单的正确 MIME/缓存头属于部署验收。

## 热门算法

旧实现仅对取回的最新文章做客户端排序；点赞 4、收藏 2.5、阅读最高 8 分，另有资产与标题信号，时间除数为 `log2(2 + ageHours/12)`。旧文的近期活动容易漏选，且衰减较慢。

新实现采用 [Evan Miller 的指数衰减思路](https://www.evanmiller.org/rank-hotness-with-newtons-law-of-cooling.html)，对比了 [HN 官方排序说明](https://news.ycombinator.com/newsfaq.html) 与 [Reddit 历史源码](https://github.com/reddit-archive/reddit/blob/master/r2/r2/lib/db/_sorts.pyx)。这些是设计参考，不代表复现它们的当前生产算法。

每个账户对每篇文章的当前收藏、当前点赞/负反馈、最近一次浏览各有一条记录。互动在原发生时间计算 `2^(-ageHours/72)`，相加得到 F、L、D、R；每 72 小时热度减半。取消收藏立即去除信号；同样的点赞重复请求不更新其时间。登录浏览按账户去重，重复刷新不会增加读者数量；匿名访问只提供最高 0.5 分的对数压缩辅助项，不作为独立读者计数。重新收藏仍可能更新那一份信号，尚无独立的多账户反作弊系统。

得分为：

```
max(0,
  0.25 × 发布时间衰减
  + 6 × ln(1 + F)
  + 3 × ln(1 + L)
  + min(2, 0.5 × ln(1 + R))
  + min(0.5, 0.08 × ln(1 + 累计访问)) × 发布时间衰减
  + 0.5 × 最近公开内容更新衰减
  - 4 × ln(1 + D)
)
```

公开点评或 AI 贡献的更新时间只产生最高 0.5 分、半衰期 36 小时的内容更新项，不让全部历史互动重新变新。RSS 抓取时间、列表刷新时间不影响热度。未保存时间的历史匿名访问不能重建为近期独立用户。权重与半衰期是本产品的初始选择，尚未通过真实点击/收藏效果实验校准。

`/api/entries?sort=hot` 在允许访问的启用来源中先计算排名，再读取返回页的正文与资产。搜索仍遵循既有搜索候选范围；停用、删除、独立投稿频道与 opt-in 边界保留。客户端与服务端共用 `public/ranking.js`，同分按发布时间和 ID 稳定排序。热度字段只在热门请求或互动更新响应中计算，普通列表和批量导出不增加热度扫描。

## SEO / AI 搜索

公开文章的标题、摘要、出处、公开贡献片段与目录链接直接出现在初始 HTML；用与用户一致的内容，不按 User-Agent 分流。公开目录可展开浏览。动态页面去除模板的默认元信息，每页只保留一套 canonical、description、社交元信息与 JSON-LD。账户页面 noindex 且 no-store；`/index.html` 永久重定向到首页。

保留既有 sitemap、robots.txt、独立文章 URL、公开 RSS 与 llms.txt。llms.txt 是可选导航资料，不作为收录或 AI 引用效果的证明。[Google AI 搜索官方说明](https://developers.google.com/search/docs/appearance/ai-features)仍以常规 SEO 为基础；[OpenAI 爬虫文档](https://developers.openai.com/api/docs/bots)区分搜索、训练和用户触发请求。已核对日期：2026-10-30。

未提交 Search Console/Bing 站点、未验证搜索平台收录、排名、AI 引用或真实转化改善。上线后应检查公开页面响应、爬虫访问日志，以及 2–4 周真实展示/点击/来源变化，不由单次测试推断效果。

## 验证与发布

本地：209 项 Node 测试、8 项可靠性测试、2 项发布回滚测试、1 项 Python 可靠性测试通过；生产依赖审计 0 漏洞。真实 Chromium 检查清单解析无错误、Service Worker 激活、刷新成功、390px 无横向溢出；关闭本地服务后真实导航显示离线页。尚未在真实 iPhone/Android 上执行安装。

发布使用 GitHub 合并提交与 `scripts/deploy-release.py`，默认目标已改为迁移后的 LA 主机；可选择 SSH ProxyJump 传输，私钥留在本机。旧 Hostinger 写实例保持停用。部署前核对 LA 运行源码与 GitHub 主线摘要一致；部署后回读版本、公开资源类型与缓存、热门接口和页面。
