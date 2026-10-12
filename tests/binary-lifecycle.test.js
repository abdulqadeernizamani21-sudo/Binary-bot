require('./helpers/stubDeps');
const assert = require('assert');
const { test, run } = require('./testKit');
const { makeFakeRedis } = require('./helpers/fakeRedis');

const store = require('../src/services/redisStore');
const dataQualitySvc = require('../src/services/dataQuality');
const twelvedata = require('../src/services/twelvedata');
const binaryEngine = require('../src/services/binaryEngine');
const binaryStore = require('../src/services/binaryStore');
const binaryTracker = require('../src/services/binaryTracker');
const calibrationSvc = require('../src/services/calibration');

// ---- A genuinely TRENDING synthetic market (real swing highs/lows, higher
// highs + higher lows) - not the flat random-walk fixture used elsewhere.
// The engine's own structure/confluence guardrails correctly return
// NO_TRADE on a directionless random walk (see the second test below,
// which relies on exactly that), so an actionable UP signal for THIS test
// needs real trend structure, not just a drift parameter.
function makeTrendingCandles({ count = 825, base = 1.1, endTime = Date.now() - 60000 } = {}) {
  const candles = [];
  const t0 = endTime - (count - 1) * 60000;
  let prevClose = null;
  for (let i = 0; i < count; i++) {
    const trend = base * (1 + i * 0.00015);
    const wave = Math.sin(i / 12) * base * 0.003;
    const close = trend + wave;
    const open = prevClose === null ? close : prevClose;
    const high = Math.max(open, close) + base * 0.0004;
    const low = Math.min(open, close) - base * 0.0004;
    candles.push({
      time: t0 + i * 60000,
      open: Number(open.toFixed(6)),
      high: Number(high.toFixed(6)),
      low: Number(low.toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: null,
    });
    prevClose = close;
  }
  return candles;
}

async function makeRealSignal({ duration = 5, base = 1.1 } = {}) {
  const candles = makeTrendingCandles({ base });
  const entryPrice = candles[candles.length - 1].close;
  const fetchedAt = Date.now();
  const inputs = {
    symbol: 'EURUSD',
    duration,
    statsLookback: 360,
    fetchSize: candles.length,
    candles,
    entryPrice,
    priceSource: 'live-quote',
    staleness: dataQualitySvc.checkStaleness(candles, fetchedAt, 60000, 5),
    fetchedAt,
  };
  return binaryEngine.generateBinarySignal(inputs.symbol, inputs.duration, inputs);
}

// ---------------------------------------------------------------- lifecycle
test('full lifecycle: !binary-equivalent signal -> tracker registration -> simulated expiry -> real outcome -> historical stats update', async () => {
  store.redis = makeFakeRedis();

  // ---- 1. Generate a REAL signal via the actual engine (same call
  // src/commands/binary.js makes). ----
  const signal = await makeRealSignal({ duration: 5 });
  assert.notStrictEqual(signal.direction, 'NO_TRADE', 'fixture must produce an actionable signal for this test to mean anything');
  assert.strictEqual(signal.direction, 'UP');

  // ---- 1b. Entry -> exact expiry timestamp -> expected expiry price must
  // all be present and internally consistent (this is the core contract:
  // the final decision is derived from the EXPIRY-moment projection, not
  // an intermediate one). ----
  assert.strictEqual(signal.expiresAtMs, signal.signalTime + 5 * 60000);
  assert.strictEqual(signal.expiresAtIso, new Date(signal.expiresAtMs).toISOString());
  assert.ok(Number.isFinite(signal.expectedExpiryPrice));
  assert.strictEqual(
    signal.expectedMoveAmount,
    Number((signal.expectedExpiryPrice - signal.entryPrice).toPrecision(8)),
  );
  assert.strictEqual(
    signal.expectedMovePct,
    Number((((signal.expectedExpiryPrice - signal.entryPrice) / signal.entryPrice) * 100).toFixed(4)),
  );

  // ---- 2. Register it exactly the way src/commands/binary.js does. ----
  const id = binaryStore.newId(signal.symbol);
  await binaryStore.saveNew({ ...signal, id, status: 'OPEN', result: null });
  assert.ok((await binaryStore.getOpenIds()).includes(id), 'signal must be in the open set right after registration');

  const finalCp = signal.checkpoints[signal.checkpoints.length - 1];
  assert.strictEqual(finalCp.minutes, 5, 'sanity check on the fixture duration/checkpoint math');

  // ---- 3. Simulate time passing: backdate signalTime so the whole
  // duration has already elapsed (no real waiting - this is the
  // "simulated timestamps" pattern EXAMPLE 29 describes, run through the
  // ACTUAL binaryTracker/binaryStore/calibration code). ----
  const signalTime = Date.now() - (finalCp.minutes + 2) * 60000;
  await binaryStore.update(id, { signalTime });

  // ---- 4. Build the actual expiry-window candles. Price dips AGAINST the
  // called direction early on, then recovers and closes ABOVE entry by
  // expiry - this is deliberately the "intermediate movement is evidence,
  // not the outcome" case from the prompt (EXAMPLE 7/8): only the price at
  // the exact expiry timestamp may decide WIN/LOSS. ----
  const entry = signal.entryPrice;
  const path = [
    entry, // t+0
    entry * 0.999, // t+1  <- dips against UP
    entry * 0.9993, // t+2  <- still against UP
    entry * 1.0004, // t+3  <- recovers
    entry * 1.0009, // t+4
    entry * 1.0015, // t+5  <- expiry: clearly above entry -> UP is correct
    entry * 1.0015, // t+6  (buffer, in case elapsed overshoots by a tick)
  ];
  const expiryCandles = path.map((close, i) => ({
    time: signalTime + i * 60000,
    open: close,
    high: close + entry * 0.0005,
    low: close - entry * 0.0005,
    close,
    volume: null,
  }));

  let tdCalls = 0;
  const savedGetTimeSeries = twelvedata.getTimeSeries;
  twelvedata.getTimeSeries = async () => { tdCalls += 1; return expiryCandles; };

  try {
    // ---- 5. Run the REAL tracker cycle (no bypass, no mocked outcome). ----
    await binaryTracker.runBinaryTrackerCycle();
  } finally {
    twelvedata.getTimeSeries = savedGetTimeSeries;
  }

  assert.ok(tdCalls >= 1, 'the tracker must actually fetch expiry-window candles, not fabricate an outcome');

  // ---- 6. The signal must now be CLOSED, out of the open set, with a
  // real WIN result derived from the actual expiry price path. ----
  assert.ok(!(await binaryStore.getOpenIds()).includes(id), 'signal must leave the open set once its expiry is processed');
  const closed = await binaryStore.get(id);
  assert.strictEqual(closed.status, 'CLOSED');
  assert.strictEqual(closed.result, 'WIN', 'price closed above entry, direction was UP -> WIN');
  assert.strictEqual(closed.closePrice, entry * 1.0015);
  // The dip-then-recover must be visible as evidence, not as a different
  // outcome - proving intermediate movement never substituted for the
  // expiry-timestamp price.
  assert.ok(closed.nearMissNote, 'a dip against direction that recovered by expiry should be noted, not silently dropped');
  assert.match(closed.nearMissNote, /price wapas/);

  // ---- 7. Historical/calibration statistics for THIS expiry bucket must
  // have actually moved - this is what turns a completed trade into future
  // calibration input, not just a stored record. ----
  const expiryPerf = await calibrationSvc.getExpiryPerf(signal.expiryBucket.key);
  assert.strictEqual(expiryPerf.total, 1);
  assert.strictEqual(expiryPerf.wins, 1);
  assert.strictEqual(expiryPerf.winRatePct, 100);

  // The final checkpoint (fraction 1.0, i.e. the actual expiry) must also
  // be reflected in checkpoint-level performance tracking.
  const cpPerf = await binaryStore.getCheckpointPerf(finalCp.fraction);
  assert.strictEqual(cpPerf.total, 1);
  assert.strictEqual(cpPerf.correct, 1);

  // ---- 8. Expected-expiry-price vs actual-expiry-price bias/error must
  // ALSO have been recorded, as a validation genuinely separate from the
  // direction win/loss stat above - this is what lets a systematically
  // over/under-shooting price target show up even when direction is
  // correct. ----
  const priceAcc = await calibrationSvc.getExpiryPriceAccuracy(signal.expiryBucket.key);
  assert.strictEqual(priceAcc.sampleSize, 1);
  const expectedBiasPct = Number(((closed.closePrice - signal.expectedExpiryPrice) / signal.entryPrice * 100).toFixed(4));
  assert.strictEqual(priceAcc.biasPct, expectedBiasPct);
  assert.strictEqual(priceAcc.maePct, Math.abs(expectedBiasPct));
});

// ------------------------------------------------------- NO_TRADE isolation
test('lifecycle: a NO_TRADE signal is never registered as an open trade, so it can never appear as a WIN/LOSS observation', async () => {
  store.redis = makeFakeRedis();

  // The plain flat/random fixture used throughout the rest of the suite
  // (no engineered trend structure) reliably fails the engine's own
  // structure/confluence guardrails - this is the SAME real NO_TRADE path
  // exercised elsewhere, asserted here specifically against the tracker
  // lifecycle rather than just the signal object.
  const { makeInputs } = require('./helpers/fixtures');
  const inputs = makeInputs({ duration: 5, drift: 0.004 });
  const signal = await binaryEngine.generateBinarySignal(inputs.symbol, inputs.duration, inputs);
  assert.strictEqual(signal.direction, 'NO_TRADE');

  // Mirror src/commands/binary.js's own guard exactly.
  if (signal.direction !== 'NO_TRADE') {
    const id = binaryStore.newId(signal.symbol);
    await binaryStore.saveNew({ ...signal, id, status: 'OPEN', result: null });
  }

  assert.deepStrictEqual(await binaryStore.getOpenIds(), [], 'NO_TRADE must never enter the open-signal tracker');
  assert.deepStrictEqual(await binaryStore.getAll(), [], 'NO_TRADE must never appear in the all-signals history either');

  // Running a tracker cycle with nothing open must be a safe no-op.
  await binaryTracker.runBinaryTrackerCycle();
  const expiryPerf = await calibrationSvc.getExpiryPerf(signal.expiryBucket.key);
  assert.strictEqual(expiryPerf.total, 0, 'a NO_TRADE must never inflate completed-trade statistics');
});

// ------------------------------------------------- exact-timestamp semantics
test('lifecycle: a data gap AT the exact expiry instant is never silently guessed - it stays open, then becomes NO_RESULT after the grace period', async () => {
  store.redis = makeFakeRedis();
  const signal = await makeRealSignal({ duration: 5 });
  assert.strictEqual(signal.direction, 'UP');

  const id = binaryStore.newId(signal.symbol);
  await binaryStore.saveNew({ ...signal, id, status: 'OPEN', result: null });

  const finalCp = signal.checkpoints[signal.checkpoints.length - 1];
  const signalTime = Date.now() - (finalCp.minutes + 2) * 60000;
  await binaryStore.update(id, { signalTime });

  // A candle series with a deliberate multi-minute GAP that skips straight
  // over the exact expiry instant (t+5) - the nearest available candle is
  // more than 60s away from it, so it must NOT be used as "the" expiry
  // price.
  const entry = signal.entryPrice;
  const gappy = [
    { time: signalTime + 0 * 60000, close: entry },
    { time: signalTime + 1 * 60000, close: entry * 1.0002 },
    // gap: nothing at t+2, t+3, t+4, t+5, t+6 - next candle is 5 bars later
    { time: signalTime + 7 * 60000, close: entry * 1.002 },
  ].map((c) => ({
    time: c.time, open: c.close, high: c.close * 1.0001, low: c.close * 0.9999, close: c.close, volume: null,
  }));

  const twelvedata = require('../src/services/twelvedata');
  const savedGetTimeSeries = twelvedata.getTimeSeries;
  twelvedata.getTimeSeries = async () => gappy;
  try {
    await binaryTracker.runBinaryTrackerCycle();
  } finally {
    twelvedata.getTimeSeries = savedGetTimeSeries;
  }

  // Must still be OPEN - no candle covers or is within tolerance of t+5, so
  // no WIN/LOSS may have been guessed from the nearby t+7 candle.
  let stored = (await binaryStore.getAll()).find((s) => s.id === id);
  assert.strictEqual(stored.status, 'OPEN', 'a data gap at the exact expiry instant must not be silently resolved from a distant candle');

  // Now simulate the grace period having passed with the gap still unresolved.
  await binaryStore.update(id, { signalTime: signalTime - 31 * 60000 });
  twelvedata.getTimeSeries = async () => gappy.map((c) => ({ ...c, time: c.time - 31 * 60000 }));
  try {
    await binaryTracker.runBinaryTrackerCycle();
  } finally {
    twelvedata.getTimeSeries = savedGetTimeSeries;
  }

  stored = (await binaryStore.getAll()).find((s) => s.id === id);
  assert.strictEqual(stored.status, 'CLOSED');
  assert.strictEqual(stored.result, 'NO_RESULT', 'a persistent data gap must resolve to an honest NO_RESULT, never a guessed WIN/LOSS');

  // And NO_RESULT must never be counted as a win or a loss in the real
  // historical stats.
  const expiryPerf = await calibrationSvc.getExpiryPerf(signal.expiryBucket.key);
  assert.strictEqual(expiryPerf.total, 0, 'NO_RESULT must not be recorded as a directional win/loss observation');
});

// ------------------------------------------------- exact-timestamp semantics
test('lifecycle: exact expiry resolution picks whichever of the covering bar\'s two REAL prices (open/close) is temporally closer to the target instant - never a fabricated/interpolated price', () => {
  const { findPriceAtExpiry } = binaryTracker;
  const barTime = 1_000_000_000;
  const bar = {
    time: barTime, open: 100, close: 101, high: 101.5, low: 99.5,
  };

  // Target near the START of the bar (10s in) -> the bar's OPEN is the
  // temporally closer real price (only 10s away vs 50s to the close).
  const nearStart = findPriceAtExpiry([bar], barTime + 10000);
  assert.strictEqual(nearStart.price, bar.open);
  assert.strictEqual(nearStart.referencePoint, 'bar-open');
  assert.ok(nearStart.gapMs <= 30000);

  // Target near the END of the bar (50s in) -> the bar's CLOSE is closer.
  const nearEnd = findPriceAtExpiry([bar], barTime + 50000);
  assert.strictEqual(nearEnd.price, bar.close);
  assert.strictEqual(nearEnd.referencePoint, 'bar-close');
  assert.ok(nearEnd.gapMs <= 30000);

  // Every returned price must be one of the two REAL observed values on the
  // bar - never a synthetic/interpolated number in between.
  for (let ms = 0; ms < 60000; ms += 1000) {
    const r = findPriceAtExpiry([bar], barTime + ms);
    assert.ok(r.price === bar.open || r.price === bar.close, `resolved price at +${ms}ms must be a real observed price, got ${r.price}`);
    assert.ok(r.gapMs <= 30000, 'the worst-case reporting gap must never exceed half a bar (~30s)');
  }
});

run('binary lifecycle');
