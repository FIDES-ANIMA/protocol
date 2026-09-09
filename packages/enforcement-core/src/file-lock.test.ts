/**
 * Cross-process serialization (audit F08): budget debits and ledger appends
 * from concurrent processes must not lose updates or interleave.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FileLockTimeoutError,
  lockPathFor,
  withFileLock,
  writeFileAtomic,
} from "./file-lock.js";
import { createTempWorkspace } from "./test-helpers.js";

const here = fileURLToPath(new URL(".", import.meta.url));

describe("file-lock", () => {
  const ws = createTempWorkspace("fpp-file-lock-");
  after(() => ws.cleanup());

  it("withFileLock is re-entrant in-process and releases the lock file", () => {
    const target = join(ws.path, "store.json");
    const out = withFileLock(target, () =>
      withFileLock(target, () => "nested-ok"),
    );
    assert.equal(out, "nested-ok");
    assert.equal(existsSync(lockPathFor(target)), false);
  });

  it("times out when a live peer holds the lock", () => {
    const target = join(ws.path, "held.json");
    writeFileSync(lockPathFor(target), `${process.pid} now\n`, "utf8");
    assert.throws(
      () => withFileLock(target, () => 1, { timeoutMs: 50, staleMs: 60_000 }),
      FileLockTimeoutError,
    );
  });

  it("breaks abandoned (stale) locks", () => {
    const target = join(ws.path, "stale.json");
    writeFileSync(lockPathFor(target), `999999 old\n`, "utf8");
    const out = withFileLock(target, () => "recovered", {
      timeoutMs: 500,
      staleMs: 0,
    });
    assert.equal(out, "recovered");
  });

  it("writeFileAtomic leaves no temp files and replaces content", () => {
    const target = join(ws.path, "atomic.json");
    writeFileAtomic(target, "one");
    writeFileAtomic(target, "two");
    assert.equal(readFileSync(target, "utf8"), "two");
  });

  it("serializes a shared counter across concurrent processes", () => {
    const counter = join(ws.path, "counter.json");
    writeFileSync(counter, "0", "utf8");
    const script = `
      import { withFileLock, writeFileAtomic } from ${JSON.stringify(
        pathToFileURL(join(here, "file-lock.ts")).href,
      )};
      import { readFileSync } from "node:fs";
      const target = process.argv[2];
      for (let i = 0; i < 25; i++) {
        withFileLock(target, () => {
          const n = Number(readFileSync(target, "utf8"));
          writeFileAtomic(target, String(n + 1));
        }, { timeoutMs: 20_000 });
      }
    `;
    const scriptPath = join(ws.path, "worker.mts");
    writeFileSync(scriptPath, script, "utf8");
    const procs = 4;
    // Spawn through the same node binary with tsx's loader so the worker can
    // import the TypeScript source directly.
    const children = Array.from({ length: procs }, () =>
      spawn(process.execPath, ["--import", "tsx", scriptPath, counter], {
        stdio: "inherit",
        cwd: join(here, ".."),
      }),
    );
    return Promise.all(
      children.map(
        (c) =>
          new Promise<void>((res, rej) =>
            c.on("exit", (code) =>
              code === 0 ? res() : rej(new Error(`worker exit ${code}`)),
            ),
          ),
      ),
    ).then(() => {
      assert.equal(Number(readFileSync(counter, "utf8")), procs * 25);
    });
  });
});
