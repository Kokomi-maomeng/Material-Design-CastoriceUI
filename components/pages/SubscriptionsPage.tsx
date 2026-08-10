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

export function SubscriptionsPage({ subscriptions, onRotate, onToast, integration, onConfigure }: { subscriptions: Subscription[]; onRotate: (id: string) => void; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [qrSubscription, setQrSubscription] = useState<Subscription | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [rotateSubscription, setRotateSubscription] = useState<Subscription | null>(null);

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
      <PageHeader eyebrow="客户端分发" title="订阅管理" description="为每个账号生成独立订阅入口，并安全地管理访问 Token。" actions={<Button icon="add_link" onClick={() => onToast("新增订阅需先由后端创建账号凭据")}>新增订阅</Button>} />
      <IntegrationGate status={integration} name="订阅发布器" description="连接现有订阅服务后，可展示真实地址、二维码和 Token 状态。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "link", title: "独立入口", description: "每个账号拥有可单独撤销的订阅链接。" }, { icon: "qr_code_2", title: "快速导入", description: "为移动客户端生成清晰二维码。" }, { icon: "key", title: "Token 轮换", description: "重置后立即使旧地址失效，降低泄露风险。" }]} />
      <div className="security-banner"><Icon name="shield_lock" size={24} filled /><div><strong>订阅安全提示</strong><span>完整 Token 只在后端生成并显示一次。列表仅展示掩码，重置后旧地址立即失效。</span></div><Button variant="text" compact onClick={() => onToast("订阅地址属于敏感凭据，请勿写入日志或公开仓库")}>了解更多</Button></div>

      <section className="subscription-grid">
        {subscriptions.map((subscription) => (
          <Card key={subscription.id} variant="outlined" className={`subscription-card ${!subscription.enabled ? "is-disabled" : ""}`}>
            <div className="subscription-card__header"><div className="account-cell"><span className="avatar">{subscription.account.slice(0, 1).toUpperCase()}</span><div><strong>{subscription.account}</strong><span>{subscription.enabled ? "订阅可用" : "已随账号禁用"}</span></div></div><Chip staticChip tone={subscription.enabled ? "success" : "default"}>{subscription.enabled ? "有效" : "停用"}</Chip></div>
            <div className="subscription-card__protocols">{subscription.protocols.map((item) => <Chip staticChip key={item}>{item}</Chip>)}</div>
            <div className="token-field"><div><span>订阅 Token</span><code>{subscription.tokenHint}</code></div><Icon name="key" size={20} /></div>
            <div className="subscription-meta"><span><Icon name="sync" size={17} />更新于 {subscription.updatedAt}</span><span><Icon name="download" size={17} />拉取于 {subscription.lastFetchedAt}</span></div>
            <div className="subscription-actions"><Button variant="tonal" icon="content_copy" onClick={() => void copy(subscription)} disabled={!subscription.enabled}>复制地址</Button><Button variant="outlined" icon="qr_code_2" onClick={() => void showQr(subscription)} disabled={!subscription.enabled}>二维码</Button><Button variant="text" icon="more_vert" aria-label={`管理 ${subscription.account} 订阅`} onClick={() => setRotateSubscription(subscription)} /></div>
          </Card>
        ))}
      </section>

      <Dialog open={Boolean(qrSubscription)} onClose={() => { setQrSubscription(null); setQrUrl(""); }} title={`${qrSubscription?.account ?? ""} 的订阅二维码`} description="二维码按需读取且不会写入浏览器存储，请只在可信设备上导入。" size="small" actions={<Button onClick={() => { setQrSubscription(null); setQrUrl(""); }}>完成</Button>}>
        {qrSubscription && qrUrl ? <div className="qr-dialog"><div className="qr-surface"><QRCodeSVG value={qrUrl} size={216} level="H" bgColor="transparent" fgColor="currentColor" /></div><code>完整地址已隐藏 · 关闭后立即从页面内存清除</code></div> : null}
      </Dialog>

      <Dialog open={Boolean(rotateSubscription)} onClose={() => setRotateSubscription(null)} title="重置订阅 Token" description="此操作会使旧订阅地址立即失效。" size="small" actions={<><Button variant="text" onClick={() => setRotateSubscription(null)}>取消</Button><Button variant="danger" onClick={() => { if (rotateSubscription) onRotate(rotateSubscription.id); setRotateSubscription(null); }}>确认重置</Button></>}>
        <div className="confirm-box"><Icon name="warning" size={24} /><p>客户端必须重新导入新地址。操作完成后，完整 Token 只应显示一次。</p></div>
      </Dialog>
    </div>
  );
}
