# CI/CD and desktop distribution

Purpose: own branch integration, CI, model preparation, packaging and release operations. Status: **Configured** in source; platform execution evidence is provided by Actions runs. Signed distribution requires operator-supplied certificates. No application auto-updater is implemented.

Language: English · [简体中文](ci-cd.zh-CN.md)

## Integration and triggers

Changes integrate into `dev` first. Feature branches use `codex/` and target `dev`; promote `dev` to `main` through a PR. [CI](../.github/workflows/ci.yml) runs on PRs targeting either branch, pushes to `dev`, merge queues and manual dispatch. Its `CI required` aggregate rejects failures/cancellations and rejects main PRs from any head other than this repository's `dev`.

[Release](../.github/workflows/release.yml) runs on every push to `main`, including merged PRs, and supports manual dispatch on `main`. It checks out the event SHA throughout, reruns validation, builds all four targets and publishes one GitHub prerelease. A tag push is not required. Direct main pushes also trigger release; branch protection must prevent ordinary direct pushes.

Repository protection requires a PR, up-to-date `CI required`, resolved conversations and administrator enforcement on `main`. Both branches reject force pushes/deletion. `dev` accepts ordinary integration pushes and runs CI afterward, preserving the approved integration path. Enable merge-queue events only if using the queue. Workflow files alone do not configure repository protection.

## Validation and native packaging

[Validation](../.github/workflows/validate.yml) pins Node 24.22.1 and uses `npm ci`, explicit Electron installation, `check`, release-script tests, and Electron/Knowledge smokes. Linux uses Xvfb with Openbox and a D-Bus session for native focus/keyboard behavior, native libraries and [per-executable AppArmor allowances](../scripts/setup-linux-ci.sh) for sandbox user namespaces on temporary runners. Chromium sandboxing remains enabled. Ubuntu 24+ installations may require an administrator-provided AppArmor profile for the chosen AppImage executable path. Normal validation requires no downloaded model. Model/native/build changes additionally invoke package validation; [scope detection](../scripts/ci-scope.cjs) controls that PR cost.

[Packaging](../.github/workflows/package.yml) runs natively on Windows x64 (`windows-2022`), macOS arm64 (`macos-15`), macOS x64 (`macos-15-intel`) and Linux x64 (`ubuntu-24.04`). It prepares/verifies the model, builds, runs real offline inference/MCP smoke and builds/verifies NSIS, DMG or AppImage. No cross-architecture runtime result is accepted. [Installer verification](../scripts/verify-installer.cjs) additionally mounts/copies a DMG, silently installs/uninstalls NSIS, or extracts an AppImage and repeats package runtime checks. [.gitattributes](../.gitattributes) fixes text line endings so manifest digests agree across platforms.

[Builder configuration](../electron-builder.yml) includes production dependencies and all compiled entries/resources. ONNX/Sharp native libraries are unpacked; the model and its notice live outside ASAR. [Package verification](../scripts/verify-package.cjs) checks every model digest, native runtime presence and then launches the packaged binary from a different cwd with disposable userData. It verifies dimensions, normalization, two-way cross-language retrieval, SQLite/RRF, a real stdio MCP session, single-process broker sharing, lexical fallback and disposal. It never uses a paid model.

## Model supply and local commands

[Manifest](../resources/embedding-model.json) pins seven files, exact sizes, SHA-256, revision and inference settings. [Preparation](../scripts/prepare-embedding-model.cjs) verifies caches, downloads fixed-revision files with bounded retries/timeouts, validates streamed bytes and atomically renames temporary files. Verify-only never downloads. Model weights do not enter Git. Missing/corrupt files fail packaging; ordinary development retains lexical fallback.

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

`build` remains offline. `package:win`, `package:mac`, `package:linux` and `release:build` prepare models automatically. `test:embedding` requires a prior build and prepared model. Model-license declarations and upstream provenance are bundled in [model-notice.txt](../resources/model-notice.txt).

## Version, artifacts and publication

[Version metadata](../scripts/release-metadata.cjs) derives `base-main.RUN.gSHA7` from package version, workflow run number and commit. The tag is prefixed `v`; Windows uses the numeric `base.RUN` file version. Rerunning the same workflow retains the version; numeric components above 65535 fail explicitly. New manual dispatches are distinct builds.

The model uses a cache keyed by the complete manifest hash and is reverified on cache hits. Final installers and per-target manifests use short-lived Actions artifacts (7 days, no recompression). Raw model files are never uploaded as artifacts. Each target records the commit, model revision/manifest digest, architecture, signing mode, installer size/hash and successful runtime verification.

Only the final publish job receives `contents: write`, after every required platform succeeds. [Publisher](../scripts/publish-release.cjs) rejects mixed commits, missing targets, unexpected files and hash mismatches, assembles `build-manifest.json` and `SHA256SUMS`, creates/reuses a draft, uploads all assets, verifies remote sizes/hashes, then makes the prerelease public. Drafts remain private on upload/verification failure. Published assets are never overwritten; an identical rerun only verifies them. Latest stable is not changed.

PR jobs cancel superseded work. Release concurrency is serialized with cancellation disabled; GitHub may replace an older pending run with a newer pending run. Run manual dispatch on `main` when a skipped intermediate commit needs a build. Successful outputs cannot publish a partial platform set.

## Signing and GitHub configuration

Previews default to **unsigned**. To enable strict signing, set the repository Actions variable `RELEASE_SIGNING=signed`; missing/invalid credentials fail the package job. `unsigned` is the only other accepted value. Linux uses checksum verification. PR packaging receives no signing secrets.

| Repository Actions secret | Use |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Base64 Developer ID certificate and password |
| `APPLE_API_KEY` | App Store Connect API key contents, written to a private temporary file and removed afterward |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Notarization API identifiers |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows signing certificate and password |

[CI packaging](../scripts/ci-package.cjs) enforces code signing in signed mode, enables Apple notarization, validates codesign/stapling/Gatekeeper, and checks Windows Authenticode. Certificate/service provisioning and first-install OS approval remain operator tasks. The `release` Environment controls publication; do not add a manual required reviewer if fully automatic main releases are desired. Its token needs permission to create repository releases. No PAT is required inside Actions.

## Failures, retries and verification limits

Rerun failed jobs in the same workflow to retain successful artifacts and version. Corrupt caches are repaired by preparation or fail verification; no release omits the model. A failed publication leaves a draft and can resume uploading missing assets. To withdraw a published preview, remove that release through GitHub; installed applications do not roll back automatically.

Failure jobs retain available builder diagnostics for seven days; normal logs include failing stage and sanitized capability errors. User profiles and credentials are not published. Manual installation/uninstallation on clean target machines, certificate provisioning, live AI-provider compatibility and automatic updates are not established by source configuration alone.

Related: [runtime](architecture.md), [storage and index identity](data-architecture.md), [MCP](mcp-architecture.md), [README commands](../README.md).
