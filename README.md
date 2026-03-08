# TREE - 能力树升级（可分享版）

TREE 是一个可直接分享的成长网页：能力树升级、每日任务、复盘、周报分享图、云同步、Web Push 提醒都在一个站点里。

## 功能亮点

- 自动推荐今日任务（含推荐理由）
- 节点升级 + 连续进步（Streak）
- 30 天热力图 + 节点成长曲线 + 回流指标
- 新手引导、增长看板、异常行为拦截
- 一键生成分享图（PNG）
- JSON 导入导出
- 无 Token 云同步（通过同步口令）
- Web Push 提醒 + 日历 `.ics` 备选
- 可安装为 PWA（桌面/手机）

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

1. 将仓库推送到 GitHub：`lastxuan4396/TREE`
2. 在 Render 选择 Blueprint，指向仓库根目录下的 `render.yaml`
3. 首次部署后可直接打开公网 URL 分享

### Push 环境变量（建议配置）

在 Render 的环境变量里配置：

- `WEB_PUSH_CONTACT`（例如 `mailto:you@example.com`）
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

未配置时系统会使用临时密钥，重启服务后旧订阅可能失效。

## 目录结构

- `index.html`：页面结构
- `styles.css`：视觉样式
- `scripts/core.js`：核心规则（可测试）
- `scripts/app.js`：前端交互与状态
- `server.js`：同步与推送 API + 静态托管
- `service-worker.js`：PWA 缓存与推送处理
- `manifest.webmanifest`：PWA 配置
- `tests/core.test.js`：核心逻辑测试
