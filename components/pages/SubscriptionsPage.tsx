import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchSubscriptionUrl } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { useI18n } from "../../lib/i18n";
import type { Subscription } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { PageHeader } from "../ui/Page";

export function SubscriptionsPage({ subscriptions, onToast }: { subscriptions: Subscription[]; onToast: (message: string) => void }) {
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

  const closeQr = () => {
    setQrSubscription(null);
    setQrUrl("");
  };

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow={t("订阅", "Subscriptions")} title={t("订阅管理", "Subscription management")} />
      <section className="subscription-grid">
        {subscriptions.map((subscription) => (
          <Card
            key={subscription.id}
            variant="outlined"
            className={`subscription-card ${!subscription.enabled ? "is-disabled" : ""}`}
          >
            <div className="subscription-card__header">
              <div className="account-cell">
                <span className="avatar">{subscription.account.slice(0, 1).toUpperCase()}</span>
                <div><small>{t("关联管理账号", "Linked managed account")}</small><strong>{subscription.account}</strong></div>
              </div>
              <Chip staticChip tone={subscription.enabled ? "success" : "default"}>
                {subscription.enabled ? t("记录已启用", "Record enabled") : t("记录已停用", "Record disabled")}
              </Chip>
            </div>
            <div className="subscription-card__protocols">
              {subscription.protocols.map((item) => <Chip staticChip key={item}>{item}</Chip>)}
            </div>
            <div className="subscription-actions">
              <Button variant="tonal" icon="content_copy" onClick={() => void copy(subscription)} disabled={!subscription.enabled}>
                {t("复制地址", "Copy URL")}
              </Button>
              <Button variant="outlined" icon="qr_code_2" onClick={() => void showQr(subscription)} disabled={!subscription.enabled}>
                {t("二维码", "QR code")}
              </Button>
            </div>
          </Card>
        ))}
      </section>
      <Dialog
        open={Boolean(qrSubscription)}
        onClose={closeQr}
        title={t(`${qrSubscription?.account ?? ""} 的订阅二维码`, `${qrSubscription?.account ?? ""} subscription QR code`)}
        size="small"
        actions={<Button onClick={closeQr}>{t("完成", "Done")}</Button>}
      >
        {qrSubscription && qrUrl ? (
          <div className="qr-dialog">
            <div className="qr-surface">
              <QRCodeSVG value={qrUrl} size={216} level="H" bgColor="transparent" fgColor="currentColor" />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
