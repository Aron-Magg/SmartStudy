import { Notice, Plugin, TFolder, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  SmartStudySettings,
  SmartStudySettingsTab,
} from "./settings/SettingsTab";
import { VenvService } from "./services/VenvService";
import {
  VENV_INSPECTOR_VIEW_TYPE,
  VenvInspectorView,
} from "./features/venv-inspector/VenvInspectorView";
import type { JupyterServerService } from "./services/JupyterServerService";
import type { KernelClient } from "./services/KernelClient";
import type { AIService } from "./services/AIService";
import type { StatsService } from "./services/StatsService";
import type { VaultContextProvider } from "./services/VaultContextProvider";
import type { PomodoroService } from "./services/PomodoroService";
import type { HtmlAssetLinker } from "./features/html-asset-linker/HtmlAssetLinker";

export default class SmartStudyPlugin extends Plugin {
  declare settings: SmartStudySettings;
  venvService!: VenvService;
  jupyterServers?: JupyterServerService;
  kernelClient?: KernelClient;
  aiService?: AIService;
  statsService?: StatsService;
  vaultContext?: VaultContextProvider;
  pomodoroService?: PomodoroService;
  htmlAssetLinker?: HtmlAssetLinker;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.venvService = new VenvService(this.app, () => this.settings.uvPath);

    if (this.settings.features.venvInspector) this.registerVenvInspector();
    if (this.settings.features.htmlViewer)
      await this.registerHtmlViewer().catch(this.warnFeatureFailure("HTML viewer"));
    if (this.settings.features.pdfViewer)
      await this.registerPdfViewer().catch(this.warnFeatureFailure("PDF viewer"));
    if (this.settings.features.notebook)
      await this.registerNotebook().catch(this.warnFeatureFailure("Notebook"));
    if (this.settings.features.quiz)
      await this.registerQuiz().catch(this.warnFeatureFailure("Quiz"));
    if (this.settings.features.pomodoro)
      await this.registerPomodoro().catch(this.warnFeatureFailure("Pomodoro"));
    if (this.settings.features.htmlAssetLinker)
      await this.registerHtmlAssetLinker().catch(
        this.warnFeatureFailure("HTML asset linker"),
      );
    if (this.settings.features.youtubeEmbed)
      await this.registerYoutubeEmbed().catch(
        this.warnFeatureFailure("YouTube embed"),
      );
    if (this.settings.features.pythonViewer)
      await this.registerPythonViewer().catch(
        this.warnFeatureFailure("Python viewer"),
      );

    this.addSettingTab(new SmartStudySettingsTab(this.app, this));
  }

  async onunload(): Promise<void> {
    /* Feature modules clean up via Plugin.register hooks. */
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) ?? {};
    this.settings = deepMerge(DEFAULT_SETTINGS, stored);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private warnFeatureFailure(name: string) {
    return (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[smart-study] ${name} feature failed to load:`, err);
      new Notice(`Smart Study: ${name} failed to load — ${msg}`);
    };
  }

  /* ---------- Feature D: Venv Inspector ---------- */

  private registerVenvInspector(): void {
    this.registerView(
      VENV_INSPECTOR_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new VenvInspectorView(leaf, this.venvService),
    );

    this.addCommand({
      id: "open-venv-inspector",
      name: "Open venv inspector",
      callback: () => this.activateVenvInspector(),
    });

    this.addRibbonIcon("package", "Venv inspector", () =>
      this.activateVenvInspector(),
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        const abs = this.venvService.absolutePath(file.path);
        const venv = this.venvService.findVenvForPath(abs);
        if (!venv) return;
        menu.addItem((item) =>
          item
            .setTitle("Inspect venv")
            .setIcon("package")
            .onClick(async () => {
              const view = await this.activateVenvInspector();
              if (view) await view.loadFolder(venv.folder);
            }),
        );
      }),
    );
  }

  private async activateVenvInspector(): Promise<VenvInspectorView | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VENV_INSPECTOR_VIEW_TYPE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf)
        await leaf.setViewState({
          type: VENV_INSPECTOR_VIEW_TYPE,
          active: true,
        });
    }
    if (!leaf) return null;
    workspace.revealLeaf(leaf);
    return leaf.view as VenvInspectorView;
  }

  /* ---------- Feature A: Notebook (registered in registerNotebook) ---------- */
  private async registerNotebook(): Promise<void> {
    const mod = await import("./features/notebook/register");
    mod.registerNotebookFeature(this);
  }

  /* ---------- Feature B: HTML (registered in registerHtmlViewer) ---------- */
  private async registerHtmlViewer(): Promise<void> {
    const mod = await import("./features/html-viewer/register");
    mod.registerHtmlFeature(this);
  }

  /* ---------- Feature B2: PDF (registered in registerPdfViewer) ---------- */
  private async registerPdfViewer(): Promise<void> {
    const mod = await import("./features/pdf-viewer/register");
    mod.registerPdfFeature(this);
  }

  /* ---------- Feature C: Quiz (registered in registerQuiz) ---------- */
  private async registerQuiz(): Promise<void> {
    const mod = await import("./features/quiz/register");
    mod.registerQuizFeature(this);
  }

  /* ---------- Feature E: Pomodoro (registered in registerPomodoro) ---------- */
  private async registerPomodoro(): Promise<void> {
    const mod = await import("./features/pomodoro/register");
    mod.registerPomodoroFeature(this);
  }

  /* ---------- Feature F: HTML Asset Linker (registered in registerHtmlAssetLinker) ---------- */
  private async registerHtmlAssetLinker(): Promise<void> {
    const mod = await import("./features/html-asset-linker/register");
    mod.registerHtmlAssetLinker(this);
  }

  /* ---------- Feature G: YouTube embed (registered in registerYoutubeEmbed) ---------- */
  private async registerYoutubeEmbed(): Promise<void> {
    const mod = await import("./features/youtube-embed/register");
    mod.registerYoutubeEmbedFeature(this);
  }

  /* ---------- Feature H: Python viewer (registered in registerPythonViewer) ---------- */
  private async registerPythonViewer(): Promise<void> {
    const mod = await import("./features/python-viewer/register");
    mod.registerPythonViewerFeature(this);
  }
}

function deepMerge<T>(base: T, overrides: unknown): T {
  if (
    typeof base !== "object" ||
    base === null ||
    typeof overrides !== "object" ||
    overrides === null
  ) {
    return (overrides ?? base) as T;
  }
  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      k in (base as Record<string, unknown>)
    ) {
      result[k] = deepMerge((base as Record<string, unknown>)[k], v);
    } else {
      result[k] = v;
    }
  }
  return result as T;
}
