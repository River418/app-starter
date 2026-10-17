# app-starter

可独立克隆的 MIT 开源应用模板。第二阶段提供 React 工作台、Supabase Auth、管理员初始化与邀请、D1 记录和私有 R2 附件。支付和 Agent 运行时属于后续阶段；`agent` 目前只有独立构建入口。

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
```

测试访问真实本地 Auth、Postgres、邮件、Worker API、D1 与 R2，不拦截浏览器后端请求。公开模式测试临时切换并恢复配置。完整云认证需要你自己的专用 Supabase 项目和 SMTP，本地通过不代表云端 CPU 或邮件投递已验证。

部署使用原生工具：配置环境 → `npm run deploy:dev -- --prepare` → `wrangler secret put` → `npm run deploy:dev`。正式环境换用 `prod`。详见 [部署](deployment.md)、[架构](architecture.md)、[验收](validation/phase-two-status.md)。密码哈希交给 Supabase 不保证所有请求满足 Free CPU，必要时仍需付费。历史 Better Auth 免费档失败证据保留。
