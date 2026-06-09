import { ItemView, Notice, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import type { VenvService, VenvPackage, VenvSummary } from "../../services/VenvService";
import { humanSize } from "../../lib/fs-size";

export const VENV_INSPECTOR_VIEW_TYPE = "smart-venv-inspector";

type SortKey = "name" | "version" | "size" | "declared";

export class VenvInspectorView extends ItemView {
  private currentFolder: string | null = null;
  private summary: VenvSummary | null = null;
  private sortKey: SortKey = "size";
  private sortAsc = false;
  private loading = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly venvService: VenvService,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VENV_INSPECTOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Venv inspector";
  }

  getIcon(): string {
    return "package";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async loadFolder(folderAbsPath: string): Promise<void> {
    this.currentFolder = folderAbsPath;
    this.summary = null;
    this.loading = true;
    this.render();
    try {
      this.summary = await this.venvService.getSummary(folderAbsPath);
    } catch (e) {
      new Notice(`Inspect failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-venv-inspector");

    const header = c.createDiv({ cls: "smart-venv-inspector-header" });
    header.createEl("h3", { text: "Venv inspector" });

    if (!this.currentFolder) {
      c.createDiv({
        cls: "smart-study-empty",
        text: "Right-click a folder containing .venv/ → Inspect venv.",
      });
      return;
    }

    const cwd = this.currentFolder;
    const cwdLine = c.createDiv({ cls: "smart-venv-inspector-cwd" });
    cwdLine.createSpan({ text: "Folder: " });
    cwdLine.createEl("code", { text: cwd });

    if (this.loading) {
      c.createDiv({ cls: "smart-study-empty", text: "Reading venv…" });
      return;
    }

    if (!this.summary) {
      c.createDiv({
        cls: "smart-study-empty",
        text: "No data. Use the folder context menu.",
      });
      return;
    }

    const summary = this.summary;

    const meta = c.createDiv({ cls: "smart-venv-inspector-meta" });
    meta.createDiv({
      text: `Python: ${summary.pythonVersion ?? "?"} · Packages: ${summary.packages.length} · Total: ${humanSize(summary.totalSize)}`,
    });

    if (summary.errors.length > 0) {
      const errBox = c.createDiv({ cls: "smart-venv-inspector-errors" });
      for (const err of summary.errors) errBox.createDiv({ text: `⚠ ${err}` });
    }

    const toolbar = c.createDiv({ cls: "smart-study-toolbar" });
    const refreshBtn = toolbar.createEl("button", { text: "Refresh" });
    refreshBtn.onclick = () => this.loadFolder(cwd);
    const copyBtn = toolbar.createEl("button", { text: "Copy summary" });
    copyBtn.onclick = () => this.copySummary();
    const writeBtn = toolbar.createEl("button", { text: "Write to note" });
    writeBtn.onclick = () => this.writeSummaryToNote();

    const table = c.createEl("table", { cls: "smart-study-table" });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    const heads: Array<[SortKey, string]> = [
      ["name", "Package"],
      ["version", "Version"],
      ["size", "Size"],
      ["declared", "In pyproject"],
    ];
    for (const [key, label] of heads) {
      const th = headRow.createEl("th", { text: label });
      if (this.sortKey === key) {
        th.appendText(this.sortAsc ? " ▲" : " ▼");
      }
      th.onclick = () => {
        if (this.sortKey === key) this.sortAsc = !this.sortAsc;
        else {
          this.sortKey = key;
          this.sortAsc = key === "name";
        }
        this.render();
      };
    }

    const sorted = [...summary.packages].sort((a, b) => {
      const cmp = compareBy(a, b, this.sortKey);
      return this.sortAsc ? cmp : -cmp;
    });

    const tbody = table.createEl("tbody");
    for (const pkg of sorted) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: pkg.name });
      tr.createEl("td", { text: pkg.version });
      tr.createEl("td", {
        text: pkg.sizeBytes != null ? humanSize(pkg.sizeBytes) : "—",
      });
      const flagTd = tr.createEl("td");
      const pill = flagTd.createSpan({
        cls: pkg.declared
          ? "smart-study-pill smart-study-pill-ok"
          : "smart-study-pill",
        text: pkg.declared ? "yes" : "transitive",
      });
      void pill;
    }
  }

  private summaryMarkdown(): string {
    if (!this.summary) return "";
    const s = this.summary;
    const lines: string[] = [];
    lines.push(`# Venv summary — ${s.venv.folder}`);
    lines.push("");
    lines.push(`- Python: \`${s.pythonVersion ?? "unknown"}\``);
    lines.push(`- Total size: ${humanSize(s.totalSize)}`);
    lines.push(`- Packages: ${s.packages.length}`);
    lines.push("");
    lines.push("| Package | Version | Size | In pyproject |");
    lines.push("|---|---|---|---|");
    const sorted = [...s.packages].sort((a, b) =>
      (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0),
    );
    for (const p of sorted) {
      lines.push(
        `| ${p.name} | ${p.version} | ${p.sizeBytes != null ? humanSize(p.sizeBytes) : "—"} | ${p.declared ? "yes" : "transitive"} |`,
      );
    }
    return lines.join("\n") + "\n";
  }

  private async copySummary(): Promise<void> {
    const md = this.summaryMarkdown();
    if (!md) return;
    await navigator.clipboard.writeText(md);
    new Notice("Venv summary copied to clipboard");
  }

  private async writeSummaryToNote(): Promise<void> {
    if (!this.summary || !this.currentFolder) return;
    const vaultRoot = this.venvService.vaultRoot();
    if (!this.currentFolder.startsWith(vaultRoot)) {
      new Notice("Folder is outside the vault — cannot write note");
      return;
    }
    const relative = this.currentFolder.slice(vaultRoot.length).replace(/^\/+/, "");
    const notePath = normalizePath(`${relative}/_venv-summary.md`);
    const md = this.summaryMarkdown();
    const existing = this.app.vault.getAbstractFileByPath(notePath);
    if (existing && "stat" in existing) {
      await this.app.vault.modify(existing as never, md);
    } else {
      await this.app.vault.create(notePath, md);
    }
    new Notice(`Wrote ${notePath}`);
  }
}

function compareBy(a: VenvPackage, b: VenvPackage, key: SortKey): number {
  if (key === "name") return a.name.localeCompare(b.name);
  if (key === "version") return a.version.localeCompare(b.version);
  if (key === "size") return (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
  if (key === "declared") return Number(a.declared) - Number(b.declared);
  return 0;
}

export async function revealInspectorForFolder(
  view: VenvInspectorView,
  folderAbsPath: string,
): Promise<void> {
  await view.loadFolder(folderAbsPath);
}

export { TFolder };
