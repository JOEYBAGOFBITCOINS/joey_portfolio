/**
 * B7 Financial browser-only concept model. No wallet, payment, market-price,
 * custody, blockchain, shipping, or network integration exists in this module.
 * Every identifier and ledger entry represents synthetic demonstration data.
 * One B7 represents one simulated gram; all balances use integer micrograms.
 */
export const SCHEMA_VERSION = 1;
export const UNITS_PER_GRAM = 1_000_000;
export const DEMO_RATE_USD_PER_GRAM = 100;
export const DEMO_RATE_USD_CENTS_PER_GRAM = 10_000;
export const DEMO_RATE_LABEL = "$100 / gram · fixed demo rate, not a live market price";
export const INITIAL_WALLET_UNITS = 12_500_000;
export const INITIAL_SUPPLY_UNITS = 500_000_000;
export const INITIAL_USD_CENTS = 1_000_000;
export const DEMO_WALLET_ADDRESS = "DEMO-WALLET-B7-0001";

export const TIERS = Object.freeze([
  { level: 1, name: "Merope", minimumUnits: 0, benefits: ["Demo portfolio", "Reserve education"] },
  { level: 2, name: "Sterope", minimumUnits: 10_000_000, benefits: ["Ownership summaries", "Redemption planning"] },
  { level: 3, name: "Celaeno", minimumUnits: 25_000_000, benefits: ["Detailed statements", "Statement preferences"] },
  { level: 4, name: "Taygete", minimumUnits: 50_000_000, benefits: ["Collection planning", "Collection preferences"] },
  { level: 5, name: "Maia", minimumUnits: 100_000_000, benefits: ["Consolidated statements", "Reserve briefings"] },
  { level: 6, name: "Electra", minimumUnits: 250_000_000, benefits: ["Allocation planning", "Delivery preferences"] },
  { level: 7, name: "Alcyone", minimumUnits: 1_000_000_000, benefits: ["Bespoke reporting", "Household summaries"] },
].map(tier => Object.freeze({ ...tier, benefits: Object.freeze(tier.benefits) })));

export const PURCHASE_STATUSES = Object.freeze(["payment_authorized", "gold_allocated", "completed", "cancelled", "failed"]);
export const REDEMPTION_STATUSES = Object.freeze(["tokens_held", "delivery_confirmed", "completed", "cancelled", "failed"]);
const CLOSED_STATUSES = new Set(["completed", "cancelled", "failed"]);
const ABORTED_STATUSES = new Set(["cancelled", "failed"]);
const MAX_UNITS = Number.MAX_SAFE_INTEGER;

export class DemoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DemoError";
    this.code = code;
  }
}

function fail(code, message) { throw new DemoError(code, message); }
function isAmount(value) { return Number.isSafeInteger(value) && value >= 0; }
function sum(orders, field, predicate = () => true) {
  return orders.filter(predicate).reduce((total, order) => total + order[field], 0);
}

/** Exact decimal parsing: excess precision is rejected, never silently rounded. */
function parseDecimal(input, places, label) {
  if ((typeof input !== "string" && typeof input !== "number") || (typeof input === "number" && !Number.isFinite(input))) {
    fail("INVALID_AMOUNT", `Enter a positive ${label} amount.`);
  }
  const text = String(input).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) fail("INVALID_AMOUNT", `Enter a positive ${label} amount using digits and a decimal point.`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > places) fail("EXCESS_PRECISION", `${label} supports at most ${places} decimal places.`);
  const integer = BigInt(whole) * (10n ** BigInt(places)) + BigInt(fraction.padEnd(places, "0") || "0");
  if (integer <= 0n) fail("INVALID_AMOUNT", `${label} amount must be greater than zero.`);
  if (integer > BigInt(MAX_UNITS)) fail("AMOUNT_TOO_LARGE", `${label} amount is too large for this demo.`);
  return Number(integer);
}

export function parseUSDToCents(value) { return parseDecimal(value, 2, "Demo USD"); }
export function parseGramsToUnits(value) { return parseDecimal(value, 6, "B7 / gram"); }

/** Returns an exact ungrouped decimal suitable for forms and display. */
export function formatUnits(units, maximumFractionDigits = 6) {
  if (!isAmount(units)) fail("INVALID_UNITS", "Token units must be a nonnegative safe integer.");
  if (!Number.isInteger(maximumFractionDigits) || maximumFractionDigits < 0 || maximumFractionDigits > 6) {
    fail("INVALID_PRECISION", "Display precision must be between zero and six.");
  }
  const whole = Math.floor(units / UNITS_PER_GRAM);
  const fraction = String(units % UNITS_PER_GRAM).padStart(6, "0").slice(0, maximumFractionDigits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export const formatTokenUnits = formatUnits;

export function createInitialState({ createdAt = new Date().toISOString() } = {}) {
  const state = {
    schemaVersion: SCHEMA_VERSION,
    simulation: true,
    createdAt,
    walletAddress: DEMO_WALLET_ADDRESS,
    walletUnits: INITIAL_WALLET_UNITS,
    heldTokenUnits: 0,
    totalSupplyUnits: INITIAL_SUPPLY_UNITS,
    reserveUnits: INITIAL_SUPPLY_UNITS,
    allocatedGoldUnits: 0,
    availableUSDCents: INITIAL_USD_CENTS,
    nextSequence: 1,
    purchases: [],
    redemptions: [],
    ledger: [],
  };
  return assertState(state);
}

export function getOwnedUnits(state) { return state.walletUnits + state.heldTokenUnits; }
export function getTier(units) {
  if (!isAmount(units)) fail("INVALID_UNITS", "Tier balance must be a nonnegative safe integer.");
  return [...TIERS].reverse().find(tier => units >= tier.minimumUnits);
}
export function currentTier(stateOrUnits) {
  return getTier(typeof stateOrUnits === "number" ? stateOrUnits : getOwnedUnits(stateOrUnits));
}
export function getAccounting(state) {
  assertState(state);
  return {
    backingUnits: state.reserveUnits,
    outstandingTokenUnits: state.totalSupplyUnits,
    pendingAllocationUnits: state.allocatedGoldUnits,
    totalSimulatedGoldUnits: state.reserveUnits + state.allocatedGoldUnits,
    redemptionReservedUnits: state.heldTokenUnits,
    unencumberedBackingUnits: state.reserveUnits - state.heldTokenUnits,
    walletOwnedUnits: getOwnedUnits(state),
    coverageRatio: state.totalSupplyUnits === 0 ? 1 : state.reserveUnits / state.totalSupplyUnits,
  };
}

/** Validate persisted data before accepting it. Invalid saves should be discarded. */
export function validateState(state) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  if (!state || typeof state !== "object" || Array.isArray(state)) return { valid: false, errors: ["State must be an object."] };
  check(state.schemaVersion === SCHEMA_VERSION, "Unsupported state version.");
  check(state.simulation === true && state.walletAddress === DEMO_WALLET_ADDRESS, "State must identify the synthetic demo wallet.");
  check(typeof state.createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(state.createdAt) && Number.isFinite(Date.parse(state.createdAt)), "Invalid creation date.");
  for (const field of ["walletUnits", "heldTokenUnits", "totalSupplyUnits", "reserveUnits", "allocatedGoldUnits", "availableUSDCents", "nextSequence"]) {
    check(isAmount(state[field]), `Invalid ${field}.`);
  }
  check(state.nextSequence >= 1 && state.nextSequence < MAX_UNITS, "Invalid event sequence.");
  for (const field of ["purchases", "redemptions", "ledger"]) check(Array.isArray(state[field]), `Invalid ${field} collection.`);
  if (errors.length) return { valid: false, errors };

  const identifiers = new Set();
  for (const [collection, prefix, statuses] of [[state.purchases, "PUR", PURCHASE_STATUSES], [state.redemptions, "RED", REDEMPTION_STATUSES]]) {
    const keys = new Set();
    for (const order of collection) {
      if (!order || typeof order !== "object" || Array.isArray(order)) { errors.push("Invalid order."); continue; }
      check(typeof order.id === "string" && new RegExp(`^DEMO-${prefix}-[0-9]{4,}$`).test(order.id) && !identifiers.has(order.id), "Invalid or duplicate demo order ID.");
      identifiers.add(order.id);
      check(isAmount(order.quantityUnits) && order.quantityUnits > 0, "Invalid order quantity.");
      check(statuses.includes(order.status), "Invalid order status.");
      check(order.idempotencyKey === null || (typeof order.idempotencyKey === "string" && order.idempotencyKey.length > 0 && order.idempotencyKey.length <= 120 && !keys.has(order.idempotencyKey)), "Invalid or duplicate idempotency key.");
      if (order.idempotencyKey !== null) keys.add(order.idempotencyKey);
      if (prefix === "PUR") {
        check(isAmount(order.amountUSDCents) && order.amountUSDCents > 0, "Invalid purchase amount.");
        check(order.quantityUnits === order.amountUSDCents * 100, "Purchase does not match the fixed demo quote.");
      }
      if (order.failureReason !== undefined) check(typeof order.failureReason === "string" && order.failureReason.length <= 240, "Invalid failure reason.");
    }
  }
  if (errors.length) return { valid: false, errors };

  const minted = sum(state.purchases, "quantityUnits", order => order.status === "completed");
  const burned = sum(state.redemptions, "quantityUnits", order => order.status === "completed");
  const held = sum(state.redemptions, "quantityUnits", order => !CLOSED_STATUSES.has(order.status));
  const spent = sum(state.purchases, "amountUSDCents", order => !ABORTED_STATUSES.has(order.status));
  check(state.reserveUnits === state.totalSupplyUnits, "Recorded backing must equal outstanding demo token units.");
  check(state.totalSupplyUnits === INITIAL_SUPPLY_UNITS + minted - burned, "Supply does not reconcile to completed orders.");
  check(state.walletUnits === INITIAL_WALLET_UNITS + minted - burned - held, "Wallet does not reconcile to orders.");
  check(state.heldTokenUnits === held, "Held tokens do not reconcile to open redemptions.");
  check(state.allocatedGoldUnits === sum(state.purchases, "quantityUnits", order => order.status === "gold_allocated"), "Pending gold allocation does not reconcile.");
  check(state.availableUSDCents === INITIAL_USD_CENTS - spent, "Demo USD balance does not reconcile to orders.");
  check(state.walletUnits + state.heldTokenUnits <= state.totalSupplyUnits, "Wallet holdings exceed supply.");
  check(state.heldTokenUnits <= state.reserveUnits, "Redemption reservations exceed recorded backing.");
  check(isAmount(minted) && isAmount(burned) && isAmount(held) && isAmount(spent) && isAmount(state.reserveUnits + state.allocatedGoldUnits), "Aggregate values exceed safe integer precision.");

  check(state.nextSequence === state.ledger.length + 1, "Event sequence does not reconcile to the ledger.");
  for (let index = 0; index < state.ledger.length; index += 1) {
    const entry = state.ledger[index];
    const sequence = index + 1;
    check(entry && entry.id === demoId("EVENT", sequence) && entry.sequence === sequence && entry.simulation === true && identifiers.has(entry.orderId) && typeof entry.action === "string" && typeof entry.description === "string" && entry.description.length <= 300, "Invalid synthetic ledger event.");
  }
  return { valid: errors.length === 0, errors };
}

export function assertState(state) {
  const result = validateState(state);
  if (!result.valid) fail("INVALID_STATE", `Invalid demo state: ${result.errors.join(" ")}`);
  return state;
}

function clone(state) {
  assertState(state);
  return { ...state, purchases: state.purchases.map(order => ({ ...order })), redemptions: state.redemptions.map(order => ({ ...order })), ledger: state.ledger.map(entry => ({ ...entry })) };
}
function demoId(kind, sequence) { return `DEMO-${kind}-${String(sequence).padStart(4, "0")}`; }
function record(state, order, action, description) {
  state.ledger.push({ id: demoId("EVENT", state.nextSequence), sequence: state.nextSequence, simulation: true, orderId: order.id, action, description });
  state.nextSequence += 1;
  return assertState(state);
}
function idempotencyKey(options) {
  const key = options.idempotencyKey ?? null;
  if (key !== null && (typeof key !== "string" || !key.length || key.length > 120)) fail("INVALID_IDEMPOTENCY_KEY", "Use an idempotency key of 1–120 characters.");
  return key;
}
function existingOrder(collection, key, amount, field) {
  if (key === null) return false;
  const existing = collection.find(order => order.idempotencyKey === key);
  if (!existing) return false;
  if (existing[field] !== amount) fail("IDEMPOTENCY_CONFLICT", "This request key was already used for a different amount.");
  return true;
}
function locate(state, collection, id) {
  assertState(state);
  const order = state[collection].find(candidate => candidate.id === id);
  if (!order) fail("ORDER_NOT_FOUND", "The demo order could not be found.");
  return order;
}
function staleOrClosed(order, options) {
  return CLOSED_STATUSES.has(order.status) || (options.expectedStatus !== undefined && options.expectedStatus !== order.status);
}

export function startPurchase(state, amountUSD, options = {}) {
  assertState(state);
  const amountUSDCents = parseUSDToCents(amountUSD);
  const key = idempotencyKey(options);
  if (existingOrder(state.purchases, key, amountUSDCents, "amountUSDCents")) return state;
  if (amountUSDCents > state.availableUSDCents) fail("INSUFFICIENT_DEMO_USD", "This purchase exceeds your available demo USD.");
  const quantityUnits = amountUSDCents * 100;
  const next = clone(state);
  const order = { id: demoId("PUR", next.nextSequence), amountUSDCents, quantityUnits, status: "payment_authorized", idempotencyKey: key };
  next.availableUSDCents -= amountUSDCents;
  next.purchases.push(order);
  return record(next, order, "purchase_authorized", "Demo payment authorized. No real money moved; no tokens issued.");
}

/** Pass the status rendered in the UI as expectedStatus to ignore stale clicks. */
export function advancePurchase(state, id, options = {}) {
  const current = locate(state, "purchases", id);
  if (staleOrClosed(current, options)) return state;
  const next = clone(state);
  const order = next.purchases.find(candidate => candidate.id === id);
  if (order.status === "payment_authorized") {
    order.status = "gold_allocated";
    next.allocatedGoldUnits += order.quantityUnits;
    return record(next, order, "gold_allocated", "Simulated gold acquisition confirmed. Allocation awaits demo token issuance.");
  }
  order.status = "completed";
  next.allocatedGoldUnits -= order.quantityUnits;
  next.reserveUnits += order.quantityUnits;
  next.totalSupplyUnits += order.quantityUnits;
  next.walletUnits += order.quantityUnits;
  return record(next, order, "tokens_minted", "Demo B7 issued against the confirmed simulated allocation. No blockchain transaction occurred.");
}

function abortPurchase(state, id, status, reason) {
  const current = locate(state, "purchases", id);
  if (CLOSED_STATUSES.has(current.status)) return state;
  const next = clone(state);
  const order = next.purchases.find(candidate => candidate.id === id);
  if (order.status === "gold_allocated") next.allocatedGoldUnits -= order.quantityUnits;
  next.availableUSDCents += order.amountUSDCents;
  order.status = status;
  if (reason !== undefined) order.failureReason = String(reason).slice(0, 240);
  return record(next, order, `purchase_${status}`, `Demo purchase ${status}. Demo USD restored and any pending allocation released; no tokens issued.`);
}
export function cancelPurchase(state, id) { return abortPurchase(state, id, "cancelled"); }
export function failPurchase(state, id, reason = "Simulated allocation failure") { return abortPurchase(state, id, "failed", reason); }

export function startRedemption(state, grams, options = {}) {
  assertState(state);
  const quantityUnits = parseGramsToUnits(grams);
  const key = idempotencyKey(options);
  if (existingOrder(state.redemptions, key, quantityUnits, "quantityUnits")) return state;
  if (quantityUnits > state.walletUnits) fail("INSUFFICIENT_B7", "This redemption exceeds your available demo B7.");
  const next = clone(state);
  const order = { id: demoId("RED", next.nextSequence), quantityUnits, status: "tokens_held", idempotencyKey: key };
  next.walletUnits -= quantityUnits;
  next.heldTokenUnits += quantityUnits;
  next.redemptions.push(order);
  return record(next, order, "redemption_requested", "Demo B7 reserved for simulated physical redemption. Tokens remain in supply until finalization.");
}

export function advanceRedemption(state, id, options = {}) {
  const current = locate(state, "redemptions", id);
  if (staleOrClosed(current, options)) return state;
  const next = clone(state);
  const order = next.redemptions.find(candidate => candidate.id === id);
  if (order.status === "tokens_held") {
    order.status = "delivery_confirmed";
    return record(next, order, "delivery_confirmed", "Synthetic delivery confirmation recorded for finalization. No physical gold was shipped.");
  }
  order.status = "completed";
  next.heldTokenUnits -= order.quantityUnits;
  next.totalSupplyUnits -= order.quantityUnits;
  next.reserveUnits -= order.quantityUnits;
  return record(next, order, "tokens_burned", "Demo redemption finalized: held B7 burned and its recorded backing released together. No actual delivery occurred.");
}

function abortRedemption(state, id, status, reason) {
  const current = locate(state, "redemptions", id);
  if (CLOSED_STATUSES.has(current.status)) return state;
  if (current.status === "delivery_confirmed") fail("DELIVERY_ALREADY_CONFIRMED", "Complete the simulated redemption after delivery confirmation; it can no longer be cancelled.");
  const next = clone(state);
  const order = next.redemptions.find(candidate => candidate.id === id);
  next.walletUnits += order.quantityUnits;
  next.heldTokenUnits -= order.quantityUnits;
  order.status = status;
  if (reason !== undefined) order.failureReason = String(reason).slice(0, 240);
  return record(next, order, `redemption_${status}`, `Demo redemption ${status}. Held B7 returned to the available balance; supply and backing unchanged.`);
}
export function cancelRedemption(state, id) { return abortRedemption(state, id, "cancelled"); }
export function failRedemption(state, id, reason = "Simulated fulfillment failure") { return abortRedemption(state, id, "failed", reason); }
