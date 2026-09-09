/**
 * Codex adapter — FppRuntimeAdapter over Codex PreToolUse hooks.
 *
 * Strategy (OpenAI Codex hooks docs): `~/.codex/hooks.json` PreToolUse can deny
 * via permissionDecision or exit code 2. Coverage is graded — shell/Bash is the
 * reliable path; apply_patch and some MCP tools have historically had gaps.
 * Trigger frontmatter for skills remains partial. No operator approval UI →
 * force unattended defaults (no requestApproval).
 */

import {
  createEnforcementRuntime,
  createWorkspaceTrashRecovery,
  type EnforcementRuntime,
  type FppBeforeToolCallResult,
  type FppRuntimeAdapter,
} from "@fides-anima/fpp-enforcement-core";
import {
  resolveWorkspaceRoot,
  workspaceFile,
} from "@fides-anima/fpp-protocol-core";

export const CODEX_HARNESS_ID = "codex" as const;
export const CODEX_INTERCEPTION_STRATEGY = "codex-hooks-PreToolUse" as const;

/** Hook invocations are one-shot processes; pending receipts persist here. */
export const CODEX_PENDING_RECEIPTS_FILE = "fpp-receipts-pending.json" as const;

export const CODEX_GRADED_GUARANTEE =
  "Codex PreToolUse hooks enforce dispositions for shell/Bash reliably; " +
  "apply_patch and some MCP paths may have incomplete coverage. " +
  "Skill trigger frontmatter remains partial. Unattended defaults (no approval UI).";

export type CodexAdapterOptions = {
  workspaceRoot?: string | undefined;
};

export type CodexRuntimeAdapter = FppRuntimeAdapter & {
  interceptionStrategy: typeof CODEX_INTERCEPTION_STRATEGY;
  gradedGuarantee: string;
};

export type CodexHookEvent = {
  tool_name: string;
  tool_input?: Record<string, unknown> | undefined;
  tool_call_id?: string | undefined;
  session_id?: string | undefined;
};

export type CodexHookDecision = {
  permissionDecision: "allow" | "deny";
  permissionDecisionReason?: string | undefined;
};

export function createCodexAdapter(
  options: CodexAdapterOptions = {},
): CodexRuntimeAdapter {
  const workspaceRoot =
    options.workspaceRoot ?? resolveWorkspaceRoot({ profile: "codex" });
  return {
    harnessId: CODEX_HARNESS_ID,
    interceptionStrategy: CODEX_INTERCEPTION_STRATEGY,
    gradedGuarantee: CODEX_GRADED_GUARANTEE,
    getWorkspacePaths: () => ({ workspaceRoot }),
    // Destructive staged-allow needs a concrete recovery artifact (audit F05).
    recoveryProvider: createWorkspaceTrashRecovery(),
    // No Codex operator approval UI for FPP — unattended only.
  };
}

export function createCodexRuntime(
  configInput: unknown,
  options: CodexAdapterOptions = {},
): EnforcementRuntime {
  // Force unattended when config omits dispositionMode; persist pending
  // receipts unless the operator set/disabled the path explicitly.
  const base =
    configInput && typeof configInput === "object"
      ? (configInput as Record<string, unknown>)
      : {};
  const input = {
    dispositionMode: "unattended",
    ...("receiptPendingStorePath" in base
      ? {}
      : {
          receiptPendingStorePath: workspaceFile(CODEX_PENDING_RECEIPTS_FILE, {
            profile: "codex",
          }),
        }),
    ...base,
  };
  return createEnforcementRuntime(input, createCodexAdapter(options));
}

export async function handleCodexPreToolUse(
  runtime: EnforcementRuntime,
  event: CodexHookEvent,
): Promise<CodexHookDecision> {
  // Missing ids are passed through; core derives a durable action id (F09).
  const toolCallId = event.tool_call_id;
  const result: FppBeforeToolCallResult = await runtime.onBeforeToolCall(
    {
      toolName: event.tool_name,
      params: event.tool_input ?? {},
      toolCallId,
    },
    {
      toolCallId,
      sessionKey: event.session_id,
      agentId: "codex",
    },
  );

  if (result.action === "block" || result.action === "require_approval") {
    // Codex has no FPP approval UI — treat require_approval as deny (fail-closed).
    const reason =
      result.action === "block"
        ? result.blockReason
        : `require_approval not supported on Codex adapter: ${result.description}`;
    return {
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    };
  }
  return { permissionDecision: "allow" };
}
