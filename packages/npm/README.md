# JAB

JAB (Job Agent Browser) is a local-first desktop workspace for job seeking, with profile management, job tracking, AI-assisted resumes, Smart Note and local MCP tools. Status: available on npm; macOS ARM64 is the only fully validated release platform.

Language: English · [简体中文](README.zh-CN.md)

## Installation

Requires Node.js **>=24.10.0** and npm.

```sh
npm install -g @stark-lin/jab
```

Electron initializes its runtime on first launch. The npm package contains no embedding model weights, and installation does not download an embedding model.

## Quick Start

Launch the desktop app:

```sh
jab
```

Configure an AI provider and default model in Settings for AI-assisted workflows. Smart Note, Markdown and keyword search work without an embedding model; download the optional model in Settings → Knowledge backup and retrieval for semantic search.

For temporary execution:

```sh
npx @stark-lin/jab
```

## CLI Commands

| Command | Purpose |
| --- | --- |
| `jab` | Open the desktop app |
| `jab --version` | Show the installed version |
| `jab doctor` | Check runtime and model locations and verify installed model digests without downloading |
| `jab --help` | Show CLI usage |
| `jab --data-dir "/absolute/path/to/JAB/data"` | Open the app with an explicit data directory |
| `jab mcp --data-dir "/absolute/path/to/JAB/data"` | Start the stdio MCP server for an external Agent |

Check your installation:

```sh
jab --version
jab doctor
```

MCP requires an explicit **absolute** data directory through `--data-dir` or `JOB_BROWSER_USER_DATA`; use the same directory as the desktop app to access its data. With a global installation, Settings → Connect external Agents → Add MCP configures absolute Node and CLI paths; install Skills separately. Temporary `npx` installations cannot install permanent MCP connections. Resume PDF output uses Electron and may initialize its runtime on first use. See the [MCP connection guide](https://github.com/stark-lin/job-agent-browser/blob/main/docs/mcp-architecture.md#5-job-agent-browser-mcp).

## Updating

Close JAB, then install the latest published version:

```sh
npm install -g @stark-lin/jab@latest
jab --version
```

Updating or uninstalling the npm package removes application files only; user data and optional model files persist independently. Automatic application updates are not implemented.

## Local Data & Privacy

Profiles, jobs, notes and settings are stored locally. AI-assisted workflows send relevant content to the provider you configure; optional GitHub note backup also sends data when enabled. Credentials are protected by the operating system.

npm and DMG use the same default JAB user-data directory and share an independent model store. Use `--data-dir` or `JOB_BROWSER_USER_DATA` to select another absolute data directory. Do not run multiple JAB processes against the same database concurrently. Cross-installation Keychain compatibility remains unverified; decryption failures are reported without resetting stored secrets. See [storage details](https://github.com/stark-lin/job-agent-browser/blob/main/docs/data-architecture.md).

## Platform Support

Only **macOS ARM64** has complete release validation. Windows, Linux and macOS x64 remain unvalidated for release. Clean-user Gatekeeper/Keychain behavior and credential interoperability between npm and DMG remain unverified; see [compatibility limits](https://github.com/stark-lin/job-agent-browser/blob/main/docs/ci-cd.md#compatibility-gates-and-remaining-limits).

## License & Source

JAB is licensed under [AGPL-3.0-only](https://github.com/stark-lin/job-agent-browser/blob/main/LICENSE); the package also includes `LICENSE`. Model and font licenses remain in their bundled notices. [Source code and issue tracker](https://github.com/stark-lin/job-agent-browser).
