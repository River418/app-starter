# Cloudflare App Starter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立开源仓库交付一套少配置的 Web 与 Agent 模板，先通过三个真实验证门槛，再搭建模板。

**Architecture:** React SPA 静态资源与 Hono API 随一个 Worker 部署；Better Auth、D1、R2、Stripe 为公共能力，Agent 配置增加模型与 Workflow。第一阶段只建设最小可丢弃探针，不建设模板框架。探针通过后仅移植已验证的约束、接口和必要代码，模板不能依赖 `probes/` 运行。

**Tech Stack:** TypeScript、React、Vite、Hono、Better Auth、Drizzle/D1、R2、Stripe、AI SDK、Workers AI、Workflows；前端组合以设计文档为准。

**Spec:** [少配置应用模板完整方案](../specs/2026-10-17-minimal-cloudflare-app-starter-design.md)

状态：阶段一已形成实测结论，准入未通过。2026-10-17 用户在看到 Free CPU 实测失败后，选择“保留现设计，先完成其余探针并暂缓阶段二”。其余探针已执行；不启动阶段二。阶段三及以后不在本轮执行范围。

实测进度见 [阶段一结论](../../validation/phase-one-summary.md)：Cloudflare 发布 6 项通过、2 项 Stripe Sandbox 按用户豁免且支付未验证；真实模型/浏览器/Workflow 协议 7 项通过；恢复 13 项、60 次竞争通过；Free CPU 失败，完整最大输入/冷请求边界压测未做。Task 1 的 Stripe 同步器尚未实现，不能把 Cloudflare 通过理解为支付功能完成。保留未满足的准入复选框，Task 5–7 按用户要求暂缓。

2026-10-17 用户调整：因暂时没有 Stripe Sandbox，明确允许跳过其真实云验证。仅豁免 Task 1 的两个 Sandbox 重复同步及价格版本用例（见 `docs/validation/approved-exceptions.json`）；相关能力保持 unverified，不得宣称支付已验证。不豁免 Cloudflare 资源重用、未知签名 secret 拒绝就绪、CPU、真实模型或恢复验证。阶段二可以在其余门槛通过并明确披露豁免后开始，正式收款验收仍需后续补做。

## Global Constraints

- 模板与 novel-writer 独立维护，不迁移原产品，不要求兼容它的模块、数据库、接口或部署结构。
- 第一版同时交付普通 Web 与 Agent 应用的完整示例，支付和权益属于两者共用的必备能力。
- 前端静态资源和 API 作为一个 Worker 一起部署。普通 Web 配置不启用模型调用和 Workflow 资源。
- 本地默认使用模拟模型；云端模型、CPU 与 Workflow 验证必须使用真实服务。
- 免费额度用于小规模可行性验证；完整应用预留 Workers Paid 每账户每月 5 美元起，其他费用另计。不自动购买计划或创建真实扣款。
- `client/server/shared` 边界必须能被构建规则验证；secret 只来自 Worker bindings。
- dev/prod 的资源、会话、用户、任务和 Stripe 对象隔离；同账户额度仍共享。
- 保留一处应用配置和同一套部署流程，不引入 Void、多平台适配、独立常驻后端或兼容旧产品的层。
- 下文 npm 命令和接口均是实施交付目标，当前文档仓库尚未提供这些脚本。

## Review Focus

1. 资源创建成功但响应、配置回写或 webhook secret 保存中断，重试必须复用已知对象或明确要求修复；由任务 1、8 验证。
2. 错误账户、错误环境或浏览器跨端导入不能改变其他环境或暴露服务端实现；由任务 1、5、7 验证。
3. 单独支持流式文本不代表模型工具循环与 assistant-ui 协议兼容；由任务 2、10 验证。
4. 提交、事件投递、重复确认和取消竞争不能丢任务、重复提交或泄漏配额；由任务 3、11 验证。
5. 付款事件乱序、回跳早于 webhook、改价和退款不能重复授予或误清其他权益；由任务 8、9 验证。

## 仓库与执行位置

- GitHub：`https://github.com/River418/cloudflare-app-starter`，公开仓库，MIT 许可证，默认分支 `main`。
- novel-writer 新 worktree：`.worktree/cloudflare-app-starter/`，分支 `codex/cloudflare-app-starter`，基于已批准设计提交 `e4be7a91`。
- 新 worktree 内的 submodule：`cloudflare-app-starter/`。父仓库只记录 `.gitmodules`、gitlink 和文档入口，独立仓库拥有源码、lockfile、测试、发布及后续设计。
- 所有实施命令从独立仓库根执行，不在父仓库的 frontend/backend/admin 安装依赖或启动服务。
- 子模块提交先推送到独立远端，再更新父仓库 gitlink。父仓库分支不在此阶段合并或推送。
- 阶段零已建立仓库与计划；本轮仅收尾阶段一，阶段二已由用户明确暂缓。不自动购买服务。

## 阶段与准入条件

| 阶段 | 任务 | 可交付结果 | 准入条件 |
| --- | --- | --- | --- |
| 0 仓库准备 | 本轮完成 | 新 worktree、公开仓库、submodule、设计与计划 | 用户已授权 |
| 1 可行性验证 | 1–4 | 三项证据、版本组合、运行预算、机器可检查的 gate | 计划评审后执行；不得提前搭模板 |
| 2 公共模板 | 5–7 | 本地启动、两种构建、前端基础、认证、数据与文件 | 阶段 1 全部通过 |
| 3 支付闭环 | 8–9 | 收款初始化、购买/订阅、权益、退款和对账 | 阶段 2 通过 |
| 4 Agent 闭环 | 10–11 | 聊天、工具、持久任务、取消与用量 | 阶段 3 通过 |
| 5 交付 | 12 | 两个干净衍生应用、CI、文档、首个发布版本 | 全部业务与真实链路验证通过 |

第一阶段三个验证按批准范围通过，Stripe 仅适用上述显式豁免。Free 超 CPU 限制不直接否决 Cloudflare 路线，但 Free 结果必须标记失败；用户自行启用已接受预算范围内的 Paid 后，选定 Paid 配置须重跑通过。缺少账号、授权、证据或依赖兼容性时记录阻塞，不用模拟或口头判断放行。

每次云验证前先提交被测探针代码并确认工作树清洁，报告关联该提交；脱敏结果另作后续提交。只有文档或报告变化不要求重测，相关探针、依赖或平台配置变化则重跑受影响验证。

第一阶段开始前检查 Cloudflare 账户授权、剩余额度、R2 开通、Stripe Sandbox 和可用模型；先列明预计模型/资源费用及停止预算。凭据仅进入本机被忽略的配置或云 secret，原始证据不得公开。不具备这些前提时只运行可独立完成的本地负测，并将云 Gate 记为 blocked。

## 文件与接口总览

| 位置 | 职责 |
| --- | --- |
| `probes/shared/evidence.ts`、`probes/versions.json` | 探针证据结构、精确版本及模型冻结记录 |
| `probes/deployment/` | 首次/重复部署与资源映射的临时验证 |
| `probes/budget-protocol/` | CPU、真实模型、浏览器流与工具协议验证 |
| `probes/recovery/` | 任务、outbox、竞争和配额结算故障注入 |
| `scripts/verify-gate.mjs`、`docs/validation/` | 校验三项证据及脱敏摘要；原始证据留在被忽略的 `artifacts/` |
| `app.config.ts`、`scripts/deploy.mjs`、`wrangler.jsonc` | 阶段二之后的应用配置与薄部署流程 |
| `src/client/`、`src/server/entrypoints/` | 浏览器与 Worker 的独立入口、公共布局与平台接入 |
| `src/features/{records,billing,agent}/` | 功能内部的 client/server/shared，Agent 的 Prompt/工具/Workflow 仅位于 server |
| `src/shared/`、`migrations/`、`locales/` | 可公开契约、版本化 SQL、中英文文案 |
| `tests/integration/`、`tests/e2e/` | 真实 API、持久化、浏览器全链路验证 |

证据统一接口 `GateReport`：`gate: "deployment" | "budget-protocol" | "recovery"`、`status: "not_run" | "pass" | "fail" | "blocked"`、`sourceCommit`、`lockfileSha256`、`versionsSha256`、`environment`、`platformPlan`、`cases[]`、`evidence[]`、`executedAt`。每个 case 保存测试名、输入边界、期望/实际和结果；云调用保存可关联的 request/instance ID，不保存凭据和私有正文。

接口总览中的文件是实施目标，不在仓库准备阶段建立空实现或伪造通过报告。

## 阶段一 可行性验证

### Task 1: 首次部署、环境隔离和重复部署探针

**Files:**
- Create: `package.json`、`package-lock.json`、`tsconfig.json`、`vitest.config.ts`，仅容纳探针所需工具。
- Create: `probes/shared/evidence.ts`、`probes/versions.json`。
- Create: `probes/deployment/wrangler.jsonc`、`probes/deployment/src/index.ts`、`probes/deployment/migrations/0001_probe.sql`。
- Create: `probes/deployment/deploy.mjs`、`probes/deployment/stripe-sync.ts`、`probes/deployment/deploy-reuse.spec.ts`。

**Interfaces:**
- Produces: `runDeploymentProbe(options: ProbeOptions): Promise<GateReport>`。
- `ProbeOptions` 固定包含验证应用 slug、Cloudflare account、临时资源前缀、证据目录；不得接受既有产品资源作为 reset 目标。
- 仅验证健康、Better Auth 登录/会话、一条记录、文件、最小 Workflow 绑定及 Stripe 对象同步，不创建正式业务页面。

- [ ] **Step 1: 先写失败断言。** `reuses_resources_and_sessions_after_clean_rebuild` 比较首次、重建、只改 title 三份清单，断言 D1/R2/Workflow 绑定和 Stripe Product/Price/Portal/webhook ID 不变，用户/记录/会话保留，migration 不重复，管理员设置不重新开放。
- [ ] **Step 2: 增加负测并验证失败。** `rejects_wrong_account_or_environment`、`resumes_after_resource_created_response_lost`、`does_not_mark_unknown_webhook_secret_ready`、`price_change_creates_only_new_price`；先用确定性故障点让相应断言失败。命令：`npm run probe:deployment -- --local`。
- [ ] **Step 3: 实现最小部署与持久映射。** 使用原生 Wrangler；D1 准备后再构建、迁移、部署。Stripe 对象使用持久映射和稳定 metadata 查找，不能只靠可能过期的幂等键。中断后签名 secret 不可确认时保持未就绪并提供修复。
- [x] **Step 4: 在独立验证资源上执行。** 命令：`npm run probe:deployment -- --cloud`。Cloudflare 使用一次性验证应用的真实 dev/prod 资源，绝不修改既有环境；Stripe 同步器在两个独立 Sandbox 验证并记录覆盖范围，正式模式拒绝测试凭据/事件作为负测，不创建正式交易，不加入可绕过生产模式校验的配置开关。
- [x] **Step 5: 保存脱敏证据并提交。** 输出 `artifacts/gates/deployment.json`、资源清单差异、migration 记录、会话持续有效及 webhook 验签结论；先本地 PASS，再云端 PASS。步骤 2 的版本组合在任务 2 冻结后，受影响的登录/会话与重建用例必须复跑。

**Pass:** 所有资源归属正确，重复发布不新建既有资源、不轮换认证 secret、不丢数据；同一付款初始化可恢复。云环境缺失或 Stripe 仅用 mock 时为 blocked，不是 pass。

**Block:** 任何串环境、重复资源、会话失效、误开放初始化、未知 webhook secret 被判就绪，均阻止阶段二。

### Task 2: 真实 CPU、模型和 UI 协议探针

**Files:**
- Create: `probes/budget-protocol/wrangler.jsonc`、`probes/budget-protocol/src/worker.ts`、`probes/budget-protocol/src/ChatProbe.tsx`。
- Create: `probes/budget-protocol/src/tools.ts`、`probes/budget-protocol/src/ModelWorkflow.ts`、`probes/budget-protocol/cloud-budget-protocol.spec.ts`。
- Modify: `probes/versions.json`、`package.json`、`package-lock.json`。

**Interfaces:**
- Consumes: 任务 1 的隔离资源策略与 `GateReport`。
- Produces: `runBudgetProtocolProbe(options: ProbeOptions): Promise<GateReport>`；冻结模型 ID、provider、AI SDK、assistant-ui 适配包、Better Auth、哈希参数和 lockfile。
- 探针仅有一页聊天、读取工具、确认修改工具、历史接口和一个真实模型 Workflow step。

- [x] **Step 1: 写组合协议失败用例。** `streams_text_and_tool_parts`、`continues_after_confirmed_tool`、`does_not_execute_rejected_tool`、`reloads_history_without_new_generation`、`cancel_does_not_reopen_run`；命令：`npm run probe:budget-protocol -- --local`，预期先失败。
- [x] **Step 2: 冻结真实兼容版本。** 根据当前官方兼容表和实际 peer dependencies 选择精确版本；先验证编译和工具协议，再写 `probes/versions.json`。不能把旧版 assistant-ui 适配包与新版 AI SDK 混装，也不能只运行 Workers AI 文本流示例就算通过。[assistant-ui 兼容说明](https://www.assistant-ui.com/docs/runtimes/ai-sdk/overview)、[Workers AI SDK 接入](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/)
- [ ] **Step 3: 配置云端测量并执行真实调用。** 命令：`npm run probe:budget-protocol -- --cloud`。测注册/登录、会话、Stripe 原始体验签、模型流处理、工具循环及 Workflow CPU；典型和最大允许输入各至少 20 次，另记新部署首请求。记录 `inputBytes`、输出上限、工具轮数、hash 参数和配置 CPU limit。
- [x] **Step 4: 判定运行计划。** 导出 Cloudflare CPU、墙钟、outcome 和模型真实用量，统计 p50/p95/max。Free 有超限则该配置 fail；不降低密码哈希安全参数。若采用 Paid，用户完成账户计划准备后，在实际 Paid 配置重跑全部受影响用例，只有实测结果才能放行。
- [x] **Step 5: 提交冻结记录和脱敏结论。** 输出 `artifacts/gates/budget-protocol.json`、版本/模型组合、用量摘要与浏览器协议断言。复跑任务 1 受版本与运行计划影响的用例；将选定目标写入 `docs/validation/runtime-baseline.md`。

**Pass:** 锁定的真实模型完成流、工具、确认及历史链路；所选计划无 CPU 超限或异常 outcome，p95 不超过配置 CPU 上限的 80%，最大输入被明确界定。测试输入过小而不能代表模板上限时不放行。

**Block:** 缺真实模型/云测量、协议不兼容、Free 未过却直接宣称支持、Paid 仍超限、依赖和证据不对应，均阻止阶段二。

### Task 3: 故障恢复、取消竞争与配额结算探针

**Files:**
- Create: `probes/recovery/wrangler.jsonc`、`probes/recovery/migrations/0001_runs.sql`、`probes/recovery/src/worker.ts`。
- Create: `probes/recovery/src/RunWorkflow.ts`、`probes/recovery/src/outbox.ts`、`probes/recovery/src/usage.ts`、`probes/recovery/recovery-settlement.spec.ts`。

**Interfaces:**
- Consumes: `GateReport`、任务 2 的目标计划与锁定版本。
- Produces: `runRecoveryProbe(options: ProbeOptions): Promise<GateReport>`。
- HTTP：创建运行 `{operationId}`、确认 `{operationId, expectedVersion}`、取消、状态查询；同一 operation/run 稳定关联一个 Workflow 实例。
- 最小 D1 表：`runs`、`outbox`、`results`、`usage_reservations`、`usage_entries`；同一 batch/条件更新提交状态与业务效果。

- [x] **Step 1: 写故障断言并观察失败。** `recovers_after_commit_before_dispatch`、`deduplicates_instance_after_ack_lost`、`handles_early_duplicate_and_expired_confirmation`；命令：`npm run probe:recovery -- --local`。
- [x] **Step 2: 冻结探针结算规则并实现最小恢复。** 探针用固定测试单位，不宣称是真实套餐定价；每个已完成逻辑步骤最多扣一次单位，未完成步骤释放预占，供应商各次 attempt 成本单独记账。创建/确认先原子保存状态与 outbox，Scheduled 补投，按稳定实例 ID 去重；故障开关仅限受保护探针环境。
- [x] **Step 3: 执行取消竞争。** `cancel_wins_without_result`、`success_wins_rejects_late_cancel`、`concurrent_cancel_and_commit_is_atomic` 各重复至少 20 次。再测崩溃后 lease 到期回收、重复 Scheduled、Workflow 重试和用户等待确认超时。
- [x] **Step 4: 云端验证。** 命令：`npm run probe:recovery -- --cloud`；Scheduled 每分钟一次、每批最多 20 个事件，单用例恢复在两个调度周期加 30 秒容差内完成。真实运行 Workflow/D1/调度，供应商可用确定性替身注入失败；任务 2 另行证明真实模型，不以替身证明模型可用。
- [x] **Step 5: 导出并提交结论。** `artifacts/gates/recovery.json` 保存事件时间线、实例 ID、SQL 断言及配额守恒结果；每运行最多一份业务结果，终态不重开，预占最终释放/结算，重试不重复扣量。

**Pass:** 所有故障和竞争用例通过，资源最终可回收，供应商尝试成本与用户扣量分开记录；取消成功不能有迟到业务提交。

**Block:** 丢任务、重复结果/扣量、确认越权/过期仍执行、终态倒退或并发名额泄漏，均阻止阶段二。

### Task 4: 阶段一 Gate 与取舍结论

**Files:**
- Create: `scripts/verify-gate.mjs`、`tests/gates/verify-gate.test.mjs`、`docs/validation/phase-one-summary.md`。
- Modify: `package.json`、`docs/validation/runtime-baseline.md`。

**Interfaces:**
- Consumes: 三个 `GateReport`、`probes/versions.json` 与 lockfile。
- Produces: `npm run verify:gate -- --evidence-dir artifacts/gates`；全部通过返回 0，否则非 0。

- [x] **Step 1: 先验证门禁会拒绝伪通过。** 用例覆盖 missing/not_run/skipped/blocked/fail、无云 ID、无证据文件、版本或配置不匹配；命令：`node --test tests/gates/verify-gate.test.mjs`，先失败再实现。
- [x] **Step 2: 实现门禁。** 每份报告记录被测代码提交及其工作树清洁状态，独立记录共同 lockfile/版本/目标计划指纹；代码提交允许因顺序实施而不同，但三项证据必须覆盖当前相关代码，不接受相关路径已变更的旧证据。失败不得通过修改报告状态消除。
- [ ] **Step 3: 执行三项云探针和门禁。** 依次运行任务 1–3 的 cloud 命令，再运行 `npm run verify:gate -- --evidence-dir artifacts/gates`，预期三项 pass 且退出 0。
- [x] **Step 4: 固化结论。** 摘要包含选定依赖/模型/计划、允许输入上限、实际费用、覆盖范围、未验证的正式收款事项及证据摘要。原始日志、Cookie 和 secret 不入库；公开摘要由人工检查脱敏。
- [x] **Step 5: 提交阶段一结果。** 任一失败则修复、复测并更新对应设计决策；全部通过后才允许执行任务 5。若失败要求改数据库、认证或运行平台，应先回到设计评审，不静默扩大架构。

## 阶段二 公共应用模板

### Task 5: 配置、本地工具链与两端构建

**Files:**
- Create: `app.config.ts`、`src/shared/config.ts`、`src/client/main.tsx`、`src/client/router.tsx`。
- Create: `src/server/app.ts`、`src/server/entrypoints/web.ts`、`src/server/entrypoints/agent.ts`。
- Create: `vite.config.ts`、`wrangler.jsonc`、`scripts/dev.mjs`、`scripts/deploy.mjs`、`tests/build/boundaries.spec.ts`、`tests/integration/deployment.spec.ts`。
- Modify: `package.json`、`package-lock.json`。

**Interfaces:**
- Consumes: 通过的阶段一结论；复用已证明的原生资源准备顺序。
- Produces: `AppConfig`（slug/title/preset、可选 billing）、`readPublicConfig(config)` 的公开白名单，以及 dev/deploy:dev/deploy:prod 命令。`DeploymentContext` 固定目标 account、环境、preset 和资源映射；`assertPresetTransition(context): Promise<void>` 在危险切换时拒绝发布。

- [ ] 写失败断言：`client_cannot_import_server`、`web_build_has_no_agent_or_workflow`、`unknown_api_returns_json`、`spa_deep_link_refreshes`、`build_and_migration_share_d1`；`refuses_agent_to_web_with_active_runs` 用状态读取替身验证部署拒绝契约，任务 11 接通真实数据验收。
- [ ] 运行 `npm run test:build`，观察缺实现导致失败。
- [ ] 实现模板入口与薄脚本；前端先构建，远程 migration 只在构建成功后运行；secret 不进入公开配置；资源 ID 持久化到源配置。Agent→Web 切换必须先停止接收新运行，再确认无活动运行、待投递事件和未结算预占；条件不满足时保留现有 Agent 版本，不自动删资源。
- [ ] 运行 `npm run type-check`、`npm run test:build`、`npm run test:integration -- deployment`，再对临时 dev/prod 资源验证同一流程和重复发布。
- [ ] 提交配置与构建闭环；模板运行时不得 import 探针实现。

### Task 6: 前端基础、账号与管理员初始化

**Files:**
- Create: `src/client/components/ui/`、`src/client/layouts/`、`src/client/lib/{api,query,auth}.ts`、`locales/{zh-CN,en}.json`。
- Create: `src/server/auth/{auth,bootstrap,invitations,mail}.ts`、`src/server/db/schema.ts`、`migrations/0001_identity.sql`。
- Create: `src/server/administration/users.ts`、`src/client/pages/admin/UsersPage.tsx`、`src/client/pages/auth/{SignUp,VerifyEmail,ResetPassword}.tsx`。
- Create: `tests/integration/auth.spec.ts`、`tests/e2e/auth-shell.spec.ts`。

**Interfaces:**
- Consumes: `AppConfig`、同源 API 客户端和锁定 Better Auth 版本。
- Produces: 服务端 `requireIdentity(request, bindings)` 返回 `{userId, role}`；前端认证仅用 Better Auth，会话不复制到 Zustand。`/api/admin/users` 提供查询、邀请和受保护的账号恢复，管理员变更记录操作 ID、原因及审计日志。

- [ ] 写失败用例：一次性初始化、令牌过期、邀请有效期、角色越权、普通用户不能调用管理操作、恢复操作幂等且有审计。增加 `public_signup_verifies_email_and_resets_password`、重复/过期令牌拒绝；浏览器覆盖注册→邮件验证→登录→密码重置，以及深链接、登录恢复、登出/换号清理缓存、主题、中英文及移动导航。
- [ ] 运行 `npm run test:integration -- auth` 与 `npm run test:e2e -- auth-shell`，预期先失败。
- [ ] 实现 shadcn/Radix 基础、React Router Data 布局、Query/RHF/Zod 规则及身份持久化；Better Auth schema 纳入 Drizzle/D1 migration，启动只检查版本。实现用户管理和公开模式页面；默认邀请模式无邮件前置，公开模式缺 Resend 配置时拒绝发布。
- [ ] 运行上述测试与 type-check；邮件测试通过后端 Resend 替身提取令牌，但保留实际验证/重置 API、数据库及 Cookie 链路。在目标云计划复核登录 CPU，无 secret 输出；启用公开模式的云环境还须执行真实邮件冒烟。
- [ ] 提交可登录的应用工作台；复制第三方组件时保留许可证。

### Task 7: 业务记录与私有文件

**Files:**
- Create: `src/features/records/{client,server,shared}/`、`src/server/files/{routes,storage}.ts`、`src/server/maintenance.ts`、`migrations/0002_records_files.sql`。
- Create: `tests/integration/records-files.spec.ts`、`tests/e2e/records-files.spec.ts`。

**Interfaces:**
- Consumes: `requireIdentity`、QueryClient 和私有 R2 binding。
- Produces: `/api/records` 的分页 CRUD，`/api/files` 的上传/下载/删除；DTO 带 owner 校验，文件响应不暴露公共 bucket 权限。

- [ ] 写失败用例：分页/筛选 URL 恢复、两个用户互访拒绝、超限文件拒绝、上传后绑定失败清理、重复删除。
- [ ] 运行 `npm run test:integration -- records-files`，确认失败场景确实命中后端。
- [ ] 实现 feature 两侧代码、条件 SQL/唯一约束、服务端大小限制和孤立文件清理；清理失败进入有批次上限的公共维护 handler 重试，后续支付与 Agent 复用该 Scheduled handler。局部 UI 不新建全局 store。
- [ ] 运行目标 integration/e2e、type-check，并验证普通 Web 配置不创建 AI/Workflow 资源。
- [ ] 提交完整 Web 示例。

## 阶段三 支付与权益

### Task 8: Stripe 初始化、Checkout 与 Portal

**Files:**
- Create: `src/features/billing/shared/contracts.ts`、`src/features/billing/server/{catalog,checkout,portal}.ts`。
- Create: `scripts/setup-billing.mjs`、`migrations/0003_billing.sql`、`tests/integration/billing-setup-checkout.spec.ts`。
- Modify: `scripts/deploy.mjs`、`src/shared/config.ts`。

**Interfaces:**
- Consumes: `billing` 的单币种最小单位价格及额度配置、`requireIdentity`；复用任务 1 已验证的同步原则。
- Produces: `/api/billing/checkout` 接收 `{planKey, operationId}` 返回 `{url}`；`/api/billing/portal` 返回门户 URL；只在配置和运行凭据就绪后开放 Checkout。

- [ ] 写失败用例：首次/重复同步、改价保留旧 Price、创建后响应丢失、签名 secret 未发布、错误 livemode、重复点击及已有订阅防重。
- [ ] 运行 `npm run test:integration -- billing-setup-checkout`，预期失败。
- [ ] 实现 Customer/对象映射与持久幂等；部署后同步支付对象，再保存并发布 webhook secret，确认运行版本可验签后标记就绪。
- [ ] 本地真实应用 API 验证后，在 Stripe Sandbox 执行同一同步器与 Checkout/Portal 测试；不创建真实交易。
- [ ] 提交支付入口；订单支付结果由任务 9 完成，不能在本任务先授予权益。

### Task 9: Webhook、权益账本与支付界面

**Files:**
- Create: `src/features/billing/server/{webhook,entitlements,reconcile}.ts`、`src/features/billing/client/{PricingPage,BillingPage,PaymentReturnPage}.tsx`。
- Create: `src/features/billing/server/admin.ts`、`src/features/billing/client/AdminBillingPage.tsx`。
- Create: `migrations/0004_entitlements.sql`、`tests/integration/billing-events.spec.ts`、`tests/e2e/billing.spec.ts`。
- Modify: `src/server/maintenance.ts`。

**Interfaces:**
- Consumes: 任务 8 的订单、Customer、Price 与账期映射。
- Produces: `getEntitlements(userId)`；`grantInvoice(invoiceId)`、`grantPurchase(orderId)`、`reverseGrant(sourceId, operationId)`，均以唯一业务键幂等。`/api/admin/billing` 提供订单/订阅查询、受保护的对账重试和权益调整；变更需操作 ID、原因和审计。

- [ ] 写失败用例：原始体验签、回跳先到、异步到账、相同/不同事件重复授予、旧账期晚到、续费失败、到期取消、退款仅影响对应权益、部分退款与争议进入审核；普通用户不能执行支付管理，重试/调整幂等且留审计。
- [ ] 运行 `npm run test:integration -- billing-events`，预期失败；使用后端供应商替身控制乱序，但保留真实验签、SQL 和权益链路。
- [ ] 实现 D1 原子事件处理、权益账本、支付管理页面与公共 Scheduled 对账；按设计保留一次性额度、订阅不结转、续费失败不赠送新账期。
- [ ] 实现套餐/订单/订阅界面；返回页最多自动等 60 秒，只查询服务端结果，确认后失效相关 Query；运行 `npm run test:e2e -- billing` 并完成 Sandbox 购买/续费/取消/退款冒烟。
- [ ] 提交完整支付与权益闭环。

## 阶段四 Agent 与持久任务

### Task 10: 聊天、历史与确认工具

**Files:**
- Create: `src/features/agent/shared/contracts.ts`、`src/features/agent/client/{ChatPage,runtime,ToolConfirmation}.tsx`。
- Create: `src/features/agent/server/{chat,history,models,tools,prompts}.ts`、`migrations/0005_conversations.sql`。
- Create: `src/server/limits.ts`。
- Create: `tests/integration/agent-chat.spec.ts`、`tests/e2e/agent-chat.spec.ts`。

**Interfaces:**
- Consumes: 阶段一锁定的模型/适配器/协议，records/files 和服务端权益。
- Produces: `/api/agent/chat` 的已验证流协议、会话历史接口、带 operationId/expectedVersion 的工具确认；所有工具在服务端检查身份和归属。公共 `checkAndReserveRun({userId, runId, kind})` 返回 `RunLease`，`settleRunLease(runId)` 幂等结算/释放，每日计数和并发 lease 在本任务迁移中落库，任务 11 复用。

- [ ] 写失败用例：历史刷新不重生成、用户隔离、读取工具、确认/拒绝/过期、取消后迟到 token、不允许工具改写角色/金额；并发或每日调用超限拒绝、最大输出和工具轮数生效、流失败后名额可回收。
- [ ] 运行 `npm run test:integration -- agent-chat` 与浏览器目标测试，确认先失败。
- [ ] 实现薄模型和 assistant-ui 适配、Prompt/工具 schema、消息与结果持久化；统一在模型前预占运行名额，单次输出/输入上限来自阶段一已测基线，初始每日调用 20、每用户并发 1、最多工具轮数 3，应用可单处调整且不得放宽到未验证输入边界。token 不逐个触发 Query/API 写入，不搬小说专用 runtime。
- [ ] 确定性供应商测试后跑真实模型冒烟与 CPU 复核，验证普通 Web 构建不包含 Agent 模块。
- [ ] 提交短对话与工具闭环并保留调用上限；付费 credit 的预占和结算由任务 11 完成。

### Task 11: Workflow、outbox、取消和用量

**Files:**
- Create: `src/features/agent/server/workflows/ReportWorkflow.ts`、`src/features/agent/server/{runs,outbox,usage}.ts`。
- Create: `src/features/agent/client/{TasksPage,AdminRunsPage}.tsx`、`src/features/agent/server/admin.ts`、`migrations/0006_runs_usage.sql`。
- Create: `tests/integration/agent-recovery.spec.ts`、`tests/e2e/agent-report.spec.ts`。
- Modify: `src/server/maintenance.ts`、`src/server/limits.ts`、`scripts/deploy.mjs`。

**Interfaces:**
- Consumes: 任务 3 验证的并发和恢复约束、任务 9 的权益、任务 10 的工具与模型。
- Produces: 创建/确认/取消/查询任务 API、一个运行对应一个 Workflow 实例、`reserveUsage`/`settleUsage`/`releaseUsage` 幂等操作和公共维护 Scheduled handler。长任务与短聊天共用 `checkAndReserveRun`；`/api/admin/runs` 提供状态/错误/用量、重试/取消及停止接收新运行的管理入口，管理操作有权限、幂等与审计。

- [ ] 将阶段一关键故障用例移入正式实现：提交后中断、投递重放、提前确认、取消竞争、重试、租约回收；再测聊天/Workflow 不能跨路径绕过每日/并发限制、重试耗尽预算必须终止、普通用户不能执行管理操作。运行目标测试先失败。
- [ ] 实现资料整理报告 Workflow、D1 outbox、条件状态提交、`waitForEvent`、timeout/重试预算与私有 R2 结果；每步骤最多额外重试 1 次且记录全部供应商 attempt，并持续执行输出/工具上限。实现运行管理与限额展示，禁止依赖 HTTP `waitUntil` 承担持久任务。
- [ ] 接通付费额度：余额预占与并发名额分开，重复调用不能多扣；模板默认按每个成功逻辑生成步骤扣一个 credit，失败或未完成步骤不扣，供应商每次尝试成本独立记录；应用可以在单处调整扣量规则。发布说明明确此示例规则不保证盈利。
- [ ] 验证关闭页面后继续、确认超时、主动取消、刷新结果和每 5 秒可见页面轮询；接通任务 5 的真实部署检查，验证停收→排空/取消→结算后才能切 Web，任何活动运行、待投递或未结算项都拒绝切换并保留当前版本。`npm run test:integration -- agent-recovery`、`npm run test:e2e -- agent-report` 及云端真实 Workflow/模型/CPU 冒烟通过。
- [ ] 提交 Agent 完整示例；变更阶段一核心版本、平台配置或恢复逻辑时重跑对应 gate。

## 阶段五 独立交付

### Task 12: 两个干净应用、CI 与首个版本

**Files:**
- Create: `.github/workflows/ci.yml`、`tests/reuse/{web,agent}.spec.ts`、`docs/getting-started.md`、`docs/deployment.md`、`docs/billing.md`、`CHANGELOG.md`。
- Modify: `README.md`、`AGENTS.md`、`package.json`、示例配置与受控环境变量模板。

**Interfaces:**
- Consumes: 全部已验证能力和阶段一结果。
- Produces: 独立 clone 后无需父仓库即可创建 Web/Agent 应用的文档、完整验证命令和首个版本。

- [ ] 从两个全新目录分别创建 Web 和 Agent 应用，不用父仓库、旧 node_modules 或开发者私人配置；先记录暴露的失败。
- [ ] 修正并验证 `npm ci`、`npm run dev`、dev/prod 发布、首次管理员、重复发布；收款演示使用 Sandbox，正式模式只检查就绪，禁止自动扣款。
- [ ] CI 覆盖类型/边界、行为、真实本地 API 与浏览器链路；Cloudflare 和 Stripe Sandbox 冒烟显式按需运行并输出证据，fork PR 不获得云 secret。
- [ ] 发布说明记录核心 CPU 分布、模型与版本、免费额度限制、Paid 要求、第三方许可证和已知范围；核对 README 只列真实存在的命令。
- [ ] 全链路通过后在独立仓库发布首版并启用 GitHub template 标记；父仓库更新已推送 commit 的 gitlink。

## 计划自检与执行交接

设计覆盖映射：前端/打包对应 5–7，少配置/环境/部署对应 1、5、12，账号对应 2、6，数据文件对应 7，支付对应 1、8–9，聊天对应 2、10，恢复及用量对应 3、11，成本及运行边界对应 2、4、12。

每个任务按“失败断言 → 验证失败 → 最小实现 → 验证通过 → 小步提交”执行。阶段一可以在独立仓库完成验证工具链，但不得先做应用壳、业务 UI 或通用抽象。通过后才进入任务 5。

建议执行方式：我按依赖顺序在同一会话实施，每个阶段结束安排独立子 agent 审阅；阶段一 Gate 单独审阅证据。该方式控制交接成本，同时在支付、恢复和最终交付处保留独立检查。计划评审通过后再开始阶段一。
