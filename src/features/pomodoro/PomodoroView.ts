import { ItemView, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import {
  PomodoroMode,
  PomodoroService,
  PomodoroState,
  formatHMS,
} from "../../services/PomodoroService";

export const POMODORO_VIEW_TYPE = "smart-pomodoro-timer";

const MODE_LABELS: Record<PomodoroMode, string> = {
  work: "Work",
  shortBreak: "Short break",
  longBreak: "Long break",
};

export class PomodoroView extends ItemView {
  private unsub?: () => void;
  private rendered = false;
  private timeEl?: HTMLElement;
  private progressFillEl?: HTMLElement;
  private modeEl?: HTMLElement;
  private statusEl?: HTMLElement;
  private sessionsEl?: HTMLElement;
  private actionsEl?: HTMLElement;
  private modeButtonsEl?: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
    private readonly service: PomodoroService,
    private readonly openStats: () => Promise<void>,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return POMODORO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Pomodoro";
  }

  getIcon(): string {
    return "timer";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    this.update(this.service.getState());
    this.unsub = this.service.onTick((s) => this.update(s));
  }

  async onClose(): Promise<void> {
    this.unsub?.();
  }

  private renderShell(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-pomodoro");

    const header = c.createDiv({ cls: "smart-pomodoro-header" });
    header.createEl("h2", { text: "Pomodoro" });

    const modeBtns = c.createDiv({ cls: "smart-pomodoro-modes" });
    this.modeButtonsEl = modeBtns;

    const card = c.createDiv({ cls: "smart-pomodoro-card" });
    this.modeEl = card.createDiv({ cls: "smart-pomodoro-mode-label" });

    const ring = card.createDiv({ cls: "smart-pomodoro-ring" });
    const fill = ring.createDiv({ cls: "smart-pomodoro-ring-fill" });
    this.progressFillEl = fill;
    this.timeEl = ring.createDiv({ cls: "smart-pomodoro-time" });

    this.statusEl = card.createDiv({ cls: "smart-pomodoro-status" });

    this.actionsEl = c.createDiv({ cls: "smart-pomodoro-actions" });
    this.sessionsEl = c.createDiv({ cls: "smart-pomodoro-sessions" });

    const footer = c.createDiv({ cls: "smart-pomodoro-footer" });
    const statsBtn = footer.createEl("button", {
      text: "Open stats dashboard",
      cls: "smart-pomodoro-link",
    });
    statsBtn.onclick = () => void this.openStats();

    this.rendered = true;
  }

  private update(state: PomodoroState): void {
    if (!this.rendered) return;
    if (!this.timeEl || !this.progressFillEl || !this.modeEl) return;

    this.modeEl.setText(MODE_LABELS[state.mode]);
    this.timeEl.setText(formatHMS(state.remainingMs / 1000));
    const pct =
      state.totalMs <= 0
        ? 0
        : 100 - Math.min(100, (state.remainingMs / state.totalMs) * 100);
    this.progressFillEl.style.width = `${pct.toFixed(1)}%`;
    this.progressFillEl.dataset.mode = state.mode;

    if (this.statusEl) {
      const parts: string[] = [];
      parts.push(
        state.status === "running"
          ? "Running"
          : state.status === "paused"
            ? "Paused"
            : "Idle",
      );
      if (state.source === "quiz" && state.quizSlug) {
        parts.push(`quiz · ${state.quizSlug}`);
      }
      this.statusEl.setText(parts.join(" · "));
    }

    if (this.sessionsEl) {
      const goal = this.plugin.settings.pomodoro.sessionsUntilLongBreak;
      this.sessionsEl.setText(
        `Sessions today (toward long break): ${state.workSessionsCompleted % goal} / ${goal} · Total completed: ${state.workSessionsCompleted}`,
      );
    }

    this.renderActions(state);
    this.renderModeButtons(state);
  }

  private renderActions(state: PomodoroState): void {
    if (!this.actionsEl) return;
    this.actionsEl.empty();
    if (state.status === "idle") {
      const start = this.actionsEl.createEl("button", {
        text: `Start ${MODE_LABELS[state.mode].toLowerCase()}`,
        cls: "mod-cta",
      });
      start.onclick = () => this.service.start({ source: "manual" });
    } else if (state.status === "running") {
      const pause = this.actionsEl.createEl("button", { text: "Pause" });
      pause.onclick = () => this.service.pause();
      const stop = this.actionsEl.createEl("button", {
        text: "Stop & save",
        cls: "mod-warning",
      });
      stop.onclick = () => void this.service.stop({ reason: "manual" });
    } else {
      const resume = this.actionsEl.createEl("button", {
        text: "Resume",
        cls: "mod-cta",
      });
      resume.onclick = () => this.service.start({ source: "manual" });
      const stop = this.actionsEl.createEl("button", { text: "Stop & save" });
      stop.onclick = () => void this.service.stop({ reason: "manual" });
    }
    const skip = this.actionsEl.createEl("button", {
      text: "Skip",
      cls: "smart-pomodoro-skip",
    });
    skip.onclick = () => this.service.skip();
  }

  private renderModeButtons(state: PomodoroState): void {
    if (!this.modeButtonsEl) return;
    this.modeButtonsEl.empty();
    const modes: PomodoroMode[] = ["work", "shortBreak", "longBreak"];
    for (const m of modes) {
      const btn = this.modeButtonsEl.createEl("button", {
        text: MODE_LABELS[m],
        cls: `smart-pomodoro-mode${state.mode === m ? " is-active" : ""}`,
      });
      btn.disabled = state.status !== "idle";
      btn.onclick = () => this.service.setMode(m);
    }
  }
}
