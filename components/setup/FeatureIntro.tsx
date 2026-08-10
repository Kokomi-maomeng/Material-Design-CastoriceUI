import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";

export function FeatureIntro({ items }: { items: Array<{ icon: string; title: string; description: string }> }) {
  return (
    <Card variant="outlined" className="feature-intro" aria-label="页面功能说明">
      {items.map((item) => <div key={item.title}><span><Icon name={item.icon} size={20} /></span><div><strong>{item.title}</strong><p>{item.description}</p></div></div>)}
    </Card>
  );
}
