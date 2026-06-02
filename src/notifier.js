// ---------------------------------------------------------------------------
// Notification runner
// Checks every 60 seconds for pending event reminders and fires them.
// ---------------------------------------------------------------------------

const { calendar } = require('./database');
const channelManager = require('./channels');

/**
 * Format a UTC ISO string for display in the server timezone.
 * Duplicated here to keep notifier self-contained.
 */
function formatEventTime(utcIso) {
  const tz = process.env.TIMEZONE || 'UTC';
  return new Date(utcIso).toLocaleString('en-US', {
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

/**
 * Build the reminder message for a notification.
 */
function buildReminderMessage(notification) {
  const rsvps = calendar.getRsvps(notification.event_id);
  const attendeeList = rsvps.length > 0
    ? rsvps.map(r => r.username).join(', ')
    : 'No one yet — use `/rsvp ' + notification.event_id + '` to join!';

  return (
    `⏰ **Event Reminder — ${notification.offset_label} to go!**\n\n` +
    `📅 **${notification.title}**\n` +
    `🕐 ${formatEventTime(notification.event_time)}\n\n` +
    `✅ **Attending (${rsvps.length}):** ${attendeeList}`
  );
}

/**
 * Start the notification polling loop.
 * @param {HavenBot} bot - bot instance with sendMessage method
 * @param {number} intervalMs - how often to check (default 60s)
 */
const AGENT_ENABLED = (process.env.AGENT_ENABLED || 'false').toLowerCase() === 'true';

function startNotifier(bot, intervalMs = 60000) {
  console.log(`🔔 Notification runner started (checking every ${intervalMs / 1000}s)`);

  const tick = async () => {
    try {
      const pending = calendar.getPendingNotifications();
      for (const notification of pending) {
        try {
          const message = buildReminderMessage(notification);
          // Send to the channel the event was created in
          await bot.sendMessage(message, notification.channel_id);
          calendar.markNotificationSent(notification.id);
          console.log(`✅ Notification sent for event ${notification.event_id} (${notification.title})`);

          // Fire AI briefing if agent is enabled (non-blocking)
          if (AGENT_ENABLED) {
            const { sendEventBriefing } = require('./agent/briefing');
            sendEventBriefing(bot, notification).catch(err => {
              console.error('[Briefing] Non-fatal error:', err.message);
            });
          }
        } catch (err) {
          console.error(`❌ Failed to send notification ${notification.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('❌ Notification runner error:', err.message);
    }
  };

  // Run once immediately on start, then on interval
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = { startNotifier };
