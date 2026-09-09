/**
 * Cursor adapter — FppRuntimeAdapter over Cursor preToolUse / beforeMCPExecution hooks.
 *
 * Strategy (verified against Cursor docs 2026-07): Cursor ships native agent hooks
 * (`preToolUse`, `postToolUse`, `beforeMCPExecution`, `afterMCPExecution`). This
 * adapter drives enforcement-core from those hooks via a command hook that reads
 * JSON on stdin and writes a permission decision on stdout. It does **not** invent
 * a Cursor extension API. Operator can disable hooks; cloud agents may defer some
 * MCP hooks — see harness/shared/harness-capabilities.json gradedGuarantee.
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

export const CURSOR_HARNESS_ID = "cursor" as const;
export const CURSOR_INTERCEPTION_STRATEGY = "cursor-hooks-preToolUse" as const;

/**
 * Cursor pre/post hooks run as separate one-shot processes, so pending
 * receipts must live on disk to be finalized (audit F10). Sibling of the
 * other workspace state files.
 */
export const CURSOR_PENDING_RECEIPTS_FILE = "fpp-receipts-pending.json" as const;

export type CursorAdapterOptions = {
  workspaceRoot?: string | undefined;
};

export type CursorRuntimeAdapter = FppRuntimeAdapter & {
  interceptionStrategy: typeof CURSOR_INTERCEPTION_STRATEGY;
};

export type CursorHookEvent = {
  tool_name: string;
  tool_input?: Record<string, unknown> | undefined;
  tool_call_id?: string | undefined;
  session_id?: string | undefined;
};

export type CursorHookDecision = {
  permissionDecision: "allow" | "deny" | "ask";
  permissionDecisionReason?: string | undefined;
};

export function createCursorAdapter(
  options: CursorAdapterOptions = {},
): CursorRuntimeAdapter {
  const workspaceRoot =
    options.workspaceRoot ??
    resolveWorkspaceRoot({ profile: "cursor" });
  return {
    harnessId: CURSOR_HARNESS_ID,
    interceptionStrategy: CURSOR_INTERCEPTION_STRATEGY,
    getWorkspacePaths: () => ({ workspaceRoot }),
    // Destructive staged-allow needs a concrete recovery artifact (audit F05).
    recoveryProvider: createWorkspaceTrashRecovery(),
    // Cursor can surface "ask" via hook permissionDecision; core never calls
    // requestApproval. Unattended installs leave this undefined.
  };
}

/**
 * Apply Cursor-specific defaults: durable pending receipts unless the operator
 * configured a path explicitly (or disabled with `null`).
 */
export function withCursorConfigDefaults(configInput: unknown): unknown {
  const base =
    configInput && typeof configInput === "object"
      ? (configInput as Record<string, unknown>)
      : {};
  if ("receiptPendingStorePath" in base) return base;
  return {
    ...base,
    receiptPendingStorePath: workspaceFile(CURSOR_PENDING_RECEIPTS_FILE, {
      profile: "cursor",
    }),
  };
}

export function createCursorRuntime(
  configInput: unknown,
  options: CursorAdapterOptions = {},
): EnforcementRuntime {
  return createEnforcementRuntime(
    withCursorConfigDefaults(configInput),
    createCursorAdapter(options),
  );
}

/**
 * Map a Cursor/Claude-compatible PreToolUse stdin payload through enforcement-core.
 *
 * A missing `tool_call_id` is passed through as-is: enforcement-core derives a
 * durable internal action id (audit F09) and marks correlation as reduced
 * instead of the adapter fabricating a host id that nothing else will echo.
 */
export async function handleCursorPreToolUse(
  runtime: EnforcementRuntime,
  event: CursorHookEvent,
): Promise<CursorHookDecision> {
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
      agentId: "cursor",
    },
  );

  if (result.action === "block") {
    return {
      permissionDecision: "deny",
      permissionDecisionReason: result.blockReason,
    };
  }
  if (result.action === "require_approval") {
    // Cursor hooks support "ask"; prefer that over inventing requestApproval UI.
    return {
      permissionDecision: "ask",
      permissionDecisionReason: result.description,
    };
  }
  return { permissionDecision: "allow" };
}
