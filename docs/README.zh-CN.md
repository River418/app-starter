# app-starter

可独立克隆的 MIT 开源应用模板。提供 React 工作台、Supabase Auth、管理员初始化与邀请、D1 记录和私有 R2 附件，以及可选的 Stripe 支付和权益账本。Agent 运行与用量结算属于第四阶段；`agent` 目前只有独立构建入口。

支付默认关闭。在 `app.config.ts` 配置单币种月订阅/额度包，在忽略提交的 `.dev.vars.dev` 配置自己的 `STRIPE_SECRET_KEY`，随后正常部署。工具自动同步 Product、版本化 Price、独立 Portal 和 Webhook，发布签名密钥并验证运行版本后才开放支付。无需手工复制 Price ID。真实托管 Sandbox 的 Checkout/Portal 已通过本地应用验证，Stripe 直达 Cloudflare 回调及托管 Supabase 认证也已验证；完整云端应用的 hosted Checkout 尚未完成。详见[支付配置与恢复](billing.md)、[第三阶段验收](validation/phase-three-status.md)及[云端证据与边界](validation/cloud-payment-2026-10-18.md)。

[邮件能力](email.md)同样可选：Cloudflare 将域名别名转发到你的现有邮箱，Resend 从验证过的域名发信，也可作为 Supabase 自定义 SMTP。`npm run email:setup -- dev` 负责可重复的域名/DNS/转发配置与待验证状态；默认邀请模式不要求域名或发信供应商。本轮不绑定真实域名，按 novel-writer 的发送/错误行为完成本地对标验证。

安装 Node.js 24、Docker 和官方 Supabase CLI 后：

```sh
npm ci
npm run auth:local:start
npm run dev
```

另开终端运行 `npm run bootstrap:token -- local`，打开 `.local/bootstrap-local.txt` 的一次性链接创建管理员。默认邀请模式不需要 SMTP，可在用户页面生成邀请/恢复链接。

名称等应用配置放在 `app.config.ts`；每个环境的 Cloudflare 绑定与 Supabase 连接分别配置。前端只读取 `/api/config` 白名单；secret key 只放 Worker secret。开发和正式环境使用不同的 Supabase、D1 与 R2。

```sh
npm run type-check
npm test
npm run test:e2e
npm run test:e2e:public
npm run test:e2e:billing
```

测试访问真实本地 Auth、Postgres、邮件、Worker API、D1 与 R2，不拦截浏览器后端请求。公开模式测试临时切换并恢复配置。2026-10-18 已使用独立免费 Supabase 项目验证云端邀请模式的初始化、登录、会话及管理员鉴权；该模式不要求 SMTP。本轮未验证托管 SMTP 或生产环境。

部署使用原生工具：配置环境 → `npm run deploy:dev -- --prepare` → `wrangler secret put` → `npm run deploy:dev`。正式环境换用 `prod`。详见 [部署](deployment.md)、[架构](architecture.md)、[验收](validation/phase-two-status.md)。本轮支付对账路径的 40 个 CPU 样本全部超过 10 ms，Workers Free 门槛失败；启用支付建议按 Workers Paid 规划，Paid 尚未实测，也不会自动购买。历史 Better Auth 免费档失败证据保留。
