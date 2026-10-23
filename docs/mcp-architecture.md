# Tools and MCP Runtime

Purpose: define capability registration, scoped execution and MCP integration. Status: **Implemented** Main-owned Native/stdio tools, audited capabilities, compatible AgentModel/AgentLoop and ResumeAgent snapshot tools. Browser tools and remote transports remain **Planned**.

Language: English · [简体中文](mcp-architecture.zh-CN.md)

## 1. Ownership and call path

Main creates one [runtime](../src/platform/mcp/runtime.ts) and injects already audited capabilities. Business Agents receive the type-only [ToolScope contract](../src/shared/tools/index.ts); they do not receive Registry mutations, SDK clients, SQL, audit writers, Electron objects or secret readers. Renderer has no tooling IPC.

```text
Main-bound caller → ToolScope → validated Tool binding
                                  ↓
                         audited read / write capability
                                  ↓
                       Domain Service or MCP Client
```

[Native bindings](../src/platform/tools/native.ts) explicitly expose `job.get`, `job.list`, `profile.get`, `profile.list_facts` and `artifact.get`. The Main-only `job.set_archived` write capability reuses the Domain service but is not registered for Agents. Generation persistence, transactions, raw SQL and secrets are never tool bindings. Storage/audit semantics belong to [data architecture](data-architecture.md#4-audit-and-transactions).

The [AI SSE adapter](../src/platform/ai/compatible.ts) retains chat streaming without tools. [AgentModel](../src/shared/agent/index.ts) separately defines non-streaming messages, call batches, final text, cancellation and errors; [compatible adaptation](../src/platform/agent/compatible.ts) shares configuration/HTTP foundations and maps dotted names injectively to provider names. Each accepted model call records one fixed outcome audit, without prompt/output persistence.

## 2. Registration and scopes

The [Registry](../src/shared/tools/registry.ts) rejects duplicate names and reserved trusted-operation namespaces. MCP names must begin with the configured unique Server ID; native namespaces cannot be claimed by MCP. A Server batch is validated before replacement. Descriptors are cloned/frozen and contain no execution function.

[Policies](../src/shared/tools/policy.ts) require `allow`; an empty array grants nothing. Patterns support exact names or a trailing namespace wildcard such as `profile.*`. Deny takes priority; `*.delete` and arbitrary glob patterns are invalid. Risks are ordered `READ < COMPUTE < WRITE < EXTERNAL_ACTION`; the default maximum is `READ`.

A scope captures approved entries, policy and Main-bound caller identity at creation. New tools never appear in an existing scope. Removal/replacement revokes old entries and active calls; old scopes cannot silently bind to a reconnected tool. Scope disposal and caller cancellation stop active calls. The application runtime accepts only `READ / COMPUTE` scopes pending a future confirmation mechanism.

The generic [AgentLoop](../src/platform/agent/loop.ts) permits at most 8 model calls per stage. It records one complete assistant call list, then executes tools sequentially and appends corresponding observations. Ordinary tool errors may be observations; cancellation and audit failure terminate immediately. Empty/illegal output, duplicate call IDs and exhaustion fail explicitly. There are no automatic retries, fallback, planner, memory or parallel tools.

[Resume scopes](../src/platform/agent/snapshot-tools.ts) use a private task registry containing only `job.get`, `profile.get` and paginated `profile.list_facts`, all bound to immutable run inputs and fixed object IDs. No live reads, external MCP tools or Artifact/status writes are offered. Domain receives only an injected stage runner; Main disposes the scope on completion/cancellation. Resume lifecycle and provenance belong to [data architecture](data-architecture.md).

## 3. Provider review and adaptation

Each [Provider](../src/platform/mcp/provider.ts) filters discovery against an explicit local review manifest. The manifest owns application name, original name, description, risk, tags, input and optional output schema. Upstream descriptions, instructions and risk annotations cannot grant permissions or replace reviewed descriptions. Unknown tools are ignored.

[Schema fingerprints](../src/platform/mcp/tool-adapter.ts) ignore object property order but reject any other input/output schema change, including adding/removing `outputSchema`. Missing or changed tools are quarantined. Discovery notifications revoke the current batch before refreshing; a failed refresh leaves it unavailable. There is no automatic reconnect or execution retry; Main may explicitly reconnect.

[Validation](../src/platform/tools/schema.ts) supports object inputs and JSON Schema 2020-12, including local references. Other dialects, remote references and dynamic references are rejected. Validation never coerces values, supplies defaults or removes fields. JSON boundaries reject getters, cycles, non-JSON values and oversized/deep data.

Results support text blocks and optional JSON `structuredContent`; declared output schemas are checked. `isError` becomes a stable execution failure. Images, audio, resource fetching and additional input/interaction flows are unsupported. SDK, process and server error bodies never become public exceptions.

## 4. Configuration and lifecycle

Main reads the optional version-1 `userData/mcp.json` through the [configuration adapter](../src/platform/storage/mcp-config.ts). Missing files mean no external processes; invalid files remain untouched and produce a sanitized diagnostic without blocking the window. There is no Settings UI, credential field, OAuth flow or automatic installation. Configuration and secret storage rules belong to [data architecture](data-architecture.md#6-settings-secrets-and-remaining-work).

The following manually reviewed example matches the `echo` schema of the [test Server](../tests/fixtures/mcp-server.mjs). Replace both executable/script paths with installed absolute paths; registering another Server requires reviewing its actual schemas, not copying this manifest unchanged.

```json
{
  "version": 1,
  "servers": [{
    "id": "example",
    "enabled": true,
    "transport": "stdio",
    "command": "/absolute/path/node",
    "args": ["/absolute/path/server.mjs"],
    "tools": [{
      "name": "example.echo",
      "originalName": "echo",
      "description": "Echo supplied text.",
      "risk": "READ",
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } },
        "required": ["text"],
        "additionalProperties": false
      }
    }]
  }]
}
```

The [SDK v2 Client](../src/platform/mcp/client.ts) uses its default legacy initialization handshake over stdio. It launches absolute commands without a shell, uses the SDK's limited environment inheritance, discards stderr and does not inject app credentials. Running Electron's own executable selects its Node mode. These local processes are trusted executables, not an OS sandbox.

The [pool](../src/platform/mcp/client-pool.ts) deduplicates pending connections and rejects conflicting Server IDs. Discovery aggregates up to 16 pages/500 tools. Connect/discovery each have a 10-second bound. Calls default to 30 seconds, with a 120-second maximum, four concurrent requests per Server and sixteen active capabilities globally; saturation fails immediately. Schema/input limits are 64 KiB, results 1 MiB, transport messages 2 MiB, nesting 32 and JSON nodes 16,384.

Main starts optional connections in the background. On disconnect it revokes tools and cancels their local waiters. Timeout/cancellation notifies the Server and rejects local work even if an operation ignores its signal; it cannot guarantee reversal of remote effects. One cancellation does not close a shared connection. Shutdown revokes scopes, settles audited calls and closes Clients before SQLite; the SDK closes stdin, then escalates to process termination within its bounded teardown sequence.

## 5. Verification and remaining delivery

[Tool tests](../tests/tools.test.ts), [MCP tests](../tests/mcp.test.ts) and [capability audit tests](../tests/capability-audit.test.ts) cover permissions, revocation, input/output/privacy boundaries, real paginated stdio, schema changes, errors, timeouts, cancellation, immutable audit and transactional local writes.

The [runtime smoke](../scripts/run-mcp-smoke.cjs) bundles the actual composition modules as CJS with external production dependencies and runs them inside Electron's Node runtime. It verifies Native/MCP execution, write audit, cancellation, disconnect/reconnect, restart recovery and child-process cleanup with disposable storage. Commands are indexed in [README](../README.md).

**Planned:** first real-service integration with its required transport/credentials, while the first business Agent now uses private snapshot scopes. HTTP/OAuth, Browser adapters, resource/prompt support, multimodal results, high-risk confirmations, automatic installation and the capability-audit viewer are not implemented. No third-party account or Windows/Linux runtime compatibility is certified by local fixture tests.

## Related documents

- [Code architecture](code-architecture.md): dependency and process boundaries.
- [Data architecture](data-architecture.md): audited read/write persistence and configuration.
- [Current architecture](architecture.md): application runtime and limitations.
