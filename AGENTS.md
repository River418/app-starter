# Agent 项目指南

本仓库是独立的 MIT 开源 Cloudflare 应用模板，包含 React 浏览器应用和同源 Worker API。
修改前以实际源码、`package.json` 和配置文件为准；不要把实验探针或历史验证报告当成产品实现。
每个派生应用使用自己的账号、资源、配置与凭据，不依赖其他项目的源码或运行环境。

## 分支与协作

- 遵循 [CONTRIBUTING.md](CONTRIBUTING.md)。所有改动，包括文档、紧急修复和自动化，都必须通过 PR 合入 `main`。
- 禁止直接推送、强推或删除 `main`，管理员和维护者同样适用；不得临时削弱保护来合并改动。
- Codex 使用从最新 `main` 创建的 `codex/<topic>` 分支；PR 合并后，新工作使用新分支和新 PR。
- 保持 main ruleset 的 PR、解决评审讨论、禁止强推和删除要求，且不配置绕过者。
- 零必需审批支持单维护者通过 PR 合并；必需 CI 检查必须对应实际存在的检查，不能假称已配置。
- 派生仓库需要自行配置分支保护，复制源码不会自动复制 GitHub 仓库规则。
- 保留他人的未提交修改、独立 worktree 和私有配置；未经授权不清理或重置它们。
- PR 写明具体问题、修改行为、验证结果和未执行的检查，通过 PR 合并操作完成集成。

## 目录与修改入口

| 路径 | 职责 |
|---|---|
| `app.config.ts` | 应用名称、preset、认证模式、上传上限及可选支付/邮件配置 |
| `wrangler.jsonc` | Worker、静态资源路由、环境变量、D1/R2 绑定与 Cron |
| `vite.config.ts` | React/CSS 构建、Cloudflare 插件、入口选择和源码边界检查 |
| `src/client/main.tsx` | React 挂载、Query Provider、Router Provider |
| `src/client/router.tsx` | 页面路由、配置 loader、会话和管理员布局检查 |
| `src/client/layouts/` | 公共页面、工作台布局、身份切换处理、主题和语言控件 |
| `src/client/lib/` | API 错误封装、Supabase 浏览器客户端、Query 与 i18n 配置 |
| `src/client/pages/auth/`、`src/client/pages/admin/` | 登录/注册/找回/确认/初始化页面与用户管理 |
| `src/client/components/ui/`、`src/client/styles.css` | 通用 UI 组件及样式 |
| `src/features/records/{client,shared,server}/` | 记录页面、输入契约和所有者隔离的 CRUD |
| `src/features/billing/{client,shared,server}/` | 定价/账单/返回/管理页面、支付契约和服务端支付逻辑 |
| `src/shared/` | 纯配置类型、身份 DTO、支付和邮件配置校验 |
| `src/server/app.ts` | Hono 中间件、路由组装、配置/会话/健康接口及统一错误处理 |
| `src/server/entrypoints/` | Worker fetch/scheduled 入口 |
| `src/server/auth/` | Supabase 服务端适配、身份验证、初始化、邀请与恢复流程 |
| `src/server/administration/users.ts` | 管理员用户列表、邀请、恢复与邀请撤销 |
| `src/server/db/schema.ts` | 成员、记录、附件的 Drizzle 映射；完整数据库结构还需查迁移 |
| `src/server/files/`、`src/server/maintenance.ts` | 私有附件 API、有限上传读取、删除与失败恢复 |
| `src/server/email/send.ts` | 可选 Resend 事务邮件发送辅助函数 |
| `src/server/types.ts` | Worker Bindings、Hono 上下文和服务端身份类型 |
| `migrations/` | D1 顺序迁移，包含身份、业务记录、支付和权益表 |
| `scripts/` | 本地环境、构建约束、原生部署、支付/邮件配置及测试编排 |
| `locales/en.json`、`locales/zh-CN.json` | 英文与简体中文界面文案 |
| `supabase/` | 隔离的本地 Auth 配置和认证邮件模板 |
| `tests/build/` | 配置、部署前置条件、边界、产物和供应商初始化测试 |
| `tests/integration/` | 本地 Worker、D1、R2、Auth 与业务集成测试 |
| `tests/e2e/`、`tests/support/` | 浏览器流程及显式的外部支付供应商测试替身 |
| `tests/sandbox/` | 显式启用的真实 Stripe Sandbox 测试 |
| `probes/`、`tests/probes/`、`tests/gates/` | 独立技术实验、证据处理和验证器测试 |
| `docs/` | 架构、部署、支付、邮件说明与按范围记录的验证证据 |

`dist/`、`node_modules/`、本地运行状态和测试输出是生成内容，不是业务源码。
不要将探针代码、测试凭据、构建产物或私有运行日志引入产品依赖。

## 运行入口与请求链路

1. Vite 以 `app.config.ts` 的 preset 选择 `src/server/entrypoints/<preset>.ts`，输出 `dist/client` 和 `dist/worker`。
2. Cloudflare 静态资源配置提供 SPA；`/api` 与 `/api/*` 优先交给 Worker，未知 API 返回 JSON 错误。
3. `web.ts` 将 fetch 交给 `app.fetch`；`app.ts` 设置禁止缓存等响应头，执行写请求 Origin 检查，再分发功能路由。仅签名保护的 `POST /api/billing/webhook` 豁免 Origin 检查。
4. 需要身份的 API 调用 `requireIdentity`，随后执行参数校验、业务规则和 D1/R2/供应商操作。
5. 浏览器通过 `src/client/lib/api.ts` 发同源请求并统一处理错误；页面从公开配置接口取得允许暴露的配置。
6. `web.ts` 的唯一 scheduled 入口并行运行附件清理和支付恢复，各最多检查十个候选项，默认 Cron 每十分钟执行。

`src/server/entrypoints/agent.ts` 当前仅转导出 Web 实现，是预留的独立入口。
不要据此宣称已具备 Agent 运行、Workflow、模型聊天或用量结算；依赖列表中的实验 SDK 也不是功能依据。
部署对 `agent` → `web` 切换保守拒绝，不能删除远端 preset 检查或只依赖本地状态绕过它。

## 客户端、服务端与共享边界

- `client` 负责渲染、交互和请求；`server` 负责绑定、密钥、鉴权、持久化和供应商调用。
- `shared` 只放两端可用的纯类型、DTO、校验与配置归一化；不能读取 Worker 绑定或进程密钥。
- 浏览器和 shared 不得导入服务端实现、`app.config.ts`、探针、Node/Cloudflare 运行时模块或服务端 SDK。
- `scripts/boundaries.mjs` 检查 import、re-export、动态导入和 require；不要通过转导出或非字面量导入规避。
- `tests/build/artifacts.test.mjs` 检查真实模块图、Worker 内容和绑定；修改入口或依赖后需要核对实际产物。
- React Router loader 负责配置与受保护布局，TanStack Query 负责服务端数据，Supabase 负责认证状态。
- 身份主体变化时，`Root.tsx` 清空 Query 缓存、隐藏旧工作区并重验 loader，避免显示前一个用户的数据。
- 表单使用 React Hook Form/Zod；检索、分页等导航状态放在 URL；主题和语言是本地偏好。
- Query 默认有限重试，写操作不自动重试；新增可重试写操作必须先设计服务端幂等语义。
- 用户可见文案同步维护中英文；复用现有基础组件，不额外引入全局状态框架或通用插件层。

## 身份、数据库与附件

- Supabase Auth 管理身份、密码、验证邮件与会话；业务表、成员角色、记录、审计和权益放在 D1。
- `authClient` 按请求创建服务端客户端并更新 Cookie；`verifiedUser` 使用 `getUser()` 验证身份及邮箱确认状态，拒绝匿名身份。
- `requireIdentity` 再查询 D1 成员状态与角色；管理员 API 使用管理员检查，浏览器菜单不能作为授权依据。
- 不信任可编辑用户 metadata 中的角色。公开注册仅将已验证身份映射为普通成员，邀请模式要求已有有效成员。
- `bootstrap.ts` 负责一次性管理员初始化及跨供应商失败恢复；`invitations.ts` 负责邀请、恢复、确认与密码设置。
- 不把 Supabase 与 D1 当成一个事务；保留预留身份、操作 ID、条件更新和重试恢复逻辑。
- 初始化、邀请和恢复链接是 bearer 凭据。不要通过邮件预取 GET 消耗链接，不向日志或公开文件输出令牌。
- 邀请模式可由管理员生成链接，不要求 SMTP；公开注册需要配置 Supabase 邮件确认与自定义 SMTP。
- `src/features/records/server/routes.ts` 用 Drizzle 查询记录；每次读取和修改都必须保留 owner 条件。
- `migrations/` 是完整 D1 结构的依据，不能只修改 Drizzle 映射或假定它已映射支付表。
- 数据变更采用新增的 forward-only 迁移，不重写已应用迁移；同步更新健康检查的预期 schema 与相关测试。
- schema 兼容性由 `/api/health` 检查，API 启动不迁移数据库；需要原子性的状态、审计和账本变更使用条件 SQL/D1 batch。
- R2 桶保持私有，附件读取和下载必须核对所有者；下载保留 attachment 与 nosniff 响应头。
- 上传先写 D1 pending 日志，再有限读取请求体并写 R2，最后关联记录；保留字节上限及读取超时。
- 记录删除、上传中断或关联失败要保留可重试的对象映射；未完成上传的 tombstone 不能随意清理，否则晚到写入可能成为孤儿对象。

## 支付与邮件

- 支付默认关闭。配置类型见 `src/shared/config.ts`，归一化见 `src/shared/billing-config.ts`。
- `scripts/setup-billing.mjs` 通过 `billing-catalog.mjs` 同步自有 Product、版本化 Price、Portal 与 Webhook，并确认签名密钥就绪。
- `catalog.ts` 核对配置/凭据就绪，`checkout.ts` 管理客户、Checkout 操作复用及 Portal，`stripe.ts` 限定供应商配置。
- `webhook.ts` 对原始请求体验签并入持久 inbox；`reconcile.ts` 回查 Stripe 当前状态、处理租约和有界恢复。
- 保留环境、账户、customer、price 和应用归属校验；同时按事件与账单/购买来源幂等，避免不同通知重复发放。
- `entitlements.ts` 按免费、订阅账期与购买来源计算权益；退款/撤销只影响对应来源，不重置总余额。
- `admin.ts` 与支付管理路由负责恢复及调整；管理写操作要求身份、操作 ID、原因和审计。
- Checkout 创建成功、跳转成功和支付完成是不同状态；返回页应查询服务端已确认结果，不在客户端直接增加权益。
- 不删除事件重试、租约防护或唯一约束来让测试变绿；本地外部供应商替身不能替代业务数据库链路。
- 认证邮件由 Supabase 负责。`supabase/templates/` 的模板与 Site URL/redirect、SMTP 设置在 Supabase 侧配置。
- `scripts/setup-email.mjs` 和 `email-setup.mjs` 管理可选 Cloudflare 邮件转发与 Resend 域名/DNS 设置。
- `src/server/email/send.ts` 是带幂等键的服务端发送辅助函数，没有公共任意发信接口；不得公开邮箱、链接或供应商错误载荷。
- 邮件 API 接受请求不等于收件箱投递成功；初始化 DNS 也不等于 SMTP 已通过验证。

## 配置、环境与部署

- `app.config.ts` 放非秘密的应用选择；`wrangler.jsonc` 放各环境绑定与公开变量；密钥只放受忽略的本地配置或 Worker secrets。
- 浏览器只能读取 `src/server/config.ts` 明确列出的公开字段；不能直接序列化环境或整个应用配置。
- `SUPABASE_URL`/publishable key 可公开；Supabase server secret、Stripe key/signing secret、Resend key 仅在服务端使用。
- 本地、dev、prod 使用隔离资源。dev/prod 必须使用不同 Supabase 项目、D1、R2 和相应秘密。
- `scripts/config.mjs` 按 JSONC 读取 Wrangler 配置；不要用普通 JSON 解析器替代注释与尾逗号支持。
- `npm run dev` 先应用本地 D1 迁移再启动 Vite；本地身份依赖先运行 `npm run auth:local:start`。
- `npm run deploy:dev -- --prepare` 创建或复用目标 D1/R2，并保存非秘密资源映射；正式环境对应 `deploy:prod`。
- 在原始配置上用 `wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc --env dev` 配置服务端秘密。
- 正常部署入口为 `scripts/deploy.mjs`，校验目标、Auth 设置与环境隔离，然后类型检查、构建、检查目标 D1、远端 preset 和 secret，再远端迁移与部署。
- 只有 Vite 构建选择 `CLOUDFLARE_ENV`；后续 Wrangler 使用展开后的 `dist/worker/wrangler.json`，不能再次选择环境导致名称重复。
- 健康检查后按需执行支付初始化；邮件初始化是独立的 `npm run email:setup -- dev|prod`。
- 远端 D1 SELECT 需要 `--command --json` 的查询结果；`--file` 批量导入输出不能当作 SELECT 行读取。
- 保留部署的资源复用与配置归属检查，不用删除资源、旋转凭据或重置数据库解决普通重试问题。
- 默认 Cron 与恢复预算是运行行为，修改时同时检查 Wrangler 配置、入口、恢复逻辑和测试。
- 详细操作见 [部署](docs/deployment.md)、[支付](docs/billing.md)和[邮件](docs/email.md)；不要自动购买套餐、注册域名或扩大账号权限。

## 开发与验证选择

基础环境是 Node.js 24+、npm；本地 Auth 还需要 Docker 和 Supabase CLI，可通过 `SUPABASE_CLI` 指定可执行文件。
常用顺序：`npm ci` → `npm run auth:local:start` → `npm run dev`；首次管理员使用 `npm run bootstrap:token -- local`。

| 修改范围 | 对应检查与定位 |
|---|---|
| 文档 | 核对路径、命令和中英文语义；`git diff --check` |
| 类型、运行时代码 | `npm run type-check`；按贡献规范在提交集成前运行 `npm test` |
| 边界、依赖、部署与初始化 | `npm run test:build`；检查真实构建和相关部署脚本 |
| Auth、API、D1、R2、支付或邮件业务 | `npm run test:integration`，可附加目标文件名筛选；定位 `tests/integration/` |
| 登录、工作台、记录或附件流程 | `npm run test:e2e` |
| 公开注册和找回密码流程 | `npm run test:e2e:public` |
| 支付页面及本地业务链路 | `npm run test:e2e:billing` |
| 实际 Stripe API 与 hosted 页面 | 授权的专用 Sandbox 下运行 `npm run test:sandbox` / `npm run test:sandbox:browser` |
| 实验和证据验证器 | `npm run test:probes`；`npm run verify:gate` 只评估对应探针证据，不代表整个产品验收 |

- `npm test` 组合 build、应用 integration 和 probes；不包含浏览器套件或真实 Sandbox 套件。
- `vitest.app.config.ts` 指向应用集成测试；默认 `vitest.config.ts`/`test:workers` 面向探针，二者不要混用。
- 本地 Vitest 保持 `remoteBindings: false`；确定性测试不得依赖云登录、线上绑定或真实模型调用。
- 集成测试应用真实 D1 迁移并重置测试状态；需要身份的用例只接受 loopback 的隔离 Supabase，禁止指向托管身份数据。
- 本地 Auth 工具只管理自己的 `app-starter-e2e` 项目；不得修改其他项目或使用全局停止/无备份清理。
- E2E 使用真实应用 HTTP API、持久化和事件链路，不用浏览器路由拦截替代后端。
- 支付本地 E2E 可用明确的 loopback 外部供应商替身，但必须保留真实业务逻辑、验签与数据库写入。
- `public-e2e.mjs`、`billing-e2e.mjs` 和 Sandbox 浏览器编排会临时改配置；与开发服务及其他模式切换套件顺序执行，并确认恢复配置。
- 只清理当前测试创建的隔离数据；结束本地 Auth 使用 `npm run auth:local:stop`，保留数据备份。
- 云探针需显式 `--cloud`，真实支付测试需专用 Sandbox/test mode 和账户核对；未经授权不得操作生产数据或发起真实扣款。

## 文档维护

- `README.md` 与 `docs/README.zh-CN.md` 面向使用者，介绍实际能力、技术选型、配置、启动、部署和常用开发命令。
- 修改 README 时同步两个语言版本的章节、能力、前置条件、示例、命令和操作限制；相对链接按各自目录正确解析，不用机械复制相对路径。
- README 不记录阶段规划、完成状态、会话过程或验收日志，不将依赖列表、实验入口或未实现功能宣传为产品能力。
- 本文件面向执行工作的 Agent：维护目录职责、运行链路、边界、不变量、修改入口和验证要求，不追加历史授权、私人账户信息或每轮进度。
- 架构描述以源码为准，涉及配置/部署/业务行为的变更同时更新对应指引。详细操作放 `docs/deployment.md`、`docs/billing.md`、`docs/email.md`，验证记录放 `docs/validation/`。

## 凭据与证据

- 不提交环境秘密、Cookie、一次性链接、签名、用户原始载荷或未经脱敏的云日志；不要将它们写入 PR、聊天或测试断言输出。
- 排查先读源码、配置模板和脱敏证据；确需使用秘密时直接供工具调用，不打印整个环境或凭据文件。
- 共享公开配置时只保留必要信息；验证摘要移除个人邮箱、账户私有信息和可重放凭据。
- 区分本地替身、真实供应商 API、CLI 转发、直达云端回调和完整浏览器付款；一种证据不能替代另一种。
- 区分身份测试、手工数据库夹具、Checkout 会话创建和实际账本发放；说明夹具绕过了哪些正常入口。
- HTTP 成功、签名挑战、构建大小、启动耗时、请求 CPU 和最终权益是不同检查；不以客户端耗时替代 CPU。
- 缺失、跳过、未运行和失败均不能记作通过；套餐或环境变化后重新测量受影响范围，不自动推断性能或生产适用性。
- 发布验证结论时记录版本、环境、命令、样本范围及限制；完整证据放 `docs/validation/`，本指南不保存某次运行的数值或账号状态。
