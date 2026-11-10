import type { ReactNode } from "react";

/** Keep form drafts mounted while the grid interpolates its intrinsic height. */
export function Collapse({ expanded, children, className = "", id }: { expanded: boolean; children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`motion-collapse ${expanded ? "is-expanded" : ""} ${className}`} aria-hidden={!expanded} inert={!expanded}>
    <div className="motion-collapse__content">{children}</div>
  </div>;
}
