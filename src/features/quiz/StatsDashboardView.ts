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
import { ItemView, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import type { StatsService } from "../../services/StatsService";
import type { Attempt, Stats } from "../../lib/schemas";

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

export const STATS_VIEW_TYPE = "smart-quiz-stats";

type Range = 7 | 14 | 30 | 90;

export class StatsDashboardView extends ItemView {
  private charts: Chart[] = [];
  private range: Range = 14;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
    private readonly stats: StatsService,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Quiz stats";
  }

  getIcon(): string {
    return "bar-chart-2";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
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
    c.addClass("smart-quiz-stats");

    const [data, attempts] = await Promise.all([
      this.stats.loadStats(),
      this.stats.loadAllAttempts(),
    ]);

    const header = c.createDiv({ cls: "smart-quiz-stats-header" });
    header.createEl("h2", { text: "Quiz statistics" });
    const controls = header.createDiv({ cls: "smart-quiz-stats-controls" });
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

    this.renderSummary(c, data, attempts);

    const grid = c.createDiv({ cls: "smart-quiz-stats-grid" });
    this.renderAccuracyOverTime(grid, attempts);
    this.renderAttemptsPerDay(grid, attempts);
    this.renderStudyMinutes(grid, data);
    this.renderPerTopic(grid, data);
    this.renderDifficultyBreakdown(grid, attempts);
    this.renderTimeOfDay(grid, attempts);

    this.renderRecentSessions(c, attempts);
  }

  private renderSummary(
    parent: HTMLElement,
    data: Stats,
    attempts: Attempt[],
  ): void {
    const summary = parent.createDiv({ cls: "smart-quiz-stats-summary" });
    const days = lastNDays(this.range);
    const dayset = new Set(days);
    const inRange = attempts.filter((a) => dayset.has(a.at.slice(0, 10)));
    const inRangeOk = inRange.filter((a) => a.correct).length;
    const today = isoDay(new Date());
    const todayAttempts = attempts.filter((a) => a.at.slice(0, 10) === today);
    const todayOk = todayAttempts.filter((a) => a.correct).length;
    const allTimeAcc =
      data.totalAttempts === 0
        ? 0
        : Math.round((data.totalCorrect / data.totalAttempts) * 100);
    const rangeAcc =
      inRange.length === 0
        ? 0
        : Math.round((inRangeOk / inRange.length) * 100);
    const todayAcc =
      todayAttempts.length === 0
        ? 0
        : Math.round((todayOk / todayAttempts.length) * 100);
    const avgMs =
      inRange.length === 0
        ? 0
        : inRange.reduce((a, x) => a + x.ms, 0) / inRange.length;
    const rangeMinutes = days.reduce(
      (acc, d) => acc + (data.studyMinutesByDay[d] ?? 0),
      0,
    );

    const items: Array<[string, string]> = [
      ["Today", `${todayAttempts.length} (${todayAcc}%)`],
      [`Last ${this.range} days`, `${inRange.length} (${rangeAcc}%)`],
      ["All-time attempts", String(data.totalAttempts)],
      ["All-time accuracy", `${allTimeAcc}%`],
      ["Avg time / Q (range)", formatMs(avgMs)],
      ["Study min (range)", String(Math.round(rangeMinutes))],
      ["Wrong queue", String(data.recentWrong.length)],
      ["Topics covered", String(Object.keys(data.perTopic).length)],
    ];
    for (const [label, value] of items) {
      const tile = summary.createDiv({ cls: "smart-quiz-stat-tile" });
      tile.createDiv({ cls: "smart-quiz-stat-label", text: label });
      tile.createDiv({ cls: "smart-quiz-stat-value", text: value });
    }
  }

  private renderPerTopic(parent: HTMLElement, data: Stats): void {
    const topics = Object.entries(data.perTopic);
    if (topics.length === 0) {
      this.placeholder(parent, "Per-topic accuracy", "Take a quiz to populate.");
      return;
    }
    topics.sort(([, a], [, b]) => b.attempts - a.attempts);
    const top = topics.slice(0, 12);
    const labels = top.map(([t]) => t);
    const values = top.map(([, v]) =>
      v.attempts > 0 ? Math.round((v.correct / v.attempts) * 100) : 0,
    );
    const canvas = this.canvasIn(parent, "Per-topic accuracy (%)");
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Accuracy %",
            data: values,
            backgroundColor: "rgba(96, 165, 250, 0.75)",
            borderColor: "rgb(59, 130, 246)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    });
    this.charts.push(ch);
  }

  private renderAccuracyOverTime(
    parent: HTMLElement,
    attempts: Attempt[],
  ): void {
    const days = lastNDays(this.range);
    const byDay = bucketByDay(attempts, days);
    if (days.every((d) => byDay[d].total === 0)) {
      this.placeholder(
        parent,
        "Accuracy over time",
        "Need attempts in the selected range.",
      );
      return;
    }
    const canvas = this.canvasIn(parent, "Accuracy over time (%)");
    const ch = new Chart(canvas, {
      type: "line",
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            label: "Accuracy %",
            data: days.map((d) =>
              byDay[d].total > 0
                ? Math.round((byDay[d].ok / byDay[d].total) * 100)
                : null,
            ),
            borderColor: "rgb(96, 165, 250)",
            backgroundColor: "rgba(96, 165, 250, 0.2)",
            tension: 0.25,
            fill: true,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    });
    this.charts.push(ch);
  }

  private renderAttemptsPerDay(
    parent: HTMLElement,
    attempts: Attempt[],
  ): void {
    const days = lastNDays(this.range);
    const byDay = bucketByDay(attempts, days);
    if (days.every((d) => byDay[d].total === 0)) {
      this.placeholder(
        parent,
        "Attempts per day",
        "No attempts in the selected range.",
      );
      return;
    }
    const canvas = this.canvasIn(parent, "Attempts per day");
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            label: "Correct",
            data: days.map((d) => byDay[d].ok),
            backgroundColor: "rgba(34, 197, 94, 0.75)",
            stack: "a",
          },
          {
            label: "Wrong",
            data: days.map((d) => byDay[d].total - byDay[d].ok),
            backgroundColor: "rgba(244, 63, 94, 0.75)",
            stack: "a",
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
    this.charts.push(ch);
  }

  private renderStudyMinutes(parent: HTMLElement, data: Stats): void {
    const days = lastNDays(this.range);
    if (days.every((d) => (data.studyMinutesByDay[d] ?? 0) === 0)) {
      this.placeholder(parent, "Study minutes per day", "No sessions yet.");
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
            data: days.map((d) => Math.round(data.studyMinutesByDay[d] ?? 0)),
            backgroundColor: "rgba(244, 114, 182, 0.75)",
            borderColor: "rgb(236, 72, 153)",
            borderWidth: 1,
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

  private renderDifficultyBreakdown(
    parent: HTMLElement,
    attempts: Attempt[],
  ): void {
    const labels = ["easy", "medium", "hard"] as const;
    const totals = labels.map((l) => attempts.filter((a) => a.difficulty === l));
    if (totals.every((t) => t.length === 0)) {
      this.placeholder(parent, "Accuracy by difficulty", "No attempts logged.");
      return;
    }
    const canvas = this.canvasIn(parent, "Accuracy by difficulty (%)");
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels.map((l) => l[0].toUpperCase() + l.slice(1)),
        datasets: [
          {
            label: "Accuracy %",
            data: totals.map((t) =>
              t.length === 0
                ? 0
                : Math.round(
                    (t.filter((a) => a.correct).length / t.length) * 100,
                  ),
            ),
            backgroundColor: [
              "rgba(34, 197, 94, 0.75)",
              "rgba(251, 191, 36, 0.75)",
              "rgba(244, 63, 94, 0.75)",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    });
    this.charts.push(ch);
  }

  private renderTimeOfDay(parent: HTMLElement, attempts: Attempt[]): void {
    const counts = new Array(24).fill(0);
    for (const a of attempts) {
      const h = parseInt(a.at.slice(11, 13), 10);
      if (Number.isFinite(h)) counts[h]++;
    }
    if (counts.every((c) => c === 0)) {
      this.placeholder(parent, "Time-of-day pattern", "No attempts logged.");
      return;
    }
    const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
    const canvas = this.canvasIn(parent, "Attempts by hour");
    const ch = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Attempts",
            data: counts,
            backgroundColor: "rgba(168, 85, 247, 0.75)",
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

  private renderRecentSessions(parent: HTMLElement, attempts: Attempt[]): void {
    const wrap = parent.createDiv({ cls: "smart-quiz-recent" });
    wrap.createEl("h3", { text: "Recent quiz sessions" });
    const sessions = groupSessions(attempts).slice(0, 25);
    if (sessions.length === 0) {
      wrap.createDiv({
        cls: "smart-study-empty",
        text: "Take a quiz to populate this list.",
      });
      return;
    }
    const tbl = wrap.createEl("table", { cls: "smart-quiz-recent-table" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of ["When", "Quiz", "Score", "Questions", "Avg time"]) {
      head.createEl("th", { text: h });
    }
    const body = tbl.createEl("tbody");
    for (const s of sessions) {
      const row = body.createEl("tr");
      row.createEl("td", { text: prettyTimestamp(s.at) });
      row.createEl("td", { text: s.quizSlug });
      const pct = s.total === 0 ? 0 : Math.round((s.ok / s.total) * 100);
      const score = row.createEl("td");
      score.setText(`${s.ok}/${s.total} (${pct}%)`);
      score.addClass(
        pct >= 80
          ? "smart-quiz-tag-ok"
          : pct >= 50
            ? "smart-quiz-tag-mid"
            : "smart-quiz-tag-bad",
      );
      row.createEl("td", { text: String(s.total) });
      row.createEl("td", { text: formatMs(s.avgMs) });
    }
  }

  private canvasIn(parent: HTMLElement, title: string): HTMLCanvasElement {
    const wrap = parent.createDiv({ cls: "smart-quiz-stats-card" });
    wrap.createDiv({ cls: "smart-study-section-title", text: title });
    const canvas = wrap.createEl("canvas");
    canvas.height = 220;
    return canvas;
  }

  private placeholder(parent: HTMLElement, title: string, text: string): void {
    const wrap = parent.createDiv({ cls: "smart-quiz-stats-card" });
    wrap.createDiv({ cls: "smart-study-section-title", text: title });
    wrap.createDiv({ cls: "smart-study-empty", text });
  }
}

interface SessionRow {
  at: string;
  quizSlug: string;
  ok: number;
  total: number;
  avgMs: number;
}

function groupSessions(attempts: Attempt[]): SessionRow[] {
  const map = new Map<string, SessionRow>();
  for (const a of attempts) {
    const key = `${a.quizSlug}::${a.at}`;
    const row = map.get(key) ?? {
      at: a.at,
      quizSlug: a.quizSlug,
      ok: 0,
      total: 0,
      avgMs: 0,
    };
    row.total++;
    if (a.correct) row.ok++;
    row.avgMs = ((row.avgMs * (row.total - 1)) + a.ms) / row.total;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
}

function bucketByDay(
  attempts: Attempt[],
  days: string[],
): Record<string, { ok: number; total: number }> {
  const acc: Record<string, { ok: number; total: number }> = {};
  for (const d of days) acc[d] = { ok: 0, total: 0 };
  for (const a of attempts) {
    const d = a.at.slice(0, 10);
    if (!acc[d]) continue;
    acc[d].total++;
    if (a.correct) acc[d].ok++;
  }
  return acc;
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
  return day.slice(5);
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 100) / 10;
  return `${s.toFixed(1)}s`;
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
