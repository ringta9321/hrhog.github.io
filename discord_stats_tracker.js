import { Client, GatewayIntentBits } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '';
const STATS_CHANNEL_ID = process.env.STATS_CHANNEL_ID || '';

const stats = {
  minute: { executions: [], users: new Set() },
  hour: { executions: [], users: new Set() },
  day: { executions: [], users: new Set() }
};

function cleanOldStats() {
  const now = Date.now();
  const oneMinute = 60 * 1000;
  const oneHour = 60 * oneMinute;
  const oneDay = 24 * oneHour;

  stats.minute.executions = stats.minute.executions.filter(t => now - t.timestamp < oneMinute);
  stats.minute.users = new Set([...stats.minute.executions.map(e => e.username)]);

  stats.hour.executions = stats.hour.executions.filter(t => now - t.timestamp < oneHour);
  stats.hour.users = new Set([...stats.hour.executions.map(e => e.username)]);

  stats.day.executions = stats.day.executions.filter(t => now - t.timestamp < oneDay);
  stats.day.users = new Set([...stats.day.executions.map(e => e.username)]);
}

function parseExecutionFromEmbed(embed) {
  if (!embed.fields) return null;
  
  const usernameField = embed.fields.find(field => 
    field.name && field.name.toLowerCase() === 'username'
  );
  
  if (usernameField && usernameField.value) {
    return usernameField.value;
  }
  
  return null;
}

function parseExecutionLog(message) {
  const patterns = [
    /executed by (\S+)/i,
    /user[:\s]+(\S+)/i,
    /username[:\s]+(\S+)/i,
    /(\S+)\s+executed/i,
    /@(\S+)/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
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

export async function startBot() {
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
    console.log('Bot is ready! Use !stats to display stats.');
  });

  client.on('messageCreate', async (message) => {
    if (message.author?.bot) return;

    if (message.content === '!stats') {
      const statsMessage = getStatsMessage();
      await message.channel.send(statsMessage);
      return;
    }

    if (LOGS_CHANNEL_ID && message.channel.id === LOGS_CHANNEL_ID) {
      let username = null;
      
      if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
          username = parseExecutionFromEmbed(embed);
          if (username) break;
        }
      }
      
      if (!username && message.content) {
        username = parseExecutionLog(message.content);
      }
      
      if (username) {
        trackExecution(username);
        console.log(`✅ Tracked execution by: ${username}`);
      }
    }
  });

  setInterval(async () => {
    cleanOldStats();
    
    if (STATS_CHANNEL_ID && stats.minute.executions.length > 0) {
      try {
        const channel = await client.channels.fetch(STATS_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
          const statsMessage = getStatsMessage();
          await channel.send(statsMessage);
        }
      } catch (error) {
        console.error('Error posting stats:', error.message);
      }
    }
  }, 60000);

  try {
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error('Bot failed to login:', err);
  }
}
