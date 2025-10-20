```markdown
# Discord Stats Tracker

Minimal Node.js Discord bot that tracks executions from a logs channel and posts stats.

## Files
- discord_stats_tracker.js - bot program
- package.json - dependencies and start script
- .env.example - environment variable examples

## Run locally
1. Copy `.env.example` to `.env` and set real values.
2. Install deps:
   npm install
3. Run:
   node discord_stats_tracker.js
   or
   npm start

Make sure your bot has these Gateway Intents enabled in the Discord Developer Portal:
- Message Content Intent
- Server Members intent (if you need members; not used here currently)

## Deploy to Render (recommended as Background Worker)
1. Push this repo to GitHub.
2. Go to https://render.com and create a new service.
3. Choose "Background Worker" (recommended for bots). If you prefer an HTTP health endpoint, pick "Web Service" and add a small express server.
4. Connect your GitHub repo and choose the branch.
5. Build Command: (default) `npm install`
6. Start Command: `npm start`
7. Add environment variables in Render's dashboard:
   - DISCORD_TOKEN
   - LOGS_CHANNEL_ID
   - STATS_CHANNEL_ID
8. Deploy and watch logs in Render's dashboard.

Notes:
- Background Worker will keep the bot running and restart on crashes.
- If you need an HTTP endpoint (for health checks or uptime pings), add an express server and run as a Web Service instead.

```
