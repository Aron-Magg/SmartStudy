import { ItemView, Modal, Notice, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import type { StatsService, QuizSummary } from "../../services/StatsService";
import { summarizeQuiz } from "../../services/StatsService";
import type { Quiz } from "../../lib/schemas";
import { QUIZ_SESSION_VIEW_TYPE, QuizSessionView } from "./QuizSessionView";

export const QUIZ_LIBRARY_VIEW_TYPE = "smart-quiz-library";

export class QuizLibraryView extends ItemView {
  private filter = "";
  private summaries: QuizSummary[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
    private readonly stats: StatsService,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return QUIZ_LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Quiz library";
  }

  getIcon(): string {
    return "library";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const [quizzes, attempts] = await Promise.all([
      this.stats.listAllQuizzes(),
      this.stats.loadAllAttempts(),
    ]);
    this.summaries = quizzes.map((q) => summarizeQuiz(q, attempts));
    this.render();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-quiz-library");

    const header = c.createDiv({ cls: "smart-quiz-library-header" });
    header.createEl("h2", { text: "Quiz library" });
    const sub = header.createDiv({ cls: "smart-quiz-library-sub" });
    sub.setText(
      this.summaries.length === 0
        ? "No quizzes saved yet."
        : `${this.summaries.length} quiz${this.summaries.length === 1 ? "" : "es"} saved.`,
    );

    const controls = c.createDiv({ cls: "smart-quiz-library-controls" });
    const search = controls.createEl("input", {
      type: "text",
      placeholder: "Filter by title, course or topic…",
    });
    search.value = this.filter;
    search.oninput = () => {
      this.filter = search.value.trim().toLowerCase();
      this.renderList(listWrap);
    };
    const refreshBtn = controls.createEl("button", { text: "Refresh" });
    refreshBtn.onclick = () => void this.refresh();

    const listWrap = c.createDiv({ cls: "smart-quiz-library-list" });
    this.renderList(listWrap);
  }

  private renderList(parent: HTMLElement): void {
    parent.empty();
    const visible = this.summaries.filter((s) => this.matchesFilter(s));
    if (visible.length === 0) {
      parent.createDiv({
        cls: "smart-study-empty",
        text:
          this.summaries.length === 0
            ? "Generate a quiz from the ribbon or command palette."
            : "No quizzes match your filter.",
      });
      return;
    }
    for (const s of visible) this.renderCard(parent, s);
  }

  private matchesFilter(s: QuizSummary): boolean {
    if (!this.filter) return true;
    const hay = [
      s.quiz.title,
      s.quiz.courseFolder,
      s.quiz.slug,
      ...s.quiz.questions.map((q) => q.topic),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(this.filter);
  }

  private renderCard(parent: HTMLElement, summary: QuizSummary): void {
    const { quiz } = summary;
    const card = parent.createDiv({ cls: "smart-quiz-library-card" });

    const title = card.createDiv({ cls: "smart-quiz-library-card-title" });
    title.createEl("strong", { text: quiz.title });
    title.createSpan({
      cls: "smart-quiz-library-card-count",
      text: ` · ${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"}`,
    });

    const meta = card.createDiv({ cls: "smart-quiz-library-card-meta" });
    meta.createDiv({
      cls: "smart-quiz-library-card-course",
      text: quiz.courseFolder,
    });
    meta.createDiv({
      cls: "smart-quiz-library-card-date",
      text: `Created ${prettyTimestamp(quiz.createdAt)}`,
    });

    const topics = new Set(quiz.questions.map((q) => q.topic));
    if (topics.size > 0) {
      const tagWrap = card.createDiv({ cls: "smart-quiz-library-tags" });
      for (const topic of [...topics].slice(0, 8)) {
        tagWrap.createSpan({ cls: "smart-quiz-library-tag", text: topic });
      }
      if (topics.size > 8) {
        tagWrap.createSpan({
          cls: "smart-quiz-library-tag-more",
          text: `+${topics.size - 8}`,
        });
      }
    }

    const stats = card.createDiv({ cls: "smart-quiz-library-card-stats" });
    this.statTile(stats, "Sessions", String(summary.sessions));
    this.statTile(stats, "Attempts", String(summary.attempts));
    this.statTile(
      stats,
      "Best",
      summary.bestPct === null ? "—" : `${summary.bestPct}%`,
    );
    this.statTile(
      stats,
      "Last",
      summary.lastPct === null ? "—" : `${summary.lastPct}%`,
    );
    this.statTile(
      stats,
      "Last taken",
      summary.lastAt ? prettyTimestamp(summary.lastAt) : "never",
    );

    const actions = card.createDiv({ cls: "smart-quiz-library-card-actions" });
    const retake = actions.createEl("button", {
      text: summary.lastAt ? "Retake" : "Start",
      cls: "mod-cta",
    });
    retake.onclick = () => void this.openQuiz(quiz);

    const del = actions.createEl("button", { text: "Delete" });
    del.onclick = () => this.confirmDelete(quiz);
  }

  private statTile(parent: HTMLElement, label: string, value: string): void {
    const tile = parent.createDiv({ cls: "smart-quiz-library-stat" });
    tile.createDiv({ cls: "smart-quiz-library-stat-label", text: label });
    tile.createDiv({ cls: "smart-quiz-library-stat-value", text: value });
  }

  private async openQuiz(quiz: Quiz): Promise<void> {
    const { workspace } = this.plugin.app;
    let leaf = workspace.getLeavesOfType(QUIZ_SESSION_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: QUIZ_SESSION_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    (leaf.view as QuizSessionView).setQuiz(quiz);
  }

  private confirmDelete(quiz: Quiz): void {
    new ConfirmDeleteModal(this.app, quiz.title, async () => {
      try {
        await this.stats.deleteQuiz(quiz.slug);
        new Notice(`Deleted "${quiz.title}"`);
        await this.refresh();
      } catch (err) {
        new Notice(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }).open();
  }
}

class ConfirmDeleteModal extends Modal {
  constructor(
    app: import("obsidian").App,
    private readonly title: string,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Delete quiz?" });
    contentEl.createEl("p", {
      text: `"${this.title}" will be removed permanently. Past attempt logs stay intact.`,
    });
    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = btns.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const ok = btns.createEl("button", { text: "Delete", cls: "mod-warning" });
    ok.onclick = async () => {
      ok.setAttr("disabled", "true");
      await this.onConfirm();
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function prettyTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
