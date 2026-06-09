import { App, Modal, Notice, Setting } from "obsidian";
import type SmartStudyPlugin from "../../main";
import type { AIService } from "../../services/AIService";
import type {
  ContextSource,
  VaultContextProvider,
} from "../../services/VaultContextProvider";
import { slugify } from "../../services/StatsService";
import type { Quiz } from "../../lib/schemas";

export interface QuizGeneratorOptions {
  presetCourse?: string;
  presetTopics?: string[];
  presetDescription?: string;
}

export class QuizGeneratorModal extends Modal {
  private courseFolder = "";
  private description = "";
  private total = 10;
  private easy = 3;
  private medium = 5;
  private hard = 2;
  private contextSources: Record<ContextSource, boolean> = {
    lectures: false,
    notebooks: false,
    venv: false,
    markdown: false,
  };
  private language = "English";
  private busy = false;

  constructor(
    app: App,
    private readonly plugin: SmartStudyPlugin,
    private readonly ai: AIService,
    private readonly context: VaultContextProvider,
    private readonly onReady: (quiz: Quiz) => void,
    options: QuizGeneratorOptions = {},
  ) {
    super(app);
    this.courseFolder = options.presetCourse ?? "";
    this.description = options.presetDescription ?? "";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Generate quiz" });

    const folders = await this.context.listCourseFolders();
    if (!this.courseFolder && folders.length > 0) this.courseFolder = folders[0];

    new Setting(contentEl)
      .setName("Course folder")
      .setDesc("Scoped to this folder for context + stats slug.")
      .addDropdown((d) => {
        for (const f of folders) d.addOption(f, f);
        d.setValue(this.courseFolder).onChange((v) => (this.courseFolder = v));
      });

    new Setting(contentEl)
      .setName("Exam description")
      .setDesc("What should the quiz cover? Topics, depth, format.")
      .addTextArea((t) => {
        t.setValue(this.description).onChange((v) => (this.description = v));
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
      });

    new Setting(contentEl)
      .setName("Total questions")
      .addText((t) =>
        t.setValue(String(this.total)).onChange((v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) this.total = n;
        }),
      );

    const mixContainer = contentEl.createDiv({ cls: "smart-quiz-gen-mix" });
    mixContainer.createDiv({
      cls: "smart-study-section-title",
      text: "Difficulty mix (counts must sum to total)",
    });
    const mixRow = mixContainer.createDiv({ cls: "smart-quiz-gen-mix-row" });
    this.makeMixInput(mixRow, "Easy", () => this.easy, (n) => (this.easy = n));
    this.makeMixInput(mixRow, "Medium", () => this.medium, (n) => (this.medium = n));
    this.makeMixInput(mixRow, "Hard", () => this.hard, (n) => (this.hard = n));

    contentEl.createDiv({
      cls: "smart-study-section-title",
      text: "Context sources (optional)",
    });
    for (const key of ["lectures", "notebooks", "venv", "markdown"] as const) {
      new Setting(contentEl).setName(label(key)).addToggle((t) =>
        t.setValue(this.contextSources[key]).onChange((v) => {
          this.contextSources[key] = v;
        }),
      );
    }

    new Setting(contentEl)
      .setName("Language")
      .addText((t) =>
        t.setValue(this.language).onChange((v) => (this.language = v || "English")),
      );

    const buttons = contentEl.createDiv({ cls: "smart-study-toolbar" });
    const generate = buttons.createEl("button", {
      text: "Generate",
      cls: "mod-cta",
    });
    generate.onclick = () => this.submit();
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();

    const status = contentEl.createDiv({ cls: "smart-quiz-gen-status" });
    status.setAttribute("data-status", "");
  }

  private makeMixInput(
    parent: HTMLElement,
    label: string,
    get: () => number,
    set: (n: number) => void,
  ): void {
    const wrap = parent.createDiv({ cls: "smart-quiz-gen-mix-item" });
    wrap.createDiv({ cls: "smart-quiz-gen-mix-label", text: label });
    const input = wrap.createEl("input", { type: "number" });
    input.value = String(get());
    input.min = "0";
    input.style.width = "60px";
    input.oninput = () => {
      const n = parseInt(input.value, 10);
      if (Number.isFinite(n) && n >= 0) set(n);
    };
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (!this.description.trim()) {
      new Notice("Please describe the exam.");
      return;
    }
    if (this.easy + this.medium + this.hard !== this.total) {
      new Notice(
        `Difficulty mix sums to ${this.easy + this.medium + this.hard}, but total is ${this.total}.`,
      );
      return;
    }
    this.busy = true;
    const status = this.contentEl.querySelector(".smart-quiz-gen-status") as HTMLElement | null;
    if (status) status.setText("Collecting context…");

    let contextText: string | undefined;
    const enabled = (Object.keys(this.contextSources) as ContextSource[]).filter(
      (k) => this.contextSources[k],
    );
    if (enabled.length > 0) {
      try {
        contextText = await this.context.collect({
          courseFolder: this.courseFolder,
          sources: enabled,
        });
      } catch (e) {
        new Notice(`Context collection failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (status) status.setText(`Calling ${this.ai.currentProvider()}…`);
    try {
      const result = await this.ai.generateQuiz({
        examDescription: this.description,
        total: this.total,
        difficultyMix: {
          easy: this.easy,
          medium: this.medium,
          hard: this.hard,
        },
        contextText,
        language: this.language,
      });

      const baseSlug = slugify(this.courseFolder + "-" + this.description);
      const slug = `${baseSlug}-${Date.now().toString(36)}`;
      const quiz: Quiz = {
        schemaVersion: 1,
        slug,
        title: this.description.slice(0, 80),
        courseFolder: this.courseFolder,
        createdAt: new Date().toISOString(),
        questions: result.questions.map((q, i) => ({
          id: `${slug}-${i}`,
          topic: q.topic,
          difficulty: q.difficulty,
          prompt: q.prompt,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        })),
      };
      this.onReady(quiz);
      this.close();
    } catch (e) {
      if (status) status.setText("");
      console.error("[smart-study] Quiz generation failed:", e);
      const msg = describeError(e);
      new Notice(`Generation failed: ${msg}`, 10_000);
      this.busy = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function describeError(e: unknown): string {
  if (!e) return "unknown error (see DevTools console)";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const parts: string[] = [];
    if (e.message) parts.push(e.message);
    const anyE = e as Error & {
      cause?: unknown;
      statusCode?: number;
      responseBody?: unknown;
      data?: unknown;
      url?: string;
      name?: string;
    };
    if (anyE.statusCode) parts.push(`HTTP ${anyE.statusCode}`);
    if (anyE.url) parts.push(anyE.url);
    if (anyE.responseBody) {
      const body =
        typeof anyE.responseBody === "string"
          ? anyE.responseBody
          : JSON.stringify(anyE.responseBody);
      parts.push(body.slice(0, 400));
    }
    if (anyE.cause) {
      const causeMsg =
        anyE.cause instanceof Error
          ? anyE.cause.message
          : typeof anyE.cause === "string"
            ? anyE.cause
            : JSON.stringify(anyE.cause).slice(0, 400);
      if (causeMsg) parts.push(`cause: ${causeMsg}`);
    }
    if (parts.length === 0 && e.name) parts.push(e.name);
    return parts.join(" — ") || "unknown error (see DevTools console)";
  }
  try {
    return JSON.stringify(e).slice(0, 400);
  } catch {
    return String(e);
  }
}

function label(key: ContextSource): string {
  return {
    lectures: "HTML lectures",
    notebooks: "Notebook outputs",
    venv: "Venv summary",
    markdown: "Markdown notes",
  }[key];
}
