// Pure preparation and verification only: no provider, wallet, signing, or network calls.
import { Interface, getAddress, getCreateAddress, keccak256 } from './vendor/ethers.js';
import { normalizeChainId } from './chain-id.js';

export const EXPECTED_CHAIN_ID = '0x61';
export const EXPECTED_ADMIN = '0x16e3ce3D715d6EEB45B8B302103BC42352206d01';
export const EXPECTED_CREATION_CODE_HASH = '0x5061480a3a616e0244c76f58fd2abb1351199f5afd9ba5709ba13341fbaea00e';
export const EXPECTED_RUNTIME_CODE_HASH = '0x155eb7c12ce5ac8a9a791d0a922cf6c0bf27501d76b1c9d9c43de68b52dbd02d';

export class DeploymentValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeploymentValidationError';
    this.code = code;
  }
}

function requireCondition(condition, code, message) {
  if (!condition) throw new DeploymentValidationError(code, message);
}

function quantity(value, label) {
  const valid = (typeof value === 'bigint' && value >= 0n)
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value));
  requireCondition(valid, 'INVALID_QUANTITY', `${label} must be a nonnegative RPC quantity.`);
  return BigInt(value);
}

function address(value, label) {
  try {
    requireCondition(typeof value === 'string', 'INVALID_ADDRESS', `${label} is missing.`);
    return getAddress(value);
  } catch (error) {
    if (error instanceof DeploymentValidationError) throw error;
    throw new DeploymentValidationError('INVALID_ADDRESS', `${label} must be a valid checksummed address.`);
  }
}

function data(value, label, bytes) {
  requireCondition(typeof value === 'string' && /^0x(?:[a-f0-9]{2})+$/i.test(value)
    && (bytes === undefined || value.length === 2 + bytes * 2),
  'INVALID_DATA', `${label} must be nonempty hexadecimal data${bytes ? ` (${bytes} bytes)` : ''}.`);
  return value.toLowerCase();
}

export function assertBscTestnet(chainId) {
  let normalized;
  try { normalized = normalizeChainId(chainId); }
  catch { throw new DeploymentValidationError('INVALID_QUANTITY', 'Chain ID must be a valid positive network identifier.'); }
  requireCondition(normalized === EXPECTED_CHAIN_ID,
    'WRONG_NETWORK', 'Use BSC testnet (chain 97). Mainnet deployment is disabled.');
  return EXPECTED_CHAIN_ID;
}

export function assertExpectedAccount(account) {
  const normalized = address(account, 'Connected account');
  requireCondition(normalized === EXPECTED_ADMIN,
    'WRONG_ACCOUNT', `Select the authorized account ${EXPECTED_ADMIN}.`);
  return normalized;
}

export function validateDeploymentArtifact(artifact) {
  requireCondition(artifact?.contractName === 'B7DemoGold' && artifact.simulatedOnly === true
    && artifact.evmVersion === 'shanghai', 'INVALID_ARTIFACT', 'Use the reviewed B7 demo artifact.');
  const creation = data(artifact.bytecode, 'Creation bytecode');
  const runtime = data(artifact.deployedBytecode, 'Runtime bytecode');
  requireCondition(keccak256(creation) === EXPECTED_CREATION_CODE_HASH
    && keccak256(runtime) === EXPECTED_RUNTIME_CODE_HASH,
  'ARTIFACT_MISMATCH', 'The artifact differs from the reviewed deployment build.');
  const constructors = Array.isArray(artifact.abi) ? artifact.abi.filter(item => item.type === 'constructor') : [];
  requireCondition(constructors.length === 1 && constructors[0].stateMutability === 'nonpayable'
    && constructors[0].inputs?.length === 1 && constructors[0].inputs[0].type === 'address',
  'INVALID_CONSTRUCTOR', 'Expected exactly one nonpayable address constructor parameter.');
  return Object.freeze({ creationCodeHash: EXPECTED_CREATION_CODE_HASH, runtimeCodeHash: EXPECTED_RUNTIME_CODE_HASH });
}

/** Re-read account and chain immediately before passing this transaction to the wallet. */
export function buildDeploymentTransaction({ artifact, account, chainId }) {
  assertBscTestnet(chainId);
  assertExpectedAccount(account);
  validateDeploymentArtifact(artifact);
  const encodedAdmin = new Interface(artifact.abi).encodeDeploy([EXPECTED_ADMIN]);
  return Object.freeze({
    from: EXPECTED_ADMIN,
    data: artifact.bytecode.toLowerCase() + encodedAdmin.slice(2).toLowerCase(),
    value: '0x0',
    chainId: EXPECTED_CHAIN_ID,
  });
}

/**
 * Validate RPC responses for the submitted hash. The controller must fetch code at
 * receipt.contractAddress at a pinned finalized block at or after the receipt,
 * on the same chain/provider session, and check both block hashes are canonical.
 * Checking runtime alone cannot establish the constructor administrator, so the mined
 * transaction input must exactly match reviewed initcode plus the fixed administrator.
 */
export function validateDeploymentReceipt({ artifact, account, chainId, transactionHash, receipt, transaction, code }) {
  const expected = buildDeploymentTransaction({ artifact, account, chainId });
  const expectedHash = data(transactionHash, 'Submitted transaction hash', 32);
  requireCondition(receipt !== null && typeof receipt === 'object', 'RECEIPT_PENDING', 'The deployment receipt is not available yet.');
  requireCondition(quantity(receipt.status, 'Receipt status') === 1n, 'DEPLOYMENT_REVERTED', 'The deployment transaction reverted.');
  requireCondition(receipt.to === null, 'NOT_CONTRACT_CREATION', 'The receipt must describe a contract creation.');
  requireCondition(address(receipt.from, 'Receipt sender') === EXPECTED_ADMIN, 'WRONG_SENDER', 'Receipt sender differs from the authorized account.');
  requireCondition(data(receipt.transactionHash, 'Receipt transaction hash', 32) === expectedHash,
    'TRANSACTION_HASH_MISMATCH', 'The receipt belongs to another transaction.');
  const blockHash = data(receipt.blockHash, 'Receipt block hash', 32);
  const blockNumber = quantity(receipt.blockNumber, 'Receipt block number');
  requireCondition(blockNumber > 0n, 'INVALID_BLOCK', 'The deployment must be included in a non-genesis block.');
  const contractAddress = address(receipt.contractAddress, 'Deployed contract address');
  requireCondition(contractAddress !== '0x0000000000000000000000000000000000000000', 'INVALID_ADDRESS', 'The deployed address cannot be zero.');

  requireCondition(transaction !== null && typeof transaction === 'object', 'TRANSACTION_MISSING', 'Fetch the mined deployment transaction before verification.');
  requireCondition(data(transaction.hash, 'Mined transaction hash', 32) === expectedHash,
    'TRANSACTION_HASH_MISMATCH', 'The mined transaction differs from the submitted transaction.');
  assertBscTestnet(transaction.chainId);
  requireCondition(transaction.to === null, 'NOT_CONTRACT_CREATION', 'The mined transaction must create a contract.');
  requireCondition(address(transaction.from, 'Transaction sender') === EXPECTED_ADMIN, 'WRONG_SENDER', 'Transaction sender differs from the authorized account.');
  requireCondition(quantity(transaction.value, 'Transaction value') === 0n, 'NONZERO_VALUE', 'The deployment must transfer zero native currency.');
  requireCondition(data(transaction.input, 'Transaction input') === expected.data, 'INITCODE_MISMATCH', 'Transaction data differs from reviewed bytecode and administrator.');
  requireCondition(data(transaction.blockHash, 'Transaction block hash', 32) === blockHash
    && quantity(transaction.blockNumber, 'Transaction block number') === blockNumber,
  'BLOCK_MISMATCH', 'The transaction and receipt must belong to the same block.');
  const createdAddress = getCreateAddress({ from: EXPECTED_ADMIN, nonce: quantity(transaction.nonce, 'Transaction nonce') });
  requireCondition(contractAddress === createdAddress, 'CONTRACT_ADDRESS_MISMATCH', 'The receipt address does not match the creation sender and nonce.');
  const deployedCode = data(code, 'Deployed runtime code');
  requireCondition(deployedCode === artifact.deployedBytecode.toLowerCase()
    && keccak256(deployedCode) === EXPECTED_RUNTIME_CODE_HASH,
  'RUNTIME_MISMATCH', 'The deployed runtime differs from the reviewed contract.');

  return Object.freeze({
    verified: true,
    chainId: EXPECTED_CHAIN_ID,
    admin: EXPECTED_ADMIN,
    contractAddress,
    transactionHash: expectedHash,
    blockHash,
    blockNumber: '0x' + blockNumber.toString(16),
    runtimeCodeHash: EXPECTED_RUNTIME_CODE_HASH,
  });
}
