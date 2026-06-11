import { spawn, SpawnOptions } from "child_process";
import { promises as fs, constants as fsConstants } from "fs";
import { delimiter, isAbsolute, join } from "path";
import { homedir, platform } from "os";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawn(cmd, args, spawnOpts);
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(
            new Error(
              `Timed out after ${opts.timeoutMs}ms running ${cmd} ${args.join(" ")}`,
            ),
          );
        }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", (b) => (stdout += b.toString()));
    child.stderr?.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
}

export async function runOrThrow(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const result = await run(cmd, args, opts);
  if (result.code !== 0) {
    throw new Error(
      `Command failed (${result.code}): ${cmd} ${args.join(" ")}\n${result.stderr}`,
    );
  }
  return result;
}

export function spawnDetached(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
) {
  return spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
}

/**
 * GUI-launched Obsidian doesn't inherit the user's shell PATH on Linux/macOS,
 * so tools installed under ~/.local/bin or ~/.cargo/bin aren't visible to
 * `spawn()` even though they work in a terminal. These are the locations we
 * fall back to in addition to whatever PATH was inherited.
 */
export function commonInstallPaths(): string[] {
  const home = homedir();
  const candidates =
    platform() === "win32"
      ? [
          join(home, "AppData", "Local", "Microsoft", "WinGet", "Links"),
          join(home, "AppData", "Local", "Programs", "Python"),
          join(home, ".cargo", "bin"),
        ]
      : [
          join(home, ".local", "bin"),
          join(home, ".cargo", "bin"),
          join(home, "bin"),
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/opt/local/bin",
          "/usr/bin",
        ];
  return candidates;
}

export function augmentedPath(): string {
  const inherited = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extras = commonInstallPaths();
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...inherited, ...extras]) {
    if (seen.has(p)) continue;
    seen.add(p);
    merged.push(p);
  }
  return merged.join(delimiter);
}

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return false;
    if (platform() === "win32") return true;
    try {
      await fs.access(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Look up an executable on the augmented PATH and return an absolute path, or
 * null if not found. Absolute inputs are returned as-is when executable.
 */
export async function resolveCommand(cmd: string): Promise<string | null> {
  if (!cmd) return null;
  if (isAbsolute(cmd)) {
    return (await isExecutableFile(cmd)) ? cmd : null;
  }
  const dirs = augmentedPath().split(delimiter).filter(Boolean);
  const exts = platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const seen = new Set<string>();
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}
