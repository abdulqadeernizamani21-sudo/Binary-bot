# Binary Signal Bot (Discord)

Binary-analysis-only Discord bot. It does not place trades or connect to Binance for execution. It obtains market data from Twelve Data, analyzes a requested symbol and duration, stores signals in Redis, and tracks outcomes after expiry.

## Commands

- `!binary EURUSD 1H` — analyze a symbol for a requested expiry.
- `!binary EURUSD 5m` — analyze a shorter expiry.
- `!binaryaccuracy` — show available binary historical performance/calibration statistics.

The bot's result may be UP, DOWN, NO_TRADE, or INSUFFICIENT_DATA. A signal is not a guarantee and external market prices may differ from a broker's OTC feed.

## Railway setup

Set these environment variables in Railway:
- `DISCORD_BOT_TOKEN`
- `TWELVEDATA_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

`PORT` is optional; it defaults to 3000.

Build/start:
- Install command: `npm install`
- Start command: `npm start`
- Tests: `npm test`

Node.js 20 or newer is required.

## Runtime architecture

```text
src/
  index.js
  config.js
  commands/
    binary.js
    binaryAccuracy.js
  services/
    binaryEngine.js
    binaryStore.js
    binaryTracker.js
    calibration.js
    candleQuality.js
    dataQuality.js
    divergence.js
    expiryBuckets.js
    expirySelection.js
    indicators.js
    nextCandle.js
    redisStore.js
    regime.js
    sessions.js
    structure.js
    twelvedata.js
    volume.js
  utils/
    formatting.js
    logger.js
  backtest/
    run.js
    walkForward.js
tests/
  helpers/
  audit-v4.test.js
  binary-lifecycle.test.js
  expiry-selection.test.js
  next-candle.test.js
  run-all.js
```

Some older market/spot/futures modules and their tests are retained in this ZIP as inactive reference material to avoid irreversible deletion before a full dependency review. The production entry point does not register or import those workflows. They can be removed in a later cleanup after deployment and binary-only tests are verified.

## Important limitations

- This bot analyzes Twelve Data's feed; it cannot guarantee a match with a broker's OTC feed.
- Probabilities and historical accuracy are estimates, not guarantees.
- Do not add API tokens or secrets to GitHub.
