import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type LanguagePreference = "system" | "zh" | "en";
export type ResolvedLanguage = "zh" | "en";

interface I18nValue {
  preference: LanguagePreference;
  language: ResolvedLanguage;
  setPreference: (preference: LanguagePreference) => void;
  t: (chinese: string, english: string) => string;
}

const STORAGE_KEY = "castorice-language";

export function withoutTerminalPeriod(value: string): string {
  return value.replace(/[。.]+$/u, "");
}

function browserLanguage(): ResolvedLanguage {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  const first = String(languages[0] ?? "").toLowerCase();
  if (first.startsWith("zh")) return "zh";
  if (first.startsWith("en")) return "en";
  return "en";
}

function initialPreference(): LanguagePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "zh" || value === "en" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(initialPreference);
  const [systemLanguage, setSystemLanguage] = useState<ResolvedLanguage>(browserLanguage);

  useEffect(() => {
    const onLanguageChange = () => setSystemLanguage(browserLanguage());
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  const setPreference = useCallback((next: LanguagePreference) => {
    setPreferenceState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* The selection still applies for this tab. */ }
  }, []);
  const language = preference === "system" ? systemLanguage : preference;
  const t = useCallback((chinese: string, english: string) => withoutTerminalPeriod(language === "zh" ? chinese : english), [language]);
  const value = useMemo(() => ({ preference, language, setPreference, t }), [language, preference, setPreference, t]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
