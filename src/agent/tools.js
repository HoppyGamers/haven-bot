// ---------------------------------------------------------------------------
// src/agent/tools.js
//
// Stage 3D: Haven Bot tool integration.
// Exposes bot capabilities to the agent as callable functions.
// Ollama decides when to call tools based on the user's message.
// ---------------------------------------------------------------------------

const { calendar, stats, rssFeeds } = require('../database');

// ---------------------------------------------------------------------------
// Tool definitions — sent to Ollama so it knows what tools are available
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'get_datetime',
    description: 'Get the current date and time. Use when the user asks about today\'s date, current time, or when you need to know the current date for context.',
    parameters: {},
  },
  {
    name: 'list_calendar_events',
    description: 'List upcoming events from the Haven calendar for this channel. Use when the user asks about upcoming events, schedule, or what\'s planned.',
    parameters: {
      limit: { type: 'number', description: 'Maximum number of events to return (default 5)', default: 5 },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Add a new event to the Haven calendar. Use when the user asks to add, create, or schedule an event. Requires a title and date/time.',
    parameters: {
      title:    { type: 'string',  description: 'Event title', required: true },
      date:     { type: 'string',  description: 'Event date in YYYY-MM-DD format', required: true },
      time:     { type: 'string',  description: 'Event time in HH:MM format (24hr)', required: true },
      notify:   { type: 'boolean', description: 'Whether to send reminders (default true)', default: true },
    },
  },
  {
    name: 'get_leaderboard',
    description: 'Get the XP leaderboard showing top users on the server. Use when the user asks about rankings, top users, or leaderboard.',
    parameters: {
      limit: { type: 'number', description: 'Number of users to show (default 5)', default: 5 },
    },
  },
  {
    name: 'play_sound',
    description: 'Play a sound from the Haven soundboard. Use when the user asks to play a sound effect.',
    parameters: {
      sound_name: { type: 'string', description: 'Name of the sound to play', required: true },
    },
  },
  {
    name: 'list_rss_feeds',
    description: 'List the active RSS feeds being monitored in this channel. Use when the user asks about news feeds or what feeds are configured.',
    parameters: {},
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Execute a tool call and return the result as a string.
 *
 * @param {string} toolName   - Name of the tool to call
 * @param {object} args       - Tool arguments
 * @param {object} context    - { bot, channelId, userId, username, timezone }
 * @returns {Promise<string>} - Result string to inject back into the conversation
 */
async function executeTool(toolName, args, context) {
  const { bot, channelId, userId, username, timezone } = context;

  switch (toolName) {

    case 'get_datetime': {
      const tz  = timezone || process.env.TIMEZONE || 'UTC';
      const now = new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
      return `Current date and time: ${now} (${tz})`;
    }

    case 'list_calendar_events': {
      const limit  = args.limit || 5;
      const events = calendar.getUpcomingForChannel(channelId, limit);

      if (events.length === 0) {
        return 'No upcoming events scheduled in this channel.';
      }

      const tz = timezone || process.env.TIMEZONE || 'UTC';
      const lines = events.map(ev => {
        const dt = new Date(ev.event_time).toLocaleString('en-US', {
          timeZone: tz, dateStyle: 'medium', timeStyle: 'short'
        });
        return `[ID:${ev.id}] ${ev.title} — ${dt}`;
      });

      return `Upcoming events:\n${lines.join('\n')}`;
    }

    case 'create_calendar_event': {
      if (!args.title || !args.date || !args.time) {
        return 'Error: title, date, and time are required to create an event.';
      }

      // Convert to UTC
      const tz       = timezone || process.env.TIMEZONE || 'UTC';
      const combined = `${args.date}T${args.time}:00`;
      const fmt      = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const now      = new Date();
      const offsetMs = now - new Date(fmt.format(now).replace(
        /(\d{4})-(\d{2})-(\d{2}),? (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6'
      ));
      const eventUtc = new Date(new Date(combined).getTime() + offsetMs).toISOString();

      if (new Date(eventUtc) <= new Date()) {
        return `Error: event date ${args.date} ${args.time} appears to be in the past.`;
      }

      const eventId = calendar.createEvent(args.title, eventUtc, channelId, username);

      // Add default notifications if requested
      if (args.notify !== false) {
        const eventTime = new Date(eventUtc);
        const offsets = [
          { ms: 86400000, label: '1 day' },
          { ms: 21600000, label: '6 hours' },
          { ms: 1800000,  label: '30 minutes' },
        ];
        for (const offset of offsets) {
          const notifyAt = new Date(eventTime.getTime() - offset.ms);
          if (notifyAt > new Date()) {
            calendar.addNotification(eventId, notifyAt.toISOString(), offset.label);
          }
        }
      }

      const displayTime = new Date(eventUtc).toLocaleString('en-US', {
        timeZone: tz, dateStyle: 'medium', timeStyle: 'short'
      });

      return `Event created: "${args.title}" on ${displayTime} (ID: ${eventId}). Reminders set for 1 day, 6 hours, and 30 minutes before.`;
    }

    case 'get_leaderboard': {
      const limit = args.limit || 5;
      const board = stats.getChannelLeaderboard(channelId, limit);

      if (board.length === 0) {
        return 'No users on the leaderboard yet.';
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = board.map((entry, i) => {
        const prefix = medals[i] || `${i + 1}.`;
        return `${prefix} ${entry.username} — Level ${entry.level} (${entry.xp} XP)`;
      });

      return `Leaderboard:\n${lines.join('\n')}`;
    }

    case 'play_sound': {
      if (!args.sound_name) {
        return 'Error: sound_name is required.';
      }
      try {
        await bot.playSound(args.sound_name);
        return `Playing sound: "${args.sound_name}"`;
      } catch (err) {
        return `Failed to play sound "${args.sound_name}": ${err.message}`;
      }
    }

    case 'list_rss_feeds': {
      const feeds = rssFeeds.getActive ? rssFeeds.getActive() : [];
      const channelFeeds = feeds.filter(f => f.channel_id === channelId);

      if (channelFeeds.length === 0) {
        return 'No active RSS feeds in this channel.';
      }

      const lines = channelFeeds.map(f =>
        `[ID:${f.id}] ${f.title || f.url}`
      );

      return `Active RSS feeds:\n${lines.join('\n')}`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
};