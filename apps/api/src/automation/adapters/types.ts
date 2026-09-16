import type { Profile, ScreeningAnswer } from "@apply-lite/shared";
import type { Page } from "playwright";

export interface AnswerCandidate {
  key: string;
  label: string;
  value: string;
  source: "profile" | "answer-library" | "generated";
  needsReview?: boolean;
}

export interface AutomationContext {
  page: Page;
  profile: Profile;
  resumePath?: string;
  coverLetterPath?: string;
  answers: AnswerCandidate[];
  screeningAnswers: ScreeningAnswer[];
}

export interface PreparationResult {
  ats: string;
  filled: string[];
  uploaded: string[];
  unknownQuestions: string[];
  manualQuestions: string[];
  fieldResults: Array<{
    label: string;
    controlType: string;
    status: "filled" | "uploaded" | "unknown" | "manual" | "skipped";
    source: string;
    detail: string;
    fieldKey?: string;
    confidence?: number;
    learned?: boolean;
  }>;
  submitDetected: boolean;
  captchaDetected: boolean;
  loginDetected: boolean;
  finalUrl: string;
  pageTitle: string;
}

export interface AtsAdapter {
  name: string;
  matches(url: string): boolean;
  prepare(ctx: AutomationContext): Promise<PreparationResult>;
}
