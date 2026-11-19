# AOSP Notes Studio · 免费在线写作工作台

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

打开 https://maoqb.github.io/aosp-docs/editor/ 进入编辑器，点击「设置」，粘贴 Worker 的 HTTPS 地址，点击「GitHub 登录」。
仅 maoqb 账号通过校验后可访问或修改私有 Notes 仓库。

## 4. 写作与图表

- Markdown：使用 Cherry Markdown 加粗、斜体、标题、列表和文字颜色等工具。
- Mermaid：点击时序图、思维导图，源 Mermaid 代码直接保留在 Markdown 内；VitePress 构建时渲染。
- draw.io：打开文章后点击「draw.io 图表」，列表会自动读取该文章 assets 目录下现有的 .drawio 源文件（例如 drawio-001.drawio），选中即可重新编辑并原位更新同名 SVG；也可选择「新建」，自动避开已有文件名。图表源与 SVG 会直接保存到 GitHub，新增的图片引用需要点击「保存到 GitHub」保存文章。
- 图片：上传 PNG/JPEG/WebP/GIF/SVG 到 Notes/assets 子目录，Markdown 插入博客公网图片链接。
- 发布：保存正文后 Notes 主仓库现有的自动同步工作流推动 aosp-docs VitePress 发布。

## 5. 安全与限制

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
