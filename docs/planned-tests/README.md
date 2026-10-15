# 未完成的后台改写队列规格

生产 test/background-jobs.test.js 中有 4 项超前规格，依赖并不存在于生产或本地模块的 enqueueRewriteEntries、backfillRewriteQueueAsync、processNextRewriteJob。API 线程确认本轮没有实现它们。

为准确归档实际运行版本，将这 4 项保存在此；它们不是已通过的回归，不计入测试通过数量。本次不新增后台调度路径，不宣称这些规格已完成。现有 lib/web-collection-process.cjs 网页抓取/翻译/改写队列和 store 层持久任务测试继续保留。将来实现这些导出时应将规格搬回 test 并执行。
