# TREE - 能力树升级（可分享版）

TREE 是一个可直接分享的成长网页：能力树升级、每日任务、复盘、周报分享图、云同步、Web Push 提醒都在一个站点里。

## 新增优化（2026-03-09）

- 持久化升级：`DATABASE_URL` 可启用 Postgres（默认文件存储兜底）
- 同步安全升级：同步口令仅服务端哈希存储 + 接口限流 + 失败锁定
- 提醒升级：支持 Cron 调用 `/api/cron/reminders`（替代进程内轮询）
- 分享升级：支持生成“只读分享链接” `https://.../share/:id`
- 成长机制升级：动态 XP、断更恢复加成、每周挑战奖励
- 前端模块化：拆分为 `state / api(sync+push+share) / analytics / growth / ui`

## 本地运行

```bash
cd TREE
npm install
npm start
```

默认访问：`http://localhost:10000`

## 测试

```bash
cd TREE
npm test
```

## Render 部署

仓库已包含 Blueprint：`render.yaml`

### Web 服务（tree-web）

必填环境变量：

- `WEB_PUSH_CONTACT`（例如 `mailto:you@example.com`）
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `SYNC_CODE_PEPPER`
- `CRON_SECRET`

可选（推荐）：

- `DATABASE_URL`（使用 Render Postgres）

### 提醒调度（两种方式）

1. 免费方案（默认）：设置 `ENABLE_INTERVAL_REMINDER=1`，由 Web 服务进程每分钟检查提醒。  
2. 定时任务方案（更稳）：使用外部 Cron 或 Render Cron 调用 `POST /api/cron/reminders`，并带 `x-cron-secret` 头（值为 `CRON_SECRET`）。

## 目录结构

- `index.html`：主页面
- `share.html`：分享页
- `styles.css`：样式
- `server.js`：后端 API（同步/推送/分享/Cron）
- `service-worker.js`：PWA 缓存和推送
- `manifest.webmanifest`：PWA 配置
- `scripts/app.js`：前端主流程
- `scripts/share.js`：分享页脚本
- `scripts/modules/*.js`：前端模块
- `scripts/cron-reminder-trigger.js`：Cron 触发脚本
- `tests/*.test.js`：单测
