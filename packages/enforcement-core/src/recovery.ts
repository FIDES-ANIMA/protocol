/**
 * Adapter-proven recovery for destructive staged-allow decisions.
 *
 * Staged allow used to record only metadata for workspace deletes; nothing
 * actually made the action recoverable. The runtime now requires a concrete
 * `RecoveryProof` before staging a destructive action. Adapters may supply
 * their own provider (VCS snapshot, host trash API); this module ships a
 * filesystem trash transaction with bounded accounting that works anywhere.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { ClassificationId } from "./risk-classifier.js";
import { createWorkspaceContainmentResolver } from "./workspace-containment.js";

export type RecoveryProof = {
  kind: "snapshot" | "trash";
  /** Location / identifier of the recovery artifact. */
  ref: string;
  /** Bytes retained by the artifact (bounded by `stagedRecoveryMaxBytes`). */
  sizeBytes: number;
  createdAt: string;
};

export type RecoveryRequest = {
  actionId: string;
  toolName: string;
  params: Record<string, unknown>;
  classification: ClassificationId;
  workspaceRoot: string;
  /** Hard upper bound — providers must return null when exceeded. */
  maxBytes: number;
  outOfWorkspacePaths?: Readonly<Record<string, string>> | undefined;
};

export type RecoveryProvider = (
  request: RecoveryRequest,
) => Promise<RecoveryProof | null> | RecoveryProof | null;

export type WorkspaceTrashRecoveryOptions = {
  /** Directory receiving trash copies. Default `<workspaceRoot>/.fpp-trash`. */
  trashDir?: string | undefined;
};

function extractTargetPath(params: Record<string, unknown>): string | undefined {
  for (const key of ["path", "target", "file", "filepath"] as const) {
    const v = params[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

/** Recursive byte count without following symlinks; null when over `limit`. */
export function measureTreeBytes(
  target: string,
  limit: number,
): number | null {
  let total = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const st = lstatSync(current);
    if (st.isSymbolicLink()) {
      total += st.size;
    } else if (st.isDirectory()) {
      for (const child of readdirSync(current)) stack.push(join(current, child));
    } else {
      total += st.size;
    }
    if (total > limit) return null;
  }
  return total;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "action";
}

/**
 * Filesystem trash transaction: copy the delete target into a trash directory
 * before the tool runs. Only single-path filesystem tools with a target that
 * resolves inside the workspace are eligible; shell deletes and out-of-
 * workspace targets yield no proof (callers then abstain or require approval).
 */
export function createWorkspaceTrashRecovery(
  options: WorkspaceTrashRecoveryOptions = {},
): RecoveryProvider {
  return (request: RecoveryRequest): RecoveryProof | null => {
    if (!request.classification.startsWith("fs.delete")) return null;
    const rawTarget = extractTargetPath(request.params);
    if (!rawTarget) return null;

    const containment = createWorkspaceContainmentResolver({
      workspaceRoot: request.workspaceRoot,
      outOfWorkspacePaths: request.outOfWorkspacePaths,
    });
    if (containment(rawTarget) !== "inside") return null;

    const root = resolve(request.workspaceRoot);
    const trashDir = resolve(options.trashDir ?? join(root, ".fpp-trash"));
    const target = resolve(root, rawTarget.replace(/\\/g, "/"));
    // Never trash the trash (or the workspace root itself).
    if (target === root || target === trashDir || target.startsWith(`${trashDir}${sep}`)) {
      return null;
    }

    const createdAt = new Date().toISOString();
    if (!existsSync(target)) {
      // Nothing to lose — deletion of an absent path is trivially recoverable.
      return { kind: "trash", ref: "absent-target", sizeBytes: 0, createdAt };
    }

    const size = measureTreeBytes(target, request.maxBytes);
    if (size === null) return null;

    const dest = join(
      trashDir,
      sanitizeSegment(request.actionId),
      basename(target),
    );
    try {
      mkdirSync(join(trashDir, sanitizeSegment(request.actionId)), {
        recursive: true,
      });
      cpSync(target, dest, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
    } catch {
      return null;
    }
    return { kind: "trash", ref: dest, sizeBytes: size, createdAt };
  };
}
