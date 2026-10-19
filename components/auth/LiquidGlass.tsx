import { useEffect, useId, useRef, useState } from "react";

type Frame = { width: number; height: number; x: number; y: number; imageWidth: number; imageHeight: number };

export function LiquidGlass({ background, fit, preset, onTone }: { background: string; fit: "cover" | "contain"; preset: "clear" | "default" | "tinted"; onTone: (tone: "light" | "dark") => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const id = "login-glass-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
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
      // Layout coordinates exclude the card's entrance transform. Measuring
      // the animated bounding box left a scaled, misaligned image until resize.
      const rect = { width: card.clientWidth, height: card.clientHeight };
      const outer = { width: page.clientWidth, height: page.clientHeight };
      const scale = Math[fit === "contain" ? "min" : "max"](outer.width / image.naturalWidth, outer.height / image.naturalHeight);
      const imageWidth = image.naturalWidth * scale, imageHeight = image.naturalHeight * scale;
      const next = { width: rect.width, height: rect.height, x: (outer.width - imageWidth) / 2 - card.offsetLeft - card.clientLeft, y: (outer.height - imageHeight) / 2 - card.offsetTop - card.clientTop, imageWidth, imageHeight };
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
  return <svg ref={svg} className="auth-glass-optics" aria-hidden="true" focusable="false" width="100%" height="100%">
    {frame && !reduced ? <>
      <defs><filter id={id} x="0" y="0" width={frame.width} height={frame.height} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={preset === "clear" ? .25 : preset === "tinted" ? 3 : 1.2} />
      </filter></defs>
      <image href={background} x={frame.x} y={frame.y} width={frame.imageWidth} height={frame.imageHeight} preserveAspectRatio="none" filter={`url(#${id})`} />
      <rect width="100%" height="100%" fill="black" opacity=".18" />
      <rect width="100%" height="100%" className="auth-glass-wash" />
    </> : null}
  </svg>;
}
