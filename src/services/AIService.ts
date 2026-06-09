import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { QuizGenerationSchema, type QuizGeneration } from "../lib/schemas";
import type { AIProviderId, SmartStudySettings } from "../settings/SettingsTab";

export interface GenerateQuizInput {
  examDescription: string;
  total: number;
  difficultyMix: { easy: number; medium: number; hard: number };
  topicsHint?: string[];
  contextText?: string;
  language?: string;
}

export interface ProviderInfo {
  id: AIProviderId;
  label: string;
  available: boolean;
  reason?: string;
}

export class AIService {
  constructor(private readonly settings: SmartStudySettings) {}

  describe(): ProviderInfo[] {
    return [
      this.providerInfo("anthropic"),
      this.providerInfo("openrouter"),
      this.providerInfo("openai"),
      this.providerInfo("codex-cli"),
    ];
  }

  currentProvider(): AIProviderId {
    return this.settings.ai.provider;
  }

  async generateQuiz(input: GenerateQuizInput): Promise<QuizGeneration> {
    const providerId = this.settings.ai.provider;
    const { systemPrompt, userPrompt } = buildPrompts(input);

    if (providerId === "codex-cli") {
      throw new Error(
        "Codex CLI provider is not yet implemented. Switch to Anthropic, OpenRouter, or OpenAI in settings.",
      );
    }

    const model = this.resolveModel(providerId);
    const { object } = await generateObject({
      model,
      schema: QuizGenerationSchema as unknown as z.ZodType<QuizGeneration>,
      system: systemPrompt,
      prompt: userPrompt,
    });
    return object;
  }

  private resolveModel(providerId: AIProviderId) {
    if (providerId === "anthropic") {
      const apiKey = readEnvOrSetting("ANTHROPIC_API_KEY", this.settings.ai.keys.anthropic);
      if (!apiKey) throw new Error("Set the Anthropic API key in settings (or ANTHROPIC_API_KEY).");
      const anthropic = createAnthropic({ apiKey });
      return anthropic(this.settings.ai.anthropicModel);
    }
    if (providerId === "openai") {
      const apiKey = readEnvOrSetting("OPENAI_API_KEY", this.settings.ai.keys.openai);
      if (!apiKey) throw new Error("Set the OpenAI API key in settings (or OPENAI_API_KEY).");
      const openai = createOpenAI({ apiKey });
      return openai(this.settings.ai.openaiModel);
    }
    if (providerId === "openrouter") {
      const apiKey = readEnvOrSetting("OPENROUTER_API_KEY", this.settings.ai.keys.openrouter);
      if (!apiKey) throw new Error("Set the OpenRouter API key in settings (or OPENROUTER_API_KEY).");
      const openrouter = createOpenRouter({ apiKey });
      return openrouter(this.settings.ai.openrouterModel);
    }
    throw new Error(`Unsupported provider: ${providerId}`);
  }

  private providerInfo(id: AIProviderId): ProviderInfo {
    if (id === "anthropic") {
      const ok = !!readEnvOrSetting("ANTHROPIC_API_KEY", this.settings.ai.keys.anthropic);
      return {
        id,
        label: `Anthropic — ${this.settings.ai.anthropicModel}`,
        available: ok,
        reason: ok ? undefined : "No API key",
      };
    }
    if (id === "openrouter") {
      const ok = !!readEnvOrSetting("OPENROUTER_API_KEY", this.settings.ai.keys.openrouter);
      return {
        id,
        label: `OpenRouter — ${this.settings.ai.openrouterModel}`,
        available: ok,
        reason: ok ? undefined : "No API key",
      };
    }
    if (id === "openai") {
      const ok = !!readEnvOrSetting("OPENAI_API_KEY", this.settings.ai.keys.openai);
      return {
        id,
        label: `OpenAI — ${this.settings.ai.openaiModel}`,
        available: ok,
        reason: ok ? undefined : "No API key",
      };
    }
    return {
      id,
      label: `Codex CLI (${this.settings.ai.codexCliPath})`,
      available: false,
      reason: "Provider not yet implemented",
    };
  }
}

function readEnvOrSetting(envName: string, settingValue: string): string {
  const env = (typeof process !== "undefined" ? process.env?.[envName] : undefined) ?? "";
  if (env) return env;
  return settingValue ?? "";
}

function buildPrompts(input: GenerateQuizInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const language = input.language ?? "English";
  const systemPrompt = [
    `You are an expert tutor that writes high-quality multiple-choice exam questions.`,
    `Write everything in ${language}.`,
    `Each question must have exactly one correct answer and 3–4 plausible distractors.`,
    `Vary difficulty per the requested mix. Make difficult questions require multi-step reasoning, not trivia.`,
    `Each question must include a concise but informative explanation of the correct answer.`,
    `Tag each question with a short topic label (lowercase kebab-case if possible).`,
    `Never leak the correct answer inside the question prompt or distractors.`,
  ].join(" ");

  const mix = input.difficultyMix;
  const userPrompt = [
    `Exam description:\n${input.examDescription}`,
    "",
    `Generate ${input.total} questions with difficulty mix: ${mix.easy} easy, ${mix.medium} medium, ${mix.hard} hard.`,
    input.topicsHint?.length
      ? `Prioritise these topics if relevant: ${input.topicsHint.join(", ")}.`
      : "",
    input.contextText
      ? `Reference material (use it; do not contradict it):\n---\n${truncate(input.contextText, 20_000)}\n---`
      : "",
    `Return the questions in the structured output schema.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { systemPrompt, userPrompt };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}
