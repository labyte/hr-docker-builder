# HR Docker 批量构建工具 — 技术方案与实施记录

> 状态：**核心功能已实施（M0–M4）**，技术栈定稿 Tauri 2 + React（2026-09-20）。
> 已实现：中英双语 UI、项目管理与 JSON 持久化、Docker 环境检测与 builder 自愈、QEMU 注册入口、批量构建队列（架构选择 amd64/arm64/双架构 × 去向多选组合：导出 tar 文件 / 本地加载 / 推送 Registry）、实时日志（全局 + 按项目分 tab + 落盘 + 目录打开）。
> 待实施：离线依赖包导出/导入（M5）、三平台安装包（M6）、构建历史持久化（F9）、manifest 多平台合并（明确 v1 不做）。

## 快速开始

```bash
# 环境要求：Node.js ≥ 18、Rust ≥ 1.77、Docker Desktop / Engine（含 buildx）
npm install
npm run tauri dev      # 开发运行
npm run tauri build    # 打包当前平台安装包（产物在 src-tauri/target/release/bundle）
```

使用流程：添加项目（选 .csproj/.sln 可一键带出 Dockerfile/上下文建议路径）→ 顶栏选架构与产物去向 → 勾选项目 → 开始构建 → 右侧日志实时输出，结束后可直接打开导出的 tar 文件所在目录。交叉架构构建要求 builder 平台包含目标架构，环境异常时顶部黄条提供「一键修复 / 安装 QEMU」。

---

## 1. 背景与目标

团队目前以 .NET 项目为主，日常需要将多个项目（可能分布在多个解决方案中）批量构建为 Docker 镜像，并支持 amd64 / arm64 两种目标架构。现有流程依赖手工敲命令，容易出错且不可复用。

目标：开发一个**跨平台桌面工具**（Linux / Windows / macOS），让使用者通过图形界面：

1. 手动添加项目（.csproj / .sln）并为其配置对应的 Dockerfile；
2. 选择目标架构（amd64 / arm64 / 两者）；
3. 勾选要构建的项目，一键开始批量构建；
4. 全程实时查看构建日志；
5. 任意宿主架构交叉构建（amd64 机器构建 arm64 镜像，反之同理）；
6. 内网/离线（无外网）电脑可完成构建；产物去向**多选可组合**：导出本地镜像文件（主要方式）/ 本地加载 / 推送 Registry，可任意勾选、也可完全不推送。

---

## 2. 需求清单

### 2.1 功能需求

| 编号 | 需求 | 优先级 |
|------|------|--------|
| F1 | 项目列表管理：添加/编辑/删除项目条目（项目名称、项目文件路径、Dockerfile 路径、构建上下文、镜像名、Tag 规则、构建参数） | P0 |
| F2 | 项目配置的本地持久化（JSON 配置文件），打开工具自动恢复上次的列表 | P0 |
| F3 | 架构选择：全局选择 linux/amd64、linux/arm64 或两者同时构建 | P0 |
| F4 | 勾选项目 → 一键批量构建，队列化执行，支持并发数控制与失败策略（继续/中止） | P0 |
| F5 | 实时日志输出：全局日志流 + 按项目分页签查看；日志落盘、可导出 | P0 |
| F6 | Docker 环境检测：docker/buildx 是否可用、daemon 是否运行、builder 实例检查与一键创建 | P1 |
| F7 | 构建状态展示：排队中 / 构建中 / 成功 / 失败 / 已跳过，单项目可重试 | P1 |
| F8 | 产物去向（**多选组合，至少一项**）：① **导出本地镜像文件 .tar（主要方式）**；② 本地加载镜像（--load）；③ 推送私有 Registry（--push，含仓库配置与登录校验）。三者在同一次构建内同时完成，不重复构建 | P0 |
| F9 | 构建历史记录（时间、架构、镜像 Tag、结果） | P2 |
| F10 | 交叉架构构建：amd64 ↔ arm64 任意宿主互构；工具自检 builder 平台能力，缺失时引导修复 | P0 |
| F11 | 内网/离线构建：在线机「导出离线依赖包」、离线机「导入」（binfmt/buildkit/基础镜像），无外网可完成构建；不推送镜像亦为完整路径 | P0 |
| F12 | UI 国际化：中文/英文双语，应用内即时切换、选择持久化，默认跟随系统语言；日志原文透传不翻译 | P0 |

### 2.2 非功能需求

- **跨平台**：Linux、Windows 10/11、macOS（Intel + Apple Silicon）；
- **低资源占用**：工具本身不应成为内存大户（Electron 方案约 200MB+ 内存需权衡）；
- **上手成本低**：界面中英双语（可切换、可持久化，默认跟随系统语言），操作路径 ≤ 3 步完成一次批量构建；
- **日志可靠**：长输出不卡 UI，构建进程可取消（终止子进程）。

### 2.3 明确不在第一版范围内

- 不内嵌 Docker daemon / 不管理容器（只调用系统已有 docker CLI）；
- 不做镜像扫描、不做 K8s 部署；
- 暂不做 Git 自动拉取源码（假定本地已有代码）；
- **不产出多平台镜像（amd64+arm64 合并为单一 manifest list）**——双架构（both）按架构拆分为两条独立的单架构构建（已确认）。

---

## 3. 技术栈选型

### 3.1 候选方案对比

| 维度 | **Tauri 2 + React**（推荐） | Electron + React/Vue | Wails 3 + Go | Avalonia UI + C# |
|------|------------------------------|----------------------|--------------|------------------|
| 跨平台 Win/Mac/Linux | ✅ | ✅ | ✅ | ✅ |
| 安装包体积 | ~8–15 MB | ~80–150 MB | ~10–20 MB | ~40–60 MB |
| 内存占用 | 低（系统 WebView） | 高（自带 Chromium） | 低 | 低 |
| 调用 docker CLI / 流式读日志 | ✅ Rust `tokio::process`，很成熟 | ✅ Node `child_process`，最省心 | ✅ Go `os/exec`，简单 | ✅ ProcessStartStream，团队最熟 |
| 前后端通信（事件流日志） | Tauri Event，原生支持流式 | IPC，支持好 | Wails 事件，支持好 | 进程内事件，简单 |
| 生态成熟度 / 资料 | 高，v2 已稳定 | 最高 | 中 | 中（桌面） |
| 开发效率 | 中（需少量 Rust） | 高 | 中高 | 中（XAML） |
| 与团队技能匹配 | 前端需 React；Rust 仅薄薄一层胶水 | 纯 JS/TS | 需 Go | 与 .NET 团队同栈 |

### 3.2 推荐方案

**Tauri 2.x + React 18 + TypeScript + Vite + Ant Design + Zustand + react-i18next**

- **Rust 侧（后端）**只承担一件事：检测 docker 环境、以子进程方式执行 `docker buildx build`、逐行读取 stdout/stderr 并通过 Tauri Event 推给前端、管理构建队列与并发。胶水代码量小、模式固定，即使团队不熟 Rust 也可维护（或由我实现后基本不再改动）。
- **前端（UI）**用 React + Ant Design 快速搭建表格/表单/日志面板；Zustand 管理构建状态机。
- 若团队强烈倾向 **零 Rust**，退路是 **Electron + React**（架构设计完全复用，仅把 Rust 后端换成 Node 主进程）；若倾向 **全 .NET 栈**，可选 **Avalonia + C#**，但生态模板与日志虚拟列表等要自建更多。

> 选定后写死在本 README，实施过程不再切换。

### 3.3 关键技术点

| 技术点 | 方案 |
|--------|------|
| 多架构构建 | v1 不合并 manifest list：双架构（both）拆为两条单架构任务，各自执行 `docker buildx build --platform linux/<arch>`；构建与宿主机不同的架构需 `docker-container` 驱动 builder（工具自动创建/复用，命名 `hr-builder`）+ buildx 自带 QEMU 模拟 |
| 交叉架构保证 | 三层保障：① .NET 项目优先纯交叉编译（`$BUILDPLATFORM` 编译阶段 + `dotnet publish -a $TARGETARCH`，不执行目标架构代码，多数场景免 QEMU）；② 确需运行目标架构层时由 `tonistiigi/binfmt` 注册 QEMU；③ 工具启动自检 `docker buildx inspect` 的 Platforms 列表是否含目标架构，缺失则引导修复 |
| 离线/内网支持 | 「离线依赖包」机制：在线机导出 binfmt、buildkit、各 Dockerfile `FROM` 基础镜像（`docker pull` + `docker save` + manifest.json），U 盘/内网传输后在离线机 `docker load` 导入并自动 bootstrap builder + QEMU；工具运行与构建全程不依赖外网 |
| NuGet 离线还原 | 离线构建最大坑是 `dotnet restore` 需要外网，模板支持两种方案：① 内网 NuGet 服务器（构建时注入 nuget.config）；② 离线包目录（本地 packages 目录拷入构建上下文，`dotnet restore --source` 指向它） |
| UI 国际化 | `react-i18next`（zh-CN / en 两套 JSON 语言包，key 化文案）+ Ant Design `ConfigProvider locale` 联动切换；语言存 `settings.language`，未设置时按 `navigator.language` 跟随系统；构建日志为 docker 原始输出，不做翻译，仅 UI 状态/错误分类做双语 |
| 日志流 | Rust 端逐行读取子进程输出 → `app.emit("build-log://{projectId}", line)` → 前端虚拟滚动列表渲染，同时异步写 `logs/<时间戳>/<project>.log` 文件 |
| 配置持久化 | Tauri `app_config_dir` 下 `projects.json`（数据模型见 §6），读写原子化（先写临时文件再 rename） |
| 镜像命名 | 模板渲染：`{registry}/{name}:{version}-{arch}-{time}`；因不合并 manifest list，Tag **必须带 arch 后缀**区分 amd64/arm64 |
| 导出镜像文件 | `docker buildx build --output type=docker,dest=<导出目录>/<name>-<arch>-<tag>.tar`——docker 格式 tar，目标机 `docker load` 即用；与 `--load`/`--push` 可在同一命令中组合，一次构建多去向交付 |
| Registry 推送 | 设置中配置私有仓库前缀（`settings.registry`）；凭据复用宿主机 `docker login`，工具提供「测试登录」辅助与构建前登录状态校验；不勾选则全程不涉及仓库 |
| .NET 多架构最佳实践 | 生成的默认 Dockerfile 模板采用 `FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build` + `ARG TARGETARCH` + `dotnet publish -a $TARGETARCH`，构建快且无需模拟编译 |
| 打包分发 | `tauri build` 产出各平台产物；三平台产物需在各自 OS 打包（建议后续接 GitHub Actions matrix 或各平台各打一次） |

---

## 4. 系统架构设计

```
┌───────────────────────────────────────────────────┐
│                  前端（WebView / React）             │
│  项目管理页 │ 架构/勾选工具条 │ 构建状态 │ 日志面板  │
└───────────────▲───────────────────┬───────────────┘
                │ invoke(命令)       │ event(日志/进度)
┌───────────────┴───────────────────▼───────────────────────┐
│                 Rust 核心（Tauri 后端）              │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐  │
│  │ 环境检测  │ │ 构建队列  │ │ 进程执行 │ │ 配置存储 │  │
│  │ docker/  │ │ 并发/失败 │ │ buildx  │ │ JSON   │  │
│  │ buildx   │ │ 策略/取消 │ │ 日志流   │ │ 读写   │  │
│  └──────────┘ └──────────┘ └────────┘ └────────┘  │
└──────────────────────┬────────────────────────────┘
                       │ std::process / tokio::process
                ┌──────▼──────┐
                │ docker buildx│（系统安装的 docker CLI）
                └─────────────┘
```

模块职责：

| 模块 | 职责 |
|------|------|
| `env_checker` | 检测 docker 可执行、daemon 状态、buildx 版本、builder 实例；输出诊断信息 |
| `project_store` | 项目条目 CRUD、配置读写、文件路径有效性校验 |
| `build_queue` | 接收构建请求 → 状态机（pending/running/success/failed/canceled）→ 并发控制 → 失败策略 → 取消 |
| `docker_exec` | 组装 buildx 命令、spawn 子进程、逐行转发日志、捕获退出码 |
| `log_center` | 日志扇出（UI 流 + 文件落盘 + 导出） |

---

## 5. 核心流程设计

### 5.1 构建流程（一次批量构建）

```
选择架构(amd64/arm64/both) → 勾选项目 → [点击构建]
  → 环境检测(docker/buildx/builder，缺失则引导创建)
  → 校验勾选项目配置(Dockerfile/上下文存在、镜像名合法)
  → 入队 → 按并发数逐个执行：
      docker buildx build \
        --builder hr-builder \
        --platform linux/<arch> \
        -f <Dockerfile> \
        -t <registry/name:tag> \
        [--output type=docker,dest=<导出目录>/<name>-<arch>-<tag>.tar] \
        [--load] [--push] \
        [--build-arg ...] \
        <context>
      ※ 三个去向开关按勾选组合出现在同一条命令中，构建一次、全部去向同时交付
  → 每个项目独立日志流 + 状态回写
  → 队列完成 → 汇总报告(成功 n / 失败 m / 导出文件列表)
```

要点：
- **both（双架构）**：按架构拆成两条单架构任务，Tag 带 arch 后缀，各任务独立组合去向（已确认不做 manifest list 合并）。
- **产物去向（多选组合）**：勾选「导出文件 / 本地加载 / 推送 Registry」任意组合（至少一项，默认勾选导出文件）；导出文件名 `{name}-{arch}-{tag}.tar`；勾选推送时要求 registry 已配置且登录有效，构建前统一校验，不通过则阻止入队并提示。
- **失败策略**：默认「失败继续构建后续项目」，可切换为「失败即中止队列」。
- **取消**：构建中可整体取消，向子进程发 SIGTERM 并标记 canceled。

### 5.2 日志方案

- 实时：按项目分 tab + 「全部」混合流；虚拟滚动防止长日志卡顿。
- 落盘：`app_data_dir/logs/{yyyy-MM-dd_HH-mm-ss}/{project}.log`。
- 导出：单项目日志复制/另存为文件；一键打包导出本次构建日志目录。

### 5.3 内网/离线构建方案（交叉架构 + 无外网）

```
有外网机器（准备一次）                    离线/内网机器
┌────────────────────────────┐          ┌────────────────────────────┐
│ 工具 [导出离线包]            │          │ 工具 [导入离线包]            │
│  · 扫描全部项目 Dockerfile   │  tar 包  │  · docker load 全部镜像      │
│    收集 FROM 基础镜像        │ ───────▶ │  · 创建 hr-builder 并        │
│  · docker pull binfmt/      │ (U盘/内网 │    bootstrap（buildkit 已    │
│    buildkit/基础镜像         │  传输）   │    在本地，不出网）           │
│  · docker save → 离线包      │          │  · 运行 binfmt 注册 QEMU     │
│    + manifest.json          │          │  · buildx inspect 自检        │
│                            │          │    Platforms 含 amd64+arm64  │
└────────────────────────────┘          └────────────────────────────┘
```

设计要点：

1. **交叉构建第一原则：尽量免 QEMU**。.NET 默认模板把编译放在 `--platform=$BUILDPLATFORM` 阶段、`dotnet publish -a $TARGETARCH` 交叉发布，运行时阶段仅按 `$TARGETARCH` 选基础镜像层——只要 Dockerfile 遵循此模板，amd64↔arm64 互构不需要执行目标架构代码，速度快且不强依赖特权容器。
2. **QEMU 兜底**：项目若使用 ARM 原生依赖或目标架构专属基础镜像，仍需模拟；工具在交叉构建前检查 builder 的 Platforms，缺 QEMU 时引导执行 `docker run --privileged --rm tonistiigi/binfmt --install all`（离线时 binfmt 镜像已在本地，不拉外网）。
3. **去向多选、默认不碰仓库**：主路径是「导出 .tar 镜像文件」+ 可选「--load 本地加载」，离线环境全程零外网；导出功能与「离线依赖包」共用同一套 docker save/load 底层能力。仅勾选「推送 Registry」时才校验仓库与登录。
4. **NuGet 离线**：项目条目可配置还原源模式（无 / 内网服务器 / 离线包目录），工具据此向构建注入 `--build-arg`、nuget.config 或上下文内的 packages 目录；默认 .NET 模板已参数化支持。
5. **离线包内容清单**：`tonistiigi/binfmt`、`moby/buildkit`（与本机 buildx 版本匹配）、扫描到的全部 `FROM` 镜像、manifest.json（记录镜像清单与版本，导入时校验完整性）。

---

## 6. 数据模型（projects.json 草案）

```jsonc
{
  "version": 1,
  "settings": {
    "language": "auto",              // auto(跟随系统) | zh-CN | en
    "defaultArch": "amd64",          // amd64 | arm64 | both
    "registry": "harbor.hr.com/hr",  // 私有仓库前缀；不推送时可为空
    "outputs": ["export", "load"],   // 多选组合：export=导出tar文件(主) | load=本地加载 | push=推送Registry
    "export": { "dir": "~/hr-docker-exports", "gzip": false }, // 导出目录/是否压缩
    "concurrency": 2,
    "failFast": false,
    "tagTemplate": "{version}-{arch}-{time}",
    "builderName": "hr-builder"
  },
  "projects": [
    {
      "id": "p-01",
      "name": "hr-order-api",
      "projectFile": "/code/hr/src/Order/Order.Api/Order.Api.csproj", // 用于上下文推断
      "dockerfile": "/code/hr/src/Order/Order.Api/Dockerfile",
      "context": "/code/hr/src/Order",      // docker 构建上下文，可留空自动推断
      "image": "hr-order-api",
      "defaultVersion": "1.4.2",
      "buildArgs": { "CONFIGURATION": "Release" },
      "nuget": { "mode": "offline", "source": "/data/nuget-packages" }, // none | internal | offline
      "enabled": true,
      "lastBuild": { "time": "...", "tag": "...", "arch": "amd64", "ok": true }
    }
  ]
}
```

---

## 7. 界面规划

```
┌────────────────────────────────────────────────────────────┐
│ 工具条: 架构[amd64▾] 去向[☑导出文件 ☐本地加载 ☐推送] 并发[2▾] 失败[继续▾] [构建] │
├──────────────────────┬─────────────────────────────────────┤
│ 项目列表              │  日志面板（tabs: 全部 | 项目A | 项目B）│
│ ☑ 名称  Tag 状态      │  $ docker buildx build --platform... │
│ ☑ hr-order-api  成功  │  ...                                 │
│ ☐ hr-user-api   构建中│  （虚拟滚动 + 关键字着色/自动滚动）    │
│ [+ 添加项目] [编辑]    │                                     │
└──────────────────────┴─────────────────────────────────────┘
```

- 添加项目：文件选择器选 `.csproj/.sln` + Dockerfile，自动带出建议的镜像名/上下文；
- 每个项目行显示状态徽标（排队/构建中/成功/失败/跳过）与最近一次构建信息；
- 环境异常时顶部黄条提示（如「未检测到 buildx，点击修复」）。

---

## 8. 实施计划（里程碑）

| 里程碑 | 内容 | 交付物 | 预估 |
|--------|------|--------|------|
| **M0 脚手架** | Tauri2+React+TS+antd 工程初始化、i18n 框架（zh/en 语言包骨架 + 语言切换）、目录结构、CI 预留 | 可运行的空壳 App（双语可切换） | 1 天 |
| **M1 项目管理** | 项目 CRUD UI、JSON 配置持久化、路径校验 | 可维护项目列表 | 1.5 天 |
| **M2 Docker 集成** | 环境检测、builder 自动创建、单项目构建+实时日志、去向「导出 tar / 本地加载」 | 能构建 1 个项目并导出文件 | 2 天 |
| **M3 批量构建** | 架构选择、勾选队列、并发/失败策略/取消、按项目日志 tab | **核心功能完整** | 2 天 |
| **M4 打磨** | Registry 推送与登录校验、导出文件列表/打开目录、日志导出、失败重试、.NET 多架构 Dockerfile 模板、构建历史 | 可用版 v0.9 | 1.5 天 |
| **M5 离线支持** | 离线依赖包导出/导入、builder/QEMU 引导与 Platforms 自检、NuGet 离线方案模板 | 内网/离线电脑可交叉构建 | 2 天 |
| **M6 打包发布** | 三平台安装包构建与冒烟验证 | v1.0 | 1 天 |

合计约 **11 人天**。每个里程碑结束即可演示验收（M1 起每个界面交付即要求双语完整）。交叉构建能力从 M2 起即为默认验收标准（每台机器都测 amd64+arm64 双向构建）。

建议目录结构：

```
hr-docker-tool/
├── README.md
├── src-tauri/          # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── env_checker.rs
│   │   ├── build_queue.rs
│   │   ├── docker_exec.rs
│   │   ├── project_store.rs
│   │   └── commands.rs # 暴露给前端的 invoke 命令
│   └── tauri.conf.json
├── src/                # React 前端
│   ├── pages/  components/  store/  types/
├── templates/          # 默认 .NET Dockerfile 模板（amd64/arm64 多架构）
└── docs/               # 使用文档、截图
```

---

## 9. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Windows 用户无 Docker Desktop / 未启用 WSL2 | 无法构建 | 启动时环境检测 + 引导页明确安装步骤 |
| 默认 docker 驱动不支持多平台/`--push` | both 模式失败 | 自动检测并创建 `docker-container` 驱动 builder，缺失时一键修复 |
| Apple Silicon 上构建 amd64 走模拟，极慢 | 体验差 | 推荐 `--platform=$BUILDPLATFORM` 交叉编译的 .NET Dockerfile 模板 |
| 离线机缺 binfmt/buildkit/基础镜像 | 交叉或整体构建失败 | 「导出/导入离线依赖包」机制（§5.3），导入时按 manifest 校验完整性 |
| 离线机不允许 `--privileged`（QEMU 注册失败） | 无法模拟目标架构 | .NET 项目走纯交叉编译天然免 QEMU；确需模拟的例外项目，提前用离线包+特权机验证并文档标注 |
| `dotnet restore` 依赖外网 | 离线构建中断 | NuGet 双方案：内网源 / 离线包目录（模板参数化，§3.3） |
| 长日志渲染卡顿 | UI 假死 | 虚拟滚动 + 日志写文件、UI 只保留尾部 N 行 |
| Rust 团队不熟悉 | 维护风险 | 后端代码保持薄胶水层并写注释；若不可接受改用 Electron（架构不变） |
| Linux 打包（deb/AppImage）环境差异 | 发布受阻 | CI matrix 分平台打包；本地先以当前 macOS 为主联调 |

---

## 10. 决策记录与待确认问题

**已确认（2026-09-20）：**

- 产物去向：**导出本地镜像文件（主要方式）/ 本地加载 / 推送 Registry 三者多选可组合**，至少勾选一项，构建一次全去向交付；
- 多平台镜像：**v1 不做 manifest list 合并**，双架构按架构拆分为单架构任务；
- 技术栈：**定稿 Tauri 2.x + React 18 + TypeScript + Vite + Ant Design + Zustand + react-i18next**（团队具备 Rust 与前端资源，2026-09-20 确认）；
- 交叉架构：**amd64 ↔ arm64 任意宿主互构为 P0 硬性需求**；
- 离线/内网：**无外网环境必须可完成构建**，工具提供离线依赖包导出/导入（§5.3）；
- 推送可选：**默认勾选「导出文件」**，不推送、不碰仓库是完整可用路径而非降级模式；
- UI 语言：**中英双语（i18next + antd locale），应用内可切换并持久化**（F12，P0）。

**仍待确认（不阻塞开发，可实施中补充）：**

1. 私有 Registry 地址大致是什么形态（Harbor / 阿里云 ACR / 其他），是否已有可用测试仓库？
2. 实施过程中如需调整功能范围/优先级，随时提出。
