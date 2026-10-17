# 运行验证探针

这是阶段一的可丢弃探针，不是阶段二的应用模板。前置条件是 Node 24+、`npm ci`。本地 `npm test`、`npm run type-check` 和三个 `--local` 命令无需有效 Cloudflare 凭据，也不会调用真实模型。

## 隔离资源与发布

云命令要求 Wrangler 已登录自己的账户。先检查 `probes/deployment/wrangler.jsonc` 内 dev/prod 的 `cfas-probe-*` 名称和目标账号；不能将现有产品资源作为探针目标。以下参数显式填写自己的账号及 workers.dev 子域，不把 API token 放命令行。

```sh
node probes/deployment/deploy.mjs --account <account-id> --environment dev --subdomain <subdomain> --prepare
node probes/deployment/deploy.mjs --account <account-id> --environment prod --subdomain <subdomain> --prepare
# 审核并提交资源映射及探针源码，再运行发布。
node probes/deployment/deploy.mjs --account <account-id> --environment dev --subdomain <subdomain>
node probes/deployment/deploy.mjs --account <account-id> --environment prod --subdomain <subdomain>
```

顺序是静态探针构建 → Worker dry run → D1 migration → 原生 Wrangler 发布。每个环境的认证和探针 secret 在首次发布前写入忽略的 `.local/probes/<env>/secrets.json`，后续复用；已有云 secret 而本机文件丢失时拒绝轮换。`clean rebuild` 只删除构建产物，必须保留密钥备份。版本标签和 API 的 `x-probe-source-commit` 用于关联实际源码。

开发探针额外使用随机生成的 `STRIPE_WEBHOOK_SECRET` 测量 HMAC；它只签名合成测试事件，不代表 Stripe 已创建 webhook。prod 验证环境保持该 secret 未配置，以验证拒绝就绪。所有资源仍是临时测试资源，prod 名称不意味着正式收款。

## 三项云验证

先安装浏览器：`npx playwright install chromium`。再按顺序执行；运行期间不要改探针源码。

```sh
npm run probe:deployment -- --cloud --account <account-id> --subdomain <subdomain>
npm run probe:budget-protocol -- --cloud
npm run probe:recovery -- --cloud
npm run verify:gate
```

探针 API 使用本机忽略目录中的私有 key 和真实 Better Auth 会话。首次初始化会保存专用假用户账号；失败后恢复原账号或会话，不重置数据库。可用这份会话运行真实 Chromium 测试，浏览器不使用路由 mock。

恢复验证先观察本次部署的真实 Scheduled 事件，再开始计时。新 Cron 可能需要最多 15 分钟传播；业务恢复上限仍为两个一分钟周期加 30 秒。源自 [Cloudflare Cron 文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

模型固定为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`。本轮功能用例预计约 10–15 次模型调用、低于约 1,500 neurons；这是估算，实际 token 以供应商返回值保存。Free 每日 10,000 neurons，超额会失败；不会自动购买 Paid 或切换收费供应商。探针限制为总计 40 个生成请求、每请求最多 3 步、30 秒中止，正常输出 128 tokens。参考 [Workers AI 价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

当前 Free 的密码哈希 CPU 已实测失败。按用户选择，预算探针继续验证真实模型、工具和浏览器协议，采集当前提交的 CPU 诊断；不会消耗模型额度去完成一个已被拒绝配置的全量边界压测。因此它预期返回非零，并明确记录完整 CPU 样本尚未执行；这不能解锁阶段二。

## 证据与范围

原始 Tail、Cookie、签名、Playwright trace 和 API 证据仅存于忽略的 `artifacts/`、`.local/`。报告在 `artifacts/gates/`，公开结论只放经脱敏的 `docs/validation/`。缺少真实证据、源码变化或未执行用例均不能当作 pass。

阶段二在用户明确暂缓后保持未开始。Stripe Sandbox 同步/改价按用户豁免保持未验证；正式收款、付费额度和产品 Agent 闭环属于后续阶段。

本轮采集结束后已停用两个临时 Worker 的远程 Cron。再次复测前，先重新执行上面的 dev/prod 发布命令；Wrangler 配置会恢复每分钟 Cron。完成验证和结算后可在 Cloudflare 控制台移除这两个专用探针 Worker 的 Cron，避免持续运行测试维护。不要删除或重置已有数据来绕过失败；模型 40 个生成请求的安全上限是本探针资源的累计上限。
