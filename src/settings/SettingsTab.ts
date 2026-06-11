import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SmartStudyPlugin from "../main";

export type AIProviderId = "anthropic" | "openai" | "openrouter" | "codex-cli";

export interface SmartStudySettings {
  uvPath: string;
  jupyterIdleTimeoutMinutes: number;
  features: {
    notebook: boolean;
    htmlViewer: boolean;
    pdfViewer: boolean;
    quiz: boolean;
    venvInspector: boolean;
    pomodoro: boolean;
    htmlAssetLinker: boolean;
    youtubeEmbed: boolean;
  };
  ai: {
    provider: AIProviderId;
    anthropicModel: string;
    openaiModel: string;
    openrouterModel: string;
    codexCliPath: string;
    keys: {
      anthropic: string;
      openai: string;
      openrouter: string;
    };
  };
  quiz: {
    dataFolder: string;
    repeatWindowDays: number;
    repeatBatchSize: number;
  };
  html: {
    disableScripts: boolean;
  };
  youtube: {
    privacyMode: boolean;
  };
  pomodoro: {
    workMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    sessionsUntilLongBreak: number;
    autoStartOnQuiz: boolean;
    autoStartBreaks: boolean;
    notify: boolean;
    soundEnabled: boolean;
    dataFolder: string;
  };
}

export const DEFAULT_SETTINGS: SmartStudySettings = {
  uvPath: "uv",
  jupyterIdleTimeoutMinutes: 10,
  features: {
    notebook: true,
    htmlViewer: true,
    pdfViewer: true,
    quiz: true,
    venvInspector: true,
    pomodoro: true,
    htmlAssetLinker: true,
    youtubeEmbed: true,
  },
  ai: {
    provider: "anthropic",
    anthropicModel: "claude-sonnet-4-6",
    openaiModel: "gpt-4o",
    openrouterModel: "anthropic/claude-sonnet-4.6",
    codexCliPath: "codex",
    keys: {
      anthropic: "",
      openai: "",
      openrouter: "",
    },
  },
  quiz: {
    dataFolder: "_study-data",
    repeatWindowDays: 30,
    repeatBatchSize: 3,
  },
  html: {
    disableScripts: false,
  },
  youtube: {
    privacyMode: true,
  },
  pomodoro: {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    sessionsUntilLongBreak: 4,
    autoStartOnQuiz: true,
    autoStartBreaks: false,
    notify: true,
    soundEnabled: true,
    dataFolder: "_study-data/pomodoro",
  },
};

export class SmartStudySettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SmartStudyPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Smart Study" });

    const s = this.plugin.settings;

    containerEl.createEl("h3", { text: "Environment" });

    new Setting(containerEl)
      .setName("uv path")
      .setDesc(
        "Path to the `uv` binary. Default: `uv` — searches PATH plus ~/.local/bin, ~/.cargo/bin, /opt/homebrew/bin, /usr/local/bin. Set an absolute path if your install lives elsewhere.",
      )
      .addText((t) =>
        t
          .setPlaceholder("uv")
          .setValue(s.uvPath)
          .onChange(async (v) => {
            s.uvPath = v || "uv";
            await this.plugin.saveSettings();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Probe").onClick(async () => {
          const r = await this.plugin.venvService.checkUvAvailable();
          if (r.ok) {
            const resolved = await this.plugin.venvService.resolveUv();
            new Notice(`uv ${r.version} (${resolved})`, 6000);
          } else {
            new Notice(`uv not found: ${r.error}`, 10000);
          }
        }),
      );

    new Setting(containerEl)
      .setName("Jupyter idle timeout (minutes)")
      .setDesc("Shut down the per-venv Jupyter server after this idle period.")
      .addText((t) =>
        t.setValue(String(s.jupyterIdleTimeoutMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.jupyterIdleTimeoutMinutes = Number.isFinite(n) && n > 0 ? n : 10;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "Features" });

    for (const [key, label] of [
      ["notebook", "Jupyter notebook viewer (.ipynb)"],
      ["htmlViewer", "HTML lesson viewer (.html, .htm)"],
      ["pdfViewer", "PDF viewer (.pdf) — bypasses broken core viewer"],
      ["quiz", "AI quiz agent"],
      ["venvInspector", "Venv inspector"],
      ["pomodoro", "Pomodoro timer & study stats"],
      ["htmlAssetLinker", "Auto-link HTML assets in graph"],
      ["youtubeEmbed", "Embed YouTube videos from pasted links"],
    ] as const) {
      new Setting(containerEl).setName(label).addToggle((t) =>
        t
          .setValue(s.features[key as keyof typeof s.features])
          .onChange(async (v) => {
            (s.features as Record<string, boolean>)[key] = v;
            await this.plugin.saveSettings();
            new Notice("Reload Obsidian to apply feature toggle changes.");
          }),
      );
    }

    containerEl.createEl("h3", { text: "AI provider" });

    new Setting(containerEl)
      .setName("Active provider")
      .setDesc("Which provider the quiz agent uses by default.")
      .addDropdown((d) =>
        d
          .addOption("anthropic", "Anthropic (Claude)")
          .addOption("openrouter", "OpenRouter")
          .addOption("openai", "OpenAI")
          .addOption("codex-cli", "Codex CLI (experimental)")
          .setValue(s.ai.provider)
          .onChange(async (v) => {
            s.ai.provider = v as AIProviderId;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Anthropic model").addText((t) =>
      t.setValue(s.ai.anthropicModel).onChange(async (v) => {
        s.ai.anthropicModel = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("OpenRouter model").addText((t) =>
      t.setValue(s.ai.openrouterModel).onChange(async (v) => {
        s.ai.openrouterModel = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("OpenAI model").addText((t) =>
      t.setValue(s.ai.openaiModel).onChange(async (v) => {
        s.ai.openaiModel = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName("Codex CLI path")
      .setDesc("Local Codex CLI binary path. Used when provider is Codex CLI.")
      .addText((t) =>
        t.setValue(s.ai.codexCliPath).onChange(async (v) => {
          s.ai.codexCliPath = v || "codex";
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "API keys" });
    containerEl.createEl("p", {
      text: "Stored in plain text under .obsidian/plugins/smart-study/data.json. Exclude .obsidian from cloud sync, or set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY env vars before launching Obsidian (env vars take precedence).",
      cls: "setting-item-description",
    });

    for (const [key, label] of [
      ["anthropic", "Anthropic API key"],
      ["openrouter", "OpenRouter API key"],
      ["openai", "OpenAI API key"],
    ] as const) {
      new Setting(containerEl).setName(label).addText((t) => {
        t.setValue(s.ai.keys[key as keyof typeof s.ai.keys]).onChange(
          async (v) => {
            (s.ai.keys as Record<string, string>)[key] = v;
            await this.plugin.saveSettings();
          },
        );
        t.inputEl.type = "password";
        return t;
      });
    }

    containerEl.createEl("h3", { text: "Quiz" });

    new Setting(containerEl)
      .setName("Data folder")
      .setDesc("Vault-relative folder for quiz JSON and attempt logs.")
      .addText((t) =>
        t.setValue(s.quiz.dataFolder).onChange(async (v) => {
          s.quiz.dataFolder = v || "_study-data";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Repeat window (days)")
      .setDesc(
        "Re-include wrong answers from the last N days when generating quizzes.",
      )
      .addText((t) =>
        t.setValue(String(s.quiz.repeatWindowDays)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.quiz.repeatWindowDays = Number.isFinite(n) && n > 0 ? n : 30;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Repeat batch size")
      .setDesc("Max wrong-answered questions to re-inject per quiz.")
      .addText((t) =>
        t.setValue(String(s.quiz.repeatBatchSize)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.quiz.repeatBatchSize = Number.isFinite(n) && n >= 0 ? n : 3;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "Pomodoro" });

    new Setting(containerEl)
      .setName("Work duration (minutes)")
      .setDesc("Length of a single focused work session.")
      .addText((t) =>
        t.setValue(String(s.pomodoro.workMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.pomodoro.workMinutes = Number.isFinite(n) && n > 0 ? n : 25;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Short break (minutes)")
      .addText((t) =>
        t.setValue(String(s.pomodoro.shortBreakMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.pomodoro.shortBreakMinutes = Number.isFinite(n) && n > 0 ? n : 5;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Long break (minutes)")
      .addText((t) =>
        t.setValue(String(s.pomodoro.longBreakMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.pomodoro.longBreakMinutes = Number.isFinite(n) && n > 0 ? n : 15;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sessions until long break")
      .setDesc("After how many work sessions a long break is offered.")
      .addText((t) =>
        t.setValue(String(s.pomodoro.sessionsUntilLongBreak)).onChange(async (v) => {
          const n = parseInt(v, 10);
          s.pomodoro.sessionsUntilLongBreak = Number.isFinite(n) && n > 0 ? n : 4;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-start when a quiz begins")
      .setDesc("Start a work session automatically when you open a quiz.")
      .addToggle((t) =>
        t.setValue(s.pomodoro.autoStartOnQuiz).onChange(async (v) => {
          s.pomodoro.autoStartOnQuiz = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-start breaks")
      .setDesc("After a work session ends, start the break automatically.")
      .addToggle((t) =>
        t.setValue(s.pomodoro.autoStartBreaks).onChange(async (v) => {
          s.pomodoro.autoStartBreaks = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Notifications")
      .setDesc("Show a notice when a session finishes.")
      .addToggle((t) =>
        t.setValue(s.pomodoro.notify).onChange(async (v) => {
          s.pomodoro.notify = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sound")
      .setDesc("Play a short tone when a session finishes.")
      .addToggle((t) =>
        t.setValue(s.pomodoro.soundEnabled).onChange(async (v) => {
          s.pomodoro.soundEnabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Data folder")
      .setDesc("Vault-relative folder for pomodoro stats and session logs.")
      .addText((t) =>
        t.setValue(s.pomodoro.dataFolder).onChange(async (v) => {
          s.pomodoro.dataFolder = v || "_study-data/pomodoro";
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "HTML" });

    new Setting(containerEl)
      .setName("Disable scripts in HTML views")
      .setDesc(
        "Off by default so Notion / interactive lecture pages render. Turn on if you want to sandbox untrusted HTML.",
      )
      .addToggle((t) =>
        t.setValue(s.html.disableScripts).onChange(async (v) => {
          s.html.disableScripts = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "YouTube" });

    new Setting(containerEl)
      .setName("Privacy-enhanced mode")
      .setDesc(
        "Embed via youtube-nocookie.com instead of youtube.com. Recommended.",
      )
      .addToggle((t) =>
        t.setValue(s.youtube.privacyMode).onChange(async (v) => {
          s.youtube.privacyMode = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
