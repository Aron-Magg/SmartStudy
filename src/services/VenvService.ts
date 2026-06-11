import { App, TFile, TFolder } from "obsidian";
import { existsSync, promises as fs } from "fs";
import { join, dirname } from "path";
import { augmentedPath, resolveCommand, run, runOrThrow } from "../lib/shell";
import { declaredPackages, parsePyProject } from "../lib/toml";
import { dirSize } from "../lib/fs-size";

export interface VenvLocation {
  folder: string;
  venvDir: string;
  pyprojectPath: string | null;
}

export interface VenvPackage {
  name: string;
  version: string;
  declared: boolean;
  sizeBytes: number | null;
}

export interface VenvSummary {
  venv: VenvLocation;
  packages: VenvPackage[];
  totalSize: number;
  pythonVersion: string | null;
  errors: string[];
}

export class VenvService {
  private resolvedUvPath: string | null = null;
  private resolvedFor: string | null = null;

  constructor(
    private readonly app: App,
    private getUvPath: () => string,
  ) {}

  /**
   * Resolve the configured uv command to an absolute path, searching both
   * `process.env.PATH` and a few well-known install dirs (`~/.local/bin`,
   * `~/.cargo/bin`, `/opt/homebrew/bin`, …). Result is cached until the
   * configured path changes. Falls back to the configured value if nothing
   * is found so error messages still say "uv" instead of empty string.
   */
  async resolveUv(): Promise<string> {
    const configured = this.getUvPath();
    if (this.resolvedFor === configured && this.resolvedUvPath) {
      return this.resolvedUvPath;
    }
    const resolved = await resolveCommand(configured);
    this.resolvedUvPath = resolved ?? configured;
    this.resolvedFor = configured;
    return this.resolvedUvPath;
  }

  /**
   * Build a PATH env value that includes the same install dirs we search when
   * resolving uv. Pass this to spawn() so uv (and the tools it dispatches to,
   * like python) can find each other on GUI-launched Obsidian.
   */
  spawnPath(): string {
    return augmentedPath();
  }

  /** Walk up the filesystem from `startPath` until a `.venv/` directory is found. */
  findVenvForPath(startPath: string): VenvLocation | null {
    let dir = startPath;
    if (existsSync(dir) && fsStatSync(dir).isFile?.()) {
      dir = dirname(dir);
    }
    const root = this.vaultRoot();
    let safety = 32;
    while (safety-- > 0) {
      const venv = join(dir, ".venv");
      if (existsSync(venv)) {
        const pyproject = join(dir, "pyproject.toml");
        return {
          folder: dir,
          venvDir: venv,
          pyprojectPath: existsSync(pyproject) ? pyproject : null,
        };
      }
      if (dir === root || dir === "/" || !dir) return null;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    return null;
  }

  /** Resolve a vault path (relative or absolute) to an absolute filesystem path. */
  absolutePath(vaultPath: string): string {
    const adapter = this.app.vault.adapter as unknown as {
      getBasePath?: () => string;
      basePath?: string;
    };
    const base = adapter.getBasePath?.() ?? adapter.basePath ?? "";
    if (vaultPath.startsWith("/")) return vaultPath;
    return join(base, vaultPath);
  }

  vaultRoot(): string {
    const adapter = this.app.vault.adapter as unknown as {
      getBasePath?: () => string;
      basePath?: string;
    };
    return adapter.getBasePath?.() ?? adapter.basePath ?? "";
  }

  findVenvForFile(file: TFile | TFolder): VenvLocation | null {
    return this.findVenvForPath(this.absolutePath(file.path));
  }

  async runUv(
    args: string[],
    cwd: string,
    extraEnv: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const bin = await this.resolveUv();
    return run(bin, args, { cwd, env: { PATH: this.spawnPath(), ...extraEnv } });
  }

  async checkUvAvailable(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const bin = await this.resolveUv();
      const r = await run(bin, ["--version"], {
        timeoutMs: 5000,
        env: { PATH: this.spawnPath() },
      });
      if (r.code === 0) return { ok: true, version: r.stdout.trim() };
      return { ok: false, error: r.stderr || r.stdout };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = / ENOENT$/.test(msg)
        ? ` — set the full path to uv in Smart Study settings (e.g. ${process.env.HOME ?? "~"}/.local/bin/uv).`
        : "";
      return { ok: false, error: `${msg}${hint}` };
    }
  }

  async pipList(venvFolder: string): Promise<Array<{ name: string; version: string }>> {
    const bin = await this.resolveUv();
    const r = await runOrThrow(bin, ["pip", "list", "--format", "json"], {
      cwd: venvFolder,
      env: {
        VIRTUAL_ENV: join(venvFolder, ".venv"),
        PATH: this.spawnPath(),
      },
    });
    return JSON.parse(r.stdout) as Array<{ name: string; version: string }>;
  }

  async pythonVersion(venvFolder: string): Promise<string | null> {
    const venvPython = join(venvFolder, ".venv", "bin", "python");
    if (!existsSync(venvPython)) return null;
    try {
      const r = await run(venvPython, ["--version"], { timeoutMs: 5000 });
      return r.stdout.trim() || r.stderr.trim() || null;
    } catch {
      return null;
    }
  }

  async getSummary(venvFolder: string): Promise<VenvSummary> {
    const errors: string[] = [];
    const venv: VenvLocation = {
      folder: venvFolder,
      venvDir: join(venvFolder, ".venv"),
      pyprojectPath: existsSync(join(venvFolder, "pyproject.toml"))
        ? join(venvFolder, "pyproject.toml")
        : null,
    };

    let declared: Set<string> = new Set();
    if (venv.pyprojectPath) {
      try {
        const raw = await fs.readFile(venv.pyprojectPath, "utf8");
        declared = declaredPackages(parsePyProject(raw));
      } catch (e) {
        errors.push(
          `Failed to parse pyproject.toml: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    let pkgList: Array<{ name: string; version: string }> = [];
    try {
      pkgList = await this.pipList(venvFolder);
    } catch (e) {
      errors.push(`uv pip list failed: ${e instanceof Error ? e.message : e}`);
    }

    const sitePackagesDir = await this.findSitePackages(venv.venvDir);
    const sizes = sitePackagesDir
      ? await this.packageSizes(sitePackagesDir, pkgList.map((p) => p.name))
      : new Map<string, number>();

    const packages: VenvPackage[] = pkgList.map((p) => ({
      name: p.name,
      version: p.version,
      declared: declared.has(p.name.toLowerCase().replace(/_/g, "-")),
      sizeBytes: sizes.get(p.name.toLowerCase()) ?? null,
    }));

    let totalSize = 0;
    try {
      totalSize = await dirSize(venv.venvDir);
    } catch (e) {
      errors.push(`venv size walk failed: ${e instanceof Error ? e.message : e}`);
    }

    const py = await this.pythonVersion(venvFolder);

    return { venv, packages, totalSize, pythonVersion: py, errors };
  }

  private async findSitePackages(venvDir: string): Promise<string | null> {
    const libDir = join(venvDir, "lib");
    if (!existsSync(libDir)) return null;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(libDir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith("python")) {
        const candidate = join(libDir, e.name, "site-packages");
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  private async packageSizes(
    sitePackagesDir: string,
    names: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(sitePackagesDir, { withFileTypes: true });
    } catch {
      return out;
    }
    const lowered = new Map<string, string>();
    for (const n of names) lowered.set(n.toLowerCase().replace(/-/g, "_"), n);

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      let key: string | null = null;
      const lname = e.name.toLowerCase();
      if (lname.endsWith(".dist-info")) {
        const stem = lname.slice(0, -".dist-info".length).split("-")[0];
        key = lowered.get(stem.replace(/-/g, "_")) ?? null;
      } else {
        key = lowered.get(lname) ?? null;
      }
      if (!key) continue;
      const full = join(sitePackagesDir, e.name);
      try {
        const size = await dirSize(full);
        const prev = out.get(key.toLowerCase()) ?? 0;
        out.set(key.toLowerCase(), prev + size);
      } catch {
        /* ignore */
      }
    }
    return out;
  }
}

function fsStatSync(path: string): { isFile?: () => boolean } {
  try {
    return require("fs").statSync(path);
  } catch {
    return {};
  }
}
