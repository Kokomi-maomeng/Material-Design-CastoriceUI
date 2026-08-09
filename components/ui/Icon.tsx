import clsx from "clsx";

interface IconProps {
  name: string;
  size?: number;
  filled?: boolean;
  className?: string;
}

export function Icon({ name, size = 22, filled = false, className }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx("material-symbols-rounded", className)}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 450, 'GRAD' 0, 'opsz' ${size}`,
      }}
    >
      {name}
    </span>
  );
}
