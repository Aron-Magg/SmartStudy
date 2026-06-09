import { App, Events, normalizePath, Notice } from "obsidian";
import {
  PomodoroSession,
  PomodoroSessionSchema,
  PomodoroStats,
  PomodoroStatsSchema,
} from "../lib/schemas";
import type { SmartStudySettings } from "../settings/SettingsTab";

export type PomodoroMode = "work" | "shortBreak" | "longBreak";
export type PomodoroStatus = "idle" | "running" | "paused";
export type PomodoroSource = "manual" | "quiz";

export interface PomodoroState {
  status: PomodoroStatus;
  mode: PomodoroMode;
  remainingMs: number;
  totalMs: number;
  elapsedWorkSecondsInCurrent: number;
  workSessionsCompleted: number;
  source: PomodoroSource;
  quizSlug?: string;
}

const EMPTY_STATS: PomodoroStats = {
  schemaVersion: 1,
  totalWorkSeconds: 0,
  totalSessions: 0,
  completedSessions: 0,
  workSecondsByDay: {},
  sessionsByDay: {},
  recentSessions: [],
};

const TICK_MS = 250;
const RECENT_LIMIT = 200;

export class PomodoroService extends Events {
  private state: PomodoroState;
  private interval: number | null = null;
  private currentSessionStart = 0;
  private currentSessionElapsedAtPause = 0;
  private lastTickTs = 0;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SmartStudySettings,
  ) {
    super();
    this.state = this.buildInitialState();
  }

  getState(): PomodoroState {
    return { ...this.state };
  }

  private buildInitialState(mode: PomodoroMode = "work"): PomodoroState {
    const total = this.modeDurationMs(mode);
    return {
      status: "idle",
      mode,
      remainingMs: total,
      totalMs: total,
      elapsedWorkSecondsInCurrent: 0,
      workSessionsCompleted: 0,
      source: "manual",
    };
  }

  private modeDurationMs(mode: PomodoroMode): number {
    const p = this.getSettings().pomodoro;
    const minutes =
      mode === "work"
        ? p.workMinutes
        : mode === "shortBreak"
          ? p.shortBreakMinutes
          : p.longBreakMinutes;
    return Math.max(1, Math.round(minutes * 60_000));
  }

  /** Begin a new work session. If one is already running, no-op. */
  start(opts?: { source?: PomodoroSource; quizSlug?: string }): void {
    if (this.state.status === "running") return;
    if (this.state.status === "idle") {
      const mode: PomodoroMode = this.state.mode;
      const total = this.modeDurationMs(mode);
      this.state = {
        status: "running",
        mode,
        remainingMs: total,
        totalMs: total,
        elapsedWorkSecondsInCurrent: 0,
        workSessionsCompleted: this.state.workSessionsCompleted,
        source: opts?.source ?? "manual",
        quizSlug: opts?.quizSlug,
      };
      this.currentSessionStart = Date.now();
      this.currentSessionElapsedAtPause = 0;
    } else {
      // resume from paused
      this.state.status = "running";
      this.state.source = opts?.source ?? this.state.source;
      if (opts?.quizSlug) this.state.quizSlug = opts.quizSlug;
    }
    this.lastTickTs = Date.now();
    this.ensureInterval();
    this.emitChange();
  }

  pause(): void {
    if (this.state.status !== "running") return;
    this.tick();
    this.state.status = "paused";
    this.currentSessionElapsedAtPause = this.state.elapsedWorkSecondsInCurrent;
    this.clearInterval();
    this.emitChange();
  }

  /** Stop the session — saves whatever work-time accumulated and resets. */
  async stop(opts?: { reason?: "manual" | "quizEnded" }): Promise<void> {
    if (this.state.status === "idle") return;
    if (this.state.status === "running") this.tick();
    const wasMode = this.state.mode;
    const elapsedSec =
      wasMode === "work" ? Math.round(this.state.elapsedWorkSecondsInCurrent) : 0;
    if (wasMode === "work" && elapsedSec > 0) {
      await this.persistSession({
        mode: "work",
        startedAt: new Date(this.currentSessionStart).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: elapsedSec,
        completed: false,
        source: this.state.source,
        quizSlug: this.state.quizSlug,
        note: opts?.reason === "quizEnded" ? "stopped on quiz end" : undefined,
      });
    }
    this.clearInterval();
    this.state = this.buildInitialState("work");
    this.emitChange();
  }

  /** Skip current segment (no save). */
  skip(): void {
    this.clearInterval();
    const next = this.nextModeAfter(this.state.mode);
    const total = this.modeDurationMs(next);
    this.state = {
      ...this.state,
      status: "idle",
      mode: next,
      remainingMs: total,
      totalMs: total,
      elapsedWorkSecondsInCurrent: 0,
      source: "manual",
      quizSlug: undefined,
    };
    this.emitChange();
  }

  setMode(mode: PomodoroMode): void {
    if (this.state.status !== "idle") return;
    const total = this.modeDurationMs(mode);
    this.state = {
      ...this.state,
      mode,
      remainingMs: total,
      totalMs: total,
      elapsedWorkSecondsInCurrent: 0,
    };
    this.emitChange();
  }

  /** Re-read durations from settings (used after user changes config). */
  refreshDurations(): void {
    if (this.state.status !== "idle") return;
    const total = this.modeDurationMs(this.state.mode);
    this.state.totalMs = total;
    this.state.remainingMs = total;
    this.emitChange();
  }

  private nextModeAfter(mode: PomodoroMode): PomodoroMode {
    if (mode !== "work") return "work";
    const p = this.getSettings().pomodoro;
    const completed = this.state.workSessionsCompleted;
    return completed > 0 && completed % p.sessionsUntilLongBreak === 0
      ? "longBreak"
      : "shortBreak";
  }

  private ensureInterval(): void {
    if (this.interval !== null) return;
    this.interval = window.setInterval(() => this.tick(), TICK_MS);
  }

  private clearInterval(): void {
    if (this.interval !== null) {
      window.clearInterval(this.interval);
      this.interval = null;
    }
  }

  private tick(): void {
    if (this.state.status !== "running") return;
    const now = Date.now();
    const delta = Math.max(0, now - this.lastTickTs);
    this.lastTickTs = now;
    if (this.state.mode === "work") {
      this.state.elapsedWorkSecondsInCurrent += delta / 1000;
    }
    this.state.remainingMs = Math.max(0, this.state.remainingMs - delta);
    if (this.state.remainingMs <= 0) {
      this.complete();
    } else {
      this.emitTick();
    }
  }

  private async complete(): Promise<void> {
    const finishedMode = this.state.mode;
    const finishedSource = this.state.source;
    const finishedQuiz = this.state.quizSlug;
    const total = this.state.totalMs;
    this.clearInterval();

    if (finishedMode === "work") {
      this.state.workSessionsCompleted++;
      await this.persistSession({
        mode: "work",
        startedAt: new Date(this.currentSessionStart).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: Math.round(total / 1000),
        completed: true,
        source: finishedSource,
        quizSlug: finishedQuiz,
      });
    }

    const settings = this.getSettings().pomodoro;
    if (settings.notify) {
      const msg =
        finishedMode === "work"
          ? "Pomodoro: work session complete — time for a break!"
          : "Pomodoro: break over — back to work!";
      new Notice(msg);
    }
    if (settings.soundEnabled) this.playDing();

    const next = this.nextModeAfter(finishedMode);
    const nextTotal = this.modeDurationMs(next);
    this.state = {
      status: "idle",
      mode: next,
      remainingMs: nextTotal,
      totalMs: nextTotal,
      elapsedWorkSecondsInCurrent: 0,
      workSessionsCompleted: this.state.workSessionsCompleted,
      source: "manual",
    };
    this.emitChange();

    const autoStartBreaks = settings.autoStartBreaks;
    if (autoStartBreaks && next !== "work") {
      this.start({ source: "manual" });
    }
  }

  private playDing(): void {
    try {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.65);
      osc.onended = () => ctx.close().catch(() => {});
    } catch {
      /* sound is best-effort */
    }
  }

  private emitChange(): void {
    this.trigger("change", this.getState());
    this.trigger("tick", this.getState());
  }

  private emitTick(): void {
    this.trigger("tick", this.getState());
  }

  // ------------- persistence -------------

  private statsPath(): string {
    return normalizePath(
      `${this.getSettings().pomodoro.dataFolder}/pomodoro-stats.json`,
    );
  }

  private sessionsFolder(): string {
    return normalizePath(`${this.getSettings().pomodoro.dataFolder}/sessions`);
  }

  private async ensureFolders(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const folder = this.getSettings().pomodoro.dataFolder;
    for (const f of [folder, this.sessionsFolder()]) {
      const n = normalizePath(f);
      if (!(await adapter.exists(n))) {
        // mkdir is recursive-safe in obsidian's adapter
        try {
          await adapter.mkdir(n);
        } catch {
          /* parent may already exist; ignore */
        }
      }
    }
  }

  async loadStats(): Promise<PomodoroStats> {
    await this.ensureFolders();
    const adapter = this.app.vault.adapter;
    const path = this.statsPath();
    if (!(await adapter.exists(path))) return { ...EMPTY_STATS };
    try {
      const raw = await adapter.read(path);
      const parsed = PomodoroStatsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      return { ...EMPTY_STATS };
    } catch {
      return { ...EMPTY_STATS };
    }
  }

  private async saveStats(stats: PomodoroStats): Promise<void> {
    await this.ensureFolders();
    await this.app.vault.adapter.write(
      this.statsPath(),
      JSON.stringify(stats, null, 2),
    );
  }

  private async appendSessionLog(session: PomodoroSession): Promise<void> {
    await this.ensureFolders();
    const day = session.startedAt.slice(0, 10);
    const path = normalizePath(`${this.sessionsFolder()}/${day}.jsonl`);
    const line = JSON.stringify(session) + "\n";
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) {
      const prev = await adapter.read(path);
      await adapter.write(path, prev + line);
    } else {
      await adapter.write(path, line);
    }
  }

  private async persistSession(
    partial: Omit<PomodoroSession, "id">,
  ): Promise<void> {
    const session: PomodoroSession = PomodoroSessionSchema.parse({
      id: `pmd-${Date.now()}-${Math.floor(performance.now()) % 100000}`,
      ...partial,
    });
    await this.appendSessionLog(session);

    const stats = await this.loadStats();
    const day = session.startedAt.slice(0, 10);
    stats.totalSessions++;
    if (session.completed) stats.completedSessions++;
    if (session.mode === "work") {
      stats.totalWorkSeconds += session.durationSeconds;
      stats.workSecondsByDay[day] =
        (stats.workSecondsByDay[day] ?? 0) + session.durationSeconds;
      stats.sessionsByDay[day] = (stats.sessionsByDay[day] ?? 0) + 1;
    }
    stats.recentSessions.unshift(session);
    stats.recentSessions = stats.recentSessions.slice(0, RECENT_LIMIT);
    await this.saveStats(stats);

    this.trigger("session-saved", session);
  }

  async updateSession(
    id: string,
    originalStartedAt: string,
    patch: { startedAt: string; endedAt: string; note?: string },
  ): Promise<PomodoroSession> {
    const newStart = new Date(patch.startedAt);
    const newEnd = new Date(patch.endedAt);
    if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) {
      throw new Error("Invalid date");
    }
    if (newEnd.getTime() <= newStart.getTime()) {
      throw new Error("End must be after start");
    }
    const newDuration = Math.round(
      (newEnd.getTime() - newStart.getTime()) / 1000,
    );

    const oldDay = originalStartedAt.slice(0, 10);
    const newDay = patch.startedAt.slice(0, 10);
    const adapter = this.app.vault.adapter;
    const oldPath = normalizePath(`${this.sessionsFolder()}/${oldDay}.jsonl`);

    if (!(await adapter.exists(oldPath))) {
      throw new Error(`Session log not found: ${oldPath}`);
    }
    const lines = (await adapter.read(oldPath)).split("\n").filter(Boolean);
    let original: PomodoroSession | null = null;
    const remaining: string[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.id === id) {
          original = PomodoroSessionSchema.parse(obj);
          continue;
        }
      } catch {
        /* keep malformed lines as-is */
      }
      remaining.push(line);
    }
    if (!original) throw new Error(`Session ${id} not found in ${oldPath}`);

    const updated: PomodoroSession = PomodoroSessionSchema.parse({
      ...original,
      startedAt: patch.startedAt,
      endedAt: patch.endedAt,
      durationSeconds: newDuration,
      note: patch.note ?? original.note,
    });

    if (oldDay === newDay) {
      remaining.push(JSON.stringify(updated));
      await adapter.write(
        oldPath,
        remaining.length ? remaining.join("\n") + "\n" : "",
      );
    } else {
      await adapter.write(
        oldPath,
        remaining.length ? remaining.join("\n") + "\n" : "",
      );
      const newPath = normalizePath(`${this.sessionsFolder()}/${newDay}.jsonl`);
      const newLine = JSON.stringify(updated) + "\n";
      if (await adapter.exists(newPath)) {
        const prev = await adapter.read(newPath);
        await adapter.write(newPath, prev + newLine);
      } else {
        await adapter.write(newPath, newLine);
      }
    }

    const stats = await this.loadStats();
    if (original.mode === "work") {
      stats.totalWorkSeconds += newDuration - original.durationSeconds;
      stats.workSecondsByDay[oldDay] = Math.max(
        0,
        (stats.workSecondsByDay[oldDay] ?? 0) - original.durationSeconds,
      );
      stats.workSecondsByDay[newDay] =
        (stats.workSecondsByDay[newDay] ?? 0) + newDuration;
      if (oldDay !== newDay) {
        stats.sessionsByDay[oldDay] = Math.max(
          0,
          (stats.sessionsByDay[oldDay] ?? 0) - 1,
        );
        stats.sessionsByDay[newDay] = (stats.sessionsByDay[newDay] ?? 0) + 1;
      }
    }
    stats.recentSessions = stats.recentSessions.filter((s) => s.id !== id);
    stats.recentSessions.unshift(updated);
    stats.recentSessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    stats.recentSessions = stats.recentSessions.slice(0, RECENT_LIMIT);
    await this.saveStats(stats);

    this.trigger("session-saved", updated);
    return updated;
  }

  // ------------- typed event helpers -------------

  onChange(handler: (state: PomodoroState) => void): () => void {
    const ref = this.on("change", handler as (...args: unknown[]) => void);
    return () => this.offref(ref);
  }

  onTick(handler: (state: PomodoroState) => void): () => void {
    const ref = this.on("tick", handler as (...args: unknown[]) => void);
    return () => this.offref(ref);
  }

  onSessionSaved(handler: (s: PomodoroSession) => void): () => void {
    const ref = this.on(
      "session-saved",
      handler as (...args: unknown[]) => void,
    );
    return () => this.offref(ref);
  }

  dispose(): void {
    this.clearInterval();
  }
}

export function formatHMS(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatHoursFromSeconds(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  const m = seconds / 60;
  return `${Math.round(m)}m`;
}
