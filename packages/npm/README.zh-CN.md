# JAB

JAB（Job Agent Browser）是面向求职的本地优先桌面工作空间，提供个人资料管理、职位跟踪、AI 辅助简历、智能笔记与本地 MCP 工具。状态：已通过 npm 提供；macOS ARM64 是唯一经过完整发行验证的平台。

语言：[English](README.md) · 简体中文

## 安装

需要 Node.js **>=24.10.0** 和 npm。

```sh
npm install -g @stark-lin/jab
```

Electron 在首次启动时初始化运行时。npm 包不内置 embedding 模型权重，安装时也不下载 embedding 模型。

## 快速开始

启动桌面应用：

```sh
jab
```

在设置中配置 AI Provider 与默认模型，即可使用 AI 辅助流程。智能笔记、Markdown 与关键词搜索无需 embedding 模型；如需语义搜索，可在设置 → 知识库备份与检索中下载可选模型。

临时执行：

```sh
npx @stark-lin/jab
```

## CLI 命令

| 命令 | 用途 |
| --- | --- |
| `jab` | 打开桌面应用 |
| `jab --version` | 显示已安装版本 |
| `jab doctor` | 检查运行时和模型位置，校验已安装模型摘要，不执行下载 |
| `jab --help` | 显示 CLI 用法 |
| `jab --data-dir "/absolute/path/to/JAB/data"` | 使用显式数据目录打开应用 |
| `jab mcp --data-dir "/absolute/path/to/JAB/data"` | 为外部 Agent 启动 stdio MCP 服务 |

检查安装：

```sh
jab --version
jab doctor
```

MCP 必须通过 `--data-dir` 或 `JOB_BROWSER_USER_DATA` 显式指定**绝对**数据目录；使用与桌面应用相同的目录才能访问其数据。全局安装后，设置 → 连接外部 Agent → 添加 MCP 会配置绝对 Node 和 CLI 路径；Skills 需单独安装。临时 `npx` 安装不能安装永久 MCP 连接。简历 PDF 输出使用 Electron，首次使用可能初始化运行时。见 [MCP 接入指南](https://github.com/stark-lin/job-agent-browser/blob/main/docs/mcp-architecture.zh-CN.md#五job-agent-browser-mcp)。

## 更新

关闭 JAB，然后安装最新发布版本：

```sh
npm install -g @stark-lin/jab@latest
jab --version
```

更新或卸载 npm 包只删除应用文件；用户数据与可选模型文件独立保留。尚未实现应用自动更新。

## 本地数据与隐私

个人资料、职位、笔记与设置保存在本地。AI 辅助流程会将相关内容发送给你配置的 Provider；可选 GitHub 笔记备份启用后也会传输数据。凭据由操作系统保护。

npm 与 DMG 默认使用同一个 JAB 用户数据目录，并共享独立模型存储。可通过 `--data-dir` 或 `JOB_BROWSER_USER_DATA` 选择其他绝对数据目录。不要让多个 JAB 进程同时访问同一个数据库。不同安装方式之间的 Keychain 兼容性尚未验证；解密失败会报错，不会重置已保存密钥。见[存储详情](https://github.com/stark-lin/job-agent-browser/blob/main/docs/data-architecture.zh-CN.md)。

## 平台支持

仅 **macOS ARM64** 经过完整发行验证。Windows、Linux 和 macOS x64 尚未完成发行验证。干净用户环境的 Gatekeeper/Keychain 行为，以及 npm 与 DMG 之间的凭据互通仍未验证；见[兼容性限制](https://github.com/stark-lin/job-agent-browser/blob/main/docs/ci-cd.zh-CN.md#兼容性门槛与剩余限制)。

## 许可证与源码

JAB 采用 [AGPL-3.0-only](https://github.com/stark-lin/job-agent-browser/blob/main/LICENSE) 许可证；包内也包含 `LICENSE`。模型和字体保留各自随包附带的许可声明。[源代码与问题跟踪](https://github.com/stark-lin/job-agent-browser)。
