# CI/CD and application distribution

Purpose: own integration, validation, optional model supply, desktop/npm packaging, signing and publication. Status: **Configured** in source; execution evidence comes from local checks and Actions. The release target is **macOS ARM64 only**. Clean-user Gatekeeper/Keychain and cross-channel credentials remain unverified. No auto-updater is implemented.

Language: English · [简体中文](ci-cd.zh-CN.md)

## Integration and triggers

Feature branches use `codex/` and integrate into `dev`. Promote `dev` to `main` through a PR with `CI required` passing. [CI](../.github/workflows/ci.yml) rejects main PRs from other heads; repository protection must enforce PRs, current checks, resolved conversations, administrator enforcement and no force pushes/deletion. Workflows do not configure these settings.

[Release](../.github/workflows/release.yml) runs on main pushes or manual main dispatch, checks out the exact event SHA, validates, builds both channels and publishes a GitHub prerelease followed by npm with the `latest` tag. Releases are serialized without canceling active runs. No tag push is required. PR jobs cancel superseded work.

## Validation and native packaging

[Validation](../.github/workflows/validate.yml) pins Node 24.22.1 and runs on `macos-15` ARM64. It installs Electron explicitly, runs `check`, release-script tests, model-free npm content validation and Electron/Knowledge smokes. Ordinary validation requires no model download. [Scope detection](../scripts/ci-scope.cjs) adds native/package validation for affected source, dependencies, resources, packaging and workflows.

[Packaging](../.github/workflows/package.yml) has two jobs: Full DMG with verified offline Seed/inference, and a model-free npm tarball with a clean installation/runtime smoke. Both use the same release metadata. No cross-architecture result is accepted. Windows, Linux and macOS x64 remain **Scaffolded**, outside publication.

The [base builder](../electron-builder.yml) produces Minimal desktop apps; [Full configuration](../electron-builder.full.yml) adds a Seed. Existing `package` commands retain Full by default; `package:minimal` opts into Minimal. ONNX/Sharp native libraries stay unpacked. App inference never reads Seed paths directly.

[Desktop verification](../scripts/verify-package.cjs) verifies notices, native modules and either all Seed digests or the absence of model weights (`--minimal`). It launches the app from another cwd with disposable data. Full checks import Seed into the user store, execute normalized 384-dimensional/two-way cross-language retrieval, SQLite/RRF, a real MCP session, shared inference, HTML/PDF and model-removal fallback. Minimal checks missing-model keyword/MCP retrieval and HTML/PDF. [Installer verification](../scripts/verify-installer.cjs) extracts/mounts installers, then repeats the selected mode's checks.

## Model supply and local commands

[Manifest](../resources/embedding-model.json) pins revision, files, exact sizes, SHA256, license and inference settings. [Preparation](../scripts/prepare-embedding-model.cjs) and Main share the [transfer/verifier core](../src/platform/models/core.cjs): fixed revision, streamed byte limits/hashes, bounded retries/timeouts and temporary-file rename. Verify-only never downloads. Full packaging requires prepared/verified Seed; Minimal and npm builds do not prepare models.

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

`test:embedding` requires a build and prepared Seed. [Model Manager](../src/platform/models/manager.ts) imports Full Seed asynchronously on first use; user removal persists an opt-out. Model store/lifetime rules belong to [data architecture](data-architecture.md). Model and font notices remain separate from the application's AGPL-3.0-only license.

## npm runtime and reproducible artifacts

[Preparation](../scripts/prepare-npm-package.cjs) keeps the source package private and creates `dist/npm/` using the [package template](../packages/npm/package.template.json). It copies the consumer READMEs from `packages/npm/` (never the root README), preserves their published license/source links, and sets repository/homepage/CLI metadata from the template. It also copies built Main/Preload/Renderer, MCP/inference/PDF workers, fonts, Skills, model manifest/notice and license. Runtime dependencies, including Electron, use exact versions from the root lock; `npm-shrinkwrap.json` retains the resolved production dependency closure, registry digests and optional-platform dependencies. It never copies checkout node_modules or model weights.

[Content validation](../scripts/verify-npm-package.cjs) rejects symlinks, model weights, databases, secrets, caches, fixtures and installers, checks package metadata and consumer README/license contents (including the packed bytes), packs the directory, and records tarball SHA256/SHA512, size, version, commit and verification status in `dist/npm-artifacts/manifest.json`. npm files remain separate from the desktop-only `release/publish/` set.

[Clean-install smoke](../scripts/npm-runtime-smoke.cjs) installs the tarball outside the checkout, initializes Electron through its official module, verifies resolved direct versions, version/doctor, real GUI/Preload/model controls, explicit `jab mcp`, missing-model retrieval, HTML/PDF and uninstall/reinstall persistence. With prepared test weights, real revision bytes/checksums and fixture transport exercise GUI offline failure, cancellation/reuse, immediate cross-language indexing and removal; release CI requires this semantic gate. Only a successful smoke marks the manifest runtime-verified. These checks establish current-host operation; clean-user OS identity remains a separate release gate.

[CLI](../packages/npm/bin/jab.cjs) exposes GUI, version, doctor and MCP; [consumer guide](../packages/npm/README.md) owns usage. Electron first-run initialization is separate from optional model installation ([official installation behavior](https://www.electronjs.org/docs/latest/tutorial/installation)). npm/DMG share the default JAB user-data directory, as explicitly selected for this release. Do not run both against it concurrently; credential compatibility is unverified and decrypt failures do not reset secrets.

## Versions, publication and retry

[Metadata](../scripts/release-metadata.cjs) derives `base-main.RUN.gSHA7` and `v` tag from the root version, workflow run and commit. DMG/npm use that exact application version and SHA; model revision is independent. macOS uses the base short version and numeric bundle build version. Rerunning a workflow keeps its version; a new manual dispatch creates another version. Numeric components above 65535 fail. Local npm builds use `base-next.0` and record their Git SHA.

Short-lived artifacts (7 days, no recompression) contain one DMG plus its desktop manifest, and separately one npm tarball plus its manifest. Model cache keys include the full manifest hash and cache hits are reverified. Raw model files are not uploaded as standalone artifacts.

[GitHub publisher](../scripts/publish-release.cjs) retains its desktop responsibility: require verified ARM64 assets, reject extra/mixed/corrupt files, upload to a draft, verify remote digests and publish the prerelease. Existing identical assets are verified, never overwritten. Latest stable is unchanged.

[npm publisher](../scripts/publish-npm.cjs) runs after GitHub publication in `npm-release`, with `contents: read` and `id-token: write`. It verifies the exact tarball, embedded metadata, SHA/version, target and runtime gates, then uses npm OIDC to publish `@stark-lin/jab` publicly with tag `latest` and provenance; every newly published main version becomes the default installation. An existing version is accepted only when Registry integrity matches and returns without publishing or changing any dist-tag, even if `latest` is absent or points to a newer version. Different bytes are rejected; registry/auth failures do not trigger blind publication. No separate stable/preview npm channels are maintained. GitHub/npm are independent transactions: an npm failure retains the GitHub release and is retried using the same verified artifact.

After `npm publish` succeeds, registry processing may still return E404. The publisher polls only the exact version’s integrity every 10 seconds within a five-minute propagation window; each lookup disables npm fetch retries, uses a 10-second fetch timeout and has a 15-second process timeout. A final lookup may finish after the window. Matching integrity is required for success. Different digests, missing/malformed integrity, authentication and other lookup failures fail immediately. Propagation timeout reports that publication succeeded but visibility remains pending; rerun the same workflow/artifact to verify it. Polling never republishes or changes dist-tags.

### One-time latest migration

Inspect the registry with the commands below. Replace `<existing-version>` with an actual published version whose SHA and `dist.integrity` match the retained, runtime-verified npm artifact manifest from the successful packaging job. Confirm the corresponding validation/package jobs passed; never infer a version from the source base version or repackage it. If `latest` already points to the verified candidate, no tag change is needed. Recheck tags immediately before any manual change and do not replace a newer verified `latest` with an older candidate.

```sh
npm dist-tag ls @stark-lin/jab
npm view "@stark-lin/jab@<existing-version>" version jab dist.integrity --json
npm dist-tag add "@stark-lin/jab@<existing-version>" latest
npm dist-tag ls @stark-lin/jab
npm install -g @stark-lin/jab
jab --version
```

Only the `dist-tag add` command changes registry state; an authorized operator runs it once after verification. Development/tests never publish or edit real tags. The old `next` tag may remain untouched; future publications use only `latest`. Migration changes a pointer to existing bytes and does not republish a version.

## Signing and publisher configuration

Previews are **unsigned** by default. `RELEASE_SIGNING=signed` requires `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. [CI packaging](../scripts/ci-package.cjs) enables strict signing/notarization, removes temporary key material, and checks codesign/stapler/Gatekeeper. PRs receive no signing secrets; Windows signing remains scaffolded. `JAB_PACKAGE_MODE=full|minimal` selects CI desktop strategy; current Releases use Full.

The operator must own npm scope `@stark-lin`, bootstrap the package if needed, and configure its GitHub Trusted Publisher for this repository, `release.yml` and `npm-release` environment. Explicitly allow direct `npm publish`: new configurations may default to staged-only permission. Use GitHub-hosted runners and npm 11.5.1+ ([npm requirements](https://docs.npmjs.com/trusted-publishers/)); no long-lived npm token is stored. GitHub's `release` environment separately permits prerelease creation. Provisioning accounts/certificates and environment approvals remains an operator task.

## Compatibility gates and remaining limits

Before publicly recommending npm, test a clean macOS ARM64 account: initial GUI/runtime download, optional model installation, offline restart, cancellation/repair, update/reinstall, Gatekeeper prompts, safeStorage reopen and npm/DMG credential interoperability. These checks cannot be inferred from same-user CI. Do not auto-migrate, discard or overwrite secrets after a decrypt failure. Model sharing does not imply credential portability.

Manual Windows/Linux/macOS x64 GUI, native modules, PDF, storage and OS-permission checks remain planned; installation success alone does not establish support. Signed certificates, live provider compatibility, cloud-backup exclusion and automatic application updates remain unverified/planned. Failed builds retain available diagnostics for seven days. Rerun failed jobs in the same workflow to preserve successful artifacts/version; withdrawing a release does not roll back installed applications.

Related: [runtime](architecture.md), [persistent storage](data-architecture.md), [MCP](mcp-architecture.md), [README](../README.md).
