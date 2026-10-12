// Simplified in-memory store (no Redis persistence)
// Data will be lost on bot restart - use for testing only
const inMemoryStore = {};

const KEYS = {
  signal: (id) => `signal:${id}`,
};

function newSignalId(pair) {
  return `${pair}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function saveNewSignal(signal) {
  inMemoryStore[signal.id] = signal;
  return signal;
}

async function getSignal(id) {
  return inMemoryStore[id] || null;
}

async function updateSignal(id, patch) {
  const existing = inMemoryStore[id];
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  inMemoryStore[id] = updated;
  return updated;
}

async function closeSignal(id, patch) {
  const updated = await updateSignal(id, patch);
  if (updated) updated.closed = true;
  return updated;
}

async function getOpenSignalIds() {
  return Object.keys(inMemoryStore).filter(id => !inMemoryStore[id].closed);
}

async function getOpenSignals() {
  return Object.values(inMemoryStore).filter(s => s && !s.closed);
}

async function getActiveSignal(pair, direction) {
  const open = await getOpenSignals();
  return open.find((s) => s.pair === pair && s.direction === direction) || null;
}

async function getRecentSignals(limit = 20) {
  const signals = Object.values(inMemoryStore)
    .sort((a, b) => (b.signalTime || 0) - (a.signalTime || 0))
    .slice(0, limit);
  return signals;
}

async function getAllSignals() {
  return Object.values(inMemoryStore);
}

async function recordFilterOutcome(category, won) {
  return { samples: 1, wins: won ? 1 : 0 };
}

async function getFilterPerformance(category) {
  return { samples: 0, wins: 0, winRate: 0.5, multiplier: 1.0 };
}

async function getAllFilterPerformance(categories) {
  const result = {};
  for (const cat of categories) {
    result[cat] = await getFilterPerformance(cat);
  }
  return result;
}

async function createPostmortem(record) {
  return record;
}

async function getPostmortem(id) {
  return null;
}

async function updatePostmortem(id, patch) {
  return null;
}

async function removePostmortemFromPending(id) {}

async function getPendingPostmortemIds() {
  return [];
}

async function recordInvalidationCheckpoint(pair, direction, checkpointLabel, recovered) {
  return { recovered: recovered ? 1 : 0, total: 1 };
}

async function getInvalidationStats(pair, direction, checkpointLabel) {
  return { recovered: 0, total: 0 };
}

module.exports = {
  redis: null,
  newSignalId,
  saveNewSignal,
  getSignal,
  updateSignal,
  closeSignal,
  getOpenSignalIds,
  getOpenSignals,
  getActiveSignal,
  getRecentSignals,
  getAllSignals,
  recordFilterOutcome,
  getFilterPerformance,
  getAllFilterPerformance,
  createPostmortem,
  getPostmortem,
  updatePostmortem,
  removePostmortemFromPending,
  getPendingPostmortemIds,
  recordInvalidationCheckpoint,
  getInvalidationStats,
};
