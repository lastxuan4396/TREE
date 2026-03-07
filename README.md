# 能力树升级 - Share Deploy

这是一个纯静态网页项目（单文件 `index.html`），可直接部署后分享给他人使用。

## 本地预览

直接打开 `index.html` 即可，或启动本地静态服务：

```bash
cd TREE
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## Render 部署（推荐）

1. 将当前仓库推送到 GitHub（仓库名：`TREE`）。
2. 在 Render 新建 Blueprint，选择该仓库，并指定 Blueprint 文件为 `render.yaml`。
3. Render 会读取 `render.yaml` 并创建 Static Web Service。
4. 部署完成后会得到公网 URL，可直接分享。

## 页面说明

- 任务进度、节点等级、复盘记录都保存在浏览器本地（LocalStorage）。
- 不需要后端数据库。
