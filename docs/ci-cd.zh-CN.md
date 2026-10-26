# CI/CD 与桌面分发

用途：负责分支集成、CI、模型准备、打包及发布运维。状态：源码中**已配置**，平台执行证据由 Actions 运行提供。签名分发需要操作者提供证书。尚未实现应用自动更新。

语言：简体中文 · [English](ci-cd.md)

## 集成与触发

改动先集成到 `dev`。功能分支使用 `codex/` 并以 `dev` 为目标；通过 PR 将 `dev` 合入 `main`。[CI](../.github/workflows/ci.yml)在指向这两个分支的 PR、`dev` push、合并队列及手动触发时运行。`CI required` 汇总检查拒绝失败和取消，并拒绝来自本仓库 `dev` 以外分支的 main PR。

[Release](../.github/workflows/release.yml)在每次 `main` push（包括合并 PR）后运行，并支持在 `main` 手动触发。各阶段固定事件 SHA，重新验证、构建四个平台目标，再统一发布 GitHub 预发布版本。无需推送 tag。直接 push main 也会触发发布，因此需通过分支保护阻止普通直接推送。

仓库保护要求 `main` 通过 PR、保持最新的 `CI required`、解决讨论，并约束管理员。两个分支均禁止强推和删除。`dev` 接受普通集成推送并在推送后运行 CI，保留已批准的集成路径。使用合并队列时再启用对应事件。工作流文件本身不会配置仓库保护。

## 验证与原生打包

[验证](../.github/workflows/validate.yml)固定 Node 24.22.1，执行 `npm ci`、显式安装 Electron、`check`、发布脚本测试及 Electron/Knowledge smoke。Linux 使用 Xvfb、原生系统库及临时 runner 上[按执行文件限定的 AppArmor 许可](../scripts/setup-linux-ci.sh)，允许沙箱用户命名空间。Chromium 沙箱保持启用。Ubuntu 24+ 安装可能需要管理员为选定的 AppImage 执行路径配置 AppArmor profile。普通验证无需下载模型。模型、原生依赖或构建相关改动额外触发包体验证；[范围检测](../scripts/ci-scope.cjs)控制 PR 成本。

[打包](../.github/workflows/package.yml)分别在 Windows x64（`windows-2022`）、macOS arm64（`macos-15`）、macOS x64（`macos-15-intel`）、Linux x64（`ubuntu-24.04`）原生运行。准备并校验模型、构建、执行真实离线推理/MCP smoke，再构建并验证 NSIS、DMG 或 AppImage。不接受跨架构运行结果。[安装器验收](../scripts/verify-installer.cjs)额外挂载并复制 DMG、静默安装/卸载 NSIS，或解压 AppImage，并重跑包内运行检查。[.gitattributes](../.gitattributes)固定文本行尾，确保跨平台 manifest 摘要一致。

[Builder 配置](../electron-builder.yml)包含生产依赖和全部编译入口/资源。ONNX/Sharp 原生库 unpack，模型和声明位于 ASAR 外。[包内验收](../scripts/verify-package.cjs)校验每个模型摘要、原生运行时，再从其他 cwd 启动打包二进制，使用临时 userData。验证维度、归一化、双向跨语言检索、SQLite/RRF、真实 stdio MCP session、broker 共用单进程、词法降级及资源释放。无需付费模型。

## 模型来源与本地命令

[Manifest](../resources/embedding-model.json)固定七个文件、精确大小、SHA-256、revision 和推理设置。[准备脚本](../scripts/prepare-embedding-model.cjs)验证缓存，以有界重试/超时下载固定 revision，流式校验并原子替换临时文件。仅验证模式绝不下载。权重不进入 Git。缺失或损坏文件使打包失败；普通开发保留词法降级。

```sh
npm ci
npx --no-install install-electron
npm run check
npm run test:release
npm run model:prepare
npm run release:check
npm run package:dir
npm run package:verify -- /absolute/path/to/unpacked-app
```

`build` 保持离线。`package:win`、`package:mac`、`package:linux` 和 `release:build` 自动准备模型。`test:embedding` 要求先构建并准备模型。模型许可证声明与上游来源随 [model-notice.txt](../resources/model-notice.txt)一同打包。

## 版本、产物与发布

[版本元数据](../scripts/release-metadata.cjs)根据 package 版本、工作流运行编号和提交生成 `base-main.RUN.gSHA7`。Tag 加 `v` 前缀；Windows 使用纯数字 `base.RUN` 文件版本。重跑同一工作流保留版本；数字分量超过 65535 时明确失败。新的手动触发属于独立构建。

模型缓存键包含完整 manifest 哈希，命中后仍重新校验。最终安装包与各平台清单使用短期 Actions artifacts（7 天，不重新压缩）。原始模型不作为 artifact 上传。每个平台记录提交、模型 revision/manifest 摘要、架构、签名模式、安装包大小/哈希及运行验收成功状态。

仅最终发布任务获得 `contents: write`，且要求所有必需平台成功。[发布器](../scripts/publish-release.cjs)拒绝混合提交、缺失平台、额外文件及哈希不符，汇总 `build-manifest.json` 和 `SHA256SUMS`，创建或复用草稿，上传并校验全部远程资源后才公开预发布。上传或验证失败时草稿保持私有。已公开资源绝不覆盖；相同重跑仅验证。不会改变最新稳定版。

PR 会取消过时运行。发布串行且禁用取消运行；GitHub 仍可能用较新待运行任务替换较旧待运行任务。需要为被跳过的中间提交构建时，可在 `main` 手动触发。成功产物不得发布缺平台的版本。

## 签名与 GitHub 配置

预览默认**不签名**。启用严格签名需设置仓库 Actions 变量 `RELEASE_SIGNING=signed`；凭据缺失或无效时打包任务失败。唯一其他合法值为 `unsigned`。Linux 使用摘要校验。PR 打包不接收签名凭据。

| 仓库 Actions secret | 用途 |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Base64 Developer ID 证书及密码 |
| `APPLE_API_KEY` | App Store Connect API 密钥正文，写入私有临时文件并在结束时清理 |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | 公证 API 标识 |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows 签名证书及密码 |

[CI 打包](../scripts/ci-package.cjs)在签名模式下强制代码签名，启用 Apple 公证，验证 codesign/stapling/Gatekeeper，并检查 Windows Authenticode。证书/服务开通和首次安装的系统批准仍由操作者处理。`release` Environment 控制发布；要求 main 全自动发布时不要添加人工必需审批。任务 token 需要创建仓库 Release 的权限。Actions 内无需 PAT。

## 失败、重试与验证边界

在同一工作流重跑失败任务以保留成功产物及版本。损坏缓存由准备脚本修复，或导致校验失败；不得发布省略模型的版本。发布失败保留草稿，可继续补传缺失资源。撤回已公开预览需在 GitHub 删除 Release；已安装应用不会自动回滚。

失败任务保留可用 builder 诊断七天；普通日志标识失败阶段及脱敏能力错误。不发布用户档案或凭据。干净目标机的人工安装/卸载、证书配置、真实 AI Provider 兼容性和自动更新不能仅由源码配置证明。

相关：[运行时](architecture.zh-CN.md)、[存储及索引 identity](data-architecture.zh-CN.md)、[MCP](mcp-architecture.zh-CN.md)、[README 命令](../README.zh-CN.md)。
