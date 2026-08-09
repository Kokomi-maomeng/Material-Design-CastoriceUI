import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { copyText } from "../../lib/clipboard";
import type { Subscription } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function SubscriptionsPage({ subscriptions, onRotate, onToast }: { subscriptions: Subscription[]; onRotate: (id: string) => void; onToast: (message: string) => void }) {
  const [qrSubscription, setQrSubscription] = useState<Subscription | null>(null);
  const [rotateSubscription, setRotateSubscription] = useState<Subscription | null>(null);

  const copy = async (subscription: Subscription) => {
    try {
      await copyText(demoUrl(subscription));
      onToast(`${subscription.account} 的演示订阅地址已复制`);
    } catch {
      onToast("复制失败，请手动选择地址");
    }
  };

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="客户端分发" title="订阅管理" description="为每个账号生成独立订阅入口，并安全地管理访问 Token。" actions={<Button icon="add_link" onClick={() => onToast("新增订阅需先由后端创建账号凭据")}>新增订阅</Button>} />
      <div className="security-banner"><Icon name="shield_lock" size={24} filled /><div><strong>订阅安全提示</strong><span>完整 Token 只在后端生成并显示一次。列表仅展示掩码，重置后旧地址立即失效。</span></div><Button variant="text" compact onClick={() => onToast("订阅地址属于敏感凭据，请勿写入日志或公开仓库")}>了解更多</Button></div>

      <section className="subscription-grid">
        {subscriptions.map((subscription) => (
          <Card key={subscription.id} variant="outlined" className={`subscription-card ${!subscription.enabled ? "is-disabled" : ""}`}>
            <div className="subscription-card__header"><div className="account-cell"><span className="avatar">{subscription.account.slice(0, 1).toUpperCase()}</span><div><strong>{subscription.account}</strong><span>{subscription.enabled ? "订阅可用" : "已随账号禁用"}</span></div></div><Chip staticChip tone={subscription.enabled ? "success" : "default"}>{subscription.enabled ? "有效" : "停用"}</Chip></div>
            <div className="subscription-card__protocols">{subscription.protocols.map((item) => <Chip staticChip key={item}>{item}</Chip>)}</div>
            <div className="token-field"><div><span>订阅 Token</span><code>{subscription.tokenHint}</code></div><Icon name="key" size={20} /></div>
            <div className="subscription-meta"><span><Icon name="sync" size={17} />更新于 {subscription.updatedAt}</span><span><Icon name="download" size={17} />拉取于 {subscription.lastFetchedAt}</span></div>
            <div className="subscription-actions"><Button variant="tonal" icon="content_copy" onClick={() => void copy(subscription)} disabled={!subscription.enabled}>复制地址</Button><Button variant="outlined" icon="qr_code_2" onClick={() => setQrSubscription(subscription)} disabled={!subscription.enabled}>二维码</Button><Button variant="text" icon="more_vert" aria-label={`管理 ${subscription.account} 订阅`} onClick={() => setRotateSubscription(subscription)} /></div>
          </Card>
        ))}
      </section>

      <Dialog open={Boolean(qrSubscription)} onClose={() => setQrSubscription(null)} title={`${qrSubscription?.account ?? ""} 的订阅二维码`} description="二维码内容为安全的演示地址，不含真实服务器或 Token。" size="small" actions={<Button onClick={() => setQrSubscription(null)}>完成</Button>}>
        {qrSubscription ? <div className="qr-dialog"><div className="qr-surface"><QRCodeSVG value={demoUrl(qrSubscription)} size={216} level="H" bgColor="transparent" fgColor="currentColor" /></div><code>{demoUrl(qrSubscription)}</code></div> : null}
      </Dialog>

      <Dialog open={Boolean(rotateSubscription)} onClose={() => setRotateSubscription(null)} title="重置订阅 Token" description="此操作会使旧订阅地址立即失效。" size="small" actions={<><Button variant="text" onClick={() => setRotateSubscription(null)}>取消</Button><Button variant="danger" onClick={() => { if (rotateSubscription) onRotate(rotateSubscription.id); setRotateSubscription(null); }}>确认重置</Button></>}>
        <div className="confirm-box"><Icon name="warning" size={24} /><p>客户端必须重新导入新地址。操作完成后，完整 Token 只应显示一次。</p></div>
      </Dialog>
    </div>
  );
}

function demoUrl(subscription: Subscription) { return `https://panel.example.test/sub/${subscription.id}/demo-token`; }
