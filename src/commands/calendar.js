// ---------------------------------------------------------------------------
// Calendar commands
//
// Commands:
//   /calendar add <date> <time> <title> [--notify <offsets>]
//   /calendar list
//   /calendar view <id>
//   /calendar edit <id> <field> <value>
//   /calendar delete <id>
//   /rsvp <id>
//
// Date format: ISO 8601  e.g. 2026-04-13
// Time format: 24h       e.g. 17:00
// Timezone:    TIMEZONE env var (IANA name, default UTC)
//
// Notify offsets: space-separated list of d/h/m values
//   e.g. --notify 1d 6h 30m  → three notifications
// ---------------------------------------------------------------------------

const { calendar, admins } = require('../database');

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------
function getTimezone() {
  return process.env.TIMEZONE || 'UTC';
}

/**
 * Parse "2026-04-13 17:00" in the server timezone and return a UTC ISO string.
 */
function parseLocalToUtc(dateStr, timeStr) {
  // Build a date string with timezone offset using Intl
  const tz = getTimezone();
  const combined = `${dateStr}T${timeStr}:00`;

  // Use a dummy date to get the UTC offset for this timezone at this moment
  const localDate = new Date(combined);
  if (isNaN(localDate)) return null;

  // Convert local time in given timezone to UTC
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Get what "now" looks like in the target timezone and compute offset
  const now = new Date();
  const tzNowStr = formatter.format(now);
  const tzNow = new Date(tzNowStr.replace(/(\d{4})-(\d{2})-(\d{2}),? (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6'));
  const offsetMs = now - tzNow;

  const eventLocal = new Date(combined);
  const eventUtc = new Date(eventLocal.getTime() + offsetMs);
  return eventUtc.toISOString();
}

/**
 * Format a UTC ISO string for display in the server timezone.
 */
function formatEventTime(utcIso) {
  const tz = getTimezone();
  const date = new Date(utcIso);
  return date.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ---------------------------------------------------------------------------
// Notification offset parser
// "1d 6h 30m" → [{ ms: 86400000, label: "1 day" }, ...]
// ---------------------------------------------------------------------------
function parseNotifyOffsets(offsetStr) {
  if (!offsetStr) return [];
  const tokens = offsetStr.trim().split(/\s+/);
  const results = [];

  for (const token of tokens) {
    const match = token.match(/^(\d+)([dhm])$/i);
    if (!match) continue;
    const n = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    let ms, label;
    switch (unit) {
      case 'd': ms = n * 86400000; label = `${n} day${n !== 1 ? 's' : ''}`; break;
      case 'h': ms = n * 3600000;  label = `${n} hour${n !== 1 ? 's' : ''}`; break;
      case 'm': ms = n * 60000;    label = `${n} minute${n !== 1 ? 's' : ''}`; break;
    }
    results.push({ ms, label });
  }
  return results;
}

// ---------------------------------------------------------------------------
// /calendar add <date> <time> <title> [--notify <offsets>]
// ---------------------------------------------------------------------------
async function calendarAdd(bot, data) {
  const { user_id: userId, user, channel_id: channelId, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can create events.`);
  }

  // Split args on --notify
  const notifyIdx = args.indexOf('--notify');
  const mainArgs  = notifyIdx === -1 ? args : args.slice(0, notifyIdx);
  const notifyArgs = notifyIdx === -1 ? [] : args.slice(notifyIdx + 1);

  if (mainArgs.length < 3) {
    return bot.sendMessage(
      `❌ **Invalid Command**\n` +
      `Usage: \`/calendar add <date> <time> <title> [--notify <offsets>]\`\n\n` +
      `Example:\n\`/calendar add 2026-04-13 17:00 Group Raid --notify 1d 6h 30m\`\n\n` +
      `Date: ISO format (YYYY-MM-DD)\nTime: 24h format (HH:MM)\nNotify: d=days h=hours m=minutes`
    );
  }

  const dateStr = mainArgs[0];
  const timeStr = mainArgs[1];
  const title   = mainArgs.slice(2).join(' ');

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return bot.sendMessage(`❌ **Invalid Date**\nUse ISO format: \`YYYY-MM-DD\` (e.g. \`2026-04-13\`)`);
  }

  // Validate time format
  if (!/^\d{2}:\d{2}$/.test(timeStr)) {
    return bot.sendMessage(`❌ **Invalid Time**\nUse 24h format: \`HH:MM\` (e.g. \`17:00\`)`);
  }

  const eventUtc = parseLocalToUtc(dateStr, timeStr);
  if (!eventUtc) {
    return bot.sendMessage(`❌ **Invalid Date/Time**\nCouldn't parse \`${dateStr} ${timeStr}\`.`);
  }

  // Must be in the future
  if (new Date(eventUtc) <= new Date()) {
    return bot.sendMessage(`❌ **Past Date**\nEvents must be scheduled in the future.`);
  }

  if (title.length > 100) {
    return bot.sendMessage(`❌ **Title Too Long**\nEvent titles must be 100 characters or fewer.`);
  }

  // Create event
  const eventId = calendar.createEvent(title, eventUtc, channelId, user);

  // Schedule notifications
  const offsets = parseNotifyOffsets(notifyArgs.join(' '));
  const scheduled = [];

  for (const { ms, label } of offsets) {
    const notifyAt = new Date(new Date(eventUtc).getTime() - ms);
    if (notifyAt > new Date()) {
      calendar.addNotification(eventId, notifyAt.toISOString(), label);
      scheduled.push(label);
    }
  }

  const notifyLine = scheduled.length > 0
    ? `\n⏰ Reminders: ${scheduled.join(', ')} before`
    : '\n⏰ No reminders scheduled';

  return bot.sendMessage(
    `✅ **Event Created** (ID: ${eventId})\n` +
    `📅 **${title}**\n` +
    `🕐 ${formatEventTime(eventUtc)}` +
    notifyLine +
    `\n\nUse \`/rsvp ${eventId}\` to mark attendance.`
  );
}

// ---------------------------------------------------------------------------
// /calendar list [all]
// Without arg: events for this channel only
// With "all": all events across all channels (admin only)
// ---------------------------------------------------------------------------
async function calendarList(bot, data) {
  const { user_id: userId, channel_id: channelId } = data;
  const isAll = (data.args || []).join(' ').toLowerCase().trim() === 'all';

  let events;
  let title;

  if (isAll) {
    if (!admins.isAdmin(userId.toString())) {
      return bot.sendMessage(`❌ **Permission Denied**\n\`/calendar list all\` is admin only.`);
    }
    events = calendar.getUpcoming(25);
    title  = `📅 **All Upcoming Events (${events.length})**`;
  } else {
    events = calendar.getUpcomingForChannel(channelId, 10);
    title  = `📅 **Upcoming Events (${events.length})**`;
  }

  if (events.length === 0) {
    const hint = isAll
      ? `No events scheduled on any channel.`
      : `No events scheduled here. Admins can use \`/calendar add\` to create one.`;
    return bot.sendMessage(`📅 **Upcoming Events**\n\n${hint}`);
  }

  let message = `${title}\n\n`;
  for (const ev of events) {
    const rsvps = calendar.getRsvps(ev.id);
    message += `**[${ev.id}] ${ev.title}**\n`;
    message += `🕐 ${formatEventTime(ev.event_time)}\n`;
    if (isAll && ev.channel_id) {
      message += `📌 Channel: ${ev.channel_id}\n`;
    }
    message += `✅ ${rsvps.length} attending  •  \`/rsvp ${ev.id}\` to join\n\n`;
  }

  return bot.sendMessage(message.trim());
}

// ---------------------------------------------------------------------------
// /calendar view <id>
// ---------------------------------------------------------------------------
async function calendarView(bot, data) {
  const { args = [] } = data;
  const eventId = parseInt(args[0]);

  if (!eventId) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/calendar view <id>\`\nFind event IDs with \`/calendar list\`.`);
  }

  const ev = calendar.getEvent(eventId);
  if (!ev) {
    return bot.sendMessage(`❌ **Event Not Found**\nNo event with ID ${eventId}.`);
  }

  const rsvps = calendar.getRsvps(eventId);
  const attendeeList = rsvps.length > 0
    ? rsvps.map(r => r.username).join(', ')
    : 'None yet';

  return bot.sendMessage(
    `📅 **${ev.title}** (ID: ${ev.id})\n\n` +
    `🕐 ${formatEventTime(ev.event_time)}\n` +
    `👤 Created by: ${ev.created_by}\n\n` +
    `✅ **Attending (${rsvps.length}):** ${attendeeList}\n\n` +
    `Use \`/rsvp ${ev.id}\` to toggle your attendance.`
  );
}

// ---------------------------------------------------------------------------
// /calendar edit <id> <field> <value>
// Fields: title, date, time
// ---------------------------------------------------------------------------
async function calendarEdit(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can edit events.`);
  }

  if (args.length < 3) {
    return bot.sendMessage(
      `❌ **Invalid Command**\nUsage: \`/calendar edit <id> <field> <value>\`\n\n` +
      `Fields:\n• \`title\` — new event name\n• \`date\` — new date (YYYY-MM-DD)\n• \`time\` — new time (HH:MM)`
    );
  }

  const eventId = parseInt(args[0]);
  const field   = args[1].toLowerCase();
  const value   = args.slice(2).join(' ');

  const ev = calendar.getEvent(eventId);
  if (!ev) {
    return bot.sendMessage(`❌ **Event Not Found**\nNo event with ID ${eventId}.`);
  }

  if (field === 'title') {
    if (value.length > 100) {
      return bot.sendMessage(`❌ **Title Too Long**\nEvent titles must be 100 characters or fewer.`);
    }
    calendar.updateEvent(eventId, { title: value });
    return bot.sendMessage(`✅ **Event Updated**\nTitle changed to: **${value}**`);
  }

  if (field === 'date' || field === 'time') {
    const currentDate = new Date(ev.event_time);
    const tz = getTimezone();
    const currentDateStr = currentDate.toLocaleDateString('en-CA', { timeZone: tz });
    const currentTimeStr = currentDate.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

    const newDate = field === 'date' ? value : currentDateStr;
    const newTime = field === 'time' ? value : currentTimeStr;

    if (field === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return bot.sendMessage(`❌ **Invalid Date**\nUse ISO format: \`YYYY-MM-DD\``);
    }
    if (field === 'time' && !/^\d{2}:\d{2}$/.test(value)) {
      return bot.sendMessage(`❌ **Invalid Time**\nUse 24h format: \`HH:MM\``);
    }

    const newUtc = parseLocalToUtc(newDate, newTime);
    if (!newUtc || new Date(newUtc) <= new Date()) {
      return bot.sendMessage(`❌ **Invalid Date/Time**\nMust be a valid future date and time.`);
    }

    calendar.updateEvent(eventId, { event_time: newUtc });
    return bot.sendMessage(
      `✅ **Event Updated**\n📅 **${ev.title}**\n🕐 ${formatEventTime(newUtc)}`
    );
  }

  return bot.sendMessage(`❌ **Unknown Field**\nValid fields: \`title\`, \`date\`, \`time\``);
}

// ---------------------------------------------------------------------------
// /calendar delete <id>
// ---------------------------------------------------------------------------
async function calendarDelete(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can delete events.`);
  }

  const eventId = parseInt(args[0]);
  if (!eventId) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/calendar delete <id>\``);
  }

  const ev = calendar.getEvent(eventId);
  if (!ev) {
    return bot.sendMessage(`❌ **Event Not Found**\nNo event with ID ${eventId}.`);
  }

  calendar.deleteEvent(eventId);
  return bot.sendMessage(`✅ **Event Deleted**\n**${ev.title}** has been removed.`);
}

// ---------------------------------------------------------------------------
// /rsvp <id>  — toggles attendance
// ---------------------------------------------------------------------------
async function rsvp(bot, data) {
  const { user_id: userId, user, args = [] } = data;
  const eventId = parseInt(args[0]);

  if (!eventId) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/rsvp <event id>\`\nFind IDs with \`/calendar list\`.`);
  }

  const ev = calendar.getEvent(eventId);
  if (!ev) {
    return bot.sendMessage(`❌ **Event Not Found**\nNo event with ID ${eventId}.`);
  }

  if (new Date(ev.event_time) <= new Date()) {
    return bot.sendMessage(`❌ **Event Passed**\nYou can no longer RSVP to **${ev.title}**.`);
  }

  const { attending } = calendar.toggleRsvp(eventId, userId.toString(), user);
  const rsvps = calendar.getRsvps(eventId);

  if (attending) {
    return bot.sendMessage(
      `✅ **RSVP Confirmed**\n**${user}** is attending **${ev.title}**\n` +
      `📅 ${formatEventTime(ev.event_time)}\n` +
      `👥 ${rsvps.length} attending total`
    );
  } else {
    return bot.sendMessage(
      `❌ **RSVP Cancelled**\n**${user}** is no longer attending **${ev.title}**\n` +
      `👥 ${rsvps.length} attending total`
    );
  }
}

// ---------------------------------------------------------------------------
// Route /calendar subcommands
// ---------------------------------------------------------------------------
async function calendarRouter(bot, data) {
  const subcommand = (data.args || [])[0]?.toLowerCase();
  const subData = { ...data, args: (data.args || []).slice(1) };

  switch (subcommand) {
    case 'add':    return calendarAdd(bot, subData);
    case 'list':   return calendarList(bot, subData);
    case 'view':   return calendarView(bot, subData);
    case 'edit':   return calendarEdit(bot, subData);
    case 'delete': return calendarDelete(bot, subData);
    default:
      return bot.sendMessage(
        `📅 **Calendar Commands**\n\n` +
        `\`/calendar add <date> <time> <title> [--notify <offsets>]\` — create event\n` +
        `  • Date format: \`YYYY-MM-DD\` (e.g. \`2026-07-05\`)\n` +
        `  • Time format: \`HH:MM\` 24hr (e.g. \`14:30\` for 2:30 PM)\n` +
        `  • Notify offsets: \`1d\` \`6h\` \`30m\` — days/hours/minutes before event\n` +
        `  • Example: \`/calendar add 2026-07-05 09:00 British Grand Prix --notify 1d 6h 30m\`\n\n` +
        `\`/calendar list\` — upcoming events in this channel\n` +
        `\`/calendar list all\` — all events across all channels (admin)\n` +
        `\`/calendar view <id>\` — event details + attendees\n` +
        `\`/calendar edit <id> <field> <value>\` — edit event (admin)\n` +
        `\`/calendar delete <id>\` — delete event (admin)\n` +
        `\`/rsvp <id>\` — toggle attendance`
      );
  }
}

module.exports = { calendarRouter, rsvp };
