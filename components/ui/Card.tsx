import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "filled" | "outlined" | "elevated";
  interactive?: boolean;
}

export function Card({
  children,
  variant = "filled",
  interactive,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={clsx(
        "md-card",
        `md-card--${variant}`,
        interactive && "md-card--interactive",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="card-header__action">{action}</div> : null}
    </div>
  );
}
