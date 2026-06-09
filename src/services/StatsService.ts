import { App, normalizePath } from "obsidian";
import {
  Attempt,
  AttemptSchema,
  Quiz,
  QuizSchema,
  Stats,
  StatsSchema,
} from "../lib/schemas";

const EMPTY_STATS: Stats = {
  schemaVersion: 1,
  totalAttempts: 0,
  totalCorrect: 0,
  perTopic: {},
  studyMinutesByDay: {},
  recentWrong: [],
};

export class StatsService {
  constructor(
    private readonly app: App,
    private readonly getDataFolder: () => string,
  ) {}

  private statsPath(): string {
    return normalizePath(`${this.getDataFolder()}/stats.json`);
  }

  private attemptsFolder(): string {
    return normalizePath(`${this.getDataFolder()}/attempts`);
  }

  private quizzesFolder(): string {
    return normalizePath(`${this.getDataFolder()}/quizzes`);
  }

  async ensureFolders(): Promise<void> {
    const adapter = this.app.vault.adapter;
    for (const folder of [
      this.getDataFolder(),
      this.attemptsFolder(),
      this.quizzesFolder(),
    ]) {
      const normalized = normalizePath(folder);
      if (!(await adapter.exists(normalized))) {
        await adapter.mkdir(normalized);
      }
    }
  }

  async loadStats(): Promise<Stats> {
    await this.ensureFolders();
    const adapter = this.app.vault.adapter;
    const path = this.statsPath();
    if (!(await adapter.exists(path))) return { ...EMPTY_STATS };
    try {
      const raw = await adapter.read(path);
      const parsed = StatsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      return { ...EMPTY_STATS };
    } catch {
      return { ...EMPTY_STATS };
    }
  }

  async saveStats(stats: Stats): Promise<void> {
    await this.ensureFolders();
    await this.app.vault.adapter.write(
      this.statsPath(),
      JSON.stringify(stats, null, 2),
    );
  }

  async saveQuiz(quiz: Quiz): Promise<void> {
    await this.ensureFolders();
    const validated = QuizSchema.parse(quiz);
    await this.app.vault.adapter.write(
      normalizePath(`${this.quizzesFolder()}/${quiz.slug}.json`),
      JSON.stringify(validated, null, 2),
    );
  }

  async loadQuiz(slug: string): Promise<Quiz | null> {
    const path = normalizePath(`${this.quizzesFolder()}/${slug}.json`);
    if (!(await this.app.vault.adapter.exists(path))) return null;
    try {
      const raw = await this.app.vault.adapter.read(path);
      return QuizSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async appendAttempt(attempt: Attempt): Promise<void> {
    await this.ensureFolders();
    const validated = AttemptSchema.parse(attempt);
    const day = validated.at.slice(0, 10);
    const path = normalizePath(`${this.attemptsFolder()}/${day}.jsonl`);
    const line = JSON.stringify(validated) + "\n";
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) {
      const prev = await adapter.read(path);
      await adapter.write(path, prev + line);
    } else {
      await adapter.write(path, line);
    }
  }

  async recordSession(
    quiz: Quiz,
    attempts: Attempt[],
    elapsedSeconds: number,
  ): Promise<Stats> {
    const stats = await this.loadStats();
    for (const a of attempts) {
      await this.appendAttempt(a);
      stats.totalAttempts++;
      if (a.correct) stats.totalCorrect++;
      const t = stats.perTopic[a.topic] ?? {
        attempts: 0,
        correct: 0,
      };
      t.attempts++;
      if (a.correct) t.correct++;
      t.lastAt = a.at;
      stats.perTopic[a.topic] = t;

      if (!a.correct) {
        stats.recentWrong.unshift({
          quizSlug: a.quizSlug,
          questionId: a.questionId,
          topic: a.topic,
          at: a.at,
          repeatPriority: 3,
        });
      } else {
        const idx = stats.recentWrong.findIndex(
          (w) => w.quizSlug === a.quizSlug && w.questionId === a.questionId,
        );
        if (idx !== -1) {
          stats.recentWrong[idx].repeatPriority = Math.max(
            0,
            stats.recentWrong[idx].repeatPriority - 1,
          );
          if (stats.recentWrong[idx].repeatPriority === 0) {
            stats.recentWrong.splice(idx, 1);
          }
        }
      }
    }
    stats.recentWrong = stats.recentWrong.slice(0, 200);

    const day = isoDay(attempts[0]?.at ?? new Date().toISOString());
    stats.studyMinutesByDay[day] =
      (stats.studyMinutesByDay[day] ?? 0) + elapsedSeconds / 60;

    await this.saveStats(stats);
    return stats;
  }

  async wrongToRepeat(
    course: string,
    windowDays: number,
    batchSize: number,
  ): Promise<Stats["recentWrong"]> {
    const stats = await this.loadStats();
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const eligible = stats.recentWrong.filter(
      (w) => new Date(w.at).getTime() >= cutoff && w.quizSlug.startsWith(slugify(course)),
    );
    eligible.sort((a, b) => b.repeatPriority - a.repeatPriority);
    return eligible.slice(0, batchSize);
  }

  async listQuizzesForCourse(course: string): Promise<string[]> {
    const folder = this.quizzesFolder();
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(folder))) return [];
    try {
      const list = await adapter.list(folder);
      const courseSlug = slugify(course);
      return list.files
        .map((f) => f.split("/").pop()?.replace(/\.json$/, "") ?? "")
        .filter((slug) => slug && slug.startsWith(courseSlug));
    } catch {
      return [];
    }
  }

  async listAllQuizzes(): Promise<Quiz[]> {
    const folder = this.quizzesFolder();
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(folder))) return [];
    const list = await adapter.list(folder);
    const out: Quiz[] = [];
    for (const file of list.files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await adapter.read(file);
        const parsed = QuizSchema.safeParse(JSON.parse(raw));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* ignore unparseable files */
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  async deleteQuiz(slug: string): Promise<void> {
    const path = normalizePath(`${this.quizzesFolder()}/${slug}.json`);
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) await adapter.remove(path);
  }

  async loadAllAttempts(): Promise<Attempt[]> {
    const folder = this.attemptsFolder();
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(folder))) return [];
    const list = await adapter.list(folder);
    const out: Attempt[] = [];
    for (const file of list.files.sort()) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const raw = await adapter.read(file);
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          const parsed = AttemptSchema.safeParse(JSON.parse(line));
          if (parsed.success) out.push(parsed.data);
        }
      } catch {
        /* ignore */
      }
    }
    return out;
  }
}

export interface QuizSummary {
  quiz: Quiz;
  attempts: number;
  sessions: number;
  bestPct: number | null;
  lastPct: number | null;
  lastAt: string | null;
}

export function summarizeQuiz(quiz: Quiz, attempts: Attempt[]): QuizSummary {
  const own = attempts.filter((a) => a.quizSlug === quiz.slug);
  if (own.length === 0) {
    return {
      quiz,
      attempts: 0,
      sessions: 0,
      bestPct: null,
      lastPct: null,
      lastAt: null,
    };
  }
  const bySession = new Map<string, { ok: number; total: number }>();
  for (const a of own) {
    const key = a.at;
    const entry = bySession.get(key) ?? { ok: 0, total: 0 };
    entry.total++;
    if (a.correct) entry.ok++;
    bySession.set(key, entry);
  }
  const sessions = [...bySession.entries()]
    .map(([at, v]) => ({ at, pct: v.total > 0 ? (v.ok / v.total) * 100 : 0 }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const bestPct = Math.max(...sessions.map((s) => s.pct));
  const last = sessions[sessions.length - 1];
  return {
    quiz,
    attempts: own.length,
    sessions: sessions.length,
    bestPct: Math.round(bestPct),
    lastPct: Math.round(last.pct),
    lastAt: last.at,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}
