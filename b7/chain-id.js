// Injected wallets commonly use hex strings; WalletConnect also uses numbers
// and decimal strings. Normalize identity only, never general RPC quantities.
const MAX_CHAIN_ID = (1n << 256n) - 1n;

export function normalizeChainId(value) {
  const accepted = (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    || (typeof value === 'bigint' && value > 0n)
    || (typeof value === 'string' && (/^0x[0-9a-f]{1,64}$/i.test(value) || /^[0-9]{1,78}$/.test(value)));
  if (accepted) {
    const id = BigInt(value);
    if (id > 0n && id <= MAX_CHAIN_ID) return '0x' + id.toString(16);
  }
  const error = new Error('The wallet returned an invalid network identifier. Reconnect your wallet to try again.');
  error.code = 'INVALID_CHAIN_ID';
  throw error;
}
