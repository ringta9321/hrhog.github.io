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

function getTimeUntilNextDayReset() {
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0); // Set to next day at midnight UTC
  
  const msUntilReset = tomorrow - now;
  const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
  const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hoursUntilReset}h ${minutesUntilReset}m`;
}

function cleanOldStats() {
  const now = Date.now();
  const oneMinute = 60 * 1000;
  const oneHour = 60 * oneMinute;
  const oneDay = 24 * oneHour;

  stats.minute.executions = stats.minute.executions.filter(t => now - t.timestamp < oneMinute);
  stats.minute.users = new Set([...stats.minute.executions.map(e => e.username)]);

  // Update previous hour stats before cleaning
  if (now - previousStats.hour.timestamp >= oneHour) {
    previousStats.hour.executions = stats.hour.executions.length;
    previousStats.hour.users = stats.hour.users.size;
    previousStats.hour.timestamp = now;
  }

  stats.hour.executions = stats.hour.executions.filter(t => now - t.timestamp < oneHour);
  stats.hour.users = new Set([...stats.hour.executions.map(e => e.username)]);

  // Update previous day stats before cleaning
  if (now - previousStats.day.timestamp >= oneDay) {
    previousStats.day.executions = stats.day.executions.length;
    previousStats.day.users = stats.day.users.size;
    previousStats.day.timestamp = now;
  }

  stats.day.executions = stats.day.executions.filter(t => now - t.timestamp < oneDay);
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
    // ignore
  }
  return null;
}

async function parseExecutionFromEmbed(embed, message) {
  if (!embed) return null;

  // Look in fields for obvious names (case-insensitive)
  if (Array.isArray(embed.fields) && embed.fields.length > 0) {
    const possibleNames = ['username', 'user', 'executor', 'executed by', 'author', 'userid', 'user id'];
    for (const f of embed.fields) {
      if (!f) continue;
      const name = (f.name || '').toString().toLowerCase();
      const value = (f.value || '').toString();

      // If the field name matches, prefer its value
      if (possibleNames.includes(name)) {
        // If the value contains a mention like <@123>, resolve it
        const mentionMatch = value.match(/<@!?\d+>/);
        if (mentionMatch) {
          const resolved = await resolveMentionToUsername(mentionMatch[0], message);
          if (resolved) return resolved;
        }
        // If field is userId but value is numeric, skip to resolving if possible
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

      // If a value contains a mention, try resolving
      const mentionInValue = value.match(/<@!?\d+>/);
      if (mentionInValue) {
        const resolved = await resolveMentionToUsername(mentionInValue[0], message);
        if (resolved) return resolved;
      }

      // Try to extract username: pattern inside combined name+value
      const combined = `${f.name || ''} ${f.value || ''}`;
      const m = combined.match(/username[:\s]*([^\s,]+)/i);
      if (m) return m[1];
    }
  }

  // author field
  if (embed.author && embed.author.name) {
    const authorName = embed.author.name.toString();
    const mentionMatch = authorName.match(/<@!?\d+>/);
    if (mentionMatch) {
      const resolved = await resolveMentionToUsername(mentionMatch[0], message);
      if (resolved) return resolved;
    }
    return authorName;
  }

  // title and description checks
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
  return `**📊 Execution Statistics**

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
  
  const hourExecDiff = currentHourExecutions - previousStats.hour.executions;
  const hourUsersDiff = currentHourUsers - previousStats.hour.users;
  const dayExecDiff = currentDayExecutions - previousStats.day.executions;
  const dayUsersDiff = currentDayUsers - previousStats.day.users;
  
  const hourExecEmoji = hourExecDiff >= 0 ? '⬆️' : '⬇️';
  const hourUsersEmoji = hourUsersDiff >= 0 ? '⬆️' : '⬇️';
  const dayExecEmoji = dayExecDiff >= 0 ? '⬆️' : '⬇️';
  const dayUsersEmoji = dayUsersDiff >= 0 ? '⬆️' : '⬇️';
  
  const hourExecMessage = `${hourExecEmoji} ${Math.abs(hourExecDiff)} executions ${hourExecDiff >= 0 ? 'more' : 'less'} than last hour`;
  const hourUsersMessage = `${hourUsersEmoji} ${Math.abs(hourUsersDiff)} unique users ${hourUsersDiff >= 0 ? 'more' : 'less'} than last hour`;
  const dayExecMessage = `${dayExecEmoji} ${Math.abs(dayExecDiff)} executions ${dayExecDiff >= 0 ? 'more' : 'less'} than yesterday`;
  const dayUsersMessage = `${dayUsersEmoji} ${Math.abs(dayUsersDiff)} unique users ${dayUsersDiff >= 0 ? 'more' : 'less'} than yesterday`;
  
  const timeUntilReset = getTimeUntilNextDayReset();
  
  return `**📊 Execution Trend Report**

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

  client.on('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📝 Monitoring channel: ${LOGS_CHANNEL_ID || 'Not set'}`);
    console.log(`📊 Stats output channel: ${STATS_CHANNEL_ID || 'Not set'}`);
    console.log(`📈 Comparison output channel: ${COMPARISON_CHANNEL_ID}`);
    console.log('Bot is ready! Type !stats in any channel to see statistics.');
  });

  client.on('messageCreate', async (message) => {
    // ignore other bots but allow webhook messages (webhooks set message.webhookId)
    if (message.author?.bot && !message.webhookId) return;

    // respond to !stats
    if (message.content === '!stats') {
      const statsMessage = getStatsMessage();
      try {
        await message.channel.send(statsMessage);
      } catch (err) {
        console.error('Failed to send !stats reply:', err);
      }
      return;
    }

    if (LOGS_CHANNEL_ID && String(message.channel.id) === String(LOGS_CHANNEL_ID)) {
      try {
        console.log('--- Incoming message in LOGS_CHANNEL ---');
        console.log('author:', message.author?.tag || message.author?.id || `webhookId:${message.webhookId}`);
        if (message.content) console.log('content:', message.content);
        if (message.embeds && message.embeds.length > 0) {
          console.log('embeds:', JSON.stringify(message.embeds.map(e => e.toJSON ? e.toJSON() : e), null, 2));
        }
        if (message.mentions && message.mentions.users.size > 0) {
          console.log('mentions:', Array.from(message.mentions.users.values()).map(u => `${u.username}#${u.discriminator}`));
        }
      } catch (e) {
        console.error('Error logging incoming message:', e);
      }

      let username = null;

      // preference: explicit mention
      if (message.mentions && message.mentions.users.size > 0) {
        const u = message.mentions.users.first();
        if (u) username = u.username;
      }

      // parse embed
      if (!username && message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
          username = await parseExecutionFromEmbed(embed, message);
          if (username) break;
        }
      }

      // fallback to content
      if (!username && message.content) {
        username = parseExecutionLog(message.content, message);
        if (username && username.startsWith('<@')) {
          const resolved = await resolveMentionToUsername(username, message);
          if (resolved) username = resolved;
        }
      }

      if (username) {
        trackExecution(username);
        console.log(`✅ Tracked execution by: ${username}`);

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
      } else {
        console.log('No username parsed from incoming embed/message.');
      }
    }
  });

  setInterval(async () => {
    const now = Date.now();
    cleanOldStats();
    
    try {
      // Original stats message
      if (STATS_CHANNEL_ID && stats.minute.executions.length > 0) {
        const channel = await client.channels.fetch(STATS_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
          const statsMessage = getStatsMessage();
          await channel.send(statsMessage);
        }
      }

      // New comparison message - only send on hourly/daily intervals
      if (COMPARISON_CHANNEL_ID) {
        const comparisonChannel = await client.channels.fetch(COMPARISON_CHANNEL_ID);
        if (comparisonChannel && comparisonChannel.isTextBased()) {
          const shouldSendHourly = now - previousStats.hour.timestamp >= 60 * 60 * 1000;
          const shouldSendDaily = now - previousStats.day.timestamp >= 24 * 60 * 60 * 1000;
          
          // Only send if we have previous stats to compare against AND it's time for an update
          if ((shouldSendHourly || shouldSendDaily) && 
              (previousStats.hour.timestamp > 0 || previousStats.day.timestamp > 0)) {
            const comparisonMessage = getComparisonMessage();
            await comparisonChannel.send(comparisonMessage);
          }
        }
      }
    } catch (error) {
      console.error('Error posting stats or comparison:', error.message);
    }
  }, 60000); // Still runs every minute for regular stats, but comparison messages are controlled

  try {
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error('Bot failed to login:', err);
  }
}

export { startBot };
