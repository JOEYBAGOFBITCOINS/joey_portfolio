import { createWalletConnection } from './wallet-connection.js';
import { normalizeChainId } from './chain-id.js';
import { WALLET_CONNECT_PROJECT_ID } from './wallet-config.js';
import { formatEther, formatUnits, Interface } from './vendor/ethers.js';
import { EXPECTED_ADMIN, EXPECTED_CHAIN_ID, buildDeploymentTransaction, validateDeploymentReceipt } from './deployment.js';

const $ = selector => document.querySelector(selector);
const dialog = $('#wallet-dialog');
const deploymentKey = 'b7-testnet-deployment-v1';
let operation = false, prepared = null, artifact = null, confirmed = null, pendingHash = null;
let identity = '', identityVersion = 0;
let pickerController = null, pickerGeneration = 0, pickerBusy = false, pickerMessage = '';
try {
  const saved = JSON.parse(localStorage.getItem(deploymentKey));
  if (saved?.chainId === EXPECTED_CHAIN_ID && /^0x[0-9a-f]{64}$/i.test(saved?.transactionHash)) pendingHash = saved.transactionHash;
} catch { /* Deployment recovery is optional; a stored record is never trusted as verification. */ }
// Public transaction recorded on November 16, 2026. This is only a verification
// candidate on a new origin; confirmed stays null until the owner checks it on-chain.
if (!pendingHash) pendingHash = '0xd9bd20440e20515e068e40fc1a3588cf331544b6cc29a1c33aca954576d27882';
const short = address => address.slice(0, 6) + '…' + address.slice(-4);
const isOwner = state => state.address?.toLowerCase() === EXPECTED_ADMIN.toLowerCase();
const report = text => { $('#deployment-state').textContent = text; };
const errorText = error => Number(error?.code ?? error?.data?.originalError?.code) === 4100
  ? 'Your wallet has not authorized this account for the request. Disconnect this site inside your wallet, then reconnect with BSC Testnet selected.'
  : String(error?.shortMessage || error?.message || 'The wallet request did not complete.').slice(0, 350);
const pairingConfigured = /^[a-f0-9]{32}$/i.test(WALLET_CONNECT_PROJECT_ID) && !/^0+$/.test(WALLET_CONNECT_PROJECT_ID);
const brands = {
  metamask: { name: 'MetaMask', matches: w => /metamask/i.test(w.rdns + ' ' + w.name) },
  trust: { name: 'Trust Wallet', matches: w => /trustwallet|trust wallet/i.test(w.rdns + ' ' + w.name) },
  coinbase: { name: 'Coinbase Wallet', matches: w => /coinbase|base wallet/i.test(w.rdns + ' ' + w.name) },
  rabby: { name: 'Rabby', matches: w => /rabby/i.test(w.rdns + ' ' + w.name) },
  okx: { name: 'OKX Wallet', matches: w => /okx|okex/i.test(w.rdns + ' ' + w.name) },
};
function pendingWalletMessage(state) {
  const name = state.walletName || 'your wallet';
  if (state.pendingAction === 'connect') return `Waiting for ${name} to finish connecting. Check the wallet window for a pending request.`;
  if (state.pendingAction === 'switch') return `Waiting for ${name} to switch to BSC Testnet. Check the wallet window for the network request.`;
  if (state.pendingAction === 'add') return `Waiting for ${name} to add BSC Testnet. Check the wallet window for the network request.`;
  if (state.pendingAction === 'balance') return 'Checking your testnet balance…';
  if (state.pendingAction === 'refresh') return 'Checking the connected account and network…';
  return '';
}
function renderChoices(state) {
  const available = wallet.getWallets().filter(item => item.source !== 'external');
  const shown = new Set();
  for (const button of document.querySelectorAll('[data-wallet-brand]')) {
    const brand = brands[button.dataset.walletBrand];
    const found = available.find(brand.matches);
    button.dataset.walletId = found?.id || '';
    button.querySelector('small').textContent = found ? 'Detected in this browser' : pairingConfigured ? 'Choose mobile or browser' : 'Not detected';
    button.disabled = operation || state.busy || pickerBusy;
    if (found) shown.add(found.id);
  }
  const extra = $('#additional-wallets');
  extra.replaceChildren();
  for (const entry of available.filter(item => !shown.has(item.id))) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button full'; button.dataset.detectedWallet = entry.id;
    button.textContent = entry.name + ' · detected'; button.disabled = operation || state.busy || pickerBusy; extra.append(button);
  }
  $('#wallet-choices').hidden = state.connected;
  $('#walletconnect-picker').disabled = operation || state.busy || pickerBusy;
  $('#browse-all-wallets').disabled = operation || state.busy || pickerBusy;
  $('#walletconnect-picker small').textContent = pairingConfigured ? 'Phone / QR code' : 'Pairing setup pending';
  $('#wallet-picker-help').textContent = pairingConfigured
    ? 'Installed wallets connect directly. WalletConnect offers supported phone apps and QR pairing. You choose which wallet to use.'
    : 'Detected browser wallets can connect now. Mobile pairing and the full wallet directory are awaiting activation for this preview.';
}

function clearPreparation() {
  prepared = null;
  $('#deployment-review').hidden = true;
}
function renderWallet(state) {
  const nextIdentity = `${state.providerVersion}:${state.connected}:${state.address}:${state.chainId}`;
  if (identity !== nextIdentity) { identity = nextIdentity; identityVersion++; clearPreparation(); $('#wallet-b7-row').hidden = true; }
  $('#open-wallet').textContent = state.connected ? short(state.address) : 'Connect wallet';
  $('#open-wallet').classList.toggle('connected', state.connected);
  $('#wallet-account').hidden = !state.connected;
  renderChoices(state);
  $('#wallet-status').textContent = pickerMessage || state.error || pendingWalletMessage(state) || (state.connected ? (state.isTestnet ? `${state.walletName || 'Wallet'} connected to BSC Testnet. Your wallet balances are separate from the local demo.` : 'Wallet connected. Switch to BSC Testnet to continue; mainnet transactions are disabled.') : 'Choose a wallet. Connecting shares your public account address; it does not send funds or request a signature.');
  $('#wallet-address').textContent = state.address || '';
  $('#wallet-network').textContent = state.isTestnet ? 'BSC Testnet · 97' : state.chainId === '0x38' ? 'BNB Smart Chain Mainnet · 56' : state.chainId ? `Other network · ${BigInt(state.chainId)}` : 'Not connected';
  $('#wallet-balance').textContent = state.isTestnet ? (state.balanceWei !== null ? `${formatEther(BigInt(state.balanceWei))} tBNB` : state.busy ? 'Checking testnet balance…' : 'Balance unavailable. Try Refresh balance.') : 'Available on testnet only';
  $('#switch-testnet').hidden = !state.connected || state.isTestnet;
  for (const id of ['switch-testnet', 'refresh-wallet']) $('#' + id).disabled = operation || state.busy || pickerBusy;
  // Local recovery must remain possible when a wallet/RPC request never settles.
  $('#disconnect-wallet').disabled = operation;
  $('#switch-testnet').textContent = state.pendingAction === 'switch' || state.pendingAction === 'add' ? 'Waiting for wallet…' : 'Switch to BSC Testnet';
  $('#wallet-explorer').hidden = !state.connected || !state.isTestnet;
  if (state.address) $('#wallet-explorer').href = 'https://testnet.bscscan.com/address/' + state.address;
  $('#deployment-tools').hidden = !state.connected || !state.isTestnet || !isOwner(state);
  $('#prepare-deployment').hidden = Boolean(pendingHash || confirmed);
  $('#prepare-deployment').disabled = operation || state.busy;
  $('#send-deployment').disabled = operation || state.busy || !prepared;
  $('#check-deployment').hidden = !pendingHash || Boolean(confirmed);
  $('#check-deployment').disabled = operation || state.busy;
  $('#wallet-contract').textContent = confirmed ? confirmed.contractAddress : pendingHash ? 'Recorded testnet deployment; verification required' : 'Not deployed';
}
const wallet = createWalletConnection({ onChange: renderWallet });
renderWallet(wallet.getState());

async function chooseInstalled(id) {
  if (operation || pickerBusy || wallet.getState().busy) return;
  const attempt = ++pickerGeneration;
  pickerMessage = ''; pickerBusy = true;
  wallet.disconnect(); clearPreparation(); renderWallet(wallet.getState());
  try { if (pickerController) await pickerController.disconnect(); if (attempt === pickerGeneration) await wallet.connect(id); }
  catch (error) { if (attempt === pickerGeneration) pickerMessage = errorText(error); }
  finally { if (attempt === pickerGeneration) { pickerBusy = false; renderWallet(wallet.getState()); } }
}
async function openUniversalPicker() {
  if (operation || pickerBusy || wallet.getState().busy) return;
  if (!pairingConfigured) { pickerMessage = 'Mobile pairing is not active in this preview yet. You can connect any detected browser wallet; MetaMask is not required.'; renderWallet(wallet.getState()); return; }
  const attempt = ++pickerGeneration;
  pickerBusy = true; pickerMessage = '';
  wallet.disconnect(); clearPreparation(); renderWallet(wallet.getState());
  try {
    const { openWalletPicker } = await import('./vendor/wallet-kit/wallet-kit.js');
    if (attempt !== pickerGeneration) return;
    dialog.close();
    pickerController = await openWalletPicker({
      projectId: WALLET_CONNECT_PROJECT_ID,
      metadata: { name: 'B7 Financial', description: 'B7 Financial portfolio testnet demonstration', url: new URL('./', import.meta.url).href, icons: [new URL('assets/b7-moon-logo.gif', location.href).href] },
      onProvider: async (provider, detail = {}) => {
        if (attempt !== pickerGeneration) return;
        pickerBusy = false;
        await wallet.setExternalProvider(provider, { id: 'appkit-eip155', name: detail.name || 'WalletConnect wallet' });
        if (attempt !== pickerGeneration) return;
        pickerController?.close();
        if (!dialog.open) dialog.showModal();
        renderWallet(wallet.getState());
      },
      onDisconnect: () => { if (attempt === pickerGeneration && wallet.getState().walletId === 'appkit-eip155') { wallet.disconnect(); clearPreparation(); } },
      onModalChange: state => { if (attempt === pickerGeneration && !state.open) { pickerBusy = false; if (!dialog.open) dialog.showModal(); renderWallet(wallet.getState()); } },
      onError: error => { if (attempt === pickerGeneration) { pickerBusy = false; pickerMessage = errorText(error); if (!dialog.open) dialog.showModal(); renderWallet(wallet.getState()); } },
    });
  } catch (error) { pickerMessage = errorText(error); if (!dialog.open) dialog.showModal(); }
  finally { if (attempt === pickerGeneration) { pickerBusy = false; renderWallet(wallet.getState()); } }
}

async function runOperation(action) {
  if (operation) return;
  operation = true; renderWallet(wallet.getState());
  try { await action(); } catch (error) { report(errorText(error)); }
  finally { operation = false; renderWallet(wallet.getState()); }
}
async function loadArtifact() {
  if (!artifact) {
    const response = await fetch('code/B7DemoGold.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('The reviewed contract artifact could not be loaded.');
    artifact = await response.json();
  }
  return artifact;
}
async function adminContext() {
  await wallet.refresh();
  const state = wallet.getState(), provider = wallet.getProvider(), version = identityVersion;
  if (!provider || !state.connected || !state.isTestnet || !isOwner(state)) throw new Error('Connect the designated administrator account on BSC Testnet before deployment.');
  const chainId = await provider.request({ method: 'eth_chainId' });
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (version !== identityVersion || provider !== wallet.getProvider()) throw new Error('The wallet changed. Review the deployment again.');
  const tx = buildDeploymentTransaction({ artifact: await loadArtifact(), account: accounts?.[0], chainId });
  if (version !== identityVersion) throw new Error('The wallet changed. Review the deployment again.');
  return { provider, tx, version };
}
function showPendingHash() {
  $('#deployment-explorer').href = 'https://testnet.bscscan.com/tx/' + pendingHash;
  $('#deployment-explorer').hidden = false;
  try { localStorage.setItem(deploymentKey, JSON.stringify({ chainId: EXPECTED_CHAIN_ID, transactionHash: pendingHash })); }
  catch { report('Deployment submitted. Save the transaction link; this browser could not save it.'); }
}
async function checkDeployment() {
  if (!pendingHash) return;
  const context = await adminContext();
  const receipt = await context.provider.request({ method: 'eth_getTransactionReceipt', params: [pendingHash] });
  if (!receipt) { report('Submitted to BSC Testnet. Confirmation is still pending; check again shortly.'); return; }
  if (BigInt(receipt.status || 0) !== 1n) { report('The testnet deployment reverted. Review the transaction on the explorer before trying again.'); return; }
  const transaction = await context.provider.request({ method: 'eth_getTransactionByHash', params: [pendingHash] });
  const finalized = await context.provider.request({ method: 'eth_getBlockByNumber', params: ['finalized', false] });
  if (!finalized?.number || !/^0x[0-9a-f]{64}$/i.test(finalized.hash || '') || BigInt(finalized.number) < BigInt(receipt.blockNumber)) { report('Deployment is mined. Waiting for a finalized testnet block before checking its code; check again shortly.'); return; }
  // Check this fixed nonproxy runtime at a pinned recent finalized block.
  // Public nodes can prune the older creation-block state while retaining its
  // transaction and receipt. Never fall back on a code mismatch or empty code.
  const code = await context.provider.request({ method: 'eth_getCode', params: [receipt.contractAddress, finalized.number] });
  const block = await context.provider.request({ method: 'eth_getBlockByNumber', params: [receipt.blockNumber, false] });
  if (context.version !== identityVersion || context.provider !== wallet.getProvider()) throw new Error('The wallet changed while verifying deployment. Reconnect and check again.');
  if (!block?.hash || block.hash.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new Error('The deployment block is not on the current canonical chain. Check again before using the contract.');
  const chainId = await context.provider.request({ method: 'eth_chainId' });
  const verified = validateDeploymentReceipt({ artifact: await loadArtifact(), account: wallet.getState().address, chainId, transactionHash: pendingHash, receipt, transaction, code });
  if (context.version !== identityVersion) throw new Error('The wallet changed during verification. Check again.');
  const finalizedCanonical = await context.provider.request({ method: 'eth_getBlockByNumber', params: [receipt.blockNumber, false] });
  const stateCanonical = await context.provider.request({ method: 'eth_getBlockByNumber', params: [finalized.number, false] });
  const finalChain = await context.provider.request({ method: 'eth_chainId' });
  const finalAccounts = await context.provider.request({ method: 'eth_accounts' });
  if (context.version !== identityVersion || context.provider !== wallet.getProvider() || normalizeChainId(finalChain) !== EXPECTED_CHAIN_ID || finalAccounts?.[0]?.toLowerCase() !== EXPECTED_ADMIN.toLowerCase()) throw new Error('The wallet changed during verification. Check again.');
  if (finalizedCanonical?.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new Error('The deployment block changed before finality. Check the transaction again.');
  if (stateCanonical?.hash?.toLowerCase() !== finalized.hash.toLowerCase() || BigInt(stateCanonical?.number || 0) !== BigInt(finalized.number)) throw new Error('The finalized verification block changed. Check the transaction again.');
  confirmed = Object.freeze({ ...verified, verificationBlock: finalized.number, verificationBlockHash: finalized.hash });
  clearPreparation();
  report('B7 test contract verified: administrator, transaction, bytecode, and finalized testnet block match. No tokens have been issued by this page.');
  await readTokenBalance();
}
async function readTokenBalance() {
  $('#wallet-b7-row').hidden = true;
  const state = wallet.getState(), provider = wallet.getProvider(), version = identityVersion;
  if (!confirmed || !state.connected || !state.isTestnet || !provider) return;
  const iface = new Interface((await loadArtifact()).abi);
  const readChain = await provider.request({ method: 'eth_chainId' });
  const readAccounts = await provider.request({ method: 'eth_accounts' });
  if (normalizeChainId(readChain) !== EXPECTED_CHAIN_ID || readAccounts?.[0]?.toLowerCase() !== state.address.toLowerCase() || provider !== wallet.getProvider() || version !== identityVersion) return;
  const result = await provider.request({ method: 'eth_call', params: [{ to: confirmed.contractAddress, data: iface.encodeFunctionData('balanceOf', [state.address]) }, 'latest'] });
  const finalChain = await provider.request({ method: 'eth_chainId' });
  const finalAccounts = await provider.request({ method: 'eth_accounts' });
  if (version !== identityVersion || provider !== wallet.getProvider() || normalizeChainId(finalChain) !== EXPECTED_CHAIN_ID || finalAccounts?.[0]?.toLowerCase() !== state.address.toLowerCase()) return;
  $('#wallet-b7-balance').textContent = formatUnits(iface.decodeFunctionResult('balanceOf', result)[0], 6) + ' B7';
  $('#wallet-b7-row').hidden = false;
}

$('#open-wallet').addEventListener('click', () => { pickerMessage = ''; wallet.discover(); dialog.showModal(); if (wallet.getState().connected) wallet.refresh(); else renderWallet(wallet.getState()); });
$('#close-wallet').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
$('#wallet-choices').addEventListener('click', event => {
  const detected = event.target.closest('[data-detected-wallet]');
  if (detected) { chooseInstalled(detected.dataset.detectedWallet); return; }
  const brand = event.target.closest('[data-wallet-brand]');
  if (brand) { if (brand.dataset.walletId) chooseInstalled(brand.dataset.walletId); else openUniversalPicker(); }
});
$('#walletconnect-picker').addEventListener('click', openUniversalPicker);
$('#browse-all-wallets').addEventListener('click', openUniversalPicker);
$('#switch-testnet').addEventListener('click', () => wallet.switchToTestnet());
$('#disconnect-wallet').addEventListener('click', async () => {
  const attempt = ++pickerGeneration;
  pickerMessage = ''; pickerBusy = false;
  wallet.disconnect(); clearPreparation(); renderWallet(wallet.getState());
  try { await pickerController?.disconnect(); }
  catch (error) { if (attempt === pickerGeneration) { pickerMessage = errorText(error); renderWallet(wallet.getState()); } }
});
$('#refresh-wallet').addEventListener('click', () => runOperation(async () => { await wallet.refresh(); await readTokenBalance(); }));
$('#prepare-deployment').addEventListener('click', () => runOperation(async () => {
  if (pendingHash || confirmed) throw new Error('A deployment is already recorded. Verify it before preparing another.');
  clearPreparation();
  report('Checking the reviewed bytecode and estimating the testnet gas fee…');
  const context = await adminContext();
  const gas = await context.provider.request({ method: 'eth_estimateGas', params: [context.tx] });
  const gasPrice = await context.provider.request({ method: 'eth_gasPrice' });
  if (context.version !== identityVersion) throw new Error('The wallet changed. Review the deployment again.');
  prepared = context;
  $('#deployment-admin').textContent = EXPECTED_ADMIN;
  $('#deployment-gas').textContent = formatEther(BigInt(gas) * BigInt(gasPrice)) + ' tBNB';
  $('#deployment-review').hidden = false;
  report('Ready for your review. Nothing has been submitted.');
}));
$('#send-deployment').addEventListener('click', () => runOperation(async () => {
  if (!prepared || pendingHash || confirmed) throw new Error('Review the deployment first.');
  const reviewed = prepared;
  const context = await adminContext();
  if (reviewed.provider !== context.provider || reviewed.version !== context.version || reviewed.tx.data !== context.tx.data) throw new Error('The wallet or deployment changed. Review it again.');
  clearPreparation();
  report('Review the BSC Testnet contract creation in your wallet. No transaction is submitted unless you approve it.');
  // Only this explicit button can request a transaction; the wallet owns all signing.
  const hash = await context.provider.request({ method: 'eth_sendTransaction', params: [context.tx] });
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('The wallet returned an invalid transaction hash. Check its activity before retrying.');
  pendingHash = hash;
  showPendingHash();
  report('Deployment submitted. Use Check deployment confirmation to verify the result.');
}));
$('#check-deployment').addEventListener('click', () => runOperation(checkDeployment));
if (pendingHash) { showPendingHash(); report('Recorded testnet deployment; verification required. Connect the administrator account and check its confirmation.'); }
