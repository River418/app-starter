# App Starter

中文 · [English](../README.md)

App Starter 是一个采用 MIT 许可证、部署在 Cloudflare 上的全栈应用模板。它将 React 工作台、认证、管理员工具、业务数据、私有附件、可选支付与邮件能力整合起来，让你从产品功能开始开发，减少每次新建应用时重复搭建基础系统的工作。

它适合需要用户账号的工具、订阅产品和内部工作台。内置的记录管理示例串起了表单校验、接口鉴权、数据持久化和文件附件，你可以替换或扩展这个模块来构建自己的应用。代码、服务账号和部署资源都由你管理，无需依赖共享的 App Starter 服务。

## 基本能力

| 领域 | 提供的能力 |
|---|---|
| 账号与访问控制 | Supabase 邮箱密码登录、邀请制或公开注册、邮箱确认、密码恢复，以及服务端成员和管理员权限检查 |
| 管理能力 | 首位管理员的一次性初始化、包含角色与状态的用户列表、邀请和恢复链接、邀请撤销，以及管理操作审计记录 |
| 应用界面 | 响应式工作台、受保护路由、中英文翻译、明暗主题、可复用表单和对话框组件，以及通知提示 |
| 业务数据 | 基于 D1 的记录增删改查、标题搜索、分页和用户数据隔离；表单与接口共用 Zod 契约 |
| 私有文件 | 私有 R2 附件存储、鉴权下载、可配置的上传大小限制，以及定时清理 |
| 支付 | 可选的 Stripe 月订阅和一次性额度包、托管 Checkout、客户 Portal、账单查看和到期取消订阅 |
| 权益 | 分别管理免费额度、订阅周期额度和已购额度，支持功能权限、重复发放防护、按来源处理退款和争议，以及管理员恢复操作 |
| 邮件 | 可选的 Cloudflare 域名地址转发现有邮箱、Resend 事务邮件发送，以及 Supabase 自定义 SMTP 配置指引 |
| 部署 | 前端资源与 API 同源部署、原生 Vite/Wrangler 工具、独立的 local/dev/prod 资源，以及只向前执行的 D1 迁移 |

默认采用邀请模式，不需要邮件供应商。公开注册需要通过 Supabase 向用户发送邮箱验证邮件。支付和邮件能力均可选，未配置时不启用。

## 技术与运行架构

| 层级 | 技术 |
|---|---|
| 浏览器 | React、TypeScript、Vite、React Router、TanStack Query |
| 表单与 UI | React Hook Form、Zod、Radix 基础组件、Tailwind CSS、Lucide、Sonner、i18next |
| API | 运行在 Cloudflare Workers 上的 Hono |
| 身份认证 | Supabase Auth |
| 业务数据库 | Cloudflare D1、Drizzle ORM，以及用于协调写入的显式 SQL |
| 文件存储 | 私有 Cloudflare R2 |
| 可选集成 | Stripe、Cloudflare Email Routing、Resend |

Vite 分别构建浏览器静态资源和 Worker。Supabase 负责身份认证；应用成员、记录、文件元数据、订单和权益账本保存在 D1，文件内容保存在 R2。业务模块按 `client`、`shared`、`server` 拆分，防止服务端实现或密钥进入浏览器包。

## 本地启动

安装 Node.js 24+、npm、Docker 和 [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)。启动 Docker，将 CLI 加入 `PATH`，或通过 `SUPABASE_CLI` 指定可执行文件路径。本地 D1/R2 不需要 Cloudflare 账号。

```sh
npm ci
npm run auth:local:start
npm run dev
```

打开 `http://localhost:5173`。在另一个终端生成首位管理员的初始化链接：

```sh
npm run bootstrap:token -- local
```

打开 `.local/bootstrap-local.txt` 中的私有链接创建管理员。链接有效期为 30 分钟，只用于初始化首位管理员。之后可在应用中管理用户并分享邀请链接。

本地 Auth 使用隔离的 `app-starter-e2e` 项目。启动命令将本地凭据保存在忽略提交的 `.local/` 中，仅在 `.dev.vars` 不存在时创建该文件，已有文件会保留。Mailpit 地址为 `http://localhost:55324`。使用 `npm run auth:local:stop` 停止服务，本地数据会保留。

也可以使用独立的 Supabase 托管开发项目，参考 `.dev.vars.example` 填写 `.dev.vars`。集成测试仍使用隔离的本地 Auth。详见[开发与认证配置](deployment.md)。

## 配置应用

在 `app.config.ts` 中设置公开的应用配置：

```ts
import type { AppConfig } from './src/shared/config';

const config: AppConfig = {
  slug: 'my-app',
  title: 'My App',
  preset: 'web',
  authMode: 'invite',
  maxFileBytes: 10 * 1024 * 1024,
};
export default config;
```

| 配置内容 | 存放位置 |
|---|---|
| 名称、注册模式、上传限制、可选支付和邮件设置 | `app.config.ts` |
| 目标账号、公开 Auth 配置和 D1/R2 资源映射 | `wrangler.jsonc` 中对应的环境 |
| 本地运行凭据 | 忽略提交的 `.dev.vars` |
| dev/prod 初始化凭据 | 忽略提交的 `.dev.vars.dev` / `.dev.vars.prod`，或 CI 环境变量 |
| 部署后的服务端密钥 | Cloudflare Worker secrets |

浏览器只会通过 `/api/config` 获得公开配置白名单。不要将 secret key 放入 `app.config.ts`、`VITE_*` 变量或版本控制。

启用支付时，添加 `billing` 配置，填写币种、价格和权益，并提供对应环境的 Stripe 密钥。正常部署会同步自有 Product、不可变 Price、Portal 和 Webhook 配置，发布服务端密钥，并在就绪检查通过后开放 Checkout。详见[支付与权益](billing.md)。

邮件配置可选择转发、发送或两者同时启用，随后运行 `npm run email:setup -- dev`。转发需要由 Cloudflare 管理的域名和已有的已验证收件邮箱，不提供邮箱托管；Resend 发信需要验证域名。公开注册使用的 SMTP 和邮件模板需在 Supabase 中配置。详见[邮件配置](email.md)。

## 部署

为目标环境创建独立的 Supabase 托管项目，配置邮箱密码、邮箱验证策略、注册模式、Site URL 和 `/auth/confirm` 回调地址，再将账号与公开配置填入 `wrangler.jsonc` 中对应的环境。

```sh
npx wrangler login
npm run deploy:dev -- --prepare
npx wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc --env dev
npm run deploy:dev
npm run bootstrap:token -- dev
```

准备命令会创建或复用一个 D1 数据库和一个私有 R2 bucket，并保存资源映射。请在派生应用中提交这些不含密钥的映射。部署命令会检查配置、构建应用、执行只向前的迁移并检查健康状态。

正式环境使用 `prod`。dev/prod 必须分别使用独立的 Supabase 项目、D1 数据库、R2 bucket 和密钥。各服务有独立配额和费用；需要评估 Worker CPU 限制，启用支付时按 Workers Paid 准备。部署命令不会购买套餐。详见[部署说明](deployment.md)和 [Cloudflare 定价](https://developers.cloudflare.com/workers/platform/pricing/)。

## 开发与检查

运行集成测试或浏览器测试前，先启动本地 Auth：

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地前端与 Worker 开发 |
| `npm run build` | 输出 `dist/client` 和 `dist/worker` |
| `npm run type-check` | TypeScript 检查 |
| `npm test` | 构建与初始化、应用集成，以及探针回归测试 |
| `npm run test:e2e` | 工作台、认证、记录和附件的浏览器测试 |
| `npm run test:e2e:public` | 公开注册与恢复的浏览器测试 |
| `npm run test:e2e:billing` | 使用确定性外部支付替身的支付浏览器测试 |

应用测试访问真实的本地 Auth、Worker API 和持久化存储。浏览器测试需串行运行：公开注册和支付测试会临时切换各自配置，并在结束后恢复。真实供应商验收使用单独的按需命令，见[支付说明](billing.md)。

## 项目目录

```text
app.config.ts        应用配置
src/client/          React 外壳、路由、UI 和客户端工具
src/features/        按 client/shared/server 拆分的业务模块
src/server/          API、Auth、管理、数据库、文件和邮件
src/shared/          不依赖运行环境的配置与契约
scripts/             开发、部署和供应商初始化工具
migrations/          只向前执行的 D1 迁移
locales/             中英文翻译
supabase/            本地 Auth 配置与邮件模板
tests/               构建、集成、浏览器和供应商测试
docs/                部署与集成指引
probes/              隔离的实验与回归测试资料
```

架构、代码边界和按改动选择的验证要求见 [AGENTS.md](../AGENTS.md)。贡献代码应从功能分支发起 PR，禁止直接推送 `main`。Fork 和派生仓库需要自行配置 GitHub 保护。详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

[MIT 许可证](../LICENSE) · [依赖声明](../THIRD_PARTY_NOTICES.md)
