/**
 * src/features/ai-reports/ai-reports.types.ts
 *
 * In-app reports of AI output (AI-P, Google Play AI-Generated Content
 * policy). A report names the screen that showed the reply and a category.
 * The reply text and a short note are stored only when the user chose to
 * include them; nothing else from the conversation is sent or kept.
 */

export const AI_REPORT_SURFACES = ['assistant', 'weekly_coaching', 'analytics_insight'] as const;
export type AiReportSurface = (typeof AI_REPORT_SURFACES)[number];

export const AI_REPORT_CATEGORIES = [
  'offensive',
  'harmful',
  'inaccurate',
  'spam',
  'other'
] as const;
export type AiReportCategory = (typeof AI_REPORT_CATEGORIES)[number];

/** Kept identical to the CHECK constraints of ai_content_reports. */
export const AI_REPORT_LIMITS = {
  replyTextMaxChars: 4000,
  noteMaxChars: 500,
  localeMaxChars: 16
} as const;

export interface CreateAiReportInput {
  surface: AiReportSurface;
  category: AiReportCategory;
  replyText?: string | undefined;
  note?: string | undefined;
  locale: string;
}

export interface AiReportRecord {
  userId: string;
  surface: AiReportSurface;
  category: AiReportCategory;
  replyText: string | null;
  note: string | null;
  locale: string;
}

/** Outcome of an insert: `available` is false until the owner SQL ran. */
export interface AiReportWriteResult {
  available: boolean;
  created: boolean;
}
