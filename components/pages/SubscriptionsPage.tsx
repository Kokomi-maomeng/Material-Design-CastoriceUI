import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { copyText } from "../../lib/clipboard";
import { useI18n } from "../../lib/i18n";
import { fetchSubscriptionUrl } from "../../lib/api";
import type { IntegrationStatus, Subscription } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function SubscriptionsPage({ subscriptions, onToast, integration, onConfigure }: { subscriptions: Subscription[]; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { t } = useI18n();
  const [qrSubscription, setQrSubscription] = useState<Subscription | null>(null);
  const [qrUrl, setQrUrl] = useState("");

  const copy = async (subscription: Subscription) => {
    try {
      const value = subscription.url ?? (await fetchSubscriptionUrl(subscription.id)).url;
      await copyText(value);
      onToast(t(`${subscription.account} 的订阅地址已复制`, `${subscription.account} subscription URL copied`));
    } catch {
      onToast(t("复制失败，请手动选择地址", "Copy failed. Select the address manually."));
    }
  };

  const showQr = async (subscription: Subscription) => {
    try {
      const value = subscription.url ?? (await fetchSubscriptionUrl(subscription.id)).url;
      setQrUrl(value);
      setQrSubscription(subscription);
    } catch {
      onToast(t("无法读取订阅地址，请检查后端连接", "Unable to read the subscription URL. Check the backend connection."));
    }
  };

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow={t("受保护配置", "Protected configuration")} title={t("订阅配置记录", "Subscription records")} description={t("读取后端已有订阅入口，并在管理员主动操作时完成复制与二维码导入。", "Read existing backend subscription entries and reveal them only for an explicit copy or QR action.")} />
      <IntegrationGate status={integration} name="订阅配置记录" nameEn="Subscription records" description="页面展示后端受保护配置中已有的订阅记录；HTTPS 格式校验不代表外部发布器已连通。" descriptionEn="This page shows records from protected backend configuration. HTTPS format validation does not prove the publisher is reachable." onConfigure={onConfigure} />
      <div className="security-banner"><Icon name="shield_lock" size={24} filled /><div><strong>{t("订阅安全提示", "Subscription security")}</strong><span>{t("常规列表只显示 Token 提示；完整地址仅在复制或生成二维码时读取。面板不会生成、轮换或验证 Token。", "The normal list shows only token hints. Full URLs are read only for copy or QR actions. The panel does not generate, rotate, or validate tokens.")}</span></div><Button variant="text" compact onClick={() => onToast(t("订阅地址属于敏感凭据，请勿写入日志或公开仓库", "Subscription URLs are sensitive. Never place them in logs or public repositories."))}>{t("了解更多", "Learn more")}</Button></div>

      <section className="subscription-grid">
        {subscriptions.map((subscription) => (
          <Card key={subscription.id} variant="outlined" className={`subscription-card ${!subscription.enabled ? "is-disabled" : ""}`}>
            <div className="subscription-card__header"><div className="account-cell"><span className="avatar">{subscription.account.slice(0, 1).toUpperCase()}</span><div><strong>{subscription.account}</strong><span>{subscription.enabled ? t("配置记录已启用", "Record enabled") : t("配置记录已停用", "Record disabled")}</span></div></div><Chip staticChip tone={subscription.enabled ? "success" : "default"}>{subscription.enabled ? t("已配置", "Configured") : t("停用", "Disabled")}</Chip></div>
            <div className="subscription-card__protocols">{subscription.protocols.map((item) => <Chip staticChip key={item}>{item}</Chip>)}</div>
            <div className="token-field"><div><span>{t("订阅 Token", "Subscription token")}</span><code>{subscription.tokenHint}</code></div><Icon name="key" size={20} /></div>
            <div className="subscription-meta"><span><Icon name="sync" size={17} />{t(`配置记录：更新于 ${subscription.updatedAt}`, `Record updated: ${subscription.updatedAt}`)}</span><span><Icon name="download" size={17} />{t(`配置记录：最近拉取 ${subscription.lastFetchedAt}`, `Last fetched: ${subscription.lastFetchedAt}`)}</span></div>
            <div className="subscription-actions"><Button variant="tonal" icon="content_copy" onClick={() => void copy(subscription)} disabled={!subscription.enabled}>{t("复制地址", "Copy URL")}</Button><Button variant="outlined" icon="qr_code_2" onClick={() => void showQr(subscription)} disabled={!subscription.enabled}>{t("二维码", "QR code")}</Button></div>
          </Card>
        ))}
      </section>

      <Dialog open={Boolean(qrSubscription)} onClose={() => { setQrSubscription(null); setQrUrl(""); }} title={t(`${qrSubscription?.account ?? ""} 的订阅二维码`, `${qrSubscription?.account ?? ""} subscription QR code`)} description={t("二维码按需读取且不会写入浏览器存储，请只在可信设备上导入。", "The QR code is loaded on demand and never stored in browser storage. Import it only on a trusted device.")} size="small" actions={<Button onClick={() => { setQrSubscription(null); setQrUrl(""); }}>{t("完成", "Done")}</Button>}>
        {qrSubscription && qrUrl ? <div className="qr-dialog"><div className="qr-surface"><QRCodeSVG value={qrUrl} size={216} level="H" bgColor="transparent" fgColor="currentColor" /></div><code>{t("完整地址已隐藏 · 关闭后立即从页面内存清除", "Full URL hidden · cleared from page memory when closed")}</code></div> : null}
      </Dialog>

    </div>
  );
}
