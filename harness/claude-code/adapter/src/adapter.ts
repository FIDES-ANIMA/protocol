/**
 * Claude Code adapter — FppRuntimeAdapter over PreToolUse / PostToolUse hooks.
 *
 * Strategy (Anthropic Claude Code hooks docs): configure PreToolUse command hooks
 * in `.claude/settings.json`. Hook reads stdin JSON, returns hookSpecificOutput
 * with permissionDecision. Prompt-layer skills already work under `.claude/skills/`.
 * Operator can disable hooks or use `--dangerously-skip-permissions`.
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

export const CLAUDE_CODE_HARNESS_ID = "claude-code" as const;
export const CLAUDE_CODE_INTERCEPTION_STRATEGY =
  "claude-code-hooks-PreToolUse" as const;

/** Hook invocations are one-shot processes; pending receipts persist here. */
export const CLAUDE_CODE_PENDING_RECEIPTS_FILE =
  "fpp-receipts-pending.json" as const;

export type ClaudeCodeAdapterOptions = {
  workspaceRoot?: string | undefined;
};

export type ClaudeCodeRuntimeAdapter = FppRuntimeAdapter & {
  interceptionStrategy: typeof CLAUDE_CODE_INTERCEPTION_STRATEGY;
};

export type ClaudeCodeHookEvent = {
  tool_name: string;
  tool_input?: Record<string, unknown> | undefined;
  tool_call_id?: string | undefined;
  session_id?: string | undefined;
};

export type ClaudeCodeHookDecision = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny" | "ask";
    permissionDecisionReason?: string | undefined;
  };
};

export function createClaudeCodeAdapter(
  options: ClaudeCodeAdapterOptions = {},
): ClaudeCodeRuntimeAdapter {
  const workspaceRoot =
    options.workspaceRoot ??
    resolveWorkspaceRoot({ profile: "claude-code" });
  return {
    harnessId: CLAUDE_CODE_HARNESS_ID,
    interceptionStrategy: CLAUDE_CODE_INTERCEPTION_STRATEGY,
    getWorkspacePaths: () => ({ workspaceRoot }),
    // Destructive staged-allow needs a concrete recovery artifact (audit F05).
    recoveryProvider: createWorkspaceTrashRecovery(),
  };
}

/** Durable pending receipts unless the operator set/disabled the path. */
export function withClaudeCodeConfigDefaults(configInput: unknown): unknown {
  const base =
    configInput && typeof configInput === "object"
      ? (configInput as Record<string, unknown>)
      : {};
  if ("receiptPendingStorePath" in base) return base;
  return {
    ...base,
    receiptPendingStorePath: workspaceFile(CLAUDE_CODE_PENDING_RECEIPTS_FILE, {
      profile: "claude-code",
    }),
  };
}

export function createClaudeCodeRuntime(
  configInput: unknown,
  options: ClaudeCodeAdapterOptions = {},
): EnforcementRuntime {
  return createEnforcementRuntime(
    withClaudeCodeConfigDefaults(configInput),
    createClaudeCodeAdapter(options),
  );
}

export async function handleClaudeCodePreToolUse(
  runtime: EnforcementRuntime,
  event: ClaudeCodeHookEvent,
): Promise<ClaudeCodeHookDecision> {
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
      agentId: "claude-code",
    },
  );

  if (result.action === "block") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.blockReason,
      },
    };
  }
  if (result.action === "require_approval") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: result.description,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  };
}
