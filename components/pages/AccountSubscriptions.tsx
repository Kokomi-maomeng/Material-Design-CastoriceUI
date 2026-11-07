import { memo, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchSubscriptionUrl } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { useI18n } from "../../lib/i18n";
import { subscriptionLinks } from "../../lib/subscription-links";
import type { Account, Subscription } from "../../lib/types";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { DataBoundary } from "../ui/DataBoundary";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";

const SubscriptionQr = memo(function SubscriptionQr({ url, title }: { url: string; title: string }) {
  return <QRCodeSVG value={url} size={216} level="M" marginSize={4} bgColor="transparent" fgColor="currentColor" title={title} />;
});

type SubscriptionDetailsProps = { open: boolean; account: Account; subscriptions: Subscription[]; onToast: (message: string) => void };

export function AccountSubscriptions({ onClose, ...props }: SubscriptionDetailsProps & { onClose: () => void }) {
  const { t } = useI18n();
  const { open, account } = props;
  return <Dialog open={open} onClose={onClose} title={t(`${account.name} 的账号订阅`, `${account.name} subscriptions`)} size="small" actions={<Button onClick={onClose}>{t("完成", "Done")}</Button>}>
    <SubscriptionDetails {...props} />
  </Dialog>;
}

function SubscriptionDetails({ open, account, subscriptions, onToast }: SubscriptionDetailsProps) {
  const { t } = useI18n();
  const linked = subscriptions.filter((item) => [account.id, account.name, account.email].filter(Boolean).includes(item.account));
  const [selected, setSelected] = useState(linked[0]?.id ?? "");
  const subscription = linked.find((item) => item.id === selected) ?? linked[0];
  const [resolved, setResolved] = useState<{ key: string; links: ReturnType<typeof subscriptionLinks> } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [manual, setManual] = useState<{ key: string; url: string } | null>(null);
  const enabled = Boolean(subscription?.enabled && account.configuredStatus !== "disabled");
  const id = subscription?.id, suppliedUrl = subscription?.url;
  const requestKey = JSON.stringify([id, suppliedUrl, account.name, retry]);
  const links = enabled && resolved?.key === requestKey ? resolved.links : null;
  const failed = failedKey === requestKey;
  const manualUrl = links && manual?.key === requestKey ? manual.url : "";
  useEffect(() => {
    const controller = new AbortController();
    if (open && enabled && id) {
      // Let an immediate cleanup cancel before opening the protected request.
      void Promise.resolve().then(async () => {
        if (controller.signal.aborted) return;
        const url = suppliedUrl ?? (await fetchSubscriptionUrl(id, controller.signal)).url;
        if (!controller.signal.aborted) setResolved({ key: requestKey, links: subscriptionLinks(url, account.name) });
      }).catch(() => { if (!controller.signal.aborted) setFailedKey(requestKey); });
    }
    return () => controller.abort();
  }, [open, enabled, id, suppliedUrl, account.name, requestKey]);
  const copy = async (kind: "url" | "clash" | "shadowrocket") => {
    if (!links || !enabled) return;
    const value = links[kind];
    try {
      await copyText(value);
      onToast(t("链接已复制", "Link copied"));
    } catch {
      setManual({ key: requestKey, url: value });
      onToast(t("复制失败，可在地址框中手动复制", "Copy failed. Copy manually from the address field."));
    }
  };
  return <div className="account-subscriptions">
      <div className="account-cell"><span className="avatar">{account.name.slice(0, 1).toUpperCase()}</span><div><small>{t("关联账号", "Linked account")}</small><strong>{account.name}</strong></div></div>
      {linked.length > 1 ? <MaterialSelect ariaLabel={t("选择订阅", "Select subscription")} value={subscription?.id ?? ""} options={linked.map((item, index) => ({ value: item.id, label: `${t("订阅", "Subscription")} ${index + 1} · ${item.protocols.join(" / ")}` }))} onChange={(value) => { setSelected(value); setManual(null); }} /> : null}
      <div className="protocol-list">{subscription?.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div>
      {!subscription ? <p className="muted">{t("此账号暂无关联订阅。", "No subscription is linked to this account.")}</p> : !enabled ? <p className="muted">{t("此账号或订阅记录已停用。", "This account or subscription record is disabled.")}</p> : <>
        <div className="subscription-qr-slot">
          {links ? <div className="qr-surface">
            <DataBoundary resetKey={requestKey} fallback={<p role="status">{t("二维码无法显示，可使用下方复制按钮", "QR code unavailable. Use the copy buttons below.")}</p>}>
              <SubscriptionQr url={links.url} title={t("订阅二维码", "Subscription QR code")} />
            </DataBoundary>
          </div> : failed ? <div className="subscription-qr-placeholder" role="alert">
            <p>{t("无法读取订阅地址，请检查后端连接", "Unable to read the subscription URL. Check the backend connection.")}</p>
            <Button onClick={() => setRetry((value) => value + 1)}>{t("重试", "Retry")}</Button>
          </div> : <div className="subscription-qr-placeholder" role="status">
            <Icon name="qr_code" size={44} /><span>{t("正在读取订阅", "Loading subscription")}</span>
          </div>}
        </div>
        <div className="account-subscription-actions">
          <Button disabled={!links} variant="tonal" icon="content_copy" onClick={() => void copy("url")}>{t("复制地址", "Copy URL")}</Button>
          <Button disabled={!links} variant="outlined" icon="content_copy" onClick={() => void copy("clash")}>{t("复制 Clash 链接", "Copy Clash link")}</Button>
          <Button disabled={!links} variant="outlined" icon="content_copy" onClick={() => void copy("shadowrocket")}>{t("复制 Shadowrocket 链接", "Copy Shadowrocket link")}</Button>
        </div>
      </>}
      {manualUrl ? <label className="field"><span>{t("手动复制链接", "Copy link manually")}</span><textarea readOnly value={manualUrl} rows={4} onFocus={(event) => event.currentTarget.select()} /></label> : null}
    </div>;
}
