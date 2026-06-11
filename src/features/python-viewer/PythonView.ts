import { MarkdownRenderer, TextFileView, WorkspaceLeaf } from "obsidian";

export const PYTHON_VIEW_TYPE = "smart-python";

const EDITABLE_EXTENSIONS = new Set(["py", "pyi", "pyx"]);

export class PythonView extends TextFileView {
  private editor!: HTMLTextAreaElement;
  private preview!: HTMLElement;
  private editing = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return PYTHON_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name ?? "Python";
  }

  getIcon(): string {
    return "file-code";
  }

  canAcceptExtension(extension: string): boolean {
    return EDITABLE_EXTENSIONS.has(extension);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: "smart-py" });

    const toolbar = root.createDiv({ cls: "smart-py-toolbar" });
    const editBtn = toolbar.createEl("button", {
      cls: "smart-py-btn",
      text: "Edit",
    });
    editBtn.onclick = () => (this.editing ? this.leaveEdit() : this.enterEdit());

    this.preview = root.createDiv({ cls: "smart-py-preview" });
    this.editor = root.createEl("textarea", { cls: "smart-py-editor" });
    this.editor.spellcheck = false;
    this.editor.style.display = "none";

    this.preview.addEventListener("click", () => {
      if (!this.editing) this.enterEdit();
    });

    this.editor.addEventListener("blur", () => this.leaveEdit());
    this.editor.addEventListener("input", () => {
      this.requestSave();
      autosize(this.editor);
    });
    this.editor.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.editor.blur();
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        this.editor.value =
          this.editor.value.slice(0, start) +
          "    " +
          this.editor.value.slice(end);
        this.editor.selectionStart = this.editor.selectionEnd = start + 4;
        this.requestSave();
        autosize(this.editor);
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
        ev.preventDefault();
        this.requestSave();
      }
    });
  }

  getViewData(): string {
    return this.editor?.value ?? "";
  }

  setViewData(data: string, _clear: boolean): void {
    if (!this.editor) return;
    this.editor.value = data;
    this.renderPreview();
    autosize(this.editor);
  }

  clear(): void {
    if (this.editor) this.editor.value = "";
    if (this.preview) this.preview.empty();
  }

  private enterEdit(): void {
    this.editing = true;
    this.preview.style.display = "none";
    this.editor.style.display = "block";
    autosize(this.editor);
    this.editor.focus();
  }

  private leaveEdit(): void {
    this.editing = false;
    this.editor.style.display = "none";
    this.preview.style.display = "";
    this.renderPreview();
  }

  private renderPreview(): void {
    this.preview.empty();
    const code = this.editor.value;
    if (!code.trim()) {
      this.preview.createDiv({
        cls: "smart-py-empty",
        text: "Empty file — click to start typing.",
      });
      return;
    }
    void MarkdownRenderer.render(
      this.app,
      "```python\n" + code + "\n```",
      this.preview,
      this.file?.path ?? "",
      this,
    );
  }
}

function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${Math.max(ta.scrollHeight + 4, 200)}px`;
}
