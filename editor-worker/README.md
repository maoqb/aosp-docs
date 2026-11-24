# AOSP Notes Studio · 免费在线写作工作台

## 无需家里电脑：通过 GitHub Actions 发布 Worker

已添加手动工作流 [Deploy Notes Studio Cloudflare Worker](https://github.com/maoqb/aosp-docs/actions/workflows/deploy-cloudflare-worker.yml)。以后在任何电脑上登录 GitHub，打开工作流，点击 **Run workflow** 就能部署。此工作流不会在每次推送时自动更新线上 Worker。

**首次使用需要在 GitHub 仓库 `Settings → Secrets and variables → Actions → New repository secret` 添加以下四项。请直接保存到 GitHub Secrets，不要提交代码、更不要发送到聊天：**

| Secret 名称 | 从哪里获取 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 用户/API tokens 创建仅限本账号 Workers 编辑权限的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台 Account ID |
| `CLOUDFLARE_KV_NAMESPACE_ID` | 现有 Worker **SESSIONS** 所绑定的 KV namespace ID（不可新建替换） |
| `NOTES_GITHUB_CLIENT_ID` | 现有 GitHub OAuth App 的 Client ID（可从原 GitHub OAuth App 页面获取） |

工作流仅在 GitHub Actions 的临时 Runner 中生成 Wrangler 配置，保留线上已有的 Worker 名称 `aosp-notes-api`、`EDITOR_ORIGIN` 和 `EDITOR_URL`。**不要重新创建 KV namespace，也不要更换 OAuth App。** Worker 上现有的 `GITHUB_CLIENT_SECRET` Secret 必须继续存在。若它曾被删除，应先在 Cloudflare Dashboard 恢复，避免部署后无法登录。

操作：

1. 在 GitHub 添加上述四个 Secrets（填写真实值，不是仓库样例配置里的 `REPLACE_WITH_...`）。
2. 打开 [部署工作流](https://github.com/maoqb/aosp-docs/actions/workflows/deploy-cloudflare-worker.yml)。
3. 点击 **Run workflow → main → Run workflow**。
4. 检查流程变为绿色 Success，然后重新打开 Notes Studio，使用「↗ 移动」功能。

工作流还会检测必需的 Secrets，并且部署后检查 `/health`。它不包含云端 OAuth Secret、KV 中保存的会话数据或用户的 GitHub Token。


编辑器公开地址：https://maoqb.github.io/aosp-docs/editor/

架构：GitHub Pages 托管 Cherry Markdown 前端；Cloudflare Workers 处理 GitHub OAuth 与 GitHub API；Cloudflare KV 存储六小时会话；私有 maoqb/Notes 保存正文与图表源文件；现有 aosp-docs / VitePress 自动发布。

## 1. 部署 Worker（免费）

注册 Cloudflare：https://dash.cloudflare.com/sign-up

在本机安装 Node.js 20+，进入仓库 aosp-docs/editor-worker 目录：

    npx wrangler@latest login
    npx wrangler@latest kv namespace create SESSIONS

复制输出的 Namespace ID，修改 editor-worker/wrangler.jsonc 内 kv_namespaces[].id。
Cloudflare Workers 免费计划有使用额度，无需购买服务器或域名。

## 2. 创建 GitHub OAuth App

打开 https://github.com/settings/developers ，选择 OAuth Apps → New OAuth App。

Application name: AOSP Notes Studio
Homepage URL: https://maoqb.github.io/aosp-docs/editor/
Callback URL: https://aosp-notes-api.<你的 Cloudflare 子域>.workers.dev/auth/callback

实际 Cloudflare 子域在首次 Worker 部署后才能确定；届时务必核对并更新 GitHub OAuth Callback URL。

获得 Client ID 和 Client Secret：
- Client ID 写入 wrangler.jsonc 的 GITHUB_CLIENT_ID。
- Client Secret 绝对不要提交到 GitHub；在终端执行 npx wrangler@latest secret put GITHUB_CLIENT_SECRET，再按照提示输入 Secret。

wrangler.jsonc 同时设置：
- EDITOR_ORIGIN: https://maoqb.github.io
- EDITOR_URL: https://maoqb.github.io/aosp-docs/editor/

注意：GitHub OAuth 的 repo scope 是宽权限，能够访问该账号其他私有仓库；虽然 Worker 限制 API 只访问 maoqb/Notes，scope 本身无法按单仓库缩小。若无法接受，需改用细粒度 GitHub App 安装权限方案，不要授权当前 OAuth App。

## 3. 部署及登录

进入 aosp-docs/editor-worker：

    npx wrangler@latest deploy

得到 https://aosp-notes-api.<你的子域>.workers.dev
确认 https://aosp-notes-api.<你的子域>.workers.dev/health 能返回 ok: true。
回 GitHub OAuth App 更新并确认回调地址为 Worker 地址加 /auth/callback。

打开 https://maoqb.github.io/aosp-docs/editor/ 进入编辑器，直接点击「GitHub 登录」。前端已固定使用 https://aosp-notes-api.maoqb.workers.dev，不需要再配置 Worker 地址。
仅 maoqb 账号通过校验后可访问或修改私有 Notes 仓库。

## 4. 写作与图表

- **新建目录**：登录后点击左侧「＋ 目录」，选择父目录并填写名称。支持在现有顶层分类（如 `wms`、`binder`）下无限制地按层级整理，但单一路径的深度与长度仍受校验规则限制。新目录立即写入私有 GitHub 仓库的 `.folder.md` 占位文件；博客构建自动忽略该文件。
- **目录树**：左侧可展开、折叠和选中目录；选中目录后点击「＋ 笔记」，即可直接在该目录创建 Markdown。文章图片与 draw.io/mindmap 图表的资源目录会保留多级相对路径，避免同名冲突。
- **当前限制**：已部署的 Cloudflare Worker 只允许向预设的顶层分类写文件；创建全新**顶层**分类需要同步扩展 Worker 的路径白名单并重新部署，不能仅靠前端完成。


- Markdown：使用 Cherry Markdown 加粗、斜体、标题、列表和文字颜色等工具。
- Markdown：正文的加粗、文字颜色、标题、列表等格式全部在 Cherry Markdown 原生工具栏完成，不占用图表入口。
- 可视化思维导图：进入「插入内容 → 可视化思维导图」，双击节点改名，Tab 添加子主题、Enter 添加同级主题，也可用右侧按钮。鼠标拖动画布、Ctrl+滚轮缩放。保存时在文章的 assets 目录生成可编辑 `mindmap-NNN.mmd` 和预览 `mindmap-NNN.svg`；打开既有导图可继续图形化编辑。
- Mermaid：通过「插入内容」单独插入时序图或 Mermaid 思维导图，源码直接保留在 Markdown 内；VitePress 构建时渲染。
- Excalidraw：目前仅提供独立 Excalidraw 网站入口，可以在外部导出图片后通过「上传图片」插入笔记；**尚未集成 Excalidraw 源文件的自动存取**。
- draw.io：打开文章后点击「draw.io 图表」，列表会自动读取该文章 assets 目录下现有的 .drawio 源文件（例如 drawio-001.drawio），选中即可重新编辑并原位更新同名 SVG；也可选择「新建」，自动避开已有文件名。图表源与 SVG 会直接保存到 GitHub，新增的图片引用需要点击「保存到 GitHub」保存文章。
- 图片：上传 PNG/JPEG/WebP/GIF/SVG 到 Notes/assets 子目录，Markdown 插入博客公网图片链接。
- 发布：保存正文后 Notes 主仓库现有的自动同步工作流推动 aosp-docs VitePress 发布。

## 5. 跨目录移动文章

- 在知识库文件列表中，点击文章右侧的 **↗ 移动** 图标，选择目标目录并确认。
- 使用受 GitHub OAuth 会话保护的 `POST /api/move`：Worker 在私有 `maoqb/Notes` 的 `main` 分支上创建 **一个 Git commit**，同时删除旧路径、添加新路径、移动专属的 `assets` 图片、draw.io 和思维导图文件。
- 目标文件或资源存在同名冲突、来源 SHA 已更改、目标目录不存在时，直接拒绝；**不会覆盖，也不会产生部分移动**。
- 文章中使用站点绝对路径引用其专属资源时会同步改写。其他文章对该旧路径的链接不会自动改写，需要后续检查。
- 浏览器内有未保存改动时，必须先保存才能移动当前文章。GitHub 历史仍保留原内容，可在需要时回退。

**必须部署新版 Cloudflare Worker 才能使用移动功能。** 只部署 GitHub Pages 前端并不会新增 `/api/move`。

如果此前已在 Cloudflare 上配置 Worker，请在原本可部署的 `editor-worker` 环境中确认 `wrangler.jsonc` 的 `GITHUB_CLIENT_ID`、`EDITOR_ORIGIN`、`EDITOR_URL`、KV namespace id 均是实际值，且 `GITHUB_CLIENT_SECRET` 已作为 Worker Secret 保存，然后执行：

```bash
cd editor-worker
npx wrangler@latest deploy
```

仓库中提供的是示例 `wrangler.jsonc`，其中包含 `REPLACE_WITH_...` 占位符，不能直接拿它覆盖现有线上配置；建议先备份线上配置并填入真实值。部署完成后，使用已登录的 Notes Studio 测试移动操作。

## 6. 安全与限制

- OAuth access token 仅在 Cloudflare KV 服务端存放，不写入浏览器或仓库。浏览器 sessionStorage 只存随机、六小时有效的 session ID。
- 本项目是个人单用户 MVP；不支持实时协作、离线编辑、冲突自动合并。
- 严格限制只能写指定 Markdown 与图片/图表格式的 Notes 目录，主分支 SHA 乐观锁可防止直接覆盖旧文件。
- GitHub Contents API 对超大文件的读取有约束，应把大截图保存在独立 PNG 文件，而不是 Base64 塞进 Markdown。
- 在公开 VitePress 网站显示 SVG，切勿上传来源不可信的 SVG。
- Cherry Markdown 从 CDN 加载，访问 CDN 失败时需更换静态资源来源。
- 已有博客可公开阅读，Notes 仓库仍保持私有。
- 最小权限方案应改用 GitHub App，只安装于 maoqb/Notes 并授权 Contents Read/Write。

## 6. 本地代码验证

    node --check editor/app.js
    node --check editor-worker/src/index.js
    python3 -m py_compile scripts/prepare_docs.py
