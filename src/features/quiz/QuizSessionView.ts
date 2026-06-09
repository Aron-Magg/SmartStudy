import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import type { StatsService } from "../../services/StatsService";
import type { Attempt, Quiz } from "../../lib/schemas";

export const QUIZ_SESSION_VIEW_TYPE = "smart-quiz-session";

interface AnswerRecord {
  index: number;
  startedAt: number;
  selectedIndex: number | null;
  correct: boolean | null;
  ms: number | null;
}

export class QuizSessionView extends ItemView {
  private quiz: Quiz | null = null;
  private cursor = 0;
  private records: AnswerRecord[] = [];
  private sessionStart = 0;
  private finished = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
    private readonly stats: StatsService,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return QUIZ_SESSION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.quiz ? `Quiz · ${this.quiz.title}` : "Quiz session";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  setQuiz(quiz: Quiz): void {
    this.quiz = quiz;
    this.cursor = 0;
    this.finished = false;
    this.sessionStart = Date.now();
    this.records = quiz.questions.map((_, i) => ({
      index: i,
      startedAt: Date.now(),
      selectedIndex: null,
      correct: null,
      ms: null,
    }));
    this.maybeStartPomodoro(quiz);
    this.render();
  }

  private maybeStartPomodoro(quiz: Quiz): void {
    const svc = this.plugin.pomodoroService;
    if (!svc) return;
    if (!this.plugin.settings.pomodoro.autoStartOnQuiz) return;
    const st = svc.getState();
    if (st.status === "running" && st.source === "quiz") return;
    if (st.status !== "idle") return;
    svc.setMode("work");
    svc.start({ source: "quiz", quizSlug: quiz.slug });
  }

  private async stopPomodoroIfQuizDriven(): Promise<void> {
    const svc = this.plugin.pomodoroService;
    if (!svc) return;
    const st = svc.getState();
    if (st.source !== "quiz") return;
    if (st.status === "idle") return;
    await svc.stop({ reason: "quizEnded" });
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-quiz-session");

    if (!this.quiz) {
      c.createDiv({
        cls: "smart-study-empty",
        text: "No quiz loaded. Run 'Generate quiz' from the command palette or ribbon.",
      });
      return;
    }

    if (this.finished) {
      this.renderResults(c);
      return;
    }

    const header = c.createDiv({ cls: "smart-quiz-header" });
    header.createEl("h2", { text: this.quiz.title });
    header.createDiv({
      cls: "smart-quiz-progress",
      text: `Question ${this.cursor + 1} of ${this.quiz.questions.length}`,
    });
    const elapsed = ((Date.now() - this.sessionStart) / 1000) | 0;
    header.createDiv({
      cls: "smart-quiz-elapsed",
      text: `Elapsed: ${formatDuration(elapsed)}`,
    });

    const q = this.quiz.questions[this.cursor];
    const card = c.createDiv({ cls: "smart-quiz-card" });
    card.createDiv({ cls: "smart-quiz-topic", text: `${q.topic} · ${q.difficulty}` });
    card.createDiv({ cls: "smart-quiz-prompt", text: q.prompt });

    const opts = card.createDiv({ cls: "smart-quiz-options" });
    const record = this.records[this.cursor];
    q.options.forEach((opt, idx) => {
      const row = opts.createEl("label", { cls: "smart-quiz-option" });
      const radio = row.createEl("input", {
        type: "radio",
        attr: { name: `q-${this.cursor}` },
      });
      radio.checked = record.selectedIndex === idx;
      radio.disabled = record.correct !== null;
      radio.onchange = () => {
        record.selectedIndex = idx;
      };
      row.createSpan({ text: opt });
      if (record.correct !== null) {
        if (idx === q.correctIndex) row.addClass("smart-quiz-option-correct");
        if (record.selectedIndex === idx && idx !== q.correctIndex)
          row.addClass("smart-quiz-option-wrong");
      }
    });

    const actions = card.createDiv({ cls: "smart-study-toolbar" });
    if (record.correct === null) {
      const submit = actions.createEl("button", {
        text: "Submit",
        cls: "mod-cta",
      });
      submit.onclick = () => this.submitCurrent();
    } else {
      const expl = card.createDiv({ cls: "smart-quiz-explanation" });
      expl.createEl("strong", { text: record.correct ? "Correct." : "Incorrect." });
      expl.createSpan({ text: " " + q.explanation });
      const next = actions.createEl("button", {
        text: this.cursor === this.quiz.questions.length - 1 ? "Finish" : "Next",
        cls: "mod-cta",
      });
      next.onclick = () => this.next();
    }
  }

  private submitCurrent(): void {
    if (!this.quiz) return;
    const q = this.quiz.questions[this.cursor];
    const rec = this.records[this.cursor];
    if (rec.selectedIndex === null) {
      new Notice("Pick an answer first.");
      return;
    }
    rec.correct = rec.selectedIndex === q.correctIndex;
    rec.ms = Date.now() - rec.startedAt;
    this.render();
  }

  private next(): void {
    if (!this.quiz) return;
    if (this.cursor < this.quiz.questions.length - 1) {
      this.cursor++;
      this.records[this.cursor].startedAt = Date.now();
      this.render();
    } else {
      this.finish();
    }
  }

  private async finish(): Promise<void> {
    if (!this.quiz) return;
    this.finished = true;
    const attempts: Attempt[] = [];
    const providerUsed = this.plugin.settings.ai.provider;
    for (const r of this.records) {
      if (r.selectedIndex === null || r.correct === null) continue;
      const q = this.quiz.questions[r.index];
      attempts.push({
        quizSlug: this.quiz.slug,
        questionId: q.id,
        topic: q.topic,
        difficulty: q.difficulty,
        selectedIndex: r.selectedIndex,
        correct: r.correct,
        ms: r.ms ?? 0,
        providerUsed,
        at: new Date().toISOString(),
      });
    }
    try {
      await this.stats.recordSession(this.quiz, attempts, (Date.now() - this.sessionStart) / 1000);
      new Notice("Quiz results saved");
    } catch (e) {
      new Notice(`Failed to save results: ${e instanceof Error ? e.message : e}`);
    }
    await this.stopPomodoroIfQuizDriven();
    this.render();
  }

  private renderResults(c: HTMLElement): void {
    if (!this.quiz) return;
    const correct = this.records.filter((r) => r.correct).length;
    const total = this.records.length;
    c.createEl("h2", { text: this.quiz.title });
    c.createDiv({
      cls: "smart-quiz-results-total",
      text: `Score: ${correct} / ${total} (${Math.round((correct / total) * 100)}%)`,
    });
    const list = c.createDiv({ cls: "smart-quiz-results-list" });
    this.records.forEach((r, idx) => {
      const q = this.quiz!.questions[idx];
      const row = list.createDiv({
        cls: `smart-quiz-results-row smart-quiz-results-${r.correct ? "ok" : "bad"}`,
      });
      row.createDiv({
        cls: "smart-quiz-results-q",
        text: `${idx + 1}. (${q.topic}) ${q.prompt}`,
      });
      const expected = q.options[q.correctIndex];
      const got = r.selectedIndex !== null ? q.options[r.selectedIndex] : "—";
      row.createDiv({
        cls: "smart-quiz-results-detail",
        text: `Your answer: ${got} · Correct: ${expected}`,
      });
      row.createDiv({
        cls: "smart-quiz-results-explanation",
        text: q.explanation,
      });
    });
    const actions = c.createDiv({ cls: "smart-study-toolbar" });
    const retry = actions.createEl("button", { text: "Retake quiz" });
    retry.onclick = () => this.setQuiz(this.quiz!);
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
