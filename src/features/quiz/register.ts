import { Notice, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { AIService } from "../../services/AIService";
import { StatsService } from "../../services/StatsService";
import { VaultContextProvider } from "../../services/VaultContextProvider";
import { QuizGeneratorModal } from "./QuizGeneratorModal";
import {
  QUIZ_SESSION_VIEW_TYPE,
  QuizSessionView,
} from "./QuizSessionView";
import {
  STATS_VIEW_TYPE,
  StatsDashboardView,
} from "./StatsDashboardView";
import {
  QUIZ_LIBRARY_VIEW_TYPE,
  QuizLibraryView,
} from "./QuizLibraryView";

export function registerQuizFeature(plugin: SmartStudyPlugin): void {
  const ai = new AIService(plugin.settings);
  const stats = new StatsService(
    plugin.app,
    () => plugin.settings.quiz.dataFolder,
  );
  const context = new VaultContextProvider(plugin.app, plugin.venvService);
  plugin.aiService = ai;
  plugin.statsService = stats;
  plugin.vaultContext = context;

  plugin.registerView(
    QUIZ_SESSION_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new QuizSessionView(leaf, plugin, stats),
  );
  plugin.registerView(
    STATS_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new StatsDashboardView(leaf, plugin, stats),
  );
  plugin.registerView(
    QUIZ_LIBRARY_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new QuizLibraryView(leaf, plugin, stats),
  );

  plugin.addRibbonIcon("graduation-cap", "Smart quiz", () =>
    openGenerator(plugin, ai, context, stats),
  );
  plugin.addRibbonIcon("library", "Quiz library", () => openLibrary(plugin));

  plugin.addCommand({
    id: "smart-quiz-generate",
    name: "Generate quiz",
    callback: () => openGenerator(plugin, ai, context, stats),
  });

  plugin.addCommand({
    id: "smart-quiz-open-library",
    name: "Open quiz library",
    callback: () => openLibrary(plugin),
  });

  plugin.addCommand({
    id: "smart-quiz-open-stats",
    name: "Open quiz stats dashboard",
    callback: () => openStats(plugin),
  });

  plugin.addCommand({
    id: "smart-quiz-review-weak",
    name: "Review weak spots",
    callback: async () => {
      const data = await stats.loadStats();
      if (data.recentWrong.length === 0) {
        new Notice("No wrong answers in the queue.");
        return;
      }
      const topTopics = Object.entries(data.perTopic)
        .filter(([, v]) => v.attempts >= 3 && v.correct / v.attempts < 0.6)
        .map(([topic]) => topic);
      const description =
        topTopics.length > 0
          ? `Focus on weak topics: ${topTopics.join(", ")}.`
          : "Review the most recent wrong answers.";
      const modal = new QuizGeneratorModal(plugin.app, plugin, ai, context, async (quiz) => {
        await stats.saveQuiz(quiz);
        await openSession(plugin, quiz);
      }, { presetDescription: description });
      modal.open();
    },
  });
}

async function openGenerator(
  plugin: SmartStudyPlugin,
  ai: AIService,
  context: VaultContextProvider,
  stats: StatsService,
): Promise<void> {
  const modal = new QuizGeneratorModal(
    plugin.app,
    plugin,
    ai,
    context,
    async (quiz) => {
      await stats.saveQuiz(quiz);
      await openSession(plugin, quiz);
    },
  );
  modal.open();
}

async function openSession(plugin: SmartStudyPlugin, quiz: import("../../lib/schemas").Quiz): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(QUIZ_SESSION_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: QUIZ_SESSION_VIEW_TYPE, active: true });
  }
  workspace.revealLeaf(leaf);
  (leaf.view as QuizSessionView).setQuiz(quiz);
}

async function openStats(plugin: SmartStudyPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(STATS_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: STATS_VIEW_TYPE, active: true });
  }
  workspace.revealLeaf(leaf);
  await (leaf.view as StatsDashboardView).refresh();
}

async function openLibrary(plugin: SmartStudyPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(QUIZ_LIBRARY_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: QUIZ_LIBRARY_VIEW_TYPE, active: true });
  }
  workspace.revealLeaf(leaf);
  await (leaf.view as QuizLibraryView).refresh();
}
