import { Client, GatewayIntentBits } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const STATS_CHANNEL_ID = '1429696356859248740';
const COMPARISON_CHANNEL_ID = '1429967291906265230';
const DEBUG_NOTIFY = process.env.DEBUG_NOTIFY === 'true';

const CHANNELS = {
  '99nights': process.env.LOGS_CHANNEL_ID || '',
  'inkgames': '1393631891147718756',
  'steala': '1400585444001054730',
  'forsaken': '1396894093900120105'
};

const stats = {
  '99nights': {
    minute: { executions: [], users: new Set() },
    hour: { executions: [], users: new Set() },
    day: { executions: [], users: new Set() }
  },
  'inkgames': {
    minute: { executions: [], users: new Set() },
    hour: { executions: [], users: new Set() },
    day: { executions: [], users: new Set() }
  },
  'steala': {
    minute: { executions: [], users: new Set() },
    hour: { executions: [], users: new Set() },
    day: { executions: [], users: new Set() }
  },
  'forsaken': {
    minute: { executions: [], users: new Set() },
    hour: { executions: [], users: new Set() },
    day: { executions: [], users: new Set() }
  }
};

const previousStats = {
  '99nights': {
    hour: { executions: 0, users: 0, timestamp: 0 },
    day: { executions: 0, users: 0, timestamp: 0 }
  },
  'inkgames': {
    hour: { executions: 0, users: 0, timestamp: 0 },
    day: { executions: 0, users: 0, timestamp: 0 }
  },
  'steala': {
    hour: { executions: 0, users: 0, timestamp: 0 },
    day: { executions: 0, users: 0, timestamp: 0 }
  },
  'forsaken': {
    hour: { executions: 0, users: 0, timestamp: 0 },
    day: { executions: 0, users: 0, timestamp: 0 }
  }
};

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

function getCurrentTimeFormatted() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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

  for (const game in stats) {
    stats[game].minute.executions = stats[game].minute.executions.filter(t => now - t.timestamp < ONE_MINUTE);
    stats[game].minute.users = new Set([...stats[game].minute.executions.map(e => e.username)]);

    stats[game].hour.executions = stats[game].hour.executions.filter(t => now - t.timestamp < ONE_HOUR);
    stats[game].hour.users = new Set([...stats[game].hour.executions.map(e => e.username)]);

    stats[game].day.executions = stats[game].day.executions.filter(t => now - t.timestamp < ONE_DAY);
    stats[game].day.users = new Set([...stats[game].day.executions.map(e => e.username)]);
  }
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
  } catch (e) {}
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

function trackExecution(username, game) {
  const now = Date.now();
  const execution = { username, timestamp: now };

  stats[game].minute.executions.push(execution);
  stats[game].minute.users.add(username);

  stats[game].hour.executions.push(execution);
  stats[game].hour.users.add(username);

  stats[game].day.executions.push(execution);
  stats[game].day.users.add(username);

  cleanOldStats();
}

function getGameName(game) {
  const names = {
    '99nights': '99 Nights',
    'inkgames': 'iNK GAMES',
    'steala': 'Steala',
    'forsaken': 'Forsaken'
  };
  return names[game] || game;
}

function getSingleGameStats(game) {
  cleanOldStats();
  const gameName = getGameName(game);
  
  return `**📊 ${gameName} - Execution Statistics**

**Last Minute:**
• Executions: ${stats[game].minute.executions.length}
• Unique Users: ${stats[game].minute.users.size}

**Last Hour:**
• Executions: ${stats[game].hour.executions.length}
• Unique Users: ${stats[game].hour.users.size}

**Last 24 Hours:**
• Executions: ${stats[game].day.executions.length}
• Unique Users: ${stats[game].day.users.size}`;
}

function getStatsMessage() {
  cleanOldStats();
  
  const separator = '\n\n\n';
  
  const allStats = [
    getSingleGameStats('99nights'),
    getSingleGameStats('inkgames'),
    getSingleGameStats('steala'),
    getSingleGameStats('forsaken')
  ];
  
  return `**📊 ALL GAMES - Execution Statistics** (${getCurrentTimeFormatted()})

${allStats.join(separator)}`;
}

function getSingleGameComparison(game) {
  const gameName = getGameName(game);
  const currentHourExecutions = stats[game].hour.executions.length;
  const currentHourUsers = stats[game].hour.users.size;
  const currentDayExecutions = stats[game].day.executions.length;
  const currentDayUsers = stats[game].day.users.size;

  const hourExecDiff = currentHourExecutions - (previousStats[game].hour.executions || 0);
  const hourUsersDiff = currentHourUsers - (previousStats[game].hour.users || 0);
  const dayExecDiff = currentDayExecutions - (previousStats[game].day.executions || 0);
  const dayUsersDiff = currentDayUsers - (previousStats[game].day.users || 0);

  const hourExecEmoji = hourExecDiff >= 0 ? '⬆️' : '⬇️';
  const hourUsersEmoji = hourUsersDiff >= 0 ? '⬆️' : '⬇️';
  const dayExecEmoji = dayExecDiff >= 0 ? '⬆️' : '⬇️';
  const dayUsersEmoji = dayUsersDiff >= 0 ? '⬆️' : '⬇️';

  const hourExecMessage = `${hourExecEmoji} ${Math.abs(hourExecDiff)} executions ${hourExecDiff >= 0 ? 'more' : 'less'} than previous hour (Current: ${currentHourExecutions})`;
  const hourUsersMessage = `${hourUsersEmoji} ${Math.abs(hourUsersDiff)} unique users ${hourUsersDiff >= 0 ? 'more' : 'less'} than previous hour (Current: ${currentHourUsers})`;
  const dayExecMessage = `${dayExecEmoji} ${Math.abs(dayExecDiff)} executions ${dayExecDiff >= 0 ? 'more' : 'less'} than previous day (Current: ${currentDayExecutions})`;
  const dayUsersMessage = `${dayUsersEmoji} ${Math.abs(dayUsersDiff)} unique users ${dayUsersDiff >= 0 ? 'more' : 'less'} than previous day (Current: ${currentDayUsers})`;

  return `**📊 ${gameName} - Execution Trend Report**

**Hourly Comparison:**
${hourExecMessage}
${hourUsersMessage}

**Daily Comparison:**
${dayExecMessage}
${dayUsersMessage}`;
}

function getComparisonMessage() {
  const separator = '\n\n\n';
  
  const allComparisons = [
    getSingleGameComparison('99nights'),
    getSingleGameComparison('inkgames'),
    getSingleGameComparison('steala'),
    getSingleGameComparison('forsaken')
  ];
  
  const timeUntilReset = getTimeUntilNextDayReset();
  
  return `**📊 ALL GAMES - Execution Trend Report** (${getCurrentTimeFormatted()})

${allComparisons.join(separator)}

⏰ **New Day Reset In:** ${timeUntilReset}`;
}

function getGameByChannelId(channelId) {
  for (const [game, id] of Object.entries(CHANNELS)) {
    if (String(id) === String(channelId)) {
      return game;
    }
  }
  return null;
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
    console.log(`📝 Monitoring channels:`);
    console.log(`   - 99 Nights: ${CHANNELS['99nights'] || 'Not set'}`);
    console.log(`   - iNK GAMES: ${CHANNELS['inkgames']}`);
    console.log(`   - Steala: ${CHANNELS['steala']}`);
    console.log(`   - Forsaken: ${CHANNELS['forsaken']}`);
    console.log(`📊 Stats output channel: ${STATS_CHANNEL_ID || 'Not set'}`);
    console.log(`📈 Comparison output channel: ${COMPARISON_CHANNEL_ID}`);
    console.log(`🕒 Current time: ${getCurrentTimeFormatted()}`);
    console.log('Bot is ready! Type !stats in any channel to see statistics.');

    const now = Date.now();
    lastHourIndex = Math.floor(now / ONE_HOUR);
    lastDayIndex = Math.floor(now / ONE_DAY);

    cleanOldStats();
    
    for (const game in stats) {
      previousStats[game].hour = {
        executions: stats[game].hour.executions.length,
        users: stats[game].hour.users.size,
        timestamp: now
      };
      previousStats[game].day = {
        executions: stats[game].day.executions.length,
        users: stats[game].day.users.size,
        timestamp: now
      };
    }
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

    const game = getGameByChannelId(message.channel.id);
    
    if (game) {
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
          } catch (err) {}
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
        trackExecution(username, game);
        console.log(`✅ [${getCurrentTimeFormatted()}] [${getGameName(game)}] Tracked execution by: ${username}`);

        if (DEBUG_NOTIFY && STATS_CHANNEL_ID) {
          try {
            const channel = await client.channels.fetch(STATS_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
              await channel.send(`🔔 (DEBUG) [${getGameName(game)}] Tracked execution by: ${username}`);
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

      let hasExecutions = false;
      for (const game in stats) {
        if (stats[game].minute.executions.length > 0) {
          hasExecutions = true;
          break;
        }
      }

      if (STATS_CHANNEL_ID && hasExecutions) {
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

          for (const game in stats) {
            previousStats[game].hour = {
              executions: stats[game].hour.executions.length,
              users: stats[game].hour.users.size,
              timestamp: now
            };

            stats[game].hour.executions = [];
            stats[game].hour.users = new Set();
          }
        }

        if (currentDayIndex > lastDayIndex) {
          lastDayIndex = currentDayIndex;

          try {
            const channel = await client.channels.fetch(COMPARISON_CHANNEL_ID);
            if (channel && channel.isTextBased()) {
              const header = `🌅 **New Day Started!** (${getCurrentTimeFormatted()})`;
              const comparisonMessage = getComparisonMessage();
              await channel.send(`${header}\n\n${comparisonMessage}`);
            }
          } catch (err) {
            console.error('Failed to send daily comparison message:', err?.message || err);
          }

          for (const game in stats) {
            previousStats[game].day = {
              executions: stats[game].day.executions.length,
              users: stats[game].day.users.size,
              timestamp: now
            };

            stats[game].day.executions = [];
            stats[game].day.users = new Set();
          }
        }
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
