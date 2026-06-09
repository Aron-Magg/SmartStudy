import { z } from "zod";

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  difficulty: DifficultySchema,
  prompt: z.string(),
  options: z.array(z.string()).min(2).max(6),
  correctIndex: z.number().int().min(0),
  explanation: z.string(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuizSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z.string(),
  title: z.string(),
  courseFolder: z.string(),
  createdAt: z.string(),
  questions: z.array(QuestionSchema).min(1),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const AttemptSchema = z.object({
  quizSlug: z.string(),
  questionId: z.string(),
  topic: z.string(),
  difficulty: DifficultySchema,
  selectedIndex: z.number().int(),
  correct: z.boolean(),
  ms: z.number().int().nonnegative(),
  providerUsed: z.string(),
  at: z.string(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const StatsSchema = z.object({
  schemaVersion: z.literal(1),
  totalAttempts: z.number().int().nonnegative(),
  totalCorrect: z.number().int().nonnegative(),
  perTopic: z.record(
    z.string(),
    z.object({
      attempts: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      lastAt: z.string().optional(),
    }),
  ),
  studyMinutesByDay: z.record(z.string(), z.number().nonnegative()),
  recentWrong: z.array(
    z.object({
      quizSlug: z.string(),
      questionId: z.string(),
      topic: z.string(),
      at: z.string(),
      repeatPriority: z.number().int(),
    }),
  ),
});
export type Stats = z.infer<typeof StatsSchema>;

export const PomodoroSessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationSeconds: z.number().nonnegative(),
  mode: z.enum(["work", "shortBreak", "longBreak"]),
  source: z.enum(["manual", "quiz"]).default("manual"),
  quizSlug: z.string().optional(),
  completed: z.boolean(),
  note: z.string().optional(),
});
export type PomodoroSession = z.infer<typeof PomodoroSessionSchema>;

export const PomodoroStatsSchema = z.object({
  schemaVersion: z.literal(1),
  totalWorkSeconds: z.number().nonnegative(),
  totalSessions: z.number().int().nonnegative(),
  completedSessions: z.number().int().nonnegative(),
  workSecondsByDay: z.record(z.string(), z.number().nonnegative()),
  sessionsByDay: z.record(z.string(), z.number().int().nonnegative()),
  recentSessions: z.array(PomodoroSessionSchema),
});
export type PomodoroStats = z.infer<typeof PomodoroStatsSchema>;

export const QuizGenerationSchema = z.object({
  questions: z
    .array(
      z.object({
        topic: z.string(),
        difficulty: DifficultySchema,
        prompt: z.string(),
        options: z.array(z.string()).min(2).max(6),
        correctIndex: z.number().int().min(0),
        explanation: z.string(),
      }),
    )
    .min(1),
});
export type QuizGeneration = z.infer<typeof QuizGenerationSchema>;
