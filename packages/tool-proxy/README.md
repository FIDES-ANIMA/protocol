# @fides-anima/fpp-tool-proxy

Shared reference implementation for harnesses that need an MCP/sidecar
interception path (in addition to, or instead of, native PreToolUse hooks).

This package is staged for public npm but has not been published from this repository yet. Until the first release, use the workspace or a local packed tarball.

```bash
npm install @fides-anima/fpp-tool-proxy@0.1.0
```

```ts
import { createToolProxy } from "@fides-anima/fpp-tool-proxy";
import { createEnforcementRuntime } from "@fides-anima/fpp-enforcement-core";

const runtime = createEnforcementRuntime(config, adapter);
const proxy = createToolProxy(runtime, async (tool, params) => realInvoke(tool, params));

await proxy.call("Bash", { command: "echo hi" }, { toolCallId: "1" });
// ToolProxyDeniedError if disposition is deny/abstain
```

Cursor / Claude Code / Codex adapters prefer native hooks; import this proxy
when wiring an MCP tool gateway or custom sidecar.

## License

See [LICENSE](./LICENSE).
