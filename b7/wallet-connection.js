/**
 * Wallet connection only. No SDK, remote discovery, signatures,
 * transactions, account storage, or simulation-state changes.
 * EIP-6963 rdns and isMetaMask are discovery hints, not proof of wallet identity.
 */
import { normalizeChainId } from './chain-id.js';

export const BSC_TESTNET_CHAIN_ID = '0x61';
export const BSC_TESTNET_CONFIG = Object.freeze({
  chainId: BSC_TESTNET_CHAIN_ID,
  chainName: 'BNB Smart Chain Testnet',
  nativeCurrency: Object.freeze({ name: 'Test BNB', symbol: 'tBNB', decimals: 18 }),
  rpcUrls: Object.freeze(['https://bsc-testnet-dataseed.bnbchain.org']),
  blockExplorerUrls: Object.freeze(['https://testnet.bscscan.com']),
});

const isProvider = value => value && typeof value.request === 'function';
const plainText = (value, fallback = '', limit = 100) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || fallback : fallback;
const account = values => Array.isArray(values) && typeof values[0] === 'string' && /^0x[0-9a-f]{40}$/i.test(values[0]) ? values[0] : null;
const chainId = normalizeChainId;
function balance(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('The wallet returned an invalid testnet balance.');
  return BigInt(value).toString();
}
function errorDetails(error) {
  const candidate = error?.code ?? error?.data?.originalError?.code;
  const code = typeof candidate === 'number' ? candidate : /^-?\d+$/.test(String(candidate)) ? Number(candidate) : ['WALLET_READ_TIMEOUT', 'WALLET_REQUEST_TIMEOUT', 'WALLET_REQUEST_PENDING'].includes(candidate) ? candidate : null;
  const messages = {
    4001: 'The wallet request was declined. You can try again when ready.',
    '-32002': 'A wallet request is already pending. Open your wallet to finish or dismiss it.',
    4100: 'This site is not authorized to use an account. Connect through your wallet.',
    4900: 'Your wallet is disconnected. Open it and reconnect.',
    4901: 'Your wallet cannot reach this network. Check the wallet connection.',
    4902: 'BNB Smart Chain Testnet has not been added to this wallet.',
  };
  return { error: messages[code] || (typeof error?.message === 'string' ? error.message.slice(0, 300) : 'The wallet request could not be completed.'), errorCode: code };
}

function boundedWait(promise, timeoutMs, message, code) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code })), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * onChange receives immutable snapshots after state changes. Read getState()
 * for the initial snapshot. All async methods resolve snapshots, including
 * errors. Only connect() prompts for accounts; call it from a user action.
 * disconnect() is local: wallet site permissions remain until revoked there.
 * connect(walletId) explicitly selects an injected wallet. With several wallets
 * and no selection, refresh/connect make no account RPCs. discover() refreshes
 * the registry without account RPCs. getWallets() returns text metadata hints
 * plus a controller-owned source enum; render names as text, never as HTML or
 * identity proof. Exclude source='external' from installed-extension rows.
 * setExternalProvider(provider,{id,name}) selects an already-connected EIP-1193
 * provider and refreshes it without another account permission request.
 * pendingAction identifies the current read or wallet prompt. A prompt may
 * remain pending after the local wait times out (busy=false); it cannot be
 * retried until the wallet finishes or dismisses the underlying request.
 */
export function createWalletConnection({ window: walletWindow = globalThis.window, onChange = () => {}, readTimeoutMs = 15000, promptTimeoutMs = 60000 } = {}) {
  for (const timeout of [readTimeoutMs, promptTimeoutMs]) if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Wallet request timeouts must be positive.');
  let state = { address: null, chainId: null, isTestnet: false, balanceWei: null, installed: false, connected: false, busy: false, pendingAction: null, error: null, errorCode: null, walletId: null, walletName: null, providerVersion: 0, walletsAvailable: 0, walletsVersion: 0 };
  let provider = null;
  const registry = [];
  let nextWalletId = 1;
  let selectionExplicit = false;
  let attached = null;
  let session = 0;
  let readVersion = 0;
  let activeRead = null;
  let readAction = null;
  let prompt = null;
  // A local deadline cannot cancel an EIP-1193 request in the wallet. Keep its
  // lock until the underlying promise settles, including across disconnects.
  const outstandingPrompts = new WeakMap();
  let locallyDisconnected = false;
  let destroyed = false;
  let initializing = true;

  const getState = () => Object.freeze({ ...state });
  const getWallets = () => Object.freeze(registry.map(({ id, name, rdns, source }) => Object.freeze({ id, name, rdns, source })));
  function update(patch = {}) {
    const currentPrompt = prompt !== null && prompt.session === session;
    const pendingAction = activeRead !== null ? readAction : currentPrompt ? prompt.pendingAction : !locallyDisconnected && provider ? outstandingPrompts.get(provider)?.kind || null : null;
    const next = { ...state, ...patch, busy: activeRead !== null || currentPrompt, pendingAction };
    const changed = Object.keys(next).some(key => next[key] !== state[key]);
    state = next;
    if (changed && !initializing && !destroyed) onChange(getState());
  }
  function invalidate() { readVersion += 1; activeRead = null; readAction = null; }
  function detach() {
    if (!attached) return;
    const remove = attached.provider.removeListener || attached.provider.off;
    if (typeof remove === 'function') {
      remove.call(attached.provider, 'accountsChanged', attached.accounts);
      remove.call(attached.provider, 'chainChanged', attached.chain);
      remove.call(attached.provider, 'disconnect', attached.disconnected);
    }
    attached = null;
  }
  function attach() {
    if (attached?.provider === provider || !provider || locallyDisconnected || destroyed) return;
    detach();
    if (typeof provider.on === 'function') {
      const selected = provider;
      const token = session;
      const binding = { provider: selected };
      const active = () => attached === binding && currentSession(token, selected) && !locallyDisconnected;
      binding.accounts = accounts => { if (active()) accountsChanged(accounts); };
      binding.chain = network => { if (active()) chainChanged(network); };
      binding.disconnected = error => { if (active()) providerDisconnected(error); };
      attached = binding;
      selected.on('accountsChanged', binding.accounts);
      selected.on('chainChanged', binding.chain);
      selected.on('disconnect', binding.disconnected);
    }
  }
  function select(entry, explicit = false) {
    if (entry?.provider === provider && entry?.id === state.walletId) {
      selectionExplicit ||= explicit;
      return provider;
    }
    detach();
    session += 1;
    invalidate();
    provider = entry?.provider || null;
    selectionExplicit = explicit;
    update({ address: null, chainId: null, isTestnet: false, balanceWei: null, connected: false, walletId: entry?.id || null, walletName: entry?.name || null, providerVersion: state.providerVersion + 1, error: null, errorCode: null });
    return provider;
  }
  function register(candidate, info = {}, source = 'legacy') {
    if (!isProvider(candidate)) return null;
    let entry = registry.find(wallet => wallet.provider === candidate);
    const name = plainText(info.name, 'Browser wallet');
    const rdns = plainText(info.rdns, '', 120);
    const requestedId = source === 'external' && typeof info.id === 'string' && /^[a-z0-9._:-]{1,80}$/i.test(info.id) ? info.id : null;
    let changed = false;
    // SDK reconnects can supply a new provider object for the same connector.
    // Replace that connector's entry, keeping its public picker ID stable.
    if (!entry && requestedId) {
      entry = registry.find(wallet => wallet.source === 'external' && wallet.id === requestedId);
      if (entry) { Object.assign(entry, { provider: candidate, name, rdns }); changed = true; }
    }
    if (!entry) {
      let id = requestedId || `wallet-${nextWalletId++}`;
      while (registry.some(wallet => wallet.id === id)) id = `wallet-${nextWalletId++}`;
      entry = { id, name, rdns, provider: candidate, source };
      registry.push(entry);
      changed = true;
    } else if (source !== 'legacy' && (entry.name !== name || entry.rdns !== rdns)) {
      Object.assign(entry, { name, rdns, source });
      changed = true;
    }
    if (changed) {
      update({ installed: true, walletsAvailable: registry.length, walletsVersion: state.walletsVersion + 1, ...(entry.id === state.walletId ? { walletName: entry.name } : {}) });
      // A read-only refresh may have found one wallet before another announced.
      // Do not turn that timing accident into a persistent wallet selection.
      if (registry.length > 1 && provider && !selectionExplicit) select(null);
    }
    return entry;
  }
  function registerLegacyProviders() {
    const injected = walletWindow?.ethereum;
    const legacy = Array.isArray(injected?.providers) ? injected.providers.filter(isProvider) : [];
    for (const candidate of legacy.length ? legacy : isProvider(injected) ? [injected] : []) {
      const name = candidate.isCoinbaseWallet ? 'Coinbase Wallet' : candidate.isRabby ? 'Rabby Wallet' : candidate.isBraveWallet ? 'Brave Wallet' : candidate.isTrust || candidate.isTrustWallet ? 'Trust Wallet' : candidate.isMetaMask ? 'MetaMask' : 'Browser wallet';
      register(candidate, { name });
    }
  }
  function chooseProvider(walletId, explicit = false) {
    if (destroyed) return null;
    registerLegacyProviders();
    if (walletId !== undefined) {
      const entry = registry.find(wallet => wallet.id === walletId);
      if (!entry) return null;
      return select(entry, explicit);
    }
    if (provider) {
      selectionExplicit ||= explicit;
      return provider;
    }
    return registry.length === 1 ? select(registry[0], explicit) : null;
  }
  function announced(event) {
    if (destroyed || !isProvider(event?.detail?.provider)) return;
    register(event.detail.provider, event.detail.info, 'eip6963');
  }
  function discover() {
    if (destroyed) return getWallets();
    const EventConstructor = walletWindow?.Event || globalThis.Event;
    if (walletWindow?.dispatchEvent && EventConstructor) walletWindow.dispatchEvent(new EventConstructor('eip6963:requestProvider'));
    registerLegacyProviders();
    return getWallets();
  }
  function missingProvider() {
    update({ installed: registry.length > 0, error: registry.length ? 'Choose a wallet to continue.' : 'A compatible wallet was not detected in this browser. Choose a mobile or QR connection, or open this site in a wallet browser.', errorCode: null });
    return getState();
  }
  const currentSession = (token, selected) => !destroyed && token === session && selected === provider;
  const currentRead = (token, selected, version) => currentSession(token, selected) && version === readVersion && !locallyDisconnected;
  const readRequest = (selected, request) => boundedWait(Promise.resolve().then(() => selected.request(request)), readTimeoutMs, 'The wallet did not respond in time. Refresh to try again, or disconnect and reconnect.', 'WALLET_READ_TIMEOUT');
  function pendingRequestError() {
    return { error: 'A wallet request is still pending. Open your wallet to finish or dismiss it before trying another request. You can disconnect this page while waiting.', errorCode: 'WALLET_REQUEST_PENDING' };
  }
  async function promptRequest(selected, operation, request, kind) {
    if (outstandingPrompts.has(selected)) throw Object.assign(new Error(pendingRequestError().error), { code: 'WALLET_REQUEST_PENDING' });
    operation.pendingAction = kind;
    const record = { kind, promise: Promise.resolve().then(() => currentSession(operation.session, selected) && !locallyDisconnected ? selected.request(request) : undefined) };
    outstandingPrompts.set(selected, record);
    const release = () => {
      if (outstandingPrompts.get(selected) === record) outstandingPrompts.delete(selected);
      // Late completion only releases the lock; it never resumes timed-out work.
      if (currentSession(operation.session, selected) && !locallyDisconnected) update();
    };
    record.promise.then(release, release);
    update();
    return boundedWait(record.promise, promptTimeoutMs, 'The wallet request is taking longer than expected. Open your wallet to finish or dismiss it. You can disconnect this page; another request will wait until the original finishes.', 'WALLET_REQUEST_TIMEOUT');
  }

  async function refresh() {
    if (destroyed) return getState();
    const selected = chooseProvider();
    if (!selected) return missingProvider();
    if (locallyDisconnected) return getState();
    attach();
    const token = session;
    const version = ++readVersion;
    activeRead = version;
    readAction = 'refresh';
    update({ balanceWei: null, error: null, errorCode: null });
    try {
      const [accounts, network] = await Promise.all([
        readRequest(selected, { method: 'eth_accounts' }),
        readRequest(selected, { method: 'eth_chainId' }),
      ]);
      if (!currentRead(token, selected, version)) return getState();
      const address = account(accounts);
      const networkId = chainId(network);
      update({ address, connected: Boolean(address), chainId: networkId, isTestnet: networkId === BSC_TESTNET_CHAIN_ID, balanceWei: null });
      if (address && networkId === BSC_TESTNET_CHAIN_ID && currentRead(token, selected, version)) {
        // No native balance reads are issued for a known non-testnet network.
        readAction = 'balance';
        update();
        let value, balanceTimeout = null;
        try { value = await readRequest(selected, { method: 'eth_getBalance', params: [address, 'latest'] }); }
        catch (error) {
          if (error?.code !== 'WALLET_READ_TIMEOUT') throw error;
          balanceTimeout = error;
        }
        if (!currentRead(token, selected, version)) return getState();
        // Recheck both dimensions after the asynchronous RPC. Account/chain
        // events can arrive later than a wallet's updated RPC responses.
        const [latestAccounts, latestNetwork] = await Promise.all([
          readRequest(selected, { method: 'eth_accounts' }),
          readRequest(selected, { method: 'eth_chainId' }),
        ]);
        if (!currentRead(token, selected, version)) return getState();
        const verifiedAddress = account(latestAccounts);
        const verifiedNetwork = chainId(latestNetwork);
        const sameAccount = verifiedAddress !== null && verifiedAddress.toLowerCase() === address.toLowerCase();
        update({ address: verifiedAddress, connected: Boolean(verifiedAddress), chainId: verifiedNetwork, isTestnet: verifiedNetwork === BSC_TESTNET_CHAIN_ID, balanceWei: !balanceTimeout && sameAccount && verifiedNetwork === networkId ? balance(value) : null,
          ...(balanceTimeout ? { error: 'The testnet balance did not respond in time. Your account and network were checked again. Refresh balance to retry.', errorCode: 'WALLET_READ_TIMEOUT' } : {}) });
      }
    } catch (error) {
      if (currentRead(token, selected, version)) {
        const details = errorDetails(error);
        // Failed reads cannot retain a previous network/account authorization.
        // Clearing identity also invalidates a previously prepared deployment.
        update({ ...details, address: null, connected: false, chainId: null, isTestnet: false, balanceWei: null });
      }
    } finally {
      if (currentRead(token, selected, version)) { activeRead = null; readAction = null; update(); }
    }
    return getState();
  }

  function accountsChanged(accounts) {
    if (destroyed || locallyDisconnected) return;
    invalidate();
    const address = account(accounts);
    update({ address, connected: Boolean(address), balanceWei: null, error: null, errorCode: null });
    if (address) void refresh();
  }
  function chainChanged(network) {
    if (destroyed || locallyDisconnected) return;
    invalidate();
    let networkId = null;
    try { networkId = chainId(network); } catch { /* Refresh reads the authoritative value. */ }
    update({ chainId: networkId, isTestnet: networkId === BSC_TESTNET_CHAIN_ID, balanceWei: null, error: null, errorCode: null });
    void refresh();
  }
  function disconnect() {
    if (destroyed) return getState();
    session += 1;
    invalidate();
    locallyDisconnected = true;
    detach();
    update({ address: null, chainId: null, isTestnet: false, balanceWei: null, connected: false, providerVersion: state.providerVersion + 1, error: null, errorCode: null });
    return getState();
  }
  function providerDisconnected(error) {
    disconnect();
    update(errorDetails(error || { code: 4900 }));
  }

  function action(kind, work, { reconnect = false, walletId } = {}) {
    if (destroyed) return Promise.resolve(getState());
    discover();
    const selected = chooseProvider(walletId, true);
    if (!selected) return Promise.resolve(missingProvider());
    if (prompt && prompt.session === session) {
      if (prompt.kind === kind) return prompt.promise;
      update(pendingRequestError());
      return Promise.resolve(getState());
    }
    if (outstandingPrompts.has(selected)) {
      update(pendingRequestError());
      return Promise.resolve(getState());
    }
    if (reconnect) locallyDisconnected = false;
    attach();
    const token = session;
    const operation = { session: token, kind, pendingAction: kind, promise: null };
    prompt = operation;
    invalidate();
    update({ balanceWei: null, error: null, errorCode: null });
    // Defer work one microtask so a synchronously emitted provider event sees
    // the already-recorded operation and repeated clicks share its promise.
    operation.promise = Promise.resolve().then(async () => {
      try {
        if (currentSession(token, selected)) await work(selected, () => currentSession(token, selected), operation);
        if (currentSession(token, selected) && !locallyDisconnected) await refresh();
      } catch (error) {
        if (currentSession(token, selected)) update(errorDetails(error));
      } finally {
        if (prompt === operation) { prompt = null; update(); }
      }
      return getState();
    });
    return operation.promise;
  }
  function connect(walletId) {
    return action('connect', async (selected, stillCurrent, operation) => {
      await promptRequest(selected, operation, { method: 'eth_requestAccounts' }, 'connect');
      // Do not trust the prompt's potentially stale result. refresh() reads
      // the provider's current authorized accounts and chain after it ends.
    }, { reconnect: true, walletId });
  }
  function setExternalProvider(externalProvider, info = {}) {
    if (destroyed) return Promise.resolve(getState());
    if (!isProvider(externalProvider)) {
      update({ error: 'The connected wallet did not provide a compatible Ethereum provider.', errorCode: null });
      return Promise.resolve(getState());
    }
    const entry = register(externalProvider, { ...info, name: plainText(info.name, 'Connected wallet') }, 'external');
    select(entry, true);
    locallyDisconnected = false;
    return refresh();
  }
  function switchToTestnet() {
    return action('switch', async (selected, stillCurrent, operation) => {
      const params = [{ chainId: BSC_TESTNET_CHAIN_ID }];
      try { await promptRequest(selected, operation, { method: 'wallet_switchEthereumChain', params }, 'switch'); }
      catch (error) {
        if (errorDetails(error).errorCode !== 4902) throw error;
        if (!stillCurrent()) return;
        await promptRequest(selected, operation, { method: 'wallet_addEthereumChain', params: [{ ...BSC_TESTNET_CONFIG, nativeCurrency: { ...BSC_TESTNET_CONFIG.nativeCurrency }, rpcUrls: [...BSC_TESTNET_CONFIG.rpcUrls], blockExplorerUrls: [...BSC_TESTNET_CONFIG.blockExplorerUrls] }] }, 'add');
        if (!stillCurrent()) return;
        await promptRequest(selected, operation, { method: 'wallet_switchEthereumChain', params }, 'switch');
      }
    });
  }
  function destroy() {
    if (destroyed) return;
    disconnect();
    destroyed = true;
    walletWindow?.removeEventListener?.('eip6963:announceProvider', announced);
    provider = null;
    registry.length = 0;
  }

  walletWindow?.addEventListener?.('eip6963:announceProvider', announced);
  discover();
  initializing = false;
  return Object.freeze({ connect, refresh, switchToTestnet, disconnect, discover, setExternalProvider, getWallets, getProvider: () => provider, getState, destroy });
}
