/** Client import schemes wrap the original HTTPS URL; no conversion service. */
export function subscriptionLinks(value: string, name: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid subscription URL");
  const encoded = btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(""));
  return {
    url: value,
    clash: `clash://install-config?url=${encodeURIComponent(value)}&name=${encodeURIComponent(name)}`,
    shadowrocket: `shadowrocket://add/sub://${encoded}?remark=${encodeURIComponent(name)}`,
  };
}
