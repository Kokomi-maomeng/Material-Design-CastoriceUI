import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  selected?: boolean;
  icon?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  staticChip?: boolean;
}

export function Chip({
  children,
  selected,
  icon,
  tone = "default",
  staticChip,
  className,
  ...props
}: ChipProps) {
  const Component = staticChip ? "span" : "button";
  return (
    <Component
      className={clsx(
        "md-chip",
        selected && "is-selected",
        `md-chip--${tone}`,
        className,
      )}
      {...(!staticChip ? props : {})}
    >
      {icon ? <Icon name={icon} size={17} filled={selected} /> : null}
      <span>{children}</span>
    </Component>
  );
}
