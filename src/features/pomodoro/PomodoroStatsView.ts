import {
  Chart,
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
} from "chart.js";
import { ItemView, Modal, Notice, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import type { PomodoroService } from "../../services/PomodoroService";
import {
  formatHoursFromSeconds,
  formatHMS,
} from "../../services/PomodoroService";
import type { PomodoroSession, PomodoroStats } from "../../lib/schemas";

Chart.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
);

export const POMODORO_STATS_VIEW_TYPE = "smart-pomodoro-stats";

type Range = 7 | 14 | 30 | 90;

export class PomodoroStatsView extends ItemView {
  private charts: Chart[] = [];
  private range: Range = 14;
  private unsub?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
    private readonly service: PomodoroService,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return POMODORO_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Study stats";
  }

  getIcon(): string {
    return "bar-chart-3";
  }

  async onOpen(): Promise<void> {
    await this.render();
    this.unsub = this.service.onSessionSaved(() => void this.render());
  }

  async onClose(): Promise<void> {
    this.unsub?.();
    this.disposeCharts();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private disposeCharts(): void {
    for (const c of this.charts) c.destroy();
    this.charts = [];
  }

  private async render(): Promise<void> {
    this.disposeCharts();
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-pomodoro-stats");

    const stats = await this.service.loadStats();

    const header = c.createDiv({ cls: "smart-pomodoro-stats-header" });
    header.createEl("h2", { text: "Study statistics" });

    const controls = header.createDiv({ cls: "smart-pomodoro-stats-controls" });
    const select = controls.createEl("select");
    for (const r of [7, 14, 30, 90] as Range[]) {
      const opt = select.createEl("option", {
        text: `Last ${r} days`,
        value: String(r),
      });
      if (r === this.range) opt.selected = true;
    }
    select.onchange = () => {
      this.range = (parseInt(select.value, 10) || 14) as Range;
      void this.render();
    };
    const refresh = controls.createEl("button", { text: "Refresh" });
    refresh.onclick = () => void this.render();

    this.renderSummary(c, stats);

    const grid = c.createDiv({ cls: "smart-pomodoro-stats-grid" });
    this.renderDailyMinutes(grid, stats);
    this.renderSessionsPerDay(grid, stats);
    this.renderModeBreakdown(grid, stats);

    this.renderRecentSessions(c, stats);
  }

  private renderSummary(parent: HTMLElement, stats: PomodoroStats): void {
    const summary = parent.createDiv({ cls: "smart-pomodoro-stats-summary" });
    const days = lastNDays(this.range);
    const rangeSeconds = days.reduce(
      (acc, d) => acc + (stats.workSecondsByDay[d] ?? 0),
      0,
    );
    const rangeSessions = days.reduce(
      (acc, d) => acc + (stats.sessionsByDay[d] ?? 0),
      0,
    );
    const today = isoDay(new Date());
    const todaySeconds = stats.workSecondsByDay[today] ?? 0;
    const avgPerDay = rangeSeconds / Math.max(1, this.range);
    const avgSession = rangeSessions === 0 ? 0 : rangeSeconds / rangeSessions;

    const items: Array<[string, string]> = [
      ["Today", formatHMS(todaySeconds)],
      [`Last ${this.range} days`, formatHoursFromSeconds(rangeSeconds)],
      ["Sessions (range)", String(rangeSessions)],
      ["Avg / day (range)", formatHoursFromSeconds(avgPerDay)],
      ["Avg session length", formatHMS(avgSession)],
      ["All-time hours", formatHoursFromSeconds(stats.totalWorkSeconds)],
      ["All-time sessions", String(stats.totalSessions)],
      [
        "Completion rate",
        stats.totalSessions === 0
          ? "—"
          : `${Math.round((stats.completedSessions / stats.totalSessions) * 100)}%`,
      ],
    ];
    for (const [label, value] of items) {
      const tile = summary.createDiv({ cls: "smart-pomodoro-stat-tile" });
      tile.createDiv({ cls: "smart-pomodoro-stat-label", text: label });
      tile.createDiv({ cls: "smart-pomodoro-stat-value", text: value });
    }
  }

  private renderDailyMinutes(parent: HTMLElement, stats: PomodoroStats): void {
    const days = lastNDays(this.range);
    if (days.every((d) => (stats.workSecondsByDay[d] ?? 0) === 0)) {
      this.placeholder(
        parent,
        "Study minutes per day",
        "Start a session to populate.",
      );
      return;
    }
    const canvas = this.canvasIn(parent, "Study minutes per day");
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            label: "Minutes",
            data: days.map((d) =>
              Math.round((stats.workSecondsByDay[d] ?? 0) / 60),
            ),
            backgroundColor: "rgba(244, 114, 182, 0.75)",
            borderColor: "rgb(236, 72, 153)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
    this.charts.push(ch);
  }

  private renderSessionsPerDay(
    parent: HTMLElement,
    stats: PomodoroStats,
  ): void {
    const days = lastNDays(this.range);
    if (days.every((d) => (stats.sessionsByDay[d] ?? 0) === 0)) {
      this.placeholder(
        parent,
        "Pomodoro sessions per day",
        "Complete a session to populate.",
      );
      return;
    }
    const canvas = this.canvasIn(parent, "Pomodoro sessions per day");
    const ch = new Chart(canvas, {
      type: "line",
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            label: "Sessions",
            data: days.map((d) => stats.sessionsByDay[d] ?? 0),
            borderColor: "rgb(34, 197, 94)",
            backgroundColor: "rgba(34, 197, 94, 0.2)",
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    this.charts.push(ch);
  }

  private renderModeBreakdown(parent: HTMLElement, stats: PomodoroStats): void {
    const counts = { manual: 0, quiz: 0 };
    for (const s of stats.recentSessions) {
      counts[s.source]++;
    }
    if (counts.manual + counts.quiz === 0) {
      this.placeholder(parent, "Source split", "No sessions saved yet.");
      return;
    }
    const canvas = this.canvasIn(parent, "Session source (recent)");
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Manual", "From quiz"],
        datasets: [
          {
            label: "Sessions",
            data: [counts.manual, counts.quiz],
            backgroundColor: [
              "rgba(96, 165, 250, 0.75)",
              "rgba(251, 191, 36, 0.75)",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    this.charts.push(ch);
  }

  private renderRecentSessions(
    parent: HTMLElement,
    stats: PomodoroStats,
  ): void {
    const wrap = parent.createDiv({ cls: "smart-pomodoro-recent" });
    wrap.createEl("h3", { text: "Recent sessions" });
    if (stats.recentSessions.length === 0) {
      wrap.createDiv({
        cls: "smart-study-empty",
        text: "No sessions saved yet.",
      });
      return;
    }
    const tbl = wrap.createEl("table", { cls: "smart-pomodoro-recent-table" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of ["When", "Mode", "Duration", "Source", "Status", ""]) {
      head.createEl("th", { text: h });
    }
    const body = tbl.createEl("tbody");
    for (const s of stats.recentSessions.slice(0, 25)) {
      const row = body.createEl("tr");
      row.createEl("td", { text: prettyTimestamp(s.startedAt) });
      row.createEl("td", { text: s.mode });
      row.createEl("td", { text: formatHMS(s.durationSeconds) });
      row.createEl("td", {
        text: s.source === "quiz" ? `quiz · ${s.quizSlug ?? ""}` : "manual",
      });
      row.createEl("td", {
        text: s.completed ? "completed" : "stopped",
        cls: s.completed
          ? "smart-pomodoro-tag-ok"
          : "smart-pomodoro-tag-warn",
      });
      const actions = row.createEl("td");
      const editBtn = actions.createEl("button", { text: "Edit" });
      editBtn.onclick = () => {
        new EditSessionModal(this.app, s, async (patch) => {
          try {
            await this.service.updateSession(s.id, s.startedAt, patch);
            new Notice("Session updated.");
            await this.render();
          } catch (err) {
            new Notice(
              `Update failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }).open();
      };
    }
  }

  private canvasIn(parent: HTMLElement, title: string): HTMLCanvasElement {
    const wrap = parent.createDiv({ cls: "smart-pomodoro-stats-card" });
    wrap.createDiv({ cls: "smart-study-section-title", text: title });
    const canvas = wrap.createEl("canvas");
    canvas.height = 220;
    return canvas;
  }

  private placeholder(parent: HTMLElement, title: string, text: string): void {
    const wrap = parent.createDiv({ cls: "smart-pomodoro-stats-card" });
    wrap.createDiv({ cls: "smart-study-section-title", text: title });
    wrap.createDiv({ cls: "smart-study-empty", text });
  }
}

function isoDay(d: Date): string {
  const tzOff = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOff).toISOString().slice(0, 10);
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(isoDay(d));
  }
  return out;
}

function shortLabel(day: string): string {
  // YYYY-MM-DD → MM-DD
  return day.slice(5);
}

class EditSessionModal extends Modal {
  constructor(
    app: import("obsidian").App,
    private readonly session: PomodoroSession,
    private readonly onSave: (patch: {
      startedAt: string;
      endedAt: string;
      note?: string;
    }) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Edit session times" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Mode: ${this.session.mode} · Source: ${this.session.source}`,
    });

    const startWrap = contentEl.createDiv({ cls: "setting-item" });
    startWrap.createEl("label", { text: "Started at" });
    const startInput = startWrap.createEl("input", { type: "datetime-local" });
    startInput.step = "1";
    startInput.value = isoToLocalInput(this.session.startedAt);

    const endWrap = contentEl.createDiv({ cls: "setting-item" });
    endWrap.createEl("label", { text: "Ended at" });
    const endInput = endWrap.createEl("input", { type: "datetime-local" });
    endInput.step = "1";
    endInput.value = isoToLocalInput(this.session.endedAt);

    const noteWrap = contentEl.createDiv({ cls: "setting-item" });
    noteWrap.createEl("label", { text: "Note (optional)" });
    const noteInput = noteWrap.createEl("input", { type: "text" });
    noteInput.value = this.session.note ?? "";

    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = btns.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = btns.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = async () => {
      const startedAt = localInputToIso(startInput.value);
      const endedAt = localInputToIso(endInput.value);
      if (!startedAt || !endedAt) {
        new Notice("Pick both start and end.");
        return;
      }
      save.setAttr("disabled", "true");
      await this.onSave({
        startedAt,
        endedAt,
        note: noteInput.value.trim() || undefined,
      });
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function prettyTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = isoDay(d);
  const time = d.toTimeString().slice(0, 5);
  return `${day} ${time}`;
}

