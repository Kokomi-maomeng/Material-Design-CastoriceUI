import { isLanguagePreference, languageSelect, useI18n } from "../../lib/i18n";
import { MaterialSelect } from "./MaterialSelect";

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { language, preference, setPreference } = useI18n();
  const { label, options } = languageSelect(language);
  return <MaterialSelect
    ariaLabel={label}
    triggerLabel={compact && preference === "system" ? label : undefined}
    value={preference}
    options={options}
    onChange={(value) => { if (isLanguagePreference(value)) setPreference(value); }}
  />;
}
