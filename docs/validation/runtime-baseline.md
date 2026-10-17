# 验证运行基线

被测源码：`bb4ef7384be8953599ae7b34ca964001d392b4f3`。精确包版本、模型、兼容日期/flags、哈希参数和探针输入输出限制见 [versions.json](../../probes/versions.json)，lockfile 校验见 [机器结果](./2026-10-17-phase-one-results.json)。

模型为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`；AI SDK 7.0.143、workers-ai-provider 4.0.0、assistant-ui/react 0.15.29、assistant-ui/ai-sdk 0.0.13、Better Auth 1.7.10。provider 包外包含探针的单方言 SSE 规范化；该适配源码属于基线，不可省略后沿用兼容结论。

平台为 Workers Free，不能据此声明模板可在免费档稳定运行。默认 scrypt N=16384/r=16/p=1/dkLen=64 未改动，注册 136–161ms（4 条）、登录 67–128ms（4 条） 已决定性超限。未建立可准入的最大输入 CPU 基线，也没有 Paid 实测结论。

本地测试使用 remoteBindings:false 和仅替换外部模型的确定性适配器；实际模型/浏览器、Workflow 和资源复用另在隔离云资源验证。详细范围与费用限制见 [阶段一结论](./phase-one-summary.md)。
