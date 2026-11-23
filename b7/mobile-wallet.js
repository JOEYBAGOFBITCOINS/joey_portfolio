// MetaMask's official dapp-opening link. This never initiates a payment or signature.
export function createMobileWalletLink(location) {
  let url;
  try { url = new URL(location); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  // A phone cannot open this workstation's localhost preview. Keep private hosts out of links.
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  // Retain only the public site path. Session tokens and unrelated query data are never forwarded.
  return 'https://link.metamask.io/dapp/' + host + url.pathname;
}
