import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "filled" | "tonal" | "outlined" | "text" | "danger";
  icon?: string;
  trailingIcon?: string;
  children?: ReactNode;
  compact?: boolean;
}

export function Button({
  variant = "filled",
  icon,
  trailingIcon,
  children,
  compact,
  className,
  ...props
}: ButtonProps) {
  const iconOnly = !children;
  return (
    <button
      className={clsx(
        "md-button",
        `md-button--${variant}`,
        compact && "md-button--compact",
        iconOnly && "md-button--icon",
        className,
      )}
      {...props}
    >
      {icon ? <Icon name={icon} size={iconOnly ? 22 : 19} /> : null}
      {children ? <span>{children}</span> : null}
      {trailingIcon ? <Icon name={trailingIcon} size={19} /> : null}
    </button>
  );
}
