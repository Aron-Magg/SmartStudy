import { App, TFile, TFolder } from "obsidian";
import type { VenvService } from "./VenvService";
import { humanSize } from "../lib/fs-size";

export type ContextSource = "lectures" | "notebooks" | "venv" | "markdown";

export interface ContextChunk {
  source: ContextSource;
  label: string;
  text: string;
}

export interface CollectOptions {
  courseFolder: string;
  sources: ContextSource[];
  maxChars?: number;
}

export class VaultContextProvider {
  constructor(
    private readonly app: App,
    private readonly venvService: VenvService,
  ) {}

  async collect(opts: CollectOptions): Promise<string> {
    const max = opts.maxChars ?? 40_000;
    const chunks: ContextChunk[] = [];
    if (opts.sources.includes("lectures"))
      chunks.push(...(await this.collectLectures(opts.courseFolder)));
    if (opts.sources.includes("notebooks"))
      chunks.push(...(await this.collectNotebooks(opts.courseFolder)));
    if (opts.sources.includes("venv"))
      chunks.push(...(await this.collectVenv(opts.courseFolder)));
    if (opts.sources.includes("markdown"))
      chunks.push(...(await this.collectMarkdown(opts.courseFolder)));

    const out: string[] = [];
    let used = 0;
    for (const c of chunks) {
      const block = `### ${c.label} (${c.source})\n${c.text.trim()}\n`;
      if (used + block.length > max) {
        out.push(block.slice(0, Math.max(0, max - used)));
        used = max;
        break;
      }
      out.push(block);
      used += block.length;
    }
    return out.join("\n");
  }

  async listCourseFolders(): Promise<string[]> {
    const out: string[] = [];
    const walk = (folder: TFolder, depth: number) => {
      if (depth > 3) return;
      out.push(folder.path);
      for (const child of folder.children) {
        if (child instanceof TFolder && !child.name.startsWith("_")) walk(child, depth + 1);
      }
    };
    const root = this.app.vault.getRoot();
    for (const child of root.children) {
      if (child instanceof TFolder && !child.name.startsWith("_") && !child.name.startsWith(".")) {
        walk(child, 0);
      }
    }
    return out;
  }

  private async collectLectures(courseFolder: string): Promise<ContextChunk[]> {
    const folder = this.app.vault.getAbstractFileByPath(courseFolder);
    if (!(folder instanceof TFolder)) return [];
    const chunks: ContextChunk[] = [];
    const walk = async (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFolder) {
          await walk(child);
        } else if (child instanceof TFile && /\.html?$/i.test(child.name)) {
          try {
            const raw = await this.app.vault.adapter.read(child.path);
            chunks.push({
              source: "lectures",
              label: child.path,
              text: htmlToText(raw),
            });
          } catch {
            /* ignore */
          }
        }
      }
    };
    await walk(folder);
    return chunks;
  }

  private async collectNotebooks(courseFolder: string): Promise<ContextChunk[]> {
    const folder = this.app.vault.getAbstractFileByPath(courseFolder);
    if (!(folder instanceof TFolder)) return [];
    const chunks: ContextChunk[] = [];
    const walk = async (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFolder) {
          await walk(child);
        } else if (child instanceof TFile && child.extension === "ipynb") {
          try {
            const raw = await this.app.vault.adapter.read(child.path);
            chunks.push({
              source: "notebooks",
              label: child.path,
              text: notebookToText(raw),
            });
          } catch {
            /* ignore */
          }
        }
      }
    };
    await walk(folder);
    return chunks;
  }

  private async collectMarkdown(courseFolder: string): Promise<ContextChunk[]> {
    const folder = this.app.vault.getAbstractFileByPath(courseFolder);
    if (!(folder instanceof TFolder)) return [];
    const chunks: ContextChunk[] = [];
    const walk = async (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFolder) {
          await walk(child);
        } else if (child instanceof TFile && child.extension === "md") {
          try {
            const raw = await this.app.vault.read(child);
            chunks.push({
              source: "markdown",
              label: child.path,
              text: raw,
            });
          } catch {
            /* ignore */
          }
        }
      }
    };
    await walk(folder);
    return chunks;
  }

  private async collectVenv(courseFolder: string): Promise<ContextChunk[]> {
    const abs = this.venvService.absolutePath(courseFolder);
    const venv = this.venvService.findVenvForPath(abs);
    if (!venv) return [];
    try {
      const summary = await this.venvService.getSummary(venv.folder);
      const lines = [
        `Python: ${summary.pythonVersion ?? "unknown"}`,
        `Total size: ${humanSize(summary.totalSize)}`,
        `Packages: ${summary.packages.length}`,
        "",
        ...summary.packages
          .slice(0, 50)
          .map(
            (p) =>
              `- ${p.name}==${p.version}${p.declared ? " (declared)" : ""}`,
          ),
      ];
      return [
        {
          source: "venv",
          label: `${venv.folder}/.venv`,
          text: lines.join("\n"),
        },
      ];
    } catch {
      return [];
    }
  }
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function notebookToText(raw: string): string {
  try {
    const nb = JSON.parse(raw) as {
      cells?: Array<{
        cell_type?: string;
        source?: string | string[];
        outputs?: Array<{
          output_type?: string;
          text?: string | string[];
          data?: Record<string, string | string[]>;
        }>;
      }>;
    };
    if (!nb.cells) return "";
    const parts: string[] = [];
    for (const c of nb.cells) {
      const src = Array.isArray(c.source) ? c.source.join("") : (c.source ?? "");
      if (c.cell_type === "markdown") parts.push(src);
      else if (c.cell_type === "code") {
        parts.push("```python\n" + src + "\n```");
        for (const o of c.outputs ?? []) {
          if (o.output_type === "stream") {
            const t = Array.isArray(o.text) ? o.text.join("") : (o.text ?? "");
            parts.push("// output:\n" + t);
          } else if (o.data?.["text/plain"]) {
            const t = Array.isArray(o.data["text/plain"])
              ? (o.data["text/plain"] as string[]).join("")
              : (o.data["text/plain"] as string);
            parts.push("// result:\n" + t);
          }
        }
      }
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}
