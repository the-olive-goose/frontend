// ── Refund reminder scheduler ───────────────────────────────────────────────────
// There's no cron/job runner in this deployment (single Node process on Railway),
// so this runs an in-process sweep instead. It's a known single-instance
// limitation — fine for the current setup, would need a real scheduler if this
// ever scales to multiple server instances.

import { sendRefundReminderEmail } from './email.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_RUN_DELAY_MS = 30 * 1000;
const DEFAULT_REMINDER_DAYS = [1, 5, 7];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startRefundReminderScheduler(pool) {
  const sweep = async () => {
    try {
      const { rows: settingsRows } = await pool.query(
        `SELECT value FROM site_settings WHERE key = 'content_automationSettings'`
      );
      const settings = settingsRows[0]?.value || {};
      if (settings.refund_reminder_enabled === false) return;

      const configuredDays = Array.isArray(settings.refund_reminder_days) ? settings.refund_reminder_days : [];
      const days = configuredDays.map(Number).filter(n => Number.isFinite(n) && n > 0);
      const reminderDays = days.length ? days : DEFAULT_REMINDER_DAYS;

      const adminEmail = process.env.ADMIN_EMAIL;
      if (!adminEmail) return;

      const { rows: reminders } = await pool.query(
        `SELECT rr.*, o.tracking_number, o.total FROM refund_reminders rr
         JOIN orders o ON o.id = rr.order_id
         WHERE rr.resolved_at IS NULL`
      );

      for (const reminder of reminders) {
        const daysElapsed = Math.floor((Date.now() - new Date(reminder.eligible_at).getTime()) / MS_PER_DAY);
        const alreadySent = new Set(reminder.reminders_sent || []);
        let updated = false;

        for (const day of reminderDays) {
          if (daysElapsed >= day && !alreadySent.has(day)) {
            await sendRefundReminderEmail(adminEmail, {
              day, source: reminder.source, orderTrackingNumber: reminder.tracking_number,
              total: Number(reminder.total).toFixed(2), daysElapsed,
            });
            alreadySent.add(day);
            updated = true;
          }
        }

        if (updated) {
          await pool.query(
            `UPDATE refund_reminders SET reminders_sent = $1 WHERE id = $2`,
            [JSON.stringify(Array.from(alreadySent)), reminder.id]
          );
        }
      }
    } catch (err) {
      console.error('[refund reminder sweep]', err);
    }
  };

  setTimeout(sweep, FIRST_RUN_DELAY_MS);
  setInterval(sweep, SWEEP_INTERVAL_MS);
}
