import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const LANGUAGES = {
  zh: { name: "中文", tag: "zh-CN", label: "语言", system: "跟随系统" },
  en: { name: "English", tag: "en", label: "Language", system: "Follow system" },
} as const;

export type ResolvedLanguage = keyof typeof LANGUAGES;
export type LanguagePreference = "system" | ResolvedLanguage;

function isLanguage(value: string | null): value is ResolvedLanguage {
  return value !== null && Object.hasOwn(LANGUAGES, value);
}

export function isLanguagePreference(value: string | null): value is LanguagePreference {
  return value === "system" || isLanguage(value);
}

export function languageSelect(language: ResolvedLanguage) {
  return {
    label: LANGUAGES[language].label,
    options: [
      { value: "system", label: LANGUAGES[language].system },
      ...Object.entries(LANGUAGES).map(([value, { name }]) => ({ value, label: name })),
    ],
  };
}

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
  for (const locale of languages) {
    const tag = locale.toLowerCase();
    if (isLanguage(tag)) return tag;
    const base = tag.split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

function initialPreference(): LanguagePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLanguagePreference(value) ? value : "system";
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
    document.documentElement.lang = LANGUAGES[language].tag;
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
