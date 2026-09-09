/**
 * Workspace containment (audit F06): normalized, symlink-aware path checks
 * that the classifier consumes via `ClassifyOptions.containment`.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkspaceContainmentResolver } from "./workspace-containment.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("createWorkspaceContainmentResolver", () => {
  const ws = createTempWorkspace("fpp-containment-");
  const outside = createTempWorkspace("fpp-containment-outside-");
  after(() => {
    ws.cleanup();
    outside.cleanup();
  });

  const root = join(ws.path, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "x", "utf8");
  const resolver = createWorkspaceContainmentResolver({ workspaceRoot: root });

  it("relative and absolute paths inside the root are inside", () => {
    assert.equal(resolver("src/a.ts"), "inside");
    assert.equal(resolver("./src/new-file.ts"), "inside");
    assert.equal(resolver(join(root, "src", "a.ts")), "inside");
    assert.equal(resolver("."), "inside");
  });

  it("dot-dot escapes and sibling prefixes are outside", () => {
    assert.equal(resolver("../escape.txt"), "outside");
    assert.equal(resolver("src/../../escape.txt"), "outside");
    // `repo-evil` shares a string prefix with `repo` but is not contained.
    assert.equal(resolver(`${root}-evil/file.txt`), "outside");
    assert.equal(resolver(outside.path), "outside");
  });

  it("Windows separators normalize before containment", () => {
    assert.equal(resolver("src\\a.ts"), "inside");
    assert.equal(resolver("..\\escape.txt"), "outside");
  });

  it("home expansion resolves ~ but not ~user", () => {
    const withHome = createWorkspaceContainmentResolver({
      workspaceRoot: root,
      homeDir: root,
    });
    assert.equal(withHome("~/src/a.ts"), "inside");
    assert.equal(withHome("~other/x"), "unknown");
    assert.equal(resolver("~/.ssh/id_rsa"), "outside");
  });

  it("empty or NUL-bearing paths are unknown", () => {
    assert.equal(resolver(""), "unknown");
    assert.equal(resolver("src/\0a.ts"), "unknown");
  });

  it("explicit out-of-workspace aliases are inside", () => {
    const aliased = createWorkspaceContainmentResolver({
      workspaceRoot: root,
      outOfWorkspacePaths: { [outside.path]: "shared-notes" },
    });
    assert.equal(aliased(outside.path), "inside");
    assert.equal(aliased(join(outside.path, "child.txt")), "outside");
  });

  it("symlinks pointing outside the workspace are outside", (t) => {
    const linkPath = join(root, "escape-link");
    try {
      symlinkSync(outside.path, linkPath, "junction");
    } catch {
      t.skip("symlink creation not permitted on this host");
      return;
    }
    assert.equal(resolver("escape-link"), "outside");
    assert.equal(resolver("escape-link/file.txt"), "outside");
  });

  it("drive-letter paths on non-Windows hosts are unknown", () => {
    const posix = createWorkspaceContainmentResolver({
      workspaceRoot: root,
      platform: "linux",
    });
    assert.equal(posix("C:/Users/x/file.txt"), "unknown");
  });
});
