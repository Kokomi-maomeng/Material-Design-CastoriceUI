import { useEffect, useId, useMemo, useRef, useState } from "react";

type Frame = { width: number; height: number; x: number; y: number; imageWidth: number; imageHeight: number; radius: number };

// A rounded lens bends only the rim. The center stays optically clear rather
// than turning the whole image into an opaque frosted sheet.
function lensMap(width: number, height: number, radius: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(canvas.width, canvas.height);
  const rim = 20;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x + .5 - width / 2, py = y + .5 - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius), qy = Math.abs(py) - (height / 2 - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const depth = -(outside + Math.min(Math.max(qx, qy), 0) - radius);
      const bend = depth > 0 && depth < rim ? Math.sin(depth / rim * Math.PI) * .42 : 0;
      const nx = outside > 0 ? Math.max(qx, 0) / outside * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
      const ny = outside > 0 ? Math.max(qy, 0) / outside * Math.sign(py) : qy >= qx ? Math.sign(py) : 0;
      const i = (y * canvas.width + x) * 4;
      image.data[i] = Math.round((.5 - nx * bend) * 255);
      image.data[i + 1] = Math.round((.5 - ny * bend) * 255);
      image.data[i + 2] = 128; image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export function LiquidGlass({ background, fit, preset, onTone }: { background: string; fit: "cover" | "contain"; preset: "clear" | "default" | "tinted"; onTone: (tone: "light" | "dark") => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const id = "login-lens-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [frame, setFrame] = useState<Frame>();
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const card = svg.current?.parentElement;
    const page = card?.parentElement;
    if (!card || !page || reduced) return;
    let disposed = false, scheduled = 0;
    const image = new Image();
    const measure = () => {
      if (disposed || !image.naturalWidth) return;
      const rect = card.getBoundingClientRect(), outer = page.getBoundingClientRect();
      const scale = Math[fit === "contain" ? "min" : "max"](outer.width / image.naturalWidth, outer.height / image.naturalHeight);
      const imageWidth = image.naturalWidth * scale, imageHeight = image.naturalHeight * scale;
      const next = { width: rect.width, height: rect.height, x: (outer.width - imageWidth) / 2 - (rect.left - outer.left), y: (outer.height - imageHeight) / 2 - (rect.top - outer.top), imageWidth, imageHeight, radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 32 };
      setFrame((old) => old && Object.keys(next).every((key) => old[key as keyof Frame] === next[key as keyof Frame]) ? old : next);
      try {
        const sample = document.createElement("canvas"); sample.width = sample.height = 24;
        const context = sample.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.fillStyle = "#191622"; context.fillRect(0, 0, 24, 24);
          context.drawImage(image, next.x / rect.width * 24, next.y / rect.height * 24, imageWidth / rect.width * 24, imageHeight / rect.height * 24);
          const pixels = context.getImageData(0, 0, 24, 24).data;
          let luminance = 0;
          const linear = (value: number) => { const v = value / 255 * .82; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
          for (let i = 0; i < pixels.length; i += 4) luminance += .2126 * linear(pixels[i]) + .7152 * linear(pixels[i + 1]) + .0722 * linear(pixels[i + 2]);
          onTone(luminance / (pixels.length / 4) > .28 ? "light" : "dark");
        }
      } catch { /* The CSS material remains readable if sampling is unavailable. */ }
    };
    const schedule = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(measure); };
    image.onload = schedule; image.src = background;
    const observer = new ResizeObserver(schedule); observer.observe(card); observer.observe(page);
    window.addEventListener("resize", schedule);
    return () => { disposed = true; cancelAnimationFrame(scheduled); observer.disconnect(); window.removeEventListener("resize", schedule); };
  }, [background, fit, onTone, reduced]);
  const width = frame?.width ?? 0, height = frame?.height ?? 0, radius = frame?.radius ?? 32;
  const map = useMemo(() => width && height ? lensMap(width, height, radius) : "", [width, height, radius]);
  return <svg ref={svg} className="auth-glass-optics" aria-hidden="true" focusable="false" width="100%" height="100%">
    {frame && map && !reduced ? <>
      <defs><filter id={id} x="0" y="0" width={frame.width} height={frame.height} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width={frame.width} height={frame.height} result="lens" />
        <feDisplacementMap in="SourceGraphic" in2="lens" scale="32" xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation={preset === "clear" ? .25 : preset === "tinted" ? 3 : 1.2} />
      </filter></defs>
      <image href={background} x={frame.x} y={frame.y} width={frame.imageWidth} height={frame.imageHeight} preserveAspectRatio="none" filter={`url(#${id})`} />
      <rect width="100%" height="100%" fill="black" opacity=".18" />
      <rect width="100%" height="100%" className="auth-glass-wash" />
    </> : null}
  </svg>;
}
