import { WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { PomodoroService, formatHMS } from "../../services/PomodoroService";
import { POMODORO_VIEW_TYPE, PomodoroView } from "./PomodoroView";
import {
  POMODORO_STATS_VIEW_TYPE,
  PomodoroStatsView,
} from "./PomodoroStatsView";

export function registerPomodoroFeature(plugin: SmartStudyPlugin): void {
  const service = new PomodoroService(plugin.app, () => plugin.settings);
  plugin.pomodoroService = service;
  plugin.register(() => service.dispose());

  const openStats = () => openPomodoroStats(plugin);

  plugin.registerView(
    POMODORO_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new PomodoroView(leaf, plugin, service, openStats),
  );
  plugin.registerView(
    POMODORO_STATS_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new PomodoroStatsView(leaf, plugin, service),
  );

  plugin.addRibbonIcon("timer", "Open pomodoro", () =>
    openPomodoroTimer(plugin),
  );

  plugin.addCommand({
    id: "smart-pomodoro-open",
    name: "Open pomodoro timer",
    callback: () => void openPomodoroTimer(plugin),
  });

  plugin.addCommand({
    id: "smart-pomodoro-open-stats",
    name: "Open study stats dashboard",
    callback: () => void openPomodoroStats(plugin),
  });

  plugin.addCommand({
    id: "smart-pomodoro-start",
    name: "Start pomodoro",
    callback: () => service.start({ source: "manual" }),
  });

  plugin.addCommand({
    id: "smart-pomodoro-stop",
    name: "Stop pomodoro & save",
    callback: () => void service.stop({ reason: "manual" }),
  });

  plugin.addCommand({
    id: "smart-pomodoro-pause",
    name: "Pause / resume pomodoro",
    callback: () => {
      const st = service.getState();
      if (st.status === "running") service.pause();
      else service.start({ source: "manual" });
    },
  });

  // Status-bar widget keeps the timer visible everywhere.
  const statusItem = plugin.addStatusBarItem();
  statusItem.addClass("smart-pomodoro-statusbar");
  const updateStatus = (): void => {
    const st = service.getState();
    statusItem.removeClass("is-running", "is-paused");
    if (st.status === "running") statusItem.addClass("is-running");
    if (st.status === "paused") statusItem.addClass("is-paused");
    const icon = st.mode === "work" ? "▶" : "☕";
    statusItem.setText(
      st.status === "idle"
        ? `${icon} ${formatHMS(st.totalMs / 1000)}`
        : `${icon} ${formatHMS(st.remainingMs / 1000)}`,
    );
  };
  statusItem.onclick = () => void openPomodoroTimer(plugin);
  const unsubTick = service.onTick(updateStatus);
  plugin.register(unsubTick);
  updateStatus();
}

async function openPomodoroTimer(plugin: SmartStudyPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null =
    workspace.getLeavesOfType(POMODORO_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: POMODORO_VIEW_TYPE, active: true });
    }
  }
  if (leaf) workspace.revealLeaf(leaf);
}

async function openPomodoroStats(plugin: SmartStudyPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null =
    workspace.getLeavesOfType(POMODORO_STATS_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({
      type: POMODORO_STATS_VIEW_TYPE,
      active: true,
    });
  }
  workspace.revealLeaf(leaf);
  await (leaf.view as PomodoroStatsView).refresh();
}
