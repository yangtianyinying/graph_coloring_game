# GitHub Pages 部署

站点源码在仓库的 **`docs/`** 目录：`index.html` 与 `experiment_site/`（`css/`、`js/`）。页面通过 **importmap** 从 `esm.sh` 加载 jsPsych；被试需能访问公网。

## 启用 Pages

1. 将 `docs/` 推送到 GitHub。
2. 打开仓库 **Settings → Pages**。
3. **Build and deployment → Source**：**Deploy from a branch**。
4. **Branch**：选默认分支（如 `main`），**Folder**：**`/docs`**，保存。
5. 几分钟后访问：`https://<用户名>.github.io/<仓库名>/`。

资源使用相对路径（如 `experiment_site/css/app.css`），适用于 **项目站**（子路径）与本地 `python -m http.server --directory docs`。

## 修改前端后

编辑 **`docs/index.html`** 或 **`docs/experiment_site/`** 下文件，提交并推送即可；Pages 会随分支更新。
