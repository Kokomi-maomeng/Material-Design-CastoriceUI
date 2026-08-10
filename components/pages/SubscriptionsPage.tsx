import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { copyText } from "../../lib/clipboard";
import { fetchSubscriptionUrl } from "../../lib/api";
import type { IntegrationStatus, Subscription } from "../../lib/types";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function SubscriptionsPage({ subscriptions, onToast, integration, onConfigure }: { subscriptions: Subscription[]; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [qrSubscription, setQrSubscription] = useState<Subscription | null>(null);
  const [qrUrl, setQrUrl] = useState("");

  const copy = async (subscription: Subscription) => {
    try {
      const value = subscription.url ?? (await fetchSubscriptionUrl(subscription.id)).url;
      await copyText(value);
      onToast(`${subscription.account} 的订阅地址已复制`);
    } catch {
      onToast("复制失败，请手动选择地址");
    }
  };

  const showQr = async (subscription: Subscription) => {
    try {
      const value = subscription.url ?? (await fetchSubscriptionUrl(subscription.id)).url;
      setQrUrl(value);
      setQrSubscription(subscription);
    } catch {
      onToast("无法读取订阅地址，请检查后端连接");
    }
  };

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="受保护配置" title="订阅配置记录" description="读取后端已有订阅入口，并在管理员主动操作时完成复制与二维码导入。" />
      <IntegrationGate status={integration} name="订阅配置记录" description="页面展示后端受保护配置中已有的订阅记录；HTTPS 地址通过格式校验不代表外部发布器已连通。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "link", title: "独立入口", description: "按后端配置展示每个账号的订阅入口。" }, { icon: "qr_code_2", title: "快速导入", description: "主动操作时按需读取并生成二维码。" }, { icon: "shield_lock", title: "凭据保护", description: "常规仪表盘不会返回完整 Token。" }]} />
      <div className="security-banner"><Icon name="shield_lock" size={24} filled /><div><strong>订阅安全提示</strong><span>常规列表只显示配置中的 Token 提示；完整地址仅在复制或生成二维码时从受保护端点读取。本面板不会生成、轮换或验证 Token。</span></div><Button variant="text" compact onClick={() => onToast("订阅地址属于敏感凭据，请勿写入日志或公开仓库")}>了解更多</Button></div>

      <section className="subscription-grid">
        {subscriptions.map((subscription) => (
          <Card key={subscription.id} variant="outlined" className={`subscription-card ${!subscription.enabled ? "is-disabled" : ""}`}>
            <div className="subscription-card__header"><div className="account-cell"><span className="avatar">{subscription.account.slice(0, 1).toUpperCase()}</span><div><strong>{subscription.account}</strong><span>{subscription.enabled ? "配置记录已启用" : "配置记录已停用"}</span></div></div><Chip staticChip tone={subscription.enabled ? "success" : "default"}>{subscription.enabled ? "已配置" : "停用"}</Chip></div>
            <div className="subscription-card__protocols">{subscription.protocols.map((item) => <Chip staticChip key={item}>{item}</Chip>)}</div>
            <div className="token-field"><div><span>订阅 Token</span><code>{subscription.tokenHint}</code></div><Icon name="key" size={20} /></div>
            <div className="subscription-meta"><span><Icon name="sync" size={17} />配置记录：更新于 {subscription.updatedAt}</span><span><Icon name="download" size={17} />配置记录：最近拉取 {subscription.lastFetchedAt}</span></div>
            <div className="subscription-actions"><Button variant="tonal" icon="content_copy" onClick={() => void copy(subscription)} disabled={!subscription.enabled}>复制地址</Button><Button variant="outlined" icon="qr_code_2" onClick={() => void showQr(subscription)} disabled={!subscription.enabled}>二维码</Button></div>
          </Card>
        ))}
      </section>

      <Dialog open={Boolean(qrSubscription)} onClose={() => { setQrSubscription(null); setQrUrl(""); }} title={`${qrSubscription?.account ?? ""} 的订阅二维码`} description="二维码按需读取且不会写入浏览器存储，请只在可信设备上导入。" size="small" actions={<Button onClick={() => { setQrSubscription(null); setQrUrl(""); }}>完成</Button>}>
        {qrSubscription && qrUrl ? <div className="qr-dialog"><div className="qr-surface"><QRCodeSVG value={qrUrl} size={216} level="H" bgColor="transparent" fgColor="currentColor" /></div><code>完整地址已隐藏 · 关闭后立即从页面内存清除</code></div> : null}
      </Dialog>

    </div>
  );
}
