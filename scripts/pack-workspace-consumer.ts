/**
 * pack-workspace-consumer.ts
 *
 * `npm pack` inside an npm workspace silently omits workspace packages listed
 * in `bundledDependencies` (npm 10: bundled files: 0). Stage those packages
 * with bundle-workspace-deps, then pack from an isolated copy that is not a
 * workspace member so the tarball actually embeds node_modules/@fides-anima/*.
 *
 * Usage:
 *   npx tsx scripts/pack-workspace-consumer.ts --package harness/openclaw/plugin-trust --destination /tmp/out
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { bundleWorkspaceDeps } from "./bundle-workspace-deps.js";
import { resolveNpmSpawn } from "./package-reproducibility.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");

type PackageJson = {
  name?: string;
  version?: string;
  files?: string[];
  bundledDependencies?: string[];
  bundleDependencies?: string[];
};

export type PackConsumerOptions = {
  repoRoot: string;
  packageDir: string;
  destination: string;
  /** Skip re-staging when callers already ran bundle:deps */
  skipBundle?: boolean;
};

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function runNpm(
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const { command, prefixArgs } = resolveNpmSpawn();
  const r = spawnSync(command, [...prefixArgs, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function toTarPath(p: string): string {
  return resolve(p).replace(/\\/g, "/");
}

function runTar(
  args: string[],
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } {
  // Drive-letter archive paths on Windows need --force-local or GNU tar
  // treats "C:" as a remote host. Avoid `tar -C <drive>:...` entirely.
  const prefix = process.platform === "win32" ? ["--force-local"] : [];
  const r = spawnSync("tar", [...prefix, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function listTarball(tgzPath: string): string {
  const archive = toTarPath(tgzPath);
  const force = runTar(["-tzf", archive]);
  if (force.status === 0 && force.stdout.length > 0) {
    return force.stdout;
  }
  const plain = spawnSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    shell: false,
  });
  return `${plain.stdout ?? ""}${plain.stderr ?? ""}`;
}

function bundledNeedle(name: string): string {
  const short = name.startsWith("@fides-anima/") ? name.slice("@fides-anima/".length) : name;
  return `node_modules/@fides-anima/${short}/`;
}

function listingHasBundled(listing: string, name: string): boolean {
  const needle = bundledNeedle(name);
  if (listing.includes(needle)) return true;
  // Directory-only entry without a trailing slash
  const bare = needle.slice(0, -1);
  return listing.split(/\r?\n/).some((line) => {
    const n = line.replace(/^\.?\//, "");
    return n === bare || n.endsWith(`/${bare}`) || n.endsWith(`/${bare}/`);
  });
}

/**
 * npm pack (even outside a workspace) still drops some bundled workspace
 * copies on npm 10. Unpack, copy staged cores, and rewrite the tarball.
 */
function embedStagedModules(
  tgzPath: string,
  isolDir: string,
  bundled: string[],
): void {
  const unpack = mkdtempSync(join(tmpdir(), "fpp-unpack-"));
  try {
    const extract = runTar(["-xzf", toTarPath(tgzPath)], unpack);
    if (extract.status !== 0) {
      throw new Error(
        `Failed to unpack ${tgzPath}:\n${extract.stdout}\n${extract.stderr}`,
      );
    }
    const pkgRoot = existsSync(join(unpack, "package"))
      ? join(unpack, "package")
      : unpack;
    for (const name of bundled) {
      const parts = name.startsWith("@") ? name.split("/") : [name];
      const src = join(isolDir, "node_modules", ...parts);
      const dest = join(pkgRoot, "node_modules", ...parts);
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
    }
    rmSync(tgzPath, { force: true });
    const top = existsSync(join(unpack, "package")) ? "package" : ".";
    const pack = runTar(["-czf", toTarPath(tgzPath), top], unpack);
    if (pack.status !== 0) {
      throw new Error(
        `Failed to rewrite ${tgzPath}:\n${pack.stdout}\n${pack.stderr}`,
      );
    }
  } finally {
    rmSync(unpack, { recursive: true, force: true });
  }
}

function copyEntry(src: string, dest: string): void {
  const destPath = dest.replace(/[/\\]$/, "");
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(src, destPath, { recursive: true });
}

/** npm pack filename: @scope/name@version → scope-name-version.tgz */
export function packedTarballName(pkg: {
  name?: string;
  version?: string;
}): string {
  const name = pkg.name ?? "package";
  const ver = pkg.version ?? "0.0.0";
  const base = name.startsWith("@")
    ? name.slice(1).replace(/\//g, "-")
    : name;
  return `${base}-${ver}.tgz`;
}

/**
 * Pack a workspace consumer so bundled @fides-anima cores are inside the tarball.
 * Returns the absolute path of the produced .tgz.
 */
export async function packWorkspaceConsumer(
  options: PackConsumerOptions,
): Promise<string> {
  const packageDir = options.packageDir;
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found: ${pkgPath}`);
  }

  const destination = options.destination;
  mkdirSync(destination, { recursive: true });

  const consumer = readJson(pkgPath);
  const bundled =
    consumer.bundledDependencies ?? consumer.bundleDependencies ?? [];
  if (bundled.length === 0) {
    throw new Error(`No bundledDependencies in ${pkgPath}`);
  }

  const isol = mkdtempSync(join(tmpdir(), "fpp-isol-pack-"));
  try {
    const always = [
      "package.json",
      "LICENSE",
      "README.md",
      "readme.md",
      "openclaw.plugin.json",
    ];
    const publishFiles = consumer.files ?? ["dist"];
    const toCopy = new Set<string>([...always, ...publishFiles]);

    for (const entry of toCopy) {
      const src = join(packageDir, entry);
      if (!existsSync(src)) continue;
      copyEntry(src, join(isol, entry));
    }

    if (!existsSync(join(isol, "package.json"))) {
      throw new Error(`Failed to stage package.json for ${consumer.name}`);
    }

    if (!options.skipBundle) {
      await bundleWorkspaceDeps({
        repoRoot: options.repoRoot,
        packageDir: isol,
      });
    } else {
      for (const name of bundled) {
        const parts = name.startsWith("@") ? name.split("/") : [name];
        const src = join(packageDir, "node_modules", ...parts);
        if (!existsSync(join(src, "package.json"))) {
          throw new Error(
            `Staged ${name} missing at ${src} — run bundle:deps first`,
          );
        }
        const dest = join(isol, "node_modules", ...parts);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    }

    const pack = runNpm(
      ["pack", "--pack-destination", destination, "--ignore-scripts"],
      isol,
    );
    if (pack.status !== 0) {
      throw new Error(
        `npm pack failed for ${consumer.name}:\n${pack.stdout}\n${pack.stderr}`,
      );
    }

    const tgz = packedTarballName(consumer);
    const tgzPath = join(destination, tgz);
    if (!existsSync(tgzPath)) {
      throw new Error(
        `npm pack did not write ${tgz} in ${destination}:\n${pack.stdout}\n${pack.stderr}`,
      );
    }

    embedStagedModules(tgzPath, isol, bundled);

    const listing = listTarball(tgzPath);
    const missing = bundled.filter((name) => !listingHasBundled(listing, name));
    if (missing.length > 0) {
      const sample = listing
        .split(/\r?\n/)
        .filter((l) => l.includes("node_modules/@fides-anima/"))
        .slice(0, 20)
        .join("\n");
      throw new Error(
        `Isolated pack missing ${missing.join(", ")} in ${tgz}\n${sample}`,
      );
    }
    return tgzPath;
  } finally {
    rmSync(isol, { recursive: true, force: true });
  }
}

function printUsage(): void {
  console.log(
    `Usage: npx tsx scripts/pack-workspace-consumer.ts --package <path> --destination <dir>

  --package       Consumer path relative to repo root (harness/openclaw/plugin-trust, …)
  --destination   Directory to write the .tgz
  --root          Optional repo root (default: repository root)
  --skip-bundle   Skip bundle:deps when cores are already staged`,
  );
}

export async function main(argv = process.argv.slice(2)): Promise<string> {
  let packageRel: string | undefined;
  let destination: string | undefined;
  let repoRoot = DEFAULT_ROOT;
  let skipBundle = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--package" && argv[i + 1]) {
      packageRel = argv[++i];
    } else if (a === "--destination" && argv[i + 1]) {
      destination = argv[++i];
    } else if (a === "--root" && argv[i + 1]) {
      repoRoot = resolve(argv[++i]!);
    } else if (a === "--skip-bundle") {
      skipBundle = true;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      return "";
    } else if (a?.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }

  if (!packageRel || !destination) {
    printUsage();
    throw new Error("Missing --package <path> and/or --destination <dir>");
  }

  const packageDir = isAbsolute(packageRel)
    ? packageRel
    : join(repoRoot, packageRel);
  const destDir = isAbsolute(destination)
    ? destination
    : resolve(process.cwd(), destination);

  const tgz = await packWorkspaceConsumer({
    repoRoot,
    packageDir,
    destination: destDir,
    skipBundle,
  });
  console.log(tgz);
  return tgz;
}

const invoked =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
