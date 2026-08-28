# AOSP Notes

Android / AOSP Framework 技术笔记。

## 在线预览

在线站点：[https://maoqb.github.io/aosp-docs/](https://maoqb.github.io/aosp-docs/)

## 当前笔记

- [Android Release Config](release_config/release_config.md)
- [指定 App 强制窗口大小和位置方案（HTML）](AI-Generated/force_app_bounds.html)
- [强制 App 窗口大小与位置原理：从 Rect 到屏幕像素（HTML）](AI-Generated/force_app_bounds_principles.html)
- [SystemServer 中 WMS：窗口与 Task 内部机制（HTML）](AI-Generated/wms-window-task.html)

## 网站构建架构

原始笔记始终保留在现有目录中。构建时，准备脚本把 Markdown、HTML 及其静态资源按原目录结构复制到临时目录，再由 MkDocs Material 生成站点：

```mermaid
flowchart LR
    Notes["原始 Markdown / HTML / 静态资源"] --> Prepare["scripts/prepare_docs.py"]
    Prepare --> Generated[".generated_docs/"]
    Generated --> MkDocs["MkDocs Material"]
    MkDocs --> Site["site/"]
    Site --> Pages["GitHub Pages"]
```

`mkdocs.yml` 不维护固定的 `nav`，新增 Markdown 后会自动按文件目录层级出现在导航中。HTML 文件不会被转换，会以原路径复制到最终站点，因此同目录下的相对 CSS、JavaScript 和图片链接仍然有效。

## 本地运行

```bash
pip install -r requirements.txt
make serve
```

然后访问 <http://127.0.0.1:8000>。

也可以使用以下命令：

```bash
make build  # 严格模式构建到 site/
make clean  # 删除 .generated_docs/ 和 site/
```

## 部署方式

推送到默认分支 `main` 后，GitHub Actions 会自动准备文档、构建站点并部署到 GitHub Pages。也可以在仓库的 Actions 页面手动触发 `Deploy documentation` 工作流。
