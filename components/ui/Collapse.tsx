import type { ReactNode } from "react";

/** Keep form drafts mounted while the grid interpolates its intrinsic height. */
export function Collapse({ expanded, children, className = "" }: { expanded: boolean; children: ReactNode; className?: string }) {
  return <div className={`motion-collapse ${expanded ? "is-expanded" : ""} ${className}`} aria-hidden={!expanded} inert={!expanded}>
    <div className="motion-collapse__content">{children}</div>
  </div>;
}
