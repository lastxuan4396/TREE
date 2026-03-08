# 能力树升级 - Share Deploy

这是一个纯静态网页项目，可直接部署后分享给他人使用。

## 本地预览

直接打开 `index.html` 即可，或启动本地静态服务：

```bash
cd TREE
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 结构

- `index.html`：页面结构
- `styles.css`：样式（含移动端优化）
- `scripts/core.js`：可测试的核心逻辑（升级、解锁、连击）
- `scripts/app.js`：交互和状态管理
- `tests/core.test.js`：核心逻辑测试

## 测试

```bash
cd TREE
npm test
```

## Render 部署（推荐）

1. 将当前仓库推送到 GitHub（仓库名：`TREE`）。
2. 在 Render 新建 Blueprint，选择该仓库，并指定 Blueprint 文件为 `render.yaml`。
3. Render 会读取 `render.yaml` 并创建 Static Web Service。
4. 部署完成后会得到公网 URL，可直接分享。

## 页面说明

- 任务进度、节点等级、复盘记录都保存在浏览器本地（LocalStorage）。
- 支持首次引导、每日任务卡、周报分享图、自定义能力树、导入导出。
- 支持云同步（GitHub Gist，需要 `gist` 权限 Token）。
- 支持日历提醒导出（`.ics`），可在系统日历中实现离线提醒。
