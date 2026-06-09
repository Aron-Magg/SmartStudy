import { spawn, SpawnOptions } from "child_process";

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
