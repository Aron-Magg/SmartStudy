import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";

export const PDF_VIEW_TYPE = "smart-pdf";

/**
 * Workaround for an Obsidian 1.12.x + pdf.js v5 bug on Linux: the core PDF
 * viewer is served from `app://obsidian.md` but tries to XHR the file from
 * `app://<vault-id>/...`, which Chromium blocks as cross-origin (CORS only
 * supports http/https/chrome/data schemes). PDFs end up rendering as "0 of 0
 * pages". This view sidesteps the issue by handing the resource URL to a plain
 * <iframe>, which routes to Chromium's native pdfium renderer instead of
 * Obsidian's broken pdf.js viewer.
 */
export class PdfView extends FileView {
  private iframe: HTMLIFrameElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
  ) {
    super(leaf);
    this.allowNoFile = false;
  }

  getViewType(): string {
    return PDF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "PDF";
  }

  getIcon(): string {
    return "file-text";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "pdf";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.renderFile(file);
  }

  async onUnloadFile(file: TFile): Promise<void> {
    if (this.iframe) {
      this.iframe.src = "about:blank";
      this.iframe.remove();
      this.iframe = null;
    }
    await super.onUnloadFile(file);
  }

  private renderFile(file: TFile): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-pdf-view");

    const adapter = this.app.vault.adapter as unknown as {
      getResourcePath: (p: string) => string;
    };
    const url = adapter.getResourcePath(file.path);

    const toolbar = c.createDiv({ cls: "smart-pdf-toolbar" });
    toolbar.createSpan({ cls: "smart-pdf-path", text: file.path });
    const openExt = toolbar.createEl("button", { text: "Open externally" });
    openExt.onclick = () => window.open(url, "_blank");
    const reload = toolbar.createEl("button", { text: "Reload" });
    reload.onclick = () => this.renderFile(file);

    const iframe = c.createEl("iframe", { cls: "smart-pdf-iframe" });
    iframe.setAttribute("src", url);
    this.iframe = iframe;
  }
}
