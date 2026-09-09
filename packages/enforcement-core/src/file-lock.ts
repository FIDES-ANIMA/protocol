/**
 * Cross-process advisory file lock + atomic replace-write.
 *
 * Shared enforcement stores (mandate / emergency ledgers, hash-chained audit
 * logs) are mutated by multiple short-lived hook processes. Unlocked
 * read/check/write cycles allow concurrent budget overspend and audit-chain
 * forks. Every mutation must run under `withFileLock` and persist via
 * `writeFileAtomic` so a crash mid-write never leaves a torn store.
 *
 * Lock acquisition uses `O_EXCL` creation of `<path>.lock`, which is atomic
 * on every platform Node supports. Stale locks (crashed holder) are broken
 * after `staleMs`; callers hold locks only for synchronous work so a healthy
 * holder never approaches that bound.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type FileLockOptions = {
  /** Max time to wait for the lock before throwing. Default 5000ms. */
  timeoutMs?: number | undefined;
  /** Lock files older than this are considered abandoned. Default 30000ms. */
  staleMs?: number | undefined;
  /** Poll interval while waiting. Default 5ms. */
  pollMs?: number | undefined;
};

export class FileLockTimeoutError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string, timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms waiting for lock ${lockPath}`);
    this.name = "FileLockTimeoutError";
    this.lockPath = lockPath;
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_POLL_MS = 5;

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(sleepBuffer, 0, 0, Math.max(1, ms));
}

export function lockPathFor(targetPath: string): string {
  return `${resolve(targetPath)}.lock`;
}

/** Re-entrancy guard: nested `withFileLock` on the same path in one process. */
const heldInProcess = new Set<string>();

/**
 * Errors that mean "someone else is touching this file right now". Windows
 * reports transient EPERM/EACCES/EBUSY (sharing violations) and ENOENT
 * (delete-pending) while a peer creates or unlinks the same lock file.
 */
const CONTENTION_CODES: ReadonlySet<string> = new Set([
  "EEXIST",
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOENT",
]);

function tryAcquire(lockPath: string, staleMs: number): boolean {
  try {
    const fd = openSync(lockPath, "wx");
    try {
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (!CONTENTION_CODES.has(code)) throw err;
  }
  // Break abandoned locks left by a crashed holder.
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) {
      unlinkSync(lockPath);
    }
  } catch {
    // Lock vanished between checks — retry loop will pick it up.
  }
  return false;
}

/**
 * Run `fn` while holding an exclusive cross-process lock for `targetPath`.
 * Synchronous by design: every store mutation in enforcement-core is sync,
 * so the critical section never yields to the event loop.
 */
export function withFileLock<T>(
  targetPath: string,
  fn: () => T,
  options: FileLockOptions = {},
): T {
  const lockPath = lockPathFor(targetPath);
  if (heldInProcess.has(lockPath)) {
    return fn();
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  mkdirSync(dirname(lockPath), { recursive: true });

  const deadline = Date.now() + timeoutMs;
  while (!tryAcquire(lockPath, staleMs)) {
    if (Date.now() >= deadline) {
      throw new FileLockTimeoutError(lockPath, timeoutMs);
    }
    sleepSync(pollMs);
  }
  heldInProcess.add(lockPath);
  try {
    return fn();
  } finally {
    heldInProcess.delete(lockPath);
    try {
      unlinkSync(lockPath);
    } catch {
      // Already removed (stale-broken by a peer); nothing to release.
    }
  }
}

/**
 * Crash-safe whole-file replace: write to a sibling temp file, then rename
 * over the target. Readers observe either the old or the new content.
 */
export function writeFileAtomic(targetPath: string, content: string): void {
  const resolved = resolve(targetPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const tmp = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, "utf8");
  // Windows refuses to replace a file another handle has open (indexers, AV,
  // a reader mid-`readFileSync`). Those holds are short; retry briefly.
  const deadline = Date.now() + RENAME_RETRY_MS;
  for (;;) {
    try {
      renameSync(tmp, resolved);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (
        (code === "EPERM" || code === "EACCES" || code === "EBUSY") &&
        Date.now() < deadline
      ) {
        sleepSync(DEFAULT_POLL_MS);
        continue;
      }
      try {
        unlinkSync(tmp);
      } catch {
        // best effort
      }
      throw err;
    }
  }
}

const RENAME_RETRY_MS = 2_000;
