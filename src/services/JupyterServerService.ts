import { ChildProcess, spawn } from "child_process";
import { join } from "path";
import { randomBytes } from "crypto";
import { createServer } from "net";
import type { VenvService } from "./VenvService";

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr && "port" in addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not get free port")));
      }
    });
  });
}

export interface JupyterServerInfo {
  url: string;
  token: string;
  venvFolder: string;
}

interface ServerRecord {
  info: JupyterServerInfo;
  proc: ChildProcess;
  lastUsedAt: number;
  refCount: number;
}

export class JupyterServerService {
  private servers = new Map<string, ServerRecord>();
  private starting = new Map<string, Promise<JupyterServerInfo>>();
  private reaper: number | null = null;
  private idleTimeoutMs: number;

  constructor(
    private readonly venvService: VenvService,
    idleTimeoutMinutes: number,
  ) {
    this.idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
    this.reaper = window.setInterval(
      () => this.reapIdle(),
      Math.max(this.idleTimeoutMs / 4, 30_000),
    );
  }

  setIdleTimeout(minutes: number): void {
    this.idleTimeoutMs = minutes * 60 * 1000;
  }

  async getOrStart(venvFolder: string): Promise<JupyterServerInfo> {
    const existing = this.servers.get(venvFolder);
    if (existing && !existing.proc.killed) {
      existing.lastUsedAt = Date.now();
      return existing.info;
    }
    const inFlight = this.starting.get(venvFolder);
    if (inFlight) return inFlight;
    const startPromise = this.start(venvFolder);
    this.starting.set(venvFolder, startPromise);
    try {
      const info = await startPromise;
      return info;
    } finally {
      this.starting.delete(venvFolder);
    }
  }

  acquire(venvFolder: string): void {
    const rec = this.servers.get(venvFolder);
    if (rec) {
      rec.refCount++;
      rec.lastUsedAt = Date.now();
    }
  }

  release(venvFolder: string): void {
    const rec = this.servers.get(venvFolder);
    if (rec) {
      rec.refCount = Math.max(0, rec.refCount - 1);
      rec.lastUsedAt = Date.now();
    }
  }

  touch(venvFolder: string): void {
    const rec = this.servers.get(venvFolder);
    if (rec) rec.lastUsedAt = Date.now();
  }

  listRunning(): JupyterServerInfo[] {
    return Array.from(this.servers.values()).map((r) => r.info);
  }

  async stop(venvFolder: string): Promise<void> {
    const rec = this.servers.get(venvFolder);
    if (!rec) return;
    this.servers.delete(venvFolder);
    rec.proc.kill("SIGTERM");
    setTimeout(() => {
      if (!rec.proc.killed) rec.proc.kill("SIGKILL");
    }, 5_000);
  }

  async stopAll(): Promise<void> {
    const folders = [...this.servers.keys()];
    await Promise.all(folders.map((f) => this.stop(f)));
  }

  dispose(): void {
    if (this.reaper !== null) {
      window.clearInterval(this.reaper);
      this.reaper = null;
    }
    void this.stopAll();
  }

  private reapIdle(): void {
    const now = Date.now();
    for (const [folder, rec] of this.servers.entries()) {
      if (rec.refCount > 0) continue;
      if (now - rec.lastUsedAt > this.idleTimeoutMs) {
        void this.stop(folder);
      }
    }
  }

  private async start(venvFolder: string): Promise<JupyterServerInfo> {
    const token = randomBytes(24).toString("hex");
    const port = await pickFreePort();
    const args = [
      "run",
      "--no-project",
      "jupyter",
      "server",
      "--no-browser",
      `--ServerApp.token=${token}`,
      "--ServerApp.password=",
      `--ServerApp.port=${port}`,
      "--ServerApp.disable_check_xsrf=True",
      "--ServerApp.allow_origin=*",
      "--ServerApp.allow_remote_access=False",
    ];
    const uvBin = await this.venvService.resolveUv();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VIRTUAL_ENV: join(venvFolder, ".venv"),
      PATH: `${join(venvFolder, ".venv", "bin")}:${this.venvService.spawnPath()}`,
    };
    const proc = spawn(uvBin, args, {
      cwd: venvFolder,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const info = await this.waitForUrl(proc, token, venvFolder, port);

    proc.on("exit", (code) => {
      const rec = this.servers.get(venvFolder);
      if (rec && rec.proc === proc) {
        this.servers.delete(venvFolder);
        console.warn(
          `[smart-study] jupyter server in ${venvFolder} exited (${code})`,
        );
      }
    });

    this.servers.set(venvFolder, {
      info,
      proc,
      lastUsedAt: Date.now(),
      refCount: 0,
    });
    return info;
  }

  private waitForUrl(
    proc: ChildProcess,
    token: string,
    venvFolder: string,
    port: number,
  ): Promise<JupyterServerInfo> {
    const url = `http://127.0.0.1:${port}/`;
    return new Promise((resolve, reject) => {
      let stderrBuf = "";
      let stdoutBuf = "";
      let resolved = false;
      const finishTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        proc.kill("SIGTERM");
        reject(
          new Error(
            `Timed out waiting for jupyter server to start in ${venvFolder}.\nstderr:\n${stderrBuf}\nstdout:\n${stdoutBuf}`,
          ),
        );
      }, 60_000);

      const tryParse = (line: string) => {
        if (resolved) return;
        if (
          /is running at|Serving notebooks from local directory/.test(line)
        ) {
          resolved = true;
          clearTimeout(finishTimer);
          resolve({ url, token, venvFolder });
        }
      };

      proc.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderrBuf += text;
        for (const line of text.split("\n")) tryParse(line);
      });
      proc.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        stdoutBuf += text;
        for (const line of text.split("\n")) tryParse(line);
      });
      proc.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(finishTimer);
        reject(err);
      });
      proc.on("exit", (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(finishTimer);
        reject(
          new Error(
            `jupyter server in ${venvFolder} exited before reporting URL (${code}).\nstderr:\n${stderrBuf}`,
          ),
        );
      });
    });
  }
}
