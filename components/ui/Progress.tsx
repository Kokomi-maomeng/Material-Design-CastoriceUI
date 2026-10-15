interface ProgressProps {
  value: number;
  tone?: "primary" | "success" | "warning" | "danger";
  label?: string;
}

export function Progress({ value, tone = "primary", label }: ProgressProps) {
  const safeValue = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      className={`progress progress--${tone}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safeValue)}
      aria-label={label}
    >
      <span style={{ width: `${safeValue}%` }} />
    </div>
  );
}
