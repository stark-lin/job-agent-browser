# CI/CD 与应用分发

目的：负责集成、验证、可选模型供应、桌面/npm 打包、签名和发布。状态：源码中**已配置**；执行证据来自本地检查与 Actions。发行目标**仅 macOS ARM64**。干净用户环境的 Gatekeeper/Keychain 与跨渠道凭据兼容性尚未验证。尚未实现自动更新器。

语言：[English](ci-cd.md) · 简体中文

## 集成与触发

功能分支使用 `codex/` 并集成到 `dev`。通过 `CI required` 通过的 PR 将 `dev` 晋升到 `main`。[CI](../.github/workflows/ci.yml) 拒绝来自其他头分支的 main PR；仓库保护必须要求 PR、最新检查、已解决讨论、管理员约束和禁止强推/删除。工作流不会配置这些设置。

[Release](../.github/workflows/release.yml) 在 main 推送或手动 main 调度时运行，始终检出事件对应 SHA，验证、构建双渠道，先发布 GitHub 预发行版，再通过 `latest` 标签发布 npm。发布串行执行，不取消活跃运行。不需要推送 tag。PR 作业取消已被替代的旧运行。

## 验证与原生打包

[验证](../.github/workflows/validate.yml) 固定 Node 24.22.1，在 `macos-15` ARM64 上运行。显式安装 Electron，运行 `check`、发布脚本测试、不含模型的 npm 内容校验和 Electron/Knowledge 冒烟测试。普通验证不下载模型。[范围检测](../scripts/ci-scope.cjs) 为受影响源码、依赖、资源、打包和工作流增加原生/发行验证。

[打包](../.github/workflows/package.yml) 包含两个作业：附带已校验离线 Seed/推理的 Full DMG，以及经过干净安装/运行时冒烟测试的不含模型 npm tarball。两者使用相同发布元数据。不接受跨架构运行结果。Windows、Linux 和 macOS x64 仍为**脚手架**，不参与发布。

[基础 builder](../electron-builder.yml) 构建 Minimal 桌面应用；[Full 配置](../electron-builder.full.yml) 添加 Seed。现有 `package` 命令默认保留 Full；`package:minimal` 显式选择 Minimal。ONNX/Sharp 原生库保持解包。应用推理不会直接读取 Seed 路径。

[桌面验证](../scripts/verify-package.cjs) 校验声明、原生模块，以及所有 Seed 摘要或模型权重缺失状态（`--minimal`）。从其他 cwd 启动应用并使用临时数据。Full 检查向用户存储导入 Seed、384 维归一化/双向跨语言检索、SQLite/RRF、真实 MCP 会话、共享推理、HTML/PDF 和删除模型后的降级。Minimal 检查无模型关键词/MCP 检索和 HTML/PDF。[安装器验证](../scripts/verify-installer.cjs) 解包/挂载安装器后，重复对应模式的检查。

## 模型供应与本地命令

[Manifest](../resources/embedding-model.json) 固定 revision、文件、精确大小、SHA256、许可和推理设置。[准备脚本](../scripts/prepare-embedding-model.cjs) 与 Main 共享[传输/校验核心](../src/platform/models/core.cjs)：固定 revision、流式字节上限/哈希、有界重试/超时和临时文件重命名。仅校验模式不会下载。Full 打包要求已准备/校验的 Seed；Minimal 和 npm 构建不准备模型。

```sh
npm ci
npx --no-install install-electron
npm run check
npm run test:release
npm run model:prepare
npm run release:check
npm run package:dir
npm run package:minimal
npm run package:verify -- /absolute/path/to/unpacked-app
npm run package:verify -- /absolute/path/to/minimal-app --minimal
npm run release:npm:check
```

`test:embedding` 要求已有构建和准备好的 Seed。[Model Manager](../src/platform/models/manager.ts) 在首次使用时异步导入 Full Seed；用户删除会持久保存拒绝自动导入的选择。模型存储/生命周期规则属于[数据架构](data-architecture.zh-CN.md)。模型与字体声明独立于应用的 AGPL-3.0-only 许可证。

## npm 运行时与可复现产物

[准备脚本](../scripts/prepare-npm-package.cjs) 保持源码包 private，使用[包模板](../packages/npm/package.template.json) 生成 `dist/npm/`。从 `packages/npm/` 复制用户 README（绝不使用根 README），保留面向发布页的许可证/源码链接，并从模板设置 repository/homepage/CLI 元数据。还会复制已构建 Main/Preload/Renderer、MCP/推理/PDF Worker、字体、Skills、模型 manifest/声明和许可证。包括 Electron 在内的运行依赖使用根锁文件中的精确版本；`npm-shrinkwrap.json` 保留已解析的生产依赖闭包、注册表摘要和可选平台依赖。不会复制源码仓库 node_modules 或模型权重。

[内容校验](../scripts/verify-npm-package.cjs) 拒绝符号链接、模型权重、数据库、密钥、缓存、fixture 和安装器，校验包元数据及用户 README/许可证内容（包括 tarball 内的实际字节），打包目录，并在 `dist/npm-artifacts/manifest.json` 记录 tarball SHA256/SHA512、大小、版本、提交和验证状态。npm 文件独立于仅用于桌面的 `release/publish/` 文件集。

[干净安装冒烟](../scripts/npm-runtime-smoke.cjs) 在仓库外安装 tarball，通过官方模块初始化 Electron，检查直接依赖解析版本、version/doctor、真实 GUI/Preload/模型控件、显式 `jab mcp`、无模型检索、HTML/PDF 和卸载/重装持久性。存在准备好的测试模型时，使用真实 revision/校验值与 fixture 传输，通过 GUI 检查离线失败、取消/复用、安装后即时跨语言索引和删除；发行 CI 要求该项通过。仅成功测试会将 manifest 标记为运行时已验证。这些检查证明当前主机可运行；干净用户的系统身份仍是独立发布门槛。

[CLI](../packages/npm/bin/jab.cjs) 提供 GUI、version、doctor 和 MCP；[用户指南](../packages/npm/README.zh-CN.md) 负责使用说明。Electron 首次运行初始化独立于可选模型安装（[官方安装行为](https://www.electronjs.org/docs/latest/tutorial/installation)）。本次发行按明确选择，让 npm/DMG 共享默认 JAB 用户数据目录。不要同时运行两个渠道访问该目录；凭据兼容性尚未验证，解密失败不会重置密钥。

## 版本、发布与重试

[元数据](../scripts/release-metadata.cjs) 根据根版本、工作流运行编号和提交生成 `base-main.RUN.gSHA7` 与 `v` tag。DMG/npm 使用完全相同的应用版本和 SHA；模型 revision 独立。macOS 使用基础短版本和数字 bundle 构建版本。工作流重跑保留版本；新手动调度生成新版本。数字分量超过 65535 会失败。本地 npm 构建使用 `base-next.0` 并记录 Git SHA。

短期产物（保留 7 天，不重新压缩）包含 DMG 及其桌面 manifest，以及独立的 npm tarball 和 manifest。模型缓存键包含完整 manifest 哈希，缓存命中也会重新校验。原始模型文件不会作为独立产物上传。

[GitHub 发布器](../scripts/publish-release.cjs) 保留桌面职责：要求已验证 ARM64 资产，拒绝额外/混合/损坏文件，上传草稿、验证远端摘要再发布预发行版。已存在的相同资产只验证，不覆盖。不修改 Latest stable。

[npm 发布器](../scripts/publish-npm.cjs) 在 GitHub 发布后于 `npm-release` 中运行，权限为 `contents: read` 和 `id-token: write`。校验实际 tarball、内部元数据、SHA/版本、目标和运行时门槛，再通过 npm OIDC 以 `latest` 标签和 provenance 公开发布 `@stark-lin/jab`；每个新发布的 main 版本都会成为默认安装版本。已存在版本仅在 Registry 完整性摘要一致时被接受，然后直接返回，不发布也不修改任何 dist-tag，即使 `latest` 缺失或已指向更新版本。内容不同会被拒绝；注册表/鉴权失败不会盲目触发发布。不维护独立的 stable/preview npm 双渠道。GitHub/npm 是独立事务：npm 失败会保留 GitHub Release，使用同一已验证产物重试。

`npm publish` 成功后，注册表处理期间仍可能返回 E404。发布器在五分钟传播窗口内每隔 10 秒只轮询该精确版本的完整性摘要；每次查询禁用 npm fetch 重试，设置 10 秒 fetch 超时和 15 秒进程超时。最后一次查询可能在窗口结束后完成。必须摘要一致才能成功。摘要不符、摘要缺失/格式错误、鉴权及其他查询失败均立即报错。传播超时会说明发布已成功、可见性仍待确认；使用同一工作流/产物重跑以验证。轮询期间不重新发布，也不修改 dist-tags。

### 一次性迁移 latest

使用以下命令检查注册表。将 `<existing-version>` 替换为实际已发布的版本，其 SHA 与 `dist.integrity` 必须匹配成功打包作业留存的、通过运行时验证的 npm 产物 manifest。确认对应验证/打包作业通过；不得根据源码基础版本推测版本号或重新打包。如果 `latest` 已指向验证通过的候选版本，则无需修改标签。手动修改前再次检查标签，不要用较旧候选版本替换更新且验证通过的 `latest`。

```sh
npm dist-tag ls @stark-lin/jab
npm view "@stark-lin/jab@<existing-version>" version jab dist.integrity --json
npm dist-tag add "@stark-lin/jab@<existing-version>" latest
npm dist-tag ls @stark-lin/jab
npm install -g @stark-lin/jab
jab --version
```

仅 `dist-tag add` 命令修改注册表状态；由获授权的操作者在验证后执行一次。开发/测试期间绝不真实发布或修改标签。旧 `next` 标签可保持原样；后续发布只使用 `latest`。迁移只将指针指向已有内容，不重新发布版本。

## 签名与发布器配置

预览版默认**不签名**。`RELEASE_SIGNING=signed` 要求 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID` 和 `APPLE_API_ISSUER`。[CI 打包](../scripts/ci-package.cjs) 启用严格签名/公证、删除临时密钥材料并检查 codesign/stapler/Gatekeeper。PR 不接收签名密钥；Windows 签名仍为脚手架。`JAB_PACKAGE_MODE=full|minimal` 选择 CI 桌面策略；当前 Release 使用 Full。

操作者需拥有 npm scope `@stark-lin`，必要时完成包首次创建，并为本仓库、`release.yml` 和 `npm-release` environment 配置 GitHub Trusted Publisher。显式允许直接 `npm publish`：新配置可能默认只允许 staged 权限。使用 GitHub-hosted runner 和 npm 11.5.1+（[npm 要求](https://docs.npmjs.com/trusted-publishers/)）；不保存长期 npm Token。GitHub 的 `release` environment 独立授权预发行版创建。账号/证书供应和 environment 审批仍由操作者负责。

## 兼容性门槛与剩余限制

公开推荐 npm 前，在干净 macOS ARM64 账号上测试：首次 GUI/运行时下载、可选模型安装、离线重启、取消/修复、更新/重装、Gatekeeper 提示、safeStorage 重开和 npm/DMG 凭据互通。不能从同用户 CI 推断这些结果。解密失败后不自动迁移、丢弃或覆盖密钥。模型共享不代表凭据可移植。

Windows/Linux/macOS x64 的 GUI、原生模块、PDF、存储和系统权限实测仍为计划；安装成功不代表正式支持。签名证书、真实 Provider 兼容性、云备份排除和自动应用更新仍未验证/计划中。失败构建保留可用诊断 7 天。在同一工作流重跑失败作业以保留成功产物/版本；撤回发行版不会回滚已安装应用。

相关：[运行时](architecture.zh-CN.md)、[持久存储](data-architecture.zh-CN.md)、[MCP](mcp-architecture.zh-CN.md)、[README](../README.zh-CN.md)。
