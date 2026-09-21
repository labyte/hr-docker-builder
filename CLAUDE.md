# 项目规则

## 网络访问（GitHub 走代理）

访问 GitHub（`git push` / `git fetch`、curl、gh CLI 等）前，先检查系统是否设置了代理，有代理就走代理加快网速：

- `scutil --proxy`（macOS 系统代理）
- 环境变量 `HTTP_PROXY` / `HTTPS_PROXY`
- `git config --get http.proxy`

本机代理为 `http://127.0.0.1:7890`（系统代理与本仓库 git 配置均已设置）。后续所有 GitHub 访问都走这条代理路径；仅当代理确认不可用时才尝试直连。

## CI 构建

`.github/workflows/build.yml`：推送到 `main` 或 tag `v*` 自动触发 macOS / Linux / Windows 三平台构建；仅 tag 推送会额外发布 GitHub Release。
