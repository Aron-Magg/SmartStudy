import { Notice, TextFileView, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import type { JupyterServerService } from "../../services/JupyterServerService";
import type { KernelClient, KernelHandle } from "../../services/KernelClient";
import { CellRenderer } from "./CellRenderer";
import { ExecBus } from "./ExecBus";
import {
  CellType,
  NotebookCell,
  NotebookFile,
  cellSourceToString,
  emptyNotebook,
  newCell,
} from "./types";

export const NOTEBOOK_VIEW_TYPE = "smart-notebook";

export class NotebookView extends TextFileView {
  private notebook: NotebookFile = emptyNotebook();
  private kernel: KernelHandle | null = null;
  private bus = new ExecBus();
  private kernelStatus = "idle";
  private kernelLabel: HTMLSpanElement | null = null;
  private cellListEl: HTMLElement | null = null;
  private venvFolder: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
    private readonly servers: JupyterServerService,
    private readonly kernels: KernelClient,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return NOTEBOOK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Notebook";
  }

  getIcon(): string {
    return "book-open";
  }

  getViewData(): string {
    return JSON.stringify(this.notebook, null, 2);
  }

  setViewData(data: string, _clear: boolean): void {
    try {
      this.notebook = parseNotebook(data);
    } catch (e) {
      new Notice(
        `Failed to parse notebook: ${e instanceof Error ? e.message : e}`,
      );
      this.notebook = emptyNotebook();
    }
    this.renderAll();
  }

  clear(): void {
    this.notebook = emptyNotebook();
    this.contentEl.empty();
  }

  async onLoadFile(file: import("obsidian").TFile): Promise<void> {
    await super.onLoadFile(file);
    const abs = this.plugin.venvService.absolutePath(file.path);
    const venv = this.plugin.venvService.findVenvForPath(abs);
    this.venvFolder = venv?.folder ?? null;
    if (this.venvFolder) this.servers.acquire(this.venvFolder);
  }

  async onUnloadFile(file: import("obsidian").TFile): Promise<void> {
    if (this.venvFolder) {
      this.servers.release(this.venvFolder);
      this.venvFolder = null;
    }
    if (this.kernel) {
      try {
        await this.kernel.shutdown();
      } catch {
        /* ignore */
      }
      this.kernel = null;
      this.bus.setKernel(null);
    }
    await super.onUnloadFile(file);
  }

  private async ensureKernel(): Promise<KernelHandle | null> {
    if (this.kernel) return this.kernel;
    if (!this.venvFolder) {
      new Notice("No .venv/ found in this folder or any parent.");
      return null;
    }
    this.setStatus("starting server…");
    try {
      const info = await this.servers.getOrStart(this.venvFolder);
      this.setStatus("starting kernel…");
      this.kernel = await this.kernels.startKernel(info);
      this.bus.setKernel(this.kernel);
      this.kernel.kernel.statusChanged.connect(() =>
        this.setStatus(this.kernel?.kernel.status ?? "idle"),
      );
      this.setStatus(this.kernel.kernel.status);
      return this.kernel;
    } catch (e) {
      this.setStatus("error");
      new Notice(`Kernel start failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private setStatus(s: string): void {
    this.kernelStatus = s;
    if (this.kernelLabel) this.kernelLabel.textContent = `kernel: ${s}`;
  }

  private renderAll(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-notebook");

    const toolbar = c.createDiv({ cls: "smart-notebook-toolbar" });
    const venvLabel = toolbar.createSpan({ cls: "smart-notebook-venv" });
    venvLabel.textContent = this.venvFolder
      ? `venv: ${this.venvFolder}`
      : "venv: (none — open a file inside a folder with .venv/)";
    this.kernelLabel = toolbar.createSpan({ cls: "smart-notebook-kernel" });
    this.kernelLabel.textContent = `kernel: ${this.kernelStatus}`;

    const buttons = toolbar.createDiv({ cls: "smart-notebook-actions" });
    this.button(buttons, "Run all", () => this.runAll());
    this.button(buttons, "Restart", () => this.restartKernel());
    this.button(buttons, "Interrupt", () => this.interruptKernel());
    this.button(buttons, "Add code cell", () =>
      this.appendCell(newCell("code", "")),
    );
    this.button(buttons, "Add markdown cell", () =>
      this.appendCell(newCell("markdown", "")),
    );

    this.cellListEl = c.createDiv({ cls: "smart-notebook-cells" });
    this.renderCells();
  }

  private renderCells(): void {
    if (!this.cellListEl) return;
    this.cellListEl.empty();
    this.notebook.cells.forEach((cell, idx) => {
      const wrap = this.cellListEl!.createDiv();
      const renderer = new CellRenderer(cell, idx, {
        filePath: this.file?.path ?? "",
        obsidianComponent: this,
        onSourceChange: (newSource) => {
          cell.source = newSource;
          this.requestSave();
        },
        onRun: () => this.runCell(idx),
        onDelete: () => {
          this.notebook.cells.splice(idx, 1);
          this.requestSave();
          this.renderCells();
        },
        onTypeChange: (type) => {
          cell.cell_type = type;
          if (type === "code") {
            cell.outputs = cell.outputs ?? [];
            cell.execution_count = cell.execution_count ?? null;
          } else {
            delete cell.outputs;
            delete cell.execution_count;
          }
          this.requestSave();
          this.renderCells();
        },
        onInsertBelow: () => {
          this.notebook.cells.splice(idx + 1, 0, newCell("code", ""));
          this.requestSave();
          this.renderCells();
        },
      });
      renderer.render(wrap);
    });
    if (this.notebook.cells.length === 0) {
      const empty = this.cellListEl.createDiv({
        cls: "smart-study-empty",
        text: "No cells. Use the toolbar to add one.",
      });
      void empty;
    }
  }

  private button(parent: HTMLElement, label: string, onclick: () => void): void {
    const btn = parent.createEl("button", { text: label });
    btn.onclick = onclick;
  }

  private appendCell(cell: NotebookCell): void {
    this.notebook.cells.push(cell);
    this.requestSave();
    this.renderCells();
  }

  private async runCell(idx: number): Promise<void> {
    const cell = this.notebook.cells[idx];
    if (!cell) return;
    if (cell.cell_type !== "code") {
      this.renderCells();
      return;
    }
    const kernel = await this.ensureKernel();
    if (!kernel) return;
    cell.outputs = [];
    cell.execution_count = null;
    this.renderCells();
    const code = cellSourceToString(cell.source);
    this.bus.enqueue({
      code,
      onOutput: (o) => {
        cell.outputs = cell.outputs ?? [];
        cell.outputs.push(o);
        this.renderCells();
      },
      onDone: (count) => {
        cell.execution_count = count;
        this.renderCells();
        this.requestSave();
      },
      onError: (err) => {
        cell.outputs = cell.outputs ?? [];
        cell.outputs.push({
          output_type: "error",
          ename: err.name,
          evalue: err.message,
          traceback: [],
        });
        this.renderCells();
      },
    });
  }

  private async runAll(): Promise<void> {
    for (let i = 0; i < this.notebook.cells.length; i++) {
      if (this.notebook.cells[i].cell_type === "code") {
        await this.runCell(i);
      }
    }
  }

  private async restartKernel(): Promise<void> {
    if (!this.kernel) {
      await this.ensureKernel();
      return;
    }
    this.bus.clearQueue();
    try {
      await this.kernel.restart();
      new Notice("Kernel restarted");
    } catch (e) {
      new Notice(`Restart failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async interruptKernel(): Promise<void> {
    if (!this.kernel) return;
    try {
      await this.kernel.interrupt();
      new Notice("Kernel interrupted");
    } catch (e) {
      new Notice(`Interrupt failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export type { CellType, NotebookCell, NotebookFile };

function parseNotebook(raw: string): NotebookFile {
  if (!raw.trim()) return emptyNotebook();
  const parsed = JSON.parse(raw) as Partial<NotebookFile>;
  if (!Array.isArray(parsed.cells)) {
    throw new Error("Missing cells[]");
  }
  return {
    cells: parsed.cells as NotebookCell[],
    metadata: parsed.metadata ?? {},
    nbformat: parsed.nbformat ?? 4,
    nbformat_minor: parsed.nbformat_minor ?? 5,
  };
}
