import { useEffect, useRef, useState } from "react";
import { backgroundCacheKey, backgroundProfile } from "../../lib/login-background";
import type { LoginAppearance } from "../../lib/types";

const CACHE_NAME = "castorice-login-background-v5";
const MAX_IMAGE_BYTES = 30_000_000;
// One last image in memory also covers browsers that disable Cache Storage.
let lastImage: { key: string; blob: Blob } | undefined;

export function useLoginBackground(appearance: LoginAppearance): string {
  const [source, setSource] = useState("");
  const activeUrl = useRef("");
  const [profile, setProfile] = useState(() => backgroundProfile(innerWidth, innerHeight));
  const key = appearance.url ? backgroundCacheKey(appearance, profile) : "";

  useEffect(() => {
    let timer = 0;
    const resize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setProfile(backgroundProfile(innerWidth, innerHeight)), 350);
    };
    window.addEventListener("resize", resize);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => () => {
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
  }, []);

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let retryTimer = 0;
    let retryDecode = false;
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
    const stored = async () => {
      if (lastImage?.key === key) await show(lastImage.blob);
      else {
        try {
          const response = await (await caches.open(CACHE_NAME)).match(key);
          if (response) await show(await response.blob());
        } catch { /* Storage-disabled browsers still load from the server. */ }
      }
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
        lastImage = { key, blob };
        shouldRetry = response.headers.get("X-Background-Stale") === "1";
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(key, new Response(blob));
          // This is image content storage, with no visitor identifier. Keep at
          // most three finite viewport variants (90 MB), newest first.
          const keys = await cache.keys();
          for (const old of keys.filter((item) => item.url !== new URL(key, location.origin).href).slice(0, Math.max(0, keys.length - 3))) await cache.delete(old);
        } catch { /* Retain the decoded image when persistence is unavailable. */ }
      } catch {
        shouldRetry = true; // Never clear the last successfully decoded image.
      } finally {
        window.clearTimeout(timeout);
      }
      if (!disposed && shouldRetry && attempt < 2) retryTimer = window.setTimeout(() => void refresh(attempt + 1), retryAfter * 1000);
    };
    void stored().finally(() => { if (!disposed) void refresh(); });
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(retryTimer);
      // A cold viewport/source variant may fail. Keep the decoded current
      // image until its replacement succeeds, while caches remain per key.
    };
  }, [key]);

  return key ? source : "";
}
