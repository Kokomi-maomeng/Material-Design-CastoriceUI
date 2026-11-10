import { useId, type ReactNode, type Ref } from "react";
import { Card } from "../ui/Card";
import { Collapse } from "../ui/Collapse";
import { Icon } from "../ui/Icon";

export function TrafficSection({ title, expanded, onToggle, action, headingRef, className, children }: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  action?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return <Card variant="outlined" className={`traffic-section ${className ?? ""}`} role="region" aria-labelledby={`${id}-heading`}>
    <div className="traffic-analysis__header">
      <h2 className="traffic-analysis__heading" id={`${id}-heading`} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
        <button className="traffic-analysis__toggle" type="button" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
          {title}<Icon name="expand_more" />
        </button>
      </h2>
      {expanded && action ? <div className="traffic-analysis__action">{action}</div> : null}
    </div>
    <Collapse expanded={expanded} id={id}>{children}</Collapse>
  </Card>;
}
