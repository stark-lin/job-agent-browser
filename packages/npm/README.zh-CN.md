# JAB npm 预览版

目的：通过 npm 运行 JAB 桌面应用及其现有 MCP 服务。状态：预览版；macOS ARM64 是唯一发行验证目标。干净用户环境的 Gatekeeper 和 Keychain 兼容性尚未验证。

语言：[English](README.md) · 简体中文

```sh
npx @stark-lin/jab@next
npm install -g @stark-lin/jab@next
jab
jab --version
jab doctor
jab mcp --data-dir "/absolute/path/to/JAB/data"
```

需要 Node.js 24.10 或更新版本。Electron 在首次启动时初始化运行时。包内不含模型权重，安装时不下载 embedding 模型。

没有模型也可使用 Smart Note、Markdown 和关键词搜索。在设置 → 知识库备份与检索中下载可选模型。应用在激活前校验每个文件。取消会保留已校验的 staging 文件供重试复用。删除操作删除模型权重并禁用自动 Seed 导入；笔记、备份和派生索引会保留。

npm 与 DMG 默认使用同一个 JAB 用户数据目录，并共享独立模型存储。使用 `--data-dir` 或 `JOB_BROWSER_USER_DATA` 显式覆盖数据库目录。不要让两个渠道同时访问同一个数据库。凭据由操作系统保护；跨渠道 Keychain 兼容性需要在干净 Mac 上验证。解密失败会报错，不会重置已有密钥。

MCP 必须显式指定绝对数据目录或 `JOB_BROWSER_USER_DATA`。全局安装的 JAB 可使用绝对 Node 和 CLI 路径配置外部 Agent。临时 `npx` 安装不能安装永久 MCP 连接。简历 PDF 输出使用 Electron，首次使用可能初始化运行时。

npm 更新或卸载只删除应用文件；用户数据和模型文件会保留。`jab doctor` 报告真实 Electron 可执行文件与模型位置，不执行下载。doctor 会流式校验已安装模型的 SHA256；GUI 也在推理前验证模型完整性。

应用许可证：AGPL-3.0-only，见 [LICENSE](../../LICENSE)。模型和字体保留随包附带的各自许可声明。源码与当前限制见[仓库](https://github.com/stark-lin/job-agent-browser)。
