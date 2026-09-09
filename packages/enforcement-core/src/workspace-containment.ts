/**
 * Adapter-provided workspace containment for filesystem classification.
 *
 * The risk classifier is deliberately free of filesystem access; harness
 * adapters (via the enforcement runtime) supply a `ContainmentResolver` built
 * here. The resolver normalizes separators, expands `~`, resolves relative
 * paths against the workspace root, follows symlinks through the deepest
 * existing ancestor, and answers whether the *real* target lives inside the
 * workspace. Anything that cannot be resolved conclusively is `unknown`, which
 * the classifier treats as conservatively as `outside`.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export type ContainmentVerdict = "inside" | "outside" | "unknown";

export type ContainmentResolver = (rawPath: string) => ContainmentVerdict;

export type WorkspaceContainmentOptions = {
  workspaceRoot: string;
  /**
   * Exact absolute-path aliases that are explicitly authorized outside the
   * workspace (mirrors `FppPluginConfig.outOfWorkspacePaths`).
   */
  outOfWorkspacePaths?: Readonly<Record<string, string>> | undefined;
  /** Override for `~` expansion (tests). */
  homeDir?: string | undefined;
  /** Override platform detection (tests). */
  platform?: NodeJS.Platform | undefined;
};

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:\//;

/** Normalize separators to `/` for pattern matching. Conservative on POSIX. */
export function normalizePathSeparators(raw: string): string {
  return raw.replace(/\\/g, "/");
}

/**
 * Resolve the real path of `target`, following symlinks through the deepest
 * existing ancestor so not-yet-created files are anchored to a real directory.
 */
export function realpathDeep(target: string): string | undefined {
  let probe = target;
  const remainder: string[] = [];
  // Walk up until something exists (bounded by filesystem depth).
  for (let i = 0; i < 4096; i++) {
    if (existsSync(probe)) {
      let real: string;
      try {
        real = realpathSync(probe);
      } catch {
        return undefined;
      }
      return remainder.length > 0
        ? join(real, ...remainder.reverse())
        : real;
    }
    const parent = dirname(probe);
    if (parent === probe) return undefined;
    remainder.push(probe.slice(parent.length).replace(/^[\\/]+/, ""));
    probe = parent;
  }
  return undefined;
}

function comparablePath(p: string, platform: NodeJS.Platform): string {
  const normalized = normalizePathSeparators(p).replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function createWorkspaceContainmentResolver(
  options: WorkspaceContainmentOptions,
): ContainmentResolver {
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const rootAbs = resolve(options.workspaceRoot);
  const rootReal = realpathDeep(rootAbs) ?? rootAbs;
  const aliases = new Set(
    Object.keys(options.outOfWorkspacePaths ?? {}).map((p) =>
      comparablePath(resolve(p), platform),
    ),
  );

  return (rawPath: string): ContainmentVerdict => {
    const trimmed = rawPath.trim();
    if (trimmed === "" || trimmed.includes("\0")) return "unknown";

    let candidate = normalizePathSeparators(trimmed);

    if (candidate === "~" || candidate.startsWith("~/")) {
      candidate = join(home, candidate.slice(1));
    } else if (candidate.startsWith("~")) {
      // `~user` — cannot resolve another account's home portably.
      return "unknown";
    }

    let absolute: string;
    if (WINDOWS_DRIVE_RE.test(candidate) || candidate.startsWith("//")) {
      // Drive-letter / UNC forms only resolve on Windows hosts.
      if (platform !== "win32") return "unknown";
      absolute = resolve(candidate);
    } else if (candidate.startsWith("/") || isAbsolute(candidate)) {
      absolute = resolve(candidate);
    } else {
      absolute = resolve(rootAbs, candidate);
    }

    if (aliases.has(comparablePath(absolute, platform))) return "inside";

    const real = realpathDeep(absolute) ?? absolute;
    if (aliases.has(comparablePath(real, platform))) return "inside";

    const rel = relative(
      comparablePath(rootReal, platform),
      comparablePath(real, platform),
    );
    if (rel === "") return "inside";
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return "outside";
    }
    return "inside";
  };
}
