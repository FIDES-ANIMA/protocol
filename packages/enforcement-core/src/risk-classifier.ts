/**
 * risk-classifier.ts
 *
 * Heuristic classifier that maps a tool call (toolName + params) onto a
 * Freedom-Preserving-Laws risk classification id. The classification is then
 * looked up in the plugin's config to decide whether to block, require
 * approval, or allow.
 *
 * Important caveats:
 *   - This is a HEURISTIC. It pattern-matches on tool names and parameter
 *     shapes. An adversary aware of the patterns can evade it (e.g., by
 *     decoding a base64 command at runtime, or by routing through a tool
 *     name that doesn't match any pattern).
 *   - The classifier is intentionally CONSERVATIVE: when unsure, it returns
 *     the highest applicable risk class. The plugin's config can be tuned
 *     to relax this, but the default should err on Law 1.
 *   - This file is dependency-free so it can be imported from both the
 *     plugin runtime and the self-test script in the parent skill package.
 *     Filesystem containment is injected via `ClassifyOptions.containment`
 *     (see workspace-containment.ts) rather than probed here.
 */

import type { ContainmentResolver, ContainmentVerdict } from "./workspace-containment.js";

export type ClassificationId =
  | "fs.delete.protected"
  | "fs.delete.workspace"
  | "fs.delete.external"
  | "fs.write.protected"
  | "fs.write.workspace"
  | "fs.write.external"
  | "fs.read.benign"
  | "exec.cred-exfil"
  | "exec.outbound-write"
  | "exec.system-modify"
  | "exec.benign"
  | "pkg.install"
  | "pkg.publish"
  | "http.public-write"
  | "http.private-write"
  | "http.public-read"
  | "http.read"
  | "gateway.restart"
  | "gateway.config-change"
  | "credential.exposure"
  | "message.external"
  | "code.patch"
  | "fpp.governance"
  | "internal.heartbeat"
  | "internal.read"
  | "gateway.inspect"
  | "unknown.unclassified";

/** Stable ordered list of all classification ids (for ruleset hashing). */
export const CLASSIFICATION_IDS: readonly ClassificationId[] = [
  "fs.delete.protected",
  "fs.delete.workspace",
  "fs.delete.external",
  "fs.write.protected",
  "fs.write.workspace",
  "fs.write.external",
  "fs.read.benign",
  "exec.cred-exfil",
  "exec.outbound-write",
  "exec.system-modify",
  "exec.benign",
  "pkg.install",
  "pkg.publish",
  "http.public-write",
  "http.private-write",
  "http.public-read",
  "http.read",
  "gateway.restart",
  "gateway.config-change",
  "gateway.inspect",
  "credential.exposure",
  "message.external",
  "code.patch",
  "fpp.governance",
  "internal.heartbeat",
  "internal.read",
  "unknown.unclassified",
] as const;

export type Decision = "block" | "approval" | "allow";

export type ClassificationResult = {
  classification: ClassificationId;
  decision: Decision;
  reason: string;
  matchedPatterns: string[];
};

/** Optional classifier options — scoped overrides, never a global fail-open. */
export type ClassifyOptions = {
  /** Explicit operator allowlist of known custom tool names. */
  knownCustomTools?: string[] | undefined;
  /**
   * Adapter-provided workspace containment check. When supplied, writes and
   * deletes whose real target is outside the workspace (or cannot be
   * resolved) are classified `fs.*.external` instead of `fs.*.workspace`.
   * Without it the classifier falls back to path heuristics only.
   */
  containment?: ContainmentResolver | undefined;
};

const PROTECTED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.gcloud(\/|$)/,
  /(^|\/)\.kube(\/|$)/,
  /(^|\/)\.config\/(openclaw|claude|cursor|codex)(\/|$)/,
  /(^|\/)\.openclaw\/(?!workspace\/).+/,
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
  /(^|\/)credentials(\.json|\.yaml|\.yml|\.toml)?$/,
];

const WORKSPACE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.openclaw\/workspace(\/|$)/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)scratch(\/|$)/,
];

const CRED_VAR_PATTERNS: RegExp[] = [
  /\$AWS_[A-Z_]*KEY/,
  /\$AWS_[A-Z_]*SECRET/,
  /\$OPENAI_API_KEY/,
  /\$ANTHROPIC_API_KEY/,
  /\$GH_TOKEN/,
  /\$GITHUB_TOKEN/,
  /\$NPM_TOKEN/,
  /\$DATABASE_URL/,
  /\$SECRET/,
  /\$PASSWORD/,
  /\$PRIVATE_KEY/,
];

const OUTBOUND_EXEC_PATTERNS: RegExp[] = [
  /\bcurl\b.*\-X\s*(POST|PUT|DELETE|PATCH)/i,
  /\bwget\b.*--post-data/i,
  /\bcurl\b.*\-d\b/,
  /\bcurl\b.*\-\-data\b/,
];

const PACKAGE_INSTALL_PATTERNS: RegExp[] = [
  /\bnpm\s+(install|i)\b/,
  /\bpnpm\s+(install|i|add)\b/,
  /\byarn\s+(add|install)\b/,
  /\bpip(3)?\s+install\b/,
  /\bcargo\s+install\b/,
  /\bgem\s+install\b/,
  /\bgo\s+install\b/,
  /\bbrew\s+install\b/,
  /\bapt(-get)?\s+install\b/,
  /\byum\s+install\b/,
];

const PACKAGE_PUBLISH_PATTERNS: RegExp[] = [
  /\bnpm\s+publish\b/,
  /\bpnpm\s+publish\b/,
  /\bcargo\s+publish\b/,
  /\bgem\s+push\b/,
  /\bgh\s+release\s+create\b/,
];

const GATEWAY_RESTART_PATTERNS: RegExp[] = [
  /\bopenclaw\s+gateway\s+(restart|stop|kill)\b/i,
  /\bsystemctl\s+(restart|stop)\s+openclaw\b/i,
  /\bpkill\s+.*openclaw\b/i,
];

const GATEWAY_CONFIG_PATTERNS: RegExp[] = [
  /\bopenclaw\s+config\s+set\b/i,
  /\bopenclaw\s+plugins\s+(install|uninstall|disable)\b/i,
  /\bopenclaw\s+skills\s+(install|uninstall)\b/i,
];

const EXEC_DELETE_PATTERNS: RegExp[] = [
  /\b(rm|unlink|shred)\b/,
];

const SYSTEM_MODIFY_PATTERNS: RegExp[] = [
  /\bsudo\b/,
  /\bsystemctl\b/,
  /\bservice\s+\w+\s+(start|stop|restart)\b/,
  /\bmount\b/,
  /\bumount\b/,
  /\bchmod\s+(\+x|777|666)/,
  /\bchown\s+/,
  /\bdd\s+if=/,
  /\bmkfs/,
];

/**
 * Private / loopback / link-local destinations. Evaluated against the fully
 * parsed hostname (never a URL prefix) so `localhost.evil.com`,
 * `10.evil.com`, or `user@localhost@evil.com` cannot masquerade as private.
 */
const PRIVATE_HOST_MARKER = "private-destination" as const;
const PUBLIC_HOST_MARKER = "public-destination" as const;

function matchAny(text: string, patterns: RegExp[]): string[] {
  const matched: string[] = [];
  for (const p of patterns) if (p.test(text)) matched.push(p.source);
  return matched;
}

/** Normalize Windows separators so `\.ssh\id_rsa` hits the same rules as `/.ssh/id_rsa`. */
function normalizePathForMatching(raw: string): string {
  return raw.replace(/\\/g, "/");
}

function extractPathArgs(command: string): string[] {
  const tokens = command.split(/\s+/);
  return tokens.filter((t) =>
    !t.startsWith("-") &&
    t !== tokens[0] &&
    (t.includes("/") || t.includes("\\") || t.startsWith("~") || t.startsWith(".") || /^[a-zA-Z]:/.test(t)),
  );
}

/** Conservative containment: only a definite `inside` is trusted. */
function containmentFor(
  rawPath: string,
  resolver: ContainmentResolver | undefined,
): ContainmentVerdict | "heuristic" {
  if (!resolver) return "heuristic";
  try {
    return resolver(rawPath);
  } catch {
    return "unknown";
  }
}

function classifyFilesystem(
  toolName: string,
  params: Record<string, unknown>,
  options?: ClassifyOptions | undefined,
): ClassificationResult | null {
  const lower = toolName.toLowerCase();
  const isDelete = /delete|remove|unlink|rm\b/.test(lower);
  const isWrite = /write|edit|put|patch|create|move|rename/.test(lower);
  const isRead = /read|get|cat|stat|list|ls\b/.test(lower);
  if (!isDelete && !isWrite && !isRead) return null;
  const rawPath = String(params.path ?? params.target ?? params.file ?? params.filepath ?? "");
  if (!rawPath) return null;
  const path = normalizePathForMatching(rawPath);

  const protectedHits = matchAny(path, PROTECTED_PATH_PATTERNS);
  const workspaceHits = matchAny(path, WORKSPACE_PATH_PATTERNS);
  const containment =
    isDelete || isWrite ? containmentFor(rawPath, options?.containment) : "heuristic";
  const notContained = containment === "outside" || containment === "unknown";

  if (isDelete && protectedHits.length > 0) {
    return {
      classification: "fs.delete.protected",
      decision: "block",
      reason: `delete on protected path ${rawPath} would reduce options irreversibly without consent (Law 1 + Law 3).`,
      matchedPatterns: protectedHits,
    };
  }
  if (isDelete && notContained) {
    return {
      classification: "fs.delete.external",
      decision: "approval",
      reason: `delete on path ${rawPath} is ${containment === "unknown" ? "unresolvable" : "outside the workspace"}; not eligible for staged allow (Law 1 + Law 3).`,
      matchedPatterns: [`containment:${containment}`],
    };
  }
  if (isDelete && workspaceHits.length > 0) {
    return {
      classification: "fs.delete.workspace",
      decision: "approval",
      reason: `delete on workspace path ${rawPath}; reversible cost is moderate but consent should be confirmed (Law 1).`,
      matchedPatterns: workspaceHits,
    };
  }
  if (isDelete) {
    return {
      classification: "fs.delete.workspace",
      decision: "approval",
      reason:
        containment === "inside"
          ? `delete on workspace-contained path ${rawPath}; requesting approval (Law 1).`
          : `delete on uncategorized path ${rawPath}; requesting approval out of caution (Law 3).`,
      matchedPatterns: containment === "inside" ? ["containment:inside"] : [],
    };
  }
  if (isWrite && protectedHits.length > 0) {
    return {
      classification: "fs.write.protected",
      decision: "approval",
      reason: `write on protected path ${rawPath}; requesting approval (Law 1).`,
      matchedPatterns: protectedHits,
    };
  }
  if (isWrite && notContained) {
    return {
      classification: "fs.write.external",
      decision: "approval",
      reason: `write on path ${rawPath} is ${containment === "unknown" ? "unresolvable" : "outside the workspace"}; requesting approval (Law 1).`,
      matchedPatterns: [`containment:${containment}`],
    };
  }
  if (isWrite) {
    return {
      classification: "fs.write.workspace",
      decision: "allow",
      reason: `write inside workspace; reversible.`,
      matchedPatterns:
        containment === "inside" ? [...workspaceHits, "containment:inside"] : workspaceHits,
    };
  }
  return {
    classification: "fs.read.benign",
    decision: "allow",
    reason: `read does not reduce options.`,
    matchedPatterns: [],
  };
}

function classifyExec(
  toolName: string,
  params: Record<string, unknown>,
  options?: ClassifyOptions | undefined,
): ClassificationResult | null {
  if (!/exec|shell|bash|sh|run|command/i.test(toolName)) return null;
  const command = String(params.command ?? params.cmd ?? params.argv ?? "");
  if (!command) return null;

  const credHits = matchAny(command, CRED_VAR_PATTERNS);
  const outboundHits = matchAny(command, OUTBOUND_EXEC_PATTERNS);

  if (credHits.length > 0 && outboundHits.length > 0) {
    return {
      classification: "exec.cred-exfil",
      decision: "block",
      reason: `command interpolates credential vars (${credHits.join(", ")}) into outbound request; classic exfiltration shape (Law 1).`,
      matchedPatterns: [...credHits, ...outboundHits],
    };
  }

  const restartHits = matchAny(command, GATEWAY_RESTART_PATTERNS);
  if (restartHits.length > 0) {
    return {
      classification: "gateway.restart",
      decision: "block",
      reason: `command would restart/stop the OpenClaw gateway, severing corrigibility (Law 2).`,
      matchedPatterns: restartHits,
    };
  }

  const configHits = matchAny(command, GATEWAY_CONFIG_PATTERNS);
  if (configHits.length > 0) {
    return {
      classification: "gateway.config-change",
      decision: "approval",
      reason: `command would change OpenClaw gateway configuration; needs steward approval (Law 2).`,
      matchedPatterns: configHits,
    };
  }

  const installHits = matchAny(command, PACKAGE_INSTALL_PATTERNS);
  if (installHits.length > 0) {
    return {
      classification: "pkg.install",
      decision: "approval",
      reason: `command would install a package, expanding capability surface (Law 5).`,
      matchedPatterns: installHits,
    };
  }

  const publishHits = matchAny(command, PACKAGE_PUBLISH_PATTERNS);
  if (publishHits.length > 0) {
    return {
      classification: "pkg.publish",
      decision: "approval",
      reason: `command would publish a package to a public registry (Law 1 + Law 3).`,
      matchedPatterns: publishHits,
    };
  }

  const sysHits = matchAny(command, SYSTEM_MODIFY_PATTERNS);
  if (sysHits.length > 0) {
    return {
      classification: "exec.system-modify",
      decision: "approval",
      reason: `command would modify host system (sudo / systemctl / mount / etc.); needs approval (Law 1 + Law 2).`,
      matchedPatterns: sysHits,
    };
  }

  if (outboundHits.length > 0) {
    return {
      classification: "exec.outbound-write",
      decision: "approval",
      reason: `command performs outbound write; verify destination and payload (Law 1 + Law 3).`,
      matchedPatterns: outboundHits,
    };
  }

  const deleteHits = matchAny(command, EXEC_DELETE_PATTERNS);
  if (deleteHits.length > 0) {
    const pathArgs = extractPathArgs(command);
    const normalizedArgs = pathArgs.map(normalizePathForMatching);
    const protectedHits = normalizedArgs.flatMap((p) => matchAny(p, PROTECTED_PATH_PATTERNS));
    if (protectedHits.length > 0) {
      return {
        classification: "fs.delete.protected",
        decision: "block",
        reason: `shell delete targets protected path (${pathArgs.filter((p) => matchAny(normalizePathForMatching(p), PROTECTED_PATH_PATTERNS).length > 0).join(", ")}); irreversible without consent (Law 1 + Law 3).`,
        matchedPatterns: [...deleteHits, ...protectedHits],
      };
    }
    if (options?.containment) {
      // Any target outside (or unresolvable) makes the whole command external.
      // A delete with no recognizable path argument (`rm "$DIR"`, `rm foo`) is
      // an unfamiliar target and is treated as unresolvable, not benign.
      const verdicts =
        pathArgs.length > 0
          ? pathArgs.map((p) => containmentFor(p, options.containment))
          : (["unknown"] as ContainmentVerdict[]);
      const worst = verdicts.find((v) => v === "outside" || v === "unknown");
      if (worst) {
        return {
          classification: "fs.delete.external",
          decision: "approval",
          reason: `shell delete targets a path ${worst === "unknown" ? "that cannot be resolved" : "outside the workspace"}; not eligible for staged allow (Law 1 + Law 3).`,
          matchedPatterns: [...deleteHits, `containment:${worst}`],
        };
      }
      return {
        classification: "fs.delete.workspace",
        decision: "approval",
        reason: `shell delete targets workspace-contained path(s); requesting approval (Law 1).`,
        matchedPatterns: [...deleteHits, "containment:inside"],
      };
    }
    const workspaceHits = normalizedArgs.flatMap((p) => matchAny(p, WORKSPACE_PATH_PATTERNS));
    if (workspaceHits.length > 0) {
      return {
        classification: "fs.delete.workspace",
        decision: "approval",
        reason: `shell delete targets workspace path; requesting approval (Law 1).`,
        matchedPatterns: [...deleteHits, ...workspaceHits],
      };
    }
  }

  return {
    classification: "exec.benign",
    decision: "allow",
    reason: `no high-risk pattern matched.`,
    matchedPatterns: [],
  };
}

function classifyHttp(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  if (!/http|fetch|request|curl|webhook/i.test(toolName)) return null;
  const method = String(params.method ?? "GET").toUpperCase();
  const url = String(params.url ?? params.endpoint ?? "");
  if (!url) return null;

  // Write semantics are decided from the method alone — never downgraded by
  // the destination. Destination privacy only picks the public/private class.
  const isWrite = !HTTP_READ_METHODS.has(method);
  const destination = classifyHttpDestination(url);
  const isPublic = destination !== "private";
  const marker = isPublic ? PUBLIC_HOST_MARKER : PRIVATE_HOST_MARKER;

  if (isWrite && isPublic) {
    return {
      classification: "http.public-write",
      decision: "approval",
      reason: `${method} to ${destination === "unparseable" ? "unparseable" : "public"} URL ${url} could create external state (Law 1 + Law 3).`,
      matchedPatterns: [marker],
    };
  }
  if (isWrite) {
    return {
      classification: "http.private-write",
      decision: "allow",
      reason: `${method} to private/loopback host ${url} is a local state change; allowing with audit (not treated as a read).`,
      matchedPatterns: [marker],
    };
  }
  if (isPublic) {
    return {
      classification: "http.public-read",
      decision: "allow",
      reason: `${method} to public URL ${url} is a read; allow by default (strict mode may escalate).`,
      matchedPatterns: [marker],
    };
  }
  return {
    classification: "http.read",
    decision: "allow",
    reason: `${method} targets a local/private host and is a read.`,
    matchedPatterns: [marker],
  };
}

const HTTP_READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

type HttpDestination = "private" | "public" | "unparseable";

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // unique-local fc00::/7
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]!);
    return v4 !== null && isPrivateIpv4(v4);
  }
  return false;
}

/**
 * Classify the destination of a URL by parsing it fully (WHATWG URL) and
 * examining the complete hostname / IP literal. Unparseable → public
 * (conservative: writes require approval).
 */
function classifyHttpDestination(url: string): HttpDestination {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "unparseable";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "unparseable";
  }
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "") return "unparseable";
  if (host === "localhost" || host.endsWith(".localhost")) return "private";
  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4) ? "private" : "public";
  if (host.includes(":")) return isPrivateIpv6(host) ? "private" : "public";
  return "public";
}

function classifyMessage(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  if (!/message|send|email|sms|post|tweet|telegram|slack|discord|whatsapp/i.test(toolName))
    return null;
  // Any outbound message to a non-self recipient is a Law 1 candidate; we
  // approve rather than block by default, because explicit user messaging is
  // the most common legitimate task.
  void params;
  return {
    classification: "message.external",
    decision: "approval",
    reason: `outbound message to a third party; verify recipient and content (Law 1).`,
    matchedPatterns: [],
  };
}

/**
 * Dedicated class for apply_patch (and OpenClaw-prefixed forms).
 * Matches even when path params are absent — classifyFilesystem requires a path
 * and previously missed bare apply_patch → unknown.unclassified.
 * Never allowlisted by default (Q3-B → approval).
 */
function classifyCodePatch(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  void params;
  if (!/^apply_patch$/i.test(toolName)) return null;
  return {
    classification: "code.patch",
    decision: "approval",
    reason:
      "apply_patch modifies code; requires approval (code.patch) — not silently allowlisted.",
    matchedPatterns: ["/^apply_patch$/i"],
  };
}

/**
 * Always-allow heartbeat responder (Q2-A). Matches bare and OpenClaw-prefixed
 * live names via /heartbeat_respond$/i so knownCustomTools seed is not required.
 */
function classifyInternalHeartbeat(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  void params;
  if (!/heartbeat_respond$/i.test(toolName)) return null;
  return {
    classification: "internal.heartbeat",
    decision: "allow",
    reason:
      "heartbeat_respond fulfills an OpenClaw heartbeat obligation (internal.heartbeat); allowing with audit.",
    matchedPatterns: ["/heartbeat_respond$/i"],
  };
}

/**
 * Curated OpenClaw introspection/coordination tools (Q6-A).
 * Named allow-with-audit under internal.read — not opaque knownCustomTools.
 * wiki_apply / subagents: keep named id; escalate clearly externalizing shapes
 * to approval if discovered (do not silently broaden fail-open).
 */
const INTERNAL_READ_TOOLS: ReadonlySet<string> = new Set([
  "memory_search",
  "get_goal",
  "update_plan",
  "read_mcp_resource",
  "sessions_list",
  "wiki_apply",
  "subagents",
]);

function classifyInternalRead(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  void params;
  if (!INTERNAL_READ_TOOLS.has(toolName)) return null;
  return {
    classification: "internal.read",
    decision: "allow",
    reason: `tool ${toolName} is a curated OpenClaw introspection/coordination tool (internal.read); allowing with audit.`,
    matchedPatterns: ["INTERNAL_READ_TOOLS"],
  };
}

/**
 * Param-aware OpenClaw gateway tool split (Q3-A).
 * Action tokens are derived from common live fields: `action`, `command`,
 * `method`, and argv-like `argv`/`args` (joined). Shell `GATEWAY_*` patterns
 * in classifyExec remain the source of truth for CLI-shaped mutate.
 * Ambiguous / unknown mutate-shaped calls must not fail-open to inspect.
 */
const GATEWAY_INSPECT_ACTIONS = /\b(inspect|status|get|list|info|health)\b/i;
const GATEWAY_RESTART_ACTIONS = /\b(restart|stop|kill)\b/i;
const GATEWAY_CONFIG_ACTIONS =
  /\b(config|plugins?\s+(install|uninstall|disable)|skills?\s+(install|uninstall)|config\.set)\b/i;

function extractGatewayActionToken(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["action", "command", "method"] as const) {
    const v = params[key];
    if (typeof v === "string" && v.trim()) parts.push(v);
  }
  const argv = params.argv ?? params.args;
  if (Array.isArray(argv)) {
    parts.push(argv.map(String).join(" "));
  } else if (typeof argv === "string" && argv.trim()) {
    parts.push(argv);
  }
  return parts.join(" ").trim();
}

function classifyGatewayTool(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  // Live OpenClaw form is often `openclawgateway`; normalized form is `gateway`.
  if (!/^(openclaw)?gateway$/i.test(toolName)) return null;

  const token = extractGatewayActionToken(params);
  if (!token) {
    return {
      classification: "unknown.unclassified",
      decision: "approval",
      reason:
        "gateway tool call missing action/command/method; degraded classification — not fail-open to gateway.inspect.",
      matchedPatterns: ["gateway-tool-ambiguous"],
    };
  }

  if (GATEWAY_RESTART_ACTIONS.test(token)) {
    return {
      classification: "gateway.restart",
      decision: "block",
      reason:
        "gateway tool would restart/stop/kill the OpenClaw gateway, severing corrigibility (Law 2).",
      matchedPatterns: [GATEWAY_RESTART_ACTIONS.source],
    };
  }
  if (GATEWAY_CONFIG_ACTIONS.test(token)) {
    return {
      classification: "gateway.config-change",
      decision: "approval",
      reason:
        "gateway tool would change OpenClaw gateway configuration; needs steward approval (Law 2).",
      matchedPatterns: [GATEWAY_CONFIG_ACTIONS.source],
    };
  }
  if (GATEWAY_INSPECT_ACTIONS.test(token)) {
    return {
      classification: "gateway.inspect",
      decision: "allow",
      reason:
        "gateway tool is inspect/status/get/list-shaped (gateway.inspect); allowing with audit.",
      matchedPatterns: [GATEWAY_INSPECT_ACTIONS.source],
    };
  }

  return {
    classification: "unknown.unclassified",
    decision: "approval",
    reason: `gateway tool action "${token}" is not a known inspect shape; degraded classification — not fail-open.`,
    matchedPatterns: ["gateway-tool-unknown-action"],
  };
}

/**
 * Normalize OpenClaw-prefixed live tool names before classify / allowlist.
 *
 * | Live form | After normalize |
 * |-----------|-----------------|
 * | `openclawfpp_*` | `fpp_*` |
 * | `openclaw.<name>` | `<name>` |
 * | `openclaw` + remainder when remainder is `fpp_*`, curated internal.read, or seeded | `<remainder>` |
 *
 * Unrelated `openclaw*` names are left unchanged (no over-broad strip).
 */
export function normalizeOpenClawToolName(
  toolName: string,
  seededNames: readonly string[] = [],
): string {
  if (/^openclawfpp_/i.test(toolName)) {
    return toolName.replace(/^openclaw/i, "");
  }
  if (/^openclaw\./i.test(toolName)) {
    return toolName.replace(/^openclaw\./i, "");
  }
  if (/^openclaw/i.test(toolName)) {
    const remainder = toolName.replace(/^openclaw/i, "");
    if (
      /^fpp_/.test(remainder) ||
      remainder === "gateway" ||
      INTERNAL_READ_TOOLS.has(remainder) ||
      seededNames.includes(remainder)
    ) {
      return remainder;
    }
  }
  return toolName;
}

export function classifyToolCall(
  toolName: string,
  params: Record<string, unknown>,
  options?: ClassifyOptions | undefined,
): ClassificationResult {
  const allowlist = options?.knownCustomTools ?? [];
  const name = normalizeOpenClawToolName(toolName, allowlist);
  const safeParams =
    params && typeof params === "object" && !Array.isArray(params)
      ? params
      : {};
  const results: (ClassificationResult | null)[] = [
    classifyFilesystem(name, safeParams, options),
    classifyExec(name, safeParams, options),
    classifyHttp(name, safeParams),
    classifyMessage(name, safeParams),
    classifyCodePatch(name, safeParams),
    // Matches bare + OpenClaw-mangled forms via /heartbeat_respond$/i
    classifyInternalHeartbeat(name, safeParams),
    classifyInternalRead(name, safeParams),
    classifyGatewayTool(name, safeParams),
  ];
  for (const r of results) {
    if (r) return r;
  }

  // Fallthrough-only: fpp_* governance tools allow with audit.
  // Must not run before specific classifiers (fpp_shell_exec still hits exec).
  if (/^fpp_/.test(name)) {
    const matchedPatterns = ["/^fpp_/"];
    if (name !== toolName) matchedPatterns.push("normalizeOpenClawToolName");
    return {
      classification: "fpp.governance",
      decision: "allow",
      reason: `tool ${name} is an FPP governance/introspection tool (fpp.governance); allowing with audit.`,
      matchedPatterns,
    };
  }

  if (allowlist.includes(name)) {
    const matchedPatterns = ["knownCustomTools"];
    if (name !== toolName) matchedPatterns.push("normalizeOpenClawToolName");
    return {
      classification: "unknown.unclassified",
      decision: "allow",
      reason: `tool ${name} is on the operator known-custom-tool allowlist; allowing with audit.`,
      matchedPatterns,
    };
  }

  return {
    classification: "unknown.unclassified",
    decision: "approval",
    reason: `tool ${name} did not match any known risk pattern; degraded classification — approval required (not fail-open).`,
    matchedPatterns: [],
  };
}
