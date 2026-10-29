import type { AppLanguage } from "../preferences/model.ts";
import { getTranslator } from "./index.ts";

function dateValue(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Dates follow the saved interface language, independently of the device locale. */
export function formatDate(value: string | null | undefined, language: AppLanguage): string {
  const date = dateValue(value);
  return date
    ? date.toLocaleDateString(language === "en" ? "en-US" : "zh-CN")
    : getTranslator(language)("common.dateUnavailable");
}

export function formatDateTime(value: string | null | undefined, language: AppLanguage): string {
  const date = dateValue(value);
  return date
    ? date.toLocaleString(language === "en" ? "en-US" : "zh-CN")
    : getTranslator(language)("common.dateUnavailable");
}
