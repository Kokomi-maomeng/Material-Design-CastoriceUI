export function readPreference<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The preference still applies to the current tab through React state.
  }
}

export function readBooleanPreference(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}
