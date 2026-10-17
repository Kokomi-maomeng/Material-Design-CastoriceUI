import { useEffect, useRef, useState } from "react";
import { backgroundCacheKey, backgroundProfile } from "../../lib/login-background";
import type { LoginAppearance } from "../../lib/types";

const CACHE_NAME = "castorice-login-background-v7";
const LEGACY_CACHES = ["castorice-login-background-v6", "castorice-login-background-v5"];
const MAX_IMAGE_BYTES = 30_000_000;
type StoredImage = { key: string; blob: Blob; fetchedAt: number; stale: boolean };
let lastImage: StoredImage | undefined;

export function useLoginBackground(appearance: LoginAppearance): string {
  const [source, setSource] = useState("");
  const activeUrl = useRef("");
  const [profile] = useState(() => backgroundProfile(innerWidth, innerHeight));
  const key = appearance.url ? backgroundCacheKey(appearance, profile) : "";
  const seconds = appearance.type === "url" ? appearance.cacheSeconds ?? 0 : 600;

  useEffect(() => () => {
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = "";
  }, []);

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let retryTimer = 0;
    let retryDecode = false;
    let fallback: StoredImage | undefined;
    let controller: AbortController | undefined;
    const show = async (blob: Blob) => {
      if (disposed || !blob.size || blob.size > MAX_IMAGE_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(blob.type)) return false;
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.src = url;
      try { await image.decode(); } catch { URL.revokeObjectURL(url); return false; }
      if (disposed) { URL.revokeObjectURL(url); return false; }
      const previous = activeUrl.current;
      activeUrl.current = url;
      setSource(url);
      if (previous) URL.revokeObjectURL(previous);
      return true;
    };
    const stored = async (): Promise<StoredImage | undefined> => {
      if (lastImage?.key === key) return lastImage;
      try {
        const response = await (await caches.open(CACHE_NAME)).match(key);
        if (response) return { key, blob: await response.blob(), fetchedAt: Number(response.headers.get("X-Background-Saved-At")) || 0, stale: response.headers.get("X-Background-Stale") === "1" };
        // Legacy entries have no age and are fallback-only.
        const names = await caches.keys();
        for (const name of LEGACY_CACHES) {
          if (!names.includes(name)) continue;
          const old = await (await caches.open(name)).match(key);
          if (old) return { key, blob: await old.blob(), fetchedAt: 0, stale: true };
        }
      } catch { /* Storage-disabled browsers still load from the server. */ }
      return undefined;
    };
    const persist = async (entry: StoredImage) => {
      if (disposed) return;
      lastImage = entry;
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(key, new Response(entry.blob, { headers: { "X-Background-Saved-At": String(entry.fetchedAt), "X-Background-Stale": entry.stale ? "1" : "0" } }));
        const keys = await cache.keys();
        for (const old of keys.filter((item) => item.url !== new URL(key, location.origin).href).slice(0, Math.max(0, keys.length - 3))) await cache.delete(old);
        for (const name of LEGACY_CACHES) await caches.delete(name);
      } catch { /* Retain the decoded image when persistence is unavailable. */ }
    };
    const refresh = async (attempt = 0) => {
      if (disposed) return;
      const requestController = new AbortController();
      controller = requestController;
      let retryAfter = 2 + attempt * 3;
      let shouldRetry = false;
      const timeout = window.setTimeout(() => requestController.abort(), 20_000);
      try {
        const response = await fetch(key + (retryDecode ? "&retry=1" : ""), { credentials: "omit", cache: "no-store", signal: requestController.signal });
        retryAfter = Math.max(2, Math.min(60, Number(response.headers.get("Retry-After")) || retryAfter));
        if (!response.ok) throw new Error("background_unavailable");
        if (Number(response.headers.get("Content-Length")) > MAX_IMAGE_BYTES) throw new Error("background_too_large");
        const blob = await response.blob();
        if (!await show(blob)) { retryDecode = true; throw new Error("background_decode_failed"); }
        retryDecode = false;
        const age = Number(response.headers.get("X-Background-Age"));
        // A new image's client TTL starts only when decoding has completed.
        // Reusing an existing cache entry never extends that deadline.
        const stale = response.headers.get("X-Background-Stale") === "1";
        await persist({ key, blob, fetchedAt: !stale && Number.isFinite(age) && age >= 0 ? Date.now() : 0, stale });
        // A decoded response is final for this visit, including a server
        // fallback. Retrying behind a visible image made it jump later.
      } catch {
        if (disposed) return;
        const retained = fallback && await show(fallback.blob);
        if (retained && fallback) await persist({ ...fallback, stale: true });
        shouldRetry = !retained && !activeUrl.current;
      } finally {
        window.clearTimeout(timeout);
      }
      if (!disposed && shouldRetry && attempt < 2) retryTimer = window.setTimeout(() => void refresh(attempt + 1), retryAfter * 1000);
    };
    void stored().then(async (entry) => {
      if (disposed) return;
      fallback = entry;
      const age = entry ? Date.now() - entry.fetchedAt : Infinity;
      if (entry && !entry.stale && seconds > 0 && age >= 0 && age < seconds * 1000 && await show(entry.blob)) return;
      await refresh();
    });
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(retryTimer);
    };
  }, [key, seconds]);

  return key ? source : "";
}
