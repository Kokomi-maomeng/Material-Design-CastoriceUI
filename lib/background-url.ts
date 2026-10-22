export function validBackgroundUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const authority = value.trim().match(/^https:\/\/([^/?#]*)/i)?.[1] ?? "";
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.hash && !authority.endsWith(":") && (!url.port || Number(url.port) >= 1);
  } catch { return false; }
}
