# JAB npm Preview

Purpose: run the JAB desktop application and its existing MCP server from npm. Status: preview; macOS ARM64 is the only release validation target. Clean-user Gatekeeper and Keychain compatibility remain unverified.

Language: English · [简体中文](README.zh-CN.md)

```sh
npx @stark-lin/jab@next
npm install -g @stark-lin/jab@next
jab
jab --version
jab doctor
jab mcp --data-dir "/absolute/path/to/JAB/data"
```

Node.js 24.10 or newer is required. Electron initializes its runtime on first launch. The package contains no model weights and installation does not download an embedding model.

Smart Note, Markdown and keyword search work without a model. Download the optional model in Settings → Knowledge backup and retrieval. The application verifies every file before activation. Cancel retains verified staging files for retry. Remove deletes model weights and disables automatic Seed import; notes, backups and derived indexes are retained.

npm and DMG default to the same JAB user-data directory and share the independent model store. `--data-dir` or `JOB_BROWSER_USER_DATA` explicitly overrides the database directory. Do not run two channels against the same database simultaneously. Credentials are protected by the operating system; cross-channel Keychain compatibility requires clean-Mac validation. Decryption failures are reported without resetting stored secrets.

MCP requires an explicit absolute data directory or `JOB_BROWSER_USER_DATA`. Globally installed JAB can configure external Agents using its absolute Node and CLI paths. Temporary `npx` installations cannot install permanent MCP connections. Resume PDF output uses Electron and may initialize its runtime on first use.

Updating or uninstalling npm removes application files only; user data and model files persist. `jab doctor` reports the actual Electron executable and model location without downloading anything. Doctor streams SHA256 verification of installed models; the GUI also verifies integrity before inference.

Application license: AGPL-3.0-only; see [LICENSE](../../LICENSE). Model and font licenses remain in their bundled notices. Source and current limitations: [repository](https://github.com/stark-lin/job-agent-browser).
