import type { AiOutputLanguage } from "@/types";

export const AI_OUTPUT_LANGUAGES: { id: AiOutputLanguage; label: string }[] = [
  { id: "de", label: "Deutsch" },
  { id: "en", label: "English" },
  { id: "no", label: "Norsk" },
];

export type AiActionLabels = {
  summarize: string;
  summarizing: string;
  aiReply: string;
  drafting: string;
  summarizeTitle: string;
  replyTitle: string;
};

const LABELS: Record<AiOutputLanguage, AiActionLabels> = {
  de: {
    summarize: "Zusammenfassen",
    summarizing: "Zusammenfassen…",
    aiReply: "KI-Antwort",
    drafting: "Entwurf…",
    summarizeTitle: "Thread mit KI zusammenfassen",
    replyTitle: "Antwort mit KI entwerfen",
  },
  en: {
    summarize: "Summarize",
    summarizing: "Summarizing…",
    aiReply: "AI Reply",
    drafting: "Drafting…",
    summarizeTitle: "Summarize this thread with AI",
    replyTitle: "Draft a reply with AI",
  },
  no: {
    summarize: "Oppsummer",
    summarizing: "Oppsummerer…",
    aiReply: "AI-svar",
    drafting: "Skriver utkast…",
    summarizeTitle: "Oppsummer tråden med AI",
    replyTitle: "Skriv svar med AI",
  },
};

export function getAiActionLabels(language: AiOutputLanguage): AiActionLabels {
  return LABELS[language] ?? LABELS.en;
}

export type AiPanelLabels = {
  title: string;
  thinking: string;
  summary: string;
  analyzing: string;
  thinkingStatus: string;
  writingStatus: string;
};

const PANEL_LABELS: Record<AiOutputLanguage, AiPanelLabels> = {
  de: {
    title: "KI-Zusammenfassung",
    thinking: "Denken",
    summary: "Zusammenfassung",
    analyzing: "Thread wird analysiert…",
    thinkingStatus: "Denkt nach…",
    writingStatus: "Schreibt…",
  },
  en: {
    title: "AI Summary",
    thinking: "Thinking",
    summary: "Summary",
    analyzing: "Analyzing thread…",
    thinkingStatus: "Thinking…",
    writingStatus: "Writing…",
  },
  no: {
    title: "AI-oppsummering",
    thinking: "Tenker",
    summary: "Oppsummering",
    analyzing: "Analyserer tråd…",
    thinkingStatus: "Tenker…",
    writingStatus: "Skriver…",
  },
};

export function getAiPanelLabels(language: AiOutputLanguage): AiPanelLabels {
  return PANEL_LABELS[language] ?? PANEL_LABELS.en;
}

export type AiThinkingLabels = {
  thinking: string;
};

const THINKING_LABELS: Record<AiOutputLanguage, AiThinkingLabels> = {
  de: { thinking: "Denken" },
  en: { thinking: "Thinking" },
  no: { thinking: "Tenker" },
};

export function getAiThinkingLabels(language: AiOutputLanguage): AiThinkingLabels {
  return THINKING_LABELS[language] ?? THINKING_LABELS.en;
}

export type ComposePolishLabels = {
  polish: string;
  polishing: string;
  polishTitle: string;
  polishHint: string;
  minDraftError: string;
};

const COMPOSE_POLISH_LABELS: Record<AiOutputLanguage, ComposePolishLabels> = {
  de: {
    polish: "Mit KI ausformulieren",
    polishing: "Formuliere aus…",
    polishTitle: "Rohentwurf von der KI zu einer fertigen E-Mail ausbauen",
    polishHint: "Stichpunkte oder Rohtext eingeben, dann ausformulieren lassen.",
    minDraftError: "Schreib zuerst einen kurzen Entwurf.",
  },
  en: {
    polish: "Polish with AI",
    polishing: "Polishing…",
    polishTitle: "Expand your rough draft into a finished email with AI",
    polishHint: "Type bullet points or rough text, then polish.",
    minDraftError: "Write a short draft first.",
  },
  no: {
    polish: "Formuler med AI",
    polishing: "Formulerer…",
    polishTitle: "Utvid kladdet til en ferdig e-post med AI",
    polishHint: "Skriv stikkord eller grov tekst, deretter formuler.",
    minDraftError: "Skriv et kort utkast først.",
  },
};

export function getComposePolishLabels(language: AiOutputLanguage): ComposePolishLabels {
  return COMPOSE_POLISH_LABELS[language] ?? COMPOSE_POLISH_LABELS.en;
}
