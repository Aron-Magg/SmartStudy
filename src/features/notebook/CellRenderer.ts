import { App, Component, MarkdownRenderer } from "obsidian";
import {
  CellOutput,
  NotebookCell,
  cellSourceToString,
  outputTextToString,
} from "./types";

export interface CellRenderHooks {
  onSourceChange: (newSource: string) => void;
  onRun: () => void;
  onDelete: () => void;
  onTypeChange: (type: "code" | "markdown") => void;
  onInsertBelow: () => void;
  filePath: string;
  obsidianComponent: Component;
  app: App;
}

export class CellRenderer {
  constructor(
    private readonly cell: NotebookCell,
    private readonly idx: number,
    private readonly hooks: CellRenderHooks,
  ) {}

  render(container: HTMLElement): void {
    container.empty();
    container.addClass("smart-cell");
    container.addClass(`smart-cell-${this.cell.cell_type}`);

    const gutter = container.createDiv({ cls: "smart-cell-gutter" });
    gutter.createDiv({
      cls: "smart-cell-index",
      text:
        this.cell.cell_type === "code"
          ? `In[${this.cell.execution_count ?? " "}]`
          : `[${this.idx + 1}]`,
    });
    const toolbar = gutter.createDiv({ cls: "smart-cell-toolbar" });
    this.makeBtn(toolbar, "▶", "Run", this.hooks.onRun);
    this.makeBtn(toolbar, "+", "Insert cell below", this.hooks.onInsertBelow);
    this.makeBtn(toolbar, this.cell.cell_type === "code" ? "M" : "C", "Toggle code/markdown", () =>
      this.hooks.onTypeChange(this.cell.cell_type === "code" ? "markdown" : "code"),
    );
    this.makeBtn(toolbar, "✕", "Delete cell", this.hooks.onDelete);

    const body = container.createDiv({ cls: "smart-cell-body" });
    if (this.cell.cell_type === "markdown") {
      this.renderMarkdownEditor(body);
    } else if (this.cell.cell_type === "code") {
      this.renderCodeEditor(body);
      this.renderOutputs(container);
    } else {
      const raw = body.createEl("pre", { cls: "smart-cell-raw" });
      raw.textContent = cellSourceToString(this.cell.source);
    }
  }

  private makeBtn(
    parent: HTMLElement,
    label: string,
    title: string,
    onclick: () => void,
  ): HTMLButtonElement {
    const btn = parent.createEl("button", {
      cls: "smart-cell-btn",
      text: label,
    });
    btn.setAttribute("aria-label", title);
    btn.title = title;
    btn.onclick = onclick;
    return btn;
  }

  private renderCodeEditor(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "smart-cell-code-wrap" });
    const rendered = wrap.createDiv({ cls: "smart-cell-code-rendered" });
    const editor = wrap.createEl("textarea", { cls: "smart-cell-code" });
    editor.value = cellSourceToString(this.cell.source);
    editor.spellcheck = false;

    const renderHighlight = () => {
      rendered.empty();
      const code = editor.value;
      if (!code.trim()) {
        rendered.createDiv({
          cls: "smart-cell-empty",
          text: "Click to add code…",
        });
        return;
      }
      void MarkdownRenderer.render(
        this.hooks.app,
        "```python\n" + code + "\n```",
        rendered,
        this.hooks.filePath,
        this.hooks.obsidianComponent,
      );
    };

    const enterEdit = () => {
      rendered.style.display = "none";
      editor.style.display = "block";
      autosize(editor);
      editor.focus();
    };

    const leaveEdit = () => {
      this.hooks.onSourceChange(editor.value);
      editor.style.display = "none";
      rendered.style.display = "";
      renderHighlight();
    };

    // Default to preview unless the cell is empty (so a fresh cell is typable
    // immediately).
    if (editor.value.trim()) {
      editor.style.display = "none";
      renderHighlight();
    } else {
      rendered.style.display = "none";
      autosize(editor);
    }

    rendered.addEventListener("click", enterEdit);
    editor.addEventListener("blur", leaveEdit);
    editor.addEventListener("input", () => {
      this.hooks.onSourceChange(editor.value);
      autosize(editor);
    });
    editor.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        this.hooks.onSourceChange(editor.value);
        this.hooks.onRun();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        editor.blur();
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value =
          editor.value.slice(0, start) + "    " + editor.value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
        this.hooks.onSourceChange(editor.value);
        autosize(editor);
      }
    });
  }

  private renderMarkdownEditor(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "smart-cell-md-wrap" });
    const renderedHost = wrap.createDiv({ cls: "smart-cell-md-rendered" });
    const editor = wrap.createEl("textarea", { cls: "smart-cell-md-editor" });
    editor.value = cellSourceToString(this.cell.source);
    editor.style.display = "none";
    autosize(editor);
    editor.spellcheck = true;

    const render = () => {
      renderedHost.empty();
      void MarkdownRenderer.render(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.hooks as any).appRef ?? (window as any).app,
        editor.value || "*(empty markdown cell)*",
        renderedHost,
        this.hooks.filePath,
        this.hooks.obsidianComponent,
      );
    };
    render();

    renderedHost.addEventListener("dblclick", () => {
      editor.style.display = "block";
      renderedHost.style.display = "none";
      editor.focus();
    });
    editor.addEventListener("blur", () => {
      editor.style.display = "none";
      renderedHost.style.display = "block";
      this.hooks.onSourceChange(editor.value);
      render();
    });
    editor.addEventListener("input", () => autosize(editor));
    editor.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        editor.blur();
        this.hooks.onRun();
      }
    });
  }

  private renderOutputs(container: HTMLElement): void {
    if (!this.cell.outputs || this.cell.outputs.length === 0) return;
    const out = container.createDiv({ cls: "smart-cell-outputs" });
    for (const o of this.cell.outputs) this.renderOutput(out, o);
  }

  private renderOutput(parent: HTMLElement, output: CellOutput): void {
    if (output.output_type === "stream") {
      const pre = parent.createEl("pre", {
        cls: `smart-cell-out-stream smart-cell-out-${output.name}`,
      });
      pre.textContent = outputTextToString(output.text);
      return;
    }
    if (output.output_type === "error") {
      const pre = parent.createEl("pre", { cls: "smart-cell-out-error" });
      pre.textContent = `${output.ename}: ${output.evalue}\n\n${(output.traceback ?? [])
        .map(stripAnsi)
        .join("\n")}`;
      return;
    }
    const data = output.data;
    if (data["text/html"]) {
      const wrap = parent.createDiv({ cls: "smart-cell-out-html" });
      wrap.innerHTML = outputTextToString(data["text/html"]);
      return;
    }
    if (data["image/png"]) {
      const img = parent.createEl("img", { cls: "smart-cell-out-img" });
      img.src = `data:image/png;base64,${outputTextToString(data["image/png"]).replace(/\s+/g, "")}`;
      return;
    }
    if (data["image/jpeg"]) {
      const img = parent.createEl("img", { cls: "smart-cell-out-img" });
      img.src = `data:image/jpeg;base64,${outputTextToString(data["image/jpeg"]).replace(/\s+/g, "")}`;
      return;
    }
    if (data["text/plain"]) {
      const pre = parent.createEl("pre", { cls: "smart-cell-out-text" });
      pre.textContent = outputTextToString(data["text/plain"]);
      return;
    }
  }
}

function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight + 2, 600)}px`;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
