/**
 * SkyRx Dispatch Lab: deterministic, browser-only training model.
 * Coordinates, aircraft, calls, flight times and operating limits are fictional.
 * This module does not connect to aircraft, emergency services or medical systems.
 */

const PAYLOADS = ['AED', 'Naloxone kit', 'Epinephrine kit'];
const ACTIVE = new Set(['enroute', 'holding', 'awaiting_handoff', 'returning', 'awaiting_recovery']);
const STATUSES = new Set([...ACTIVE, 'completed', 'cancelled']);
const KM_PER_UNIT = 0.008;
const FLIGHT_KMH = 48;
const RESERVE_PERCENT = 25;
const percentPerKm = 3.4;
const clone = value => JSON.parse(JSON.stringify(value));
const result = (ok, message) => ({ok, message});
const distance = (state, a, b) => Math.hypot(a.x - b.x, a.y - b.y) * (state.kmPerUnit ?? KM_PER_UNIT);
const round = (value, digits = 2) => Number(value.toFixed(digits));
const duration = (state, a, b) => Math.max(12, Math.ceil(distance(state, a, b) / FLIGHT_KMH * 3600 + 12));
const stationFor = state => state.stations.find(s => s.id === state.mission?.stationId);
const incidentFor = state => state.incidents.find(i => i.id === state.mission?.incidentId);
const zoneFor = state => state.zones.find(z => z.id === state.mission?.zoneId);
const active = state => state.mission && ACTIVE.has(state.mission.status);
const point = value => ({x: value.x, y: value.y});

function event(state, type, message, missionId = state.mission?.id) {
  state.sequence += 1;
  state.events.push({id: `EV-${String(state.sequence).padStart(5, '0')}`, time: round(state.clock, 2), type, message, ...(missionId ? {missionId} : {})});
  if (state.events.length > 600) state.events.splice(0, state.events.length - 600);
}

export function createState() {
  const state = {
    version: 1, clock: 0, sequence: 0, missionSequence: 0, incidentSequence: 103,
    weatherHold: false, kmPerUnit: KM_PER_UNIT, handoffRadiusKm: 1.8,
    stations: [
      {id: 'ST-01', name: 'Harbor Station 01', short: 'Harbor', x: 210, y: 380, battery: 96, status: 'ready', payloads: [...PAYLOADS], droneId: 'LF-01'},
      {id: 'ST-02', name: 'North Station 02', short: 'North', x: 495, y: 145, battery: 88, status: 'ready', payloads: ['AED', 'Naloxone kit'], droneId: 'LF-02'},
      {id: 'ST-03', name: 'East Station 03', short: 'East', x: 805, y: 405, battery: 91, status: 'ready', payloads: [...PAYLOADS], droneId: 'LF-03'}
    ],
    zones: [
      {id: 'Z-01', name: 'Pier 7 forecourt', x: 350, y: 460, blocked: false},
      {id: 'Z-02', name: 'Civic plaza', x: 570, y: 330, blocked: false},
      {id: 'Z-03', name: 'East school field', x: 795, y: 245, blocked: false},
      {id: 'Z-04', name: 'South recreation ground', x: 660, y: 565, blocked: false}
    ],
    incidents: [
      {id: 'INC-101', title: 'Medical kit request', location: 'Riverside walkway', x: 400, y: 440, payload: 'AED', priority: 'urgent', status: 'queued', createdAt: 0},
      {id: 'INC-102', title: 'Responder supply request', location: 'Market district', x: 610, y: 300, payload: 'Naloxone kit', priority: 'priority', status: 'queued', createdAt: 0},
      {id: 'INC-103', title: 'Community response request', location: 'East community center', x: 820, y: 270, payload: 'Epinephrine kit', priority: 'priority', status: 'queued', createdAt: 0}
    ],
    mission: null, events: [], history: []
  };
  event(state, 'system', 'Training session initialized. All calls and aircraft are simulated.', null);
  return state;
}

export function resetState() { return createState(); }

/** Rank eligible options by flight + an illustrative 1.4 m/s recipient transfer. */
export function recommend(state, incidentId, zoneId) {
  const incident = state.incidents.find(i => i.id === incidentId);
  if (!incident) return [];
  const zones = zoneId ? state.zones.filter(z => z.id === zoneId) : state.zones;
  const choices = [];
  for (const station of state.stations) {
    for (const zone of zones) {
      const distanceKm = distance(state, station, zone);
      const handoffDistanceKm = distance(state, zone, incident);
      const etaSeconds = duration(state, station, zone);
      const batteryAfter = round(station.battery - distanceKm * percentPerKm * 2 - 3);
      const reasons = [];
      if (incident.status !== 'queued') reasons.push('Incident is not queued');
      if (active(state)) reasons.push('Another mission is active');
      if (station.status !== 'ready') reasons.push('Aircraft is not ready');
      if (!station.payloads.includes(incident.payload)) reasons.push('Requested payload is not stocked');
      if (zone.blocked) reasons.push('Delivery zone is blocked');
      if (state.weatherHold) reasons.push('Weather hold is active');
      if (batteryAfter < RESERVE_PERCENT) reasons.push('Insufficient round-trip battery reserve');
      // A fictional service-area constraint, not a real medical response standard.
      if (handoffDistanceKm > (state.handoffRadiusKm ?? 1.8)) reasons.push('Delivery zone is outside this incident’s simulated handoff radius');
      choices.push({stationId: station.id, zoneId: zone.id, distanceKm: round(distanceKm), etaSeconds,
        recipientEtaSeconds: etaSeconds + Math.ceil(handoffDistanceKm / 0.0014),
        handoffDistanceKm: round(handoffDistanceKm), batteryAfter, eligible: reasons.length === 0, reasons});
    }
  }
  return choices.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.recipientEtaSeconds - b.recipientEtaSeconds || b.batteryAfter - a.batteryAfter || a.stationId.localeCompare(b.stationId));
}

export function dispatch(state, incidentId, stationId, zoneId, approved) {
  if (approved !== true) return result(false, 'Operator approval and a clear delivery-zone check are required.');
  if (active(state)) return result(false, 'A mission is already active. Finish or recover it before launching another.');
  const choice = recommend(state, incidentId, zoneId).find(c => c.stationId === stationId);
  if (!choice || !choice.eligible) return result(false, choice?.reasons.join('; ') || 'Select a valid incident, station and delivery zone.');
  const station = state.stations.find(s => s.id === stationId);
  const incident = state.incidents.find(i => i.id === incidentId);
  const zone = state.zones.find(z => z.id === zoneId);
  state.missionSequence += 1;
  state.mission = {
    id: `MIS-${String(state.missionSequence).padStart(3, '0')}`, incidentId, stationId, zoneId,
    status: 'enroute', progress: 0, returnProgress: 0,
    etaSeconds: choice.etaSeconds, durationSeconds: choice.etaSeconds,
    startedAt: state.clock, deliveredAt: null, completedAt: null, failure: null, receiver: null,
    position: point(station), legStart: point(station), legEnd: point(zone), legElapsed: 0,
    returnDurationSeconds: 0, distanceKm: choice.distanceKm, handoffDistanceKm: choice.handoffDistanceKm,
    recipientEtaSeconds: choice.recipientEtaSeconds, initialBattery: station.battery,
    cancelRequested: false, resumeStatus: null
  };
  station.status = 'reserved'; incident.status = 'active';
  event(state, 'approval', `Operator approved ${incident.id}; ${zone.name} confirmed clear.`);
  event(state, 'dispatch', `${station.droneId} departed ${station.name} with ${incident.payload}.`);
  return result(true, `${station.droneId} is en route to ${zone.name}.`);
}

function archive(state, outcome) {
  const mission = state.mission;
  if (!mission || state.history.some(h => h.id === mission.id)) return;
  state.history.push({
    ...clone(mission), outcome, incidentTitle: incidentFor(state)?.title || '',
    incidentLocation: incidentFor(state)?.location || '', stationName: stationFor(state)?.name || '',
    zoneName: zoneFor(state)?.name || '', payload: incidentFor(state)?.payload || '',
    totalSeconds: round(state.clock - mission.startedAt, 2),
    events: clone(state.events.filter(e => e.missionId === mission.id))
  });
  if (state.history.length > 100) state.history.shift();
}

function finishReturn(state) {
  const mission = state.mission, station = stationFor(state), incident = incidentFor(state);
  mission.status = mission.cancelRequested ? 'cancelled' : 'completed';
  mission.completedAt = state.clock; mission.etaSeconds = 0; mission.position = point(station);
  mission.returnProgress = 1; station.status = 'ready';
  if (mission.cancelRequested) incident.status = 'queued';
  event(state, 'recovery', `${station.droneId} returned to ${station.name}; aircraft available${mission.cancelRequested ? ', incident returned to queue' : ''}.`);
  archive(state, mission.cancelRequested ? 'Returned without delivery' : 'Delivered and returned');
}

/** Advance simulated time only. Browser wall-clock suspension never silently advances missions. */
export function tick(state, seconds = 1) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) return result(false, 'Use a finite simulation interval between 0 and 86400 seconds.');
  let remaining = seconds;
  while (remaining > 0) {
    const mission = state.mission;
    if (!mission || !['enroute', 'returning'].includes(mission.status) || mission.failure) {
      state.clock += remaining;
      break;
    }
    const legDuration = mission.status === 'returning' ? mission.returnDurationSeconds : mission.durationSeconds;
    const delta = Math.min(remaining, Math.max(0, legDuration - mission.legElapsed));
    if (delta <= 0) break;
    state.clock += delta; remaining -= delta; mission.legElapsed += delta;
    const fraction = Math.min(1, mission.legElapsed / legDuration);
    const segmentKm = distance(state, mission.legStart, mission.legEnd);
    const station = stationFor(state);
    station.battery = Math.max(0, station.battery - segmentKm * percentPerKm * delta / legDuration);
    mission.position = {x: mission.legStart.x + (mission.legEnd.x - mission.legStart.x) * fraction, y: mission.legStart.y + (mission.legEnd.y - mission.legStart.y) * fraction};
    mission.etaSeconds = Math.max(0, Math.ceil(legDuration - mission.legElapsed));
    if (mission.status === 'returning') {
      mission.returnProgress = fraction;
      if (fraction >= 1) finishReturn(state);
    } else {
      mission.progress = fraction;
      if (fraction >= 1) {
        if (zoneFor(state).blocked) {
          mission.status = 'holding'; mission.failure = 'blocked_zone'; mission.resumeStatus = 'enroute';
          event(state, 'alert', 'Delivery zone no longer clear. Handoff blocked; operator reroute required.');
        } else {
          mission.status = 'awaiting_handoff';
          event(state, 'arrival', `${station.droneId} arrived at ${zoneFor(state).name}. Awaiting responder handoff confirmation.`);
        }
      }
    }
  }
  return result(true, 'Simulation advanced.');
}

export function getPosition(state) { return state.mission?.position ? point(state.mission.position) : null; }

export function injectFailure(state, type) {
  const mission = state.mission;
  if (!mission || !ACTIVE.has(mission.status)) return result(false, 'Launch a simulated mission before injecting a fault.');
  if (mission.failure || mission.status === 'awaiting_recovery') return result(false, 'Resolve the current incident before injecting another fault.');
  if (!['link_loss', 'blocked_zone', 'low_battery'].includes(type)) return result(false, 'Unknown simulation fault.');
  if (type === 'blocked_zone' && !['enroute', 'awaiting_handoff'].includes(mission.status)) return result(false, 'Delivery-zone faults apply before payload handoff.');
  mission.resumeStatus = mission.status; mission.failure = type;
  if (type === 'link_loss') {
    mission.status = 'holding';
    event(state, 'alert', 'Telemetry link lost. Last known position frozen; simulated aircraft holds. Restore link before issuing commands.');
  } else if (type === 'blocked_zone') {
    zoneFor(state).blocked = true; mission.status = 'holding';
    event(state, 'alert', `${zoneFor(state).name} is blocked. Delivery paused; alternate zone approval required.`);
  } else {
    const station = stationFor(state);
    station.battery = Math.min(station.battery, 15); station.status = 'recovery';
    // Explicit training shortcut: safe landing is simulated, never a real control command.
    const clearZones = state.zones.filter(z => !z.blocked).sort((a, b) => distance(state, mission.position, a) - distance(state, mission.position, b));
    const landing = clearZones[0] || station;
    mission.position = point(landing); mission.recoveryLocation = landing.name;
    mission.status = 'awaiting_recovery'; mission.etaSeconds = 0;
    event(state, 'alert', `Low-battery scenario: simulated safe landing at ${landing.name}. EMS aircraft recovery required${mission.deliveredAt === null ? '; delivery aborted' : '; payload handoff remains recorded'}.`);
  }
  return result(true, 'Fault injected. Follow the recovery action.');
}

export function resolveFailure(state) {
  const mission = state.mission;
  if (!mission?.failure) return result(false, 'There is no active fault to resolve.');
  if (mission.failure === 'low_battery') return result(false, 'Confirm EMS aircraft recovery before releasing this drone.');
  if (mission.failure === 'link_loss') {
    mission.failure = null; mission.status = mission.resumeStatus || 'enroute'; mission.resumeStatus = null;
    event(state, 'reconnected', 'Telemetry link restored and state resynchronized. Mission resumed from the last simulated position.');
    return result(true, 'Link restored. Mission resumed.');
  }
  const station = stationFor(state), incident = incidentFor(state);
  const alternatives = state.zones.filter(z => !z.blocked && z.id !== mission.zoneId)
    .map(zone => ({zone, remainingKm: distance(state, mission.position, zone), transferKm: distance(state, zone, incident), returnKm: distance(state, zone, station)}))
    .filter(candidate => candidate.transferKm <= (state.handoffRadiusKm ?? 1.8) && station.battery - (candidate.remainingKm + candidate.returnKm) * percentPerKm - 3 >= RESERVE_PERCENT)
    .sort((a, b) => a.remainingKm / FLIGHT_KMH * 3600 + a.transferKm / 0.0014 - (b.remainingKm / FLIGHT_KMH * 3600 + b.transferKm / 0.0014));
  if (!alternatives.length) return result(false, 'No eligible alternate zone. Keep holding or cancel and return to station.');
  const alternate = alternatives[0].zone;
  mission.zoneId = alternate.id; mission.legStart = point(mission.position); mission.legEnd = point(alternate);
  mission.legElapsed = 0; mission.progress = 0; mission.durationSeconds = duration(state, mission.legStart, alternate); mission.etaSeconds = mission.durationSeconds;
  mission.handoffDistanceKm = round(distance(state, alternate, incident));
  mission.failure = null; mission.status = 'enroute'; mission.resumeStatus = null;
  event(state, 'reroute', `Operator approved alternate delivery zone: ${alternate.name}. Route and battery reserve recalculated.`);
  return result(true, `Rerouted to ${alternate.name}.`);
}

function beginReturn(state) {
  const mission = state.mission, station = stationFor(state);
  mission.legStart = point(mission.position); mission.legEnd = point(station); mission.legElapsed = 0;
  mission.returnDurationSeconds = duration(state, mission.position, station); mission.etaSeconds = mission.returnDurationSeconds;
  mission.returnProgress = 0; mission.status = 'returning'; mission.failure = null; mission.resumeStatus = null;
  station.status = 'returning';
  event(state, 'return', `${station.droneId} returning to ${station.name}.`);
}

export function confirmDelivery(state, receiver) {
  const mission = state.mission;
  if (!mission || mission.status !== 'awaiting_handoff' || mission.failure) return result(false, 'Handoff can only be confirmed after arrival with a healthy link.');
  if (zoneFor(state).blocked) return result(false, 'The delivery zone is blocked. Reroute before confirming handoff.');
  if (typeof receiver !== 'string' || !receiver.trim() || receiver.trim().length > 80 || /[<>\u0000-\u001f]/.test(receiver)) return result(false, 'Enter a responder identifier, up to 80 plain-text characters.');
  mission.receiver = receiver.trim(); mission.deliveredAt = state.clock; incidentFor(state).status = 'resolved';
  event(state, 'handoff', `${incidentFor(state).payload} handoff confirmed by ${mission.receiver} at ${zoneFor(state).name}.`);
  beginReturn(state);
  return result(true, 'Handoff recorded. Aircraft returning to station.');
}

export function recoverDrone(state) {
  const mission = state.mission;
  if (!mission || mission.status !== 'awaiting_recovery') return result(false, 'No aircraft is awaiting EMS recovery.');
  const station = stationFor(state), delivered = mission.deliveredAt !== null;
  mission.status = delivered ? 'completed' : 'cancelled'; mission.completedAt = state.clock; mission.failure = null;
  station.status = 'ready'; mission.position = point(station); station.battery = 100;
  if (!delivered) incidentFor(state).status = 'queued';
  event(state, 'recovery', `EMS recovery confirmed; ${station.droneId} returned to station with a simulated battery replacement${delivered ? '' : '. Incident returned to dispatch queue'}.`);
  archive(state, delivered ? 'Delivered; EMS recovery' : 'Delivery aborted; EMS recovery');
  return result(true, delivered ? 'Aircraft recovered; handoff remains recorded.' : 'Aircraft recovered. Incident is available for redispatch.');
}

export function cancelMission(state) {
  const mission = state.mission;
  if (!mission || !ACTIVE.has(mission.status)) return result(false, 'There is no active mission to cancel.');
  if (mission.deliveredAt !== null) return result(false, 'The payload is already delivered. Let the aircraft return or complete recovery.');
  if (mission.failure === 'link_loss') return result(false, 'Restore the telemetry link before sending a return command.');
  if (mission.status === 'awaiting_recovery') return result(false, 'Confirm EMS recovery for the grounded aircraft.');
  if (mission.cancelRequested) return result(false, 'The aircraft is already returning after cancellation.');
  mission.cancelRequested = true;
  event(state, 'cancel', 'Operator cancelled delivery. Aircraft returning; incident will rejoin the queue after recovery.');
  beginReturn(state);
  return result(true, 'Delivery cancelled. Aircraft returning safely to station.');
}

export function addIncident(state, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result(false, 'Provide a valid synthetic incident.');
  const clean = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100 && !/[<>\u0000-\u001f]/.test(value);
  if (!clean(input.title) || !clean(input.location)) return result(false, 'Title and location must be plain text between 1 and 100 characters.');
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1000 || input.y < 0 || input.y > 680) return result(false, 'Choose a location within the fictional service map.');
  if (input.lat !== undefined && (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90) || input.lng !== undefined && (!Number.isFinite(input.lng) || Math.abs(input.lng) > 180)) return result(false, 'Geographic coordinates must be valid numbers.');
  if (!PAYLOADS.includes(input.payload) || !['urgent', 'priority', 'routine'].includes(input.priority)) return result(false, 'Choose a supported payload and priority.');
  if (state.incidents.length >= 100) return result(false, 'This training session has reached its 100-incident limit. Reset to start a new session.');
  state.incidentSequence += 1;
  const incident = {id: `INC-${state.incidentSequence}`, title: input.title.trim(), location: input.location.trim(), x: input.x, y: input.y, payload: input.payload, priority: input.priority, status: 'queued', createdAt: state.clock};
  if (input.lat !== undefined) incident.lat = input.lat;
  if (input.lng !== undefined) incident.lng = input.lng;
  state.incidents.push(incident);
  event(state, 'incident', `${incident.id}: synthetic ${incident.payload} request added at ${incident.location}.`, null);
  return result(true, `${incident.id} added to the dispatch queue.`);
}

/** Reject malformed local storage instead of merging it into live simulation state. */
export function validateSnapshot(input) {
  try {
    if (typeof input === 'string') input = JSON.parse(input);
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) return null;
    const finite = (v, lo = 0, hi = 1e9) => Number.isFinite(v) && v >= lo && v <= hi;
    const text = (v, max = 200) => typeof v === 'string' && v.length <= max && !/[<>\u0000-\u001f]/.test(v);
    const validPoint = v => v && finite(v.x, 0, 1000) && finite(v.y, 0, 680) && (v.lat === undefined || finite(v.lat,-90,90)) && (v.lng === undefined || finite(v.lng,-180,180));
    const validId = id => typeof id === 'string' && /^[A-Z]+-\d+$/.test(id);
    if (!finite(input.clock) || !Number.isInteger(input.sequence) || !finite(input.sequence) || !Number.isInteger(input.missionSequence) || !finite(input.missionSequence) || !Number.isInteger(input.incidentSequence) || !finite(input.incidentSequence) || typeof input.weatherHold !== 'boolean') return null;
    if (input.kmPerUnit !== undefined && !finite(input.kmPerUnit, 0.00001, 1) || input.handoffRadiusKm !== undefined && !finite(input.handoffRadiusKm,0.01,100)) return null;
    if (!Array.isArray(input.stations) || input.stations.length !== 3 || !Array.isArray(input.zones) || input.zones.length !== 4 || !Array.isArray(input.incidents) || input.incidents.length > 100 || !Array.isArray(input.events) || input.events.length > 600 || !Array.isArray(input.history) || input.history.length > 100) return null;
    const unique = rows => new Set(rows.map(v => v.id)).size === rows.length;
    for (const list of [input.stations, input.zones, input.incidents, input.events, input.history]) if (!unique(list)) return null;
    for (const s of input.stations) if (!validId(s.id) || !text(s.name) || !text(s.short) || !text(s.droneId) || !validPoint(s) || !finite(s.battery, 0, 100) || !['ready','reserved','returning','recovery','offline'].includes(s.status) || !Array.isArray(s.payloads) || s.payloads.some(p => !PAYLOADS.includes(p))) return null;
    for (const z of input.zones) if (!validId(z.id) || !text(z.name) || !validPoint(z) || typeof z.blocked !== 'boolean') return null;
    for (const i of input.incidents) if (!validId(i.id) || !text(i.title, 100) || !text(i.location, 100) || !validPoint(i) || !PAYLOADS.includes(i.payload) || !['urgent','priority','routine'].includes(i.priority) || !['queued','active','resolved','cancelled'].includes(i.status) || !finite(i.createdAt, 0, input.clock)) return null;
    const validMission = m => {
      if (!m || !validId(m.id) || !STATUSES.has(m.status) || !input.stations.some(s => s.id === m.stationId) || !input.zones.some(z => z.id === m.zoneId) || !input.incidents.some(i => i.id === m.incidentId)) return false;
      if (![m.position, m.legStart, m.legEnd].every(validPoint) || !finite(m.progress,0,1) || !finite(m.returnProgress,0,1) || !finite(m.etaSeconds) || !finite(m.durationSeconds, 1) || !finite(m.legElapsed) || !finite(m.returnDurationSeconds) || !finite(m.startedAt,0,input.clock) || ![null,'link_loss','blocked_zone','low_battery'].includes(m.failure)) return false;
      if (m.deliveredAt !== null && !finite(m.deliveredAt,m.startedAt,input.clock) || m.completedAt !== null && !finite(m.completedAt,m.startedAt,input.clock) || m.receiver !== null && !text(m.receiver,80) || typeof m.cancelRequested !== 'boolean') return false;
      if (![null,'enroute','awaiting_handoff','returning'].includes(m.resumeStatus)) return false;
      if (m.status === 'holding' && m.failure === 'link_loss' && !['enroute','awaiting_handoff','returning'].includes(m.resumeStatus)) return false;
      const returning = m.status === 'returning' || m.resumeStatus === 'returning' || m.returnDurationSeconds > 0 && (m.deliveredAt !== null || m.cancelRequested);
      if (m.legElapsed > (returning ? m.returnDurationSeconds : m.durationSeconds)) return false;
      if (m.status === 'enroute' && m.legElapsed >= m.durationSeconds || m.status === 'returning' && m.legElapsed >= m.returnDurationSeconds) return false;
      if (['enroute','awaiting_handoff','returning','completed','cancelled'].includes(m.status) && m.failure !== null) return false;
      return true;
    };
    if (input.mission !== null && !validMission(input.mission)) return null;
    for (const e of input.events) if (!validId(e.id) || !finite(e.time,0,input.clock) || !text(e.type,40) || !text(e.message,600) || e.missionId && !validId(e.missionId)) return null;
    const maxSuffix = rows => rows.reduce((max, row) => Math.max(max, Number(row.id.split('-').at(-1))), 0);
    if (input.sequence < maxSuffix(input.events) || input.incidentSequence < maxSuffix(input.incidents) || input.missionSequence < maxSuffix([...input.history, ...(input.mission ? [input.mission] : [])])) return null;
    for (const h of input.history) {
      if (!validMission(h) || !['completed','cancelled'].includes(h.status) || !text(h.outcome) || !text(h.incidentTitle) || !text(h.incidentLocation) || !text(h.stationName) || !text(h.zoneName) || !PAYLOADS.includes(h.payload) || !finite(h.totalSeconds) || !Array.isArray(h.events) || h.events.length > 600) return null;
      for (const e of h.events) if (!validId(e.id) || !finite(e.time,0,input.clock) || !text(e.type,40) || !text(e.message,600) || e.missionId && !validId(e.missionId)) return null;
    }
    const m = input.mission;
    const occupied = input.stations.filter(s => ['reserved','returning','recovery'].includes(s.status));
    if (m && ACTIVE.has(m.status)) {
      if (occupied.length !== 1 || occupied[0].id !== m.stationId) return null;
      if (m.status === 'holding' && !['link_loss','blocked_zone'].includes(m.failure) || m.status === 'awaiting_recovery' && m.failure !== 'low_battery') return null;
      const incident = input.incidents.find(i => i.id === m.incidentId);
      if (incident.status !== (m.deliveredAt === null ? 'active' : 'resolved')) return null;
    } else if (occupied.length) return null;
    if (input.incidents.filter(i => i.status === 'active').length > (m && ACTIVE.has(m.status) && m.deliveredAt === null ? 1 : 0)) return null;
    // Whitelist top-level data; serialized data cannot introduce functions/prototypes.
    return clone({version:1,clock:input.clock,sequence:input.sequence,missionSequence:input.missionSequence,incidentSequence:input.incidentSequence,weatherHold:input.weatherHold,kmPerUnit:input.kmPerUnit ?? KM_PER_UNIT,handoffRadiusKm:input.handoffRadiusKm ?? 1.8,stations:input.stations,zones:input.zones,incidents:input.incidents,mission:input.mission,events:input.events,history:input.history});
  } catch { return null; }
}
