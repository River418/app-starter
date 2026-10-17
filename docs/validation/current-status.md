# 当前执行状态

阶段一其余探针已执行，阶段二按用户要求暂缓。当前只有独立验证工具，没有应用模板。

- Cloudflare 重复部署及隔离：通过批准范围；Stripe 两项按用户豁免，支付仍未验证。
- 真实模型、assistant-ui 浏览器协议及模型 Workflow：7 项通过，包含已注明的 provider 薄适配。
- 恢复、取消和结算：13 项通过，60 次竞争。
- Free CPU：默认 Better Auth 哈希实测超 10ms，预算 Gate 失败；完整边界压测未运行。

[完整结论](./phase-one-summary.md) · [脱敏机器结果](./2026-10-17-phase-one-results.json) · [运行方法](./running-probes.md)

被测源码：`bb4ef7384be8953599ae7b34ca964001d392b4f3`。不把用户豁免、缺失样本或未执行项目记成通过；没有升级套餐、降低哈希或搭建阶段二模板。

临时 Worker 的远程 Cron 已在采集和结算完成后停用，资源保留。再次运行恢复探针前需重新发布恢复 Cron。
