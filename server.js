import 'dotenv/config';
import express from 'express';
import { startBot } from './discord_stats_tracker.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Discord Stats Tracker is running.');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, async () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
  // Start the Discord bot after the web server is listening
  await startBot();
});
