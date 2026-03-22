# 静态站点部署（GitHub Pages）

本实验前端为纯静态资源（HTML/CSS/JS）+ 通过 `importmap` 从 `esm.sh` 加载 jsPsych 7。GitHub Pages **不运行 Django**，只需部署可访问的静态文件。

## 需要部署的文件

- [`experiment_site/templates/experiment_site/index.html`](../experiment_site/templates/experiment_site/index.html) 复制为站点根目录的 `index.html`（或 `docs/index.html` 若使用 `/docs` 建站）。
- 目录 [`experiment_site/static/experiment_site/`](../experiment_site/static/experiment_site/) 下的 `css/`、`js/` 保持相对路径：模板中 `{% static 'experiment_site/...' %}` 在静态导出时需替换为 **`/仓库名/`** 前缀（若站点在子路径）或根路径。

### 将 Django `{% static %}` 换为相对路径（推荐）

在导出的 `index.html` 中，把

- `href="/static/experiment_site/..."` 或 `src="/static/experiment_site/..."`

改为与 `index.html` 同级的相对路径，例如：

- `href="experiment_site/css/app.css"`
- `src="experiment_site/js/graphTheme.js"`

若仓库使用 **GitHub Pages 项目站**（`https://user.github.io/repo/`），所有资源 URL 需带前缀 `/repo/`，例如 `href="/repo/experiment_site/css/app.css"`。

### jsPsych 与 importmap

页面使用 **importmap** 从 `https://esm.sh` 拉取 `jspsych` 与插件；被试需能访问公网。若需完全离线，请将对应包打包为本地 ES 模块并修改 `importmap` 指向本地路径。

## 本地仍用 Django（开发）

```bash
python manage.py runserver
```

浏览器访问 `http://127.0.0.1:8000/` 即可使用 `{% static %}` 解析后的路径。
