import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { useI18n } from "../../lib/i18n";

export function FeatureIntro({ items }: { items: Array<{ icon: string; title: string; description: string }> }) {
  const { t } = useI18n();
  return (
    <Card variant="outlined" className="feature-intro" aria-label={t("页面功能说明", "Page feature overview")}>
      {items.map((item) => <div key={item.title}><span><Icon name={item.icon} size={20} /></span><div><strong>{item.title}</strong><p>{item.description}</p></div></div>)}
    </Card>
  );
}
