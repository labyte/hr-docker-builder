# 项目规则

## 网络访问（GitHub 走代理）

访问 GitHub（`git push` / `git fetch`、curl、gh CLI 等）前，先检查系统是否设置了代理，有代理就走代理加快网速：

- `scutil --proxy`（macOS 系统代理）
- 环境变量 `HTTP_PROXY` / `HTTPS_PROXY`
- `git config --get http.proxy`

本机代理为 `http://127.0.0.1:7890`（系统代理与本仓库 git 配置均已设置）。后续所有 GitHub 访问都走这条代理路径；仅当代理确认不可用时才尝试直连。

## 协作规则

- **不代跑应用**：`tauri dev` / 启动 App 等运行验证由用户手动执行；Claude 只做编译检查（cargo check / npm run build）与 CLI 级验证，需要 UI 验证时列步骤请用户操作。
- **提交推送需确认**：所有 `git commit` / `git push` / `git tag` 操作先列出改动内容，经用户确认后再执行（本条之前的多次推送是历史授权，此后生效）。

## CI 构建

`.github/workflows/build.yml`：仅推送 tag `v*` 自动触发 macOS / Linux / Windows 三平台构建并发布 GitHub Release；`main` 推送不触发（手动构建可用 workflow_dispatch）。
