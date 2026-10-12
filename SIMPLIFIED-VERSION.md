Binary Bot - Simplified Version (No Redis)
What Changed?
✅ Removed Redis completely ✅ Simplified to core signal generation ✅ In-memory storage only ✅ Minimal dependencies ✅ Quick setup - just 4 environment variables
Environment Variables Required (Railway)
Only 4 variables needed:
DISCORD_BOT_TOKEN=your_token
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_GUILD_ID=your_server_id
TWELVEDATA_API_KEY=your_api_key
That's it! No Redis URL/Token needed! ✓
How to Use
1. Upload to GitHub
git add .
git commit -m "Simplify bot - remove Redis, use in-memory storage"
git push origin main
2. Railway will auto-redeploy
Wait 2-3 minutes for deployment.
3. Check logs in Railway
You should see:
Starting Binary Signal Bot (Simplified - No Redis)...
- DISCORD_BOT_TOKEN: Set ✓
- DISCORD_CHANNEL_ID: Set ✓
- TWELVEDATA_API_KEY: Set ✓
Binary Signal Bot fully initialized ✓
4. Test in Discord
!binary EURUSD 1m
!binary GBPUSD 5m
!binary AUDUSD 1h
Bot will respond with signal (🟢 GREEN, 🔴 RED, or NO_SIGNAL)
What Works?
✅ Signal generation (binary UP/DOWN detection) ✅ Multiple timeframes (1m, 5m, 15m, 1h, etc.) ✅ Multiple trading pairs (EURUSD, GBPUSD, etc.) ✅ Technical analysis ✅ Pattern recognition ✅ Discord integration
What's Limited?
⚠️ No data persistence - Signals/history lost on bot restart ⚠️ No accuracy tracking - Stats not saved ⚠️ In-memory only - Good for testing, not for production
For Production?
Once bot is working well, you can:
Add Redis back (follow FIXES-APPLIED.md)
Enable signal history tracking
Enable accuracy calculations
Enable persistence
Troubleshooting
Bot crashes after startup?
Check all 4 environment variables are in Railway
Check DISCORD_BOT_TOKEN is correct
Check bot has permissions in Discord server
No signal response?
Check Twelve Data API key is valid
Check bot can access Discord channel
Check bot has Send Messages permission
How to check logs?
Railway → Deployment → Deploy Logs
Look for errors in red lines
Files Changed
✅ package.json - Removed @upstash/redis dependency
✅ src/config.js - Removed redis config
✅ src/index.js - Removed cron/tracker, simplified startup
✅ src/services/redisStore.js - Replaced with in-memory store
✅ SIMPLIFIED-VERSION.md - This file (documentation)
Next Steps
✅ Upload to GitHub
✅ Railway auto-deploys
✅ Test bot in Discord
⬜ (Optional) Add Redis back later for full features
Version: 2.0.0-simplified
Created: 2026-10-12
By: Claude Haiku 4.5
