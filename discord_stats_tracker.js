import { Client, GatewayIntentBits } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '';
const STATS_CHANNEL_ID = process.env.STATS_CHANNEL_ID || '';
const COMPARISON_CHANNEL_ID = '1432001369178636350';
const DEBUG_NOTIFY = process.env.DEBUG_NOTIFY === 'true';

const stats = {
  minute: { executions: [], users: new Set() },
  hour: { executions: [], users: new Set() },
  day: { executions: [], users: new Set() }
};

const previousStats = {
  hour: { executions: 0, users: 0, timestamp: 0 },
  day: { executions: 0, users: 0, timestamp: 0 }
};

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

function getCurrentTimeFormatted() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

function getTimeUntilNextDayReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const msUntilReset = tomorrow - now;
  const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
  const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));

  return `${hoursUntilReset}h ${minutesUntilReset}m`;
}

function cleanOldStats() {
  const now = Date.now();

  stats.minute.executions = stats.minute.executions.filter(t => now - t.timestamp < ONE_MINUTE);
  stats.minute.users = new Set([...stats.minute.executions.map(e => e.username)]);

  stats.hour.executions = stats.hour.executions.filter(t => now - t.timestamp < ONE_HOUR);
  stats.hour.users = new Set([...stats.hour.executions.map(e => e.username)]);

  stats.day.executions = stats.day.executions.filter(t => now - t.timestamp < ONE_DAY);
  stats.day.users = new Set([...stats.day.executions.map(e => e.username)]);
}

async function resolveMentionToUsername(mentionText, message) {
  const idMatch = mentionText && mentionText.match(/<@!?(?<id>\d+)>/);
  if (!idMatch) return null;
  const id = idMatch.groups?.id;
  if (!id) return null;

  try {
    if (message?.guild) {
      const member = await message.guild.members.fetch(id).catch(() => null);
      if (member) return member.user.username;
    }
    const user = await message.client.users.fetch(id).catch(() => null);
    if (user) return user.username;
  } catch (e) {
  }
  return null;
}

async function parseExecutionFromEmbed(embed, message) {
  if (!embed) return null;

  if (Array.isArray(embed.fields) && embed.fields.length > 0) {
    const possibleNames = ['username', 'user', 'executor', 'executed by', 'author', 'userid', 'user id'];
    for (const f of embed.fields) {
      if (!f) continue;
      const name = (f.name || '').toString().toLowerCase();
      const value = (f.value || '').toString();

      if (possibleNames.includes(name)) {
        const mentionMatch = value.match(/<@!?\d+>/);
        if (mentionMatch) {
          const resolved = await resolveMentionToUsername(mentionMatch[0], message);
          if (resolved) return resolved;
        }
        if (name === 'userid' || name === 'user id') {
          const idMatch = value.match(/(\d{17,19})/);
          if (idMatch) {
            const resolved = await resolveMentionToUsername(`<@${idMatch[1]}>`, message);
            if (resolved) return resolved;
            return value.trim();
          }
        }
        return value.split('\n')[0].trim();
      }

      const mentionInValue = value.match(/<@!?\d+>/);
      if (mentionInValue) {
        const resolved = await resolveMentionToUsername(mentionInValue[0], message);
        if (resolved) return resolved;
      }

      const combined = `${f.name || ''} ${f.value || ''}`;
      const m = combined.match(/username[:\s]*([^\s,]+)/i);
      if (m) return m[1];
    }
  }

  if (embed.author && embed.author.name) {
    const authorName = embed.author.name.toString();
    const mentionMatch = authorName.match(/<@!?\d+>/);
    if (mentionMatch) {
      const resolved = await resolveMentionToUsername(mentionMatch[0], message);
      if (resolved) return resolved;
    }
    return authorName;
  }

  if (embed.title) {
    const title = embed.title.toString();
    const mentionMatch = title.match(/<@!?\d+>/);
    if (mentionMatch) {
      const resolved = await resolveMentionToUsername(mentionMatch[0], message);
      if (resolved) return resolved;
    }
    const m = title.match(/username[:\s]*([^\s,]+)/i);
    if (m) return m[1];
    if (title.split(/\s+/).length <= 4) return title.trim();
  }

  if (embed.description) {
    const desc = embed.description.toString();
    const mentionMatch = desc.match(/<@!?\d+>/);
    if (mentionMatch) {
      const resolved = await resolveMentionToUsername(mentionMatch[0], message);
      if (resolved) return resolved;
    }
    const m = desc.match(/username[:\s]*([^\s,]+)/i);
    if (m) return m[1];
  }

  if (embed.footer && embed.footer.text) {
    const footer = embed.footer.text.toString();
    const m = footer.match(/username[:\s]*([^\s,]+)/i);
    if (m) return m[1];
  }

  return null;
}

function parseExecutionLog(messageContent, message) {
  if (!messageContent) return null;

  if (message && message.mentions && message.mentions.users && message.mentions.users.size > 0) {
    const mentioned = message.mentions.users.first();
    if (mentioned) return mentioned.username;
  }

  const patterns = [
    /executed by (\S+)/i,
    /user[:\s]+(\S+)/i,
    /username[:\s]+(\S+)/i,
    /(\S+)\s+executed/i,
    /@(\S+)/,
  ];

  for (const pattern of patterns) {
    const match = messageContent.match(pattern);
    if (match) return match[1];
  }

  const mentionIdMatch = messageContent.match(/<@!?(?<id>\d+)>/);
  if (mentionIdMatch) return `<@${mentionIdMatch.groups?.id}>`;

  return null;
}

function trackExecution(username) {
  const now = Date.now();
  const execution = { username, timestamp: now };

  stats.minute.executions.push(execution);
  stats.minute.users.add(username);

  stats.hour.executions.push(execution);
  stats.hour.users.add(username);

  stats.day.executions.push(execution);
  stats.day.users.add(username);

  cleanOldStats();
}

function getStatsMessage() {
  cleanOldStats();
  return `**📊 Execution Statistics** (${getCurrentTimeFormatted()} UTC)

**Last Minute:**
• Executions: ${stats.minute.executions.length}
• Unique Users: ${stats.minute.users.size}

**Last Hour:**
• Executions: ${stats.hour.executions.length}
• Unique Users: ${stats.hour.users.size}

**Last 24 Hours:**
• Executions: ${stats.day.executions.length}
• Unique Users: ${stats.day.users.size}`;
}

function getComparisonMessage() {
  const currentHourExecutions = stats.hour.executions.length;
  const currentHourUsers = stats.hour.users.size;
  const currentDayExecutions = stats.day.executions.length;
  const currentDayUsers = stats.day.users.size;

  const hourExecDiff = currentHourExecutions - (previousStats.hour.executions || 0);
  const hourUsersDiff = currentHourUsers - (previousStats.hour.users || 0);
  const dayExecDiff = currentDayExecutions - (previousStats.day.executions || 0);
  const dayUsersDiff = currentDayUsers - (previousStats.day.users || 0);

  const hourExecEmoji = hourExecDiff >= 0 ? '⬆️' : '⬇️';
  const hourUsersEmoji = hourUsersDiff >= 0 ? '⬆️' : '⬇️';
  const dayExecEmoji = dayExecDiff >= 0 ? '⬆️' : '⬇️';
  const dayUsersEmoji = dayUsersDiff >= 0 ? '⬆️' : '⬇️';

  const hourExecMessage = `${hourExecEmoji} ${Math.abs(hourExecDiff)} executions ${hourExecDiff >= 0 ? 'more' : 'less'} than previous hour (Current: ${currentHourExecutions})`;
  const hourUsersMessage = `${hourUsersEmoji} ${Math.abs(hourUsersDiff)} unique users ${hourUsersDiff >= 0 ? 'more' : 'less'} than previous hour (Current: ${currentHourUsers})`;
  const dayExecMessage = `${dayExecEmoji} ${Math.abs(dayExecDiff)} executions ${dayExecDiff >= 0 ? 'more' : 'less'} than previous day (Current: ${currentDayExecutions})`;
  const dayUsersMessage = `${dayUsersEmoji} ${Math.abs(dayUsersDiff)} unique users ${dayUsersDiff >= 0 ? 'more' : 'less'} than previous day (Current: ${currentDayUsers})`;

  const timeUntilReset = getTimeUntilNextDayReset();

  return `**📊 Execution Trend Report** (${getCurrentTimeFormatted()} UTC)

**Hourly Comparison:**
${hourExecMessage}
${hourUsersMessage}

**Daily Comparison:**
${dayExecMessage}
${dayUsersMessage}

⏰ **New Day Reset In:** ${timeUntilReset}`;
}

async function startBot() {
  if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set!');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  let lastHourIndex = 0;
  let lastDayIndex = 0;

  client.on('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📝 Monitoring channel: ${LOGS_CHANNEL_ID || 'Not set'}`);
    console.log(`📊 Stats output channel: ${STATS_CHANNEL_ID || 'Not set'}`);
    console.log(`📈 Comparison output channel: ${COMPARISON_CHANNEL_ID}`);
    console.log(`🕒 Current time (UTC): ${getCurrentTimeFormatted()}`);
    console.log('Bot is ready! Type !stats in any channel to see statistics.');

    const now = Date.now();
    lastHourIndex = Math.floor(now / ONE_HOUR);
    lastDayIndex = Math.floor(now / ONE_DAY);

    cleanOldStats();
    previousStats.hour = {
      executions: stats.hour.executions.length,
      users: stats.hour.users.size,
      timestamp: now
    };
    previousStats.day = {
      executions: stats.day.executions.length,
      users: stats.day.users.size,
      timestamp: now
    };
  });

  client.on('messageCreate', async (message) => {
    if (message.author?.bot && !message.webhookId) return;

    if (message.content === '!stats') {
      try {
        await message.channel.send(getStatsMessage());
      } catch (err) {
        console.error('Failed to send !stats reply:', err);
      }
      return;
    }

    if (LOGS_CHANNEL_ID && String(message.channel.id) === String(LOGS_CHANNEL_ID)) {
      let username = null;

      if (message.mentions && message.mentions.users.size > 0) {
        const u = message.mentions.users.first();
        if (u) username = u.username;
      }

      if (!username && message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
          try {
            username = await parseExecutionFromEmbed(embed, message);
            if (username) break;
          } catch (err) {
          }
        }
      }

      if (!username && message.content) {
        username = parseExecutionLog(message.content, message);
        if (username && username.startsWith('<@')) {
          const resolved = await resolveMentionToUsername(username, message);
          if (resolved) username = resolved;
        }
      }

      if (username) {
        trackExecution(username);
        console.log(`✅ [${getCurrentTimeFormatted()}] Tracked execution by: ${username}`);

        if (DEBUG_NOTIFY && STATS_CHANNEL_ID) {
          try {
            const channel = await client.channels.fetch(STATS_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
              await channel.send(`🔔 (DEBUG) Tracked execution by: ${username}`);
            }
          } catch (err) {
            console.error('Failed to send DEBUG_NOTIFY message:', err?.message || err);
          }
        }
      }
    }
  });

  setInterval(async () => {
    const now = Date.now();
    try {
      cleanOldStats();

      if (STATS_CHANNEL_ID && stats.minute.executions.length > 0) {
        try {
          const channel = await client.channels.fetch(STATS_CHANNEL_ID);
          if (channel && channel.isTextBased()) {
            await channel.send(getStatsMessage());
          }
        } catch (err) {
          console.error('Failed to send stats message:', err?.message || err);
        }
      }

      if (COMPARISON_CHANNEL_ID) {
        const currentHourIndex = Math.floor(now / ONE_HOUR);
        const currentDayIndex = Math.floor(now / ONE_DAY);

        if (currentHourIndex > lastHourIndex) {
          lastHourIndex = currentHourIndex;

          try {
            const channel = await client.channels.fetch(COMPARISON_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
              const comparisonMessage = getComparisonMessage();
              await channel.send(comparisonMessage);
            }
          } catch (err) {
            console.error('Failed to send hourly comparison message:', err?.message || err);
          }

          previousStats.hour = {
            executions: stats.hour.executions.length,
            users: stats.hour.users.size,
            timestamp: now
          };
        }

        if (currentDayIndex > lastDayIndex) {
          lastDayIndex = currentDayIndex;

          try {
            const channel = await client.channels.fetch(COMPARISON_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
              const header = `🌅 **New Day Started!** (${getCurrentTimeFormatted()} UTC)`;
              const comparisonMessage = getComparisonMessage();
              await channel.send(`${header}\n\n${comparisonMessage}`);
            }
          } catch (err) {
            console.error('Failed to send daily comparison message:', err?.message || err);
          }

          previousStats.day = {
            executions: stats.day.executions.length,
            users: stats.day.users.size,
            timestamp: now
          };

          stats.day.executions = [];
          stats.day.users = new Set();
        }

        stats.hour.executions = [];
        stats.hour.users = new Set();
      }
    } catch (error) {
      console.error(`Error [${getCurrentTimeFormatted()}]:`, error?.message || error);
    }
  }, ONE_MINUTE);

  try {
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error('Bot failed to login:', err);
  }
}

export { startBot };
