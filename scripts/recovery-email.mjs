const BREVO = 'https://api.brevo.com/v3/smtp';
const MAX_ATTEMPTS = 4;
const CHECK_INTERVAL = 60_000;
const POLL_DELAYS = [1_500, 2_500, 4_000, 5_000, 5_000];
const ATTEMPT_TAG = 'briefbooth-recovery-';
const SENDER = { email: 'admin@customtechbuilt4u.com', name: '4u Digital' };
const DELIVERED = new Set(['delivered', 'opened', 'open', 'uniqueopen', 'uniqueopened', 'firstopening', 'click', 'clicked']);
const TERMINAL = new Set(['softbounce', 'softbounces', 'hardbounce', 'hardbounces', 'blocked', 'invalid', 'invalidemail', 'error', 'spam', 'unsubscribed']);

function expected(kind) {
  const stage = kind.split('_')[0];
  return stage === 'request' ? 'pending_approval' : stage;
}

const CURRENT = `(CASE WHEN substr(e.kind, 1, 8) = 'request_' THEN 'pending_approval'
  ELSE substr(e.kind, 1, instr(e.kind, '_') - 1) END) = b.status AND e.booking_version=b.notification_version`;

export const recoveryMailFlagsSql = `SELECT json_object(
  'email_pending', count(*),
  'email_uncertain', sum(CASE WHEN e.state IN ('uncertain', 'sending') OR (e.state='sent' AND e.delivery_status='unknown') THEN 1 ELSE 0 END),
  'email_queued', sum(CASE WHEN e.state='queued' THEN 1 ELSE 0 END),
  'email_failed', sum(CASE WHEN e.delivery_status='failed' THEN 1 ELSE 0 END))
  FROM recovery_emails e WHERE e.booking_id=b.id AND ${CURRENT}
    AND e.state<>'superseded' AND e.delivery_status<>'delivered'`;

export function readRecoveryMailFlags(value) {
  const flags = JSON.parse(value || '{}');
  return Object.fromEntries(['email_pending', 'email_uncertain', 'email_queued', 'email_failed'].map(key => [key, Boolean(flags[key])]));
}

export async function recoveryMailFlags(env, bookingId, clientOnly = false) {
  const scope = clientOnly ? " AND substr(e.kind, -7)='_client'" : '';
  const row = await env.RECOVERY_DB.prepare(`SELECT (${recoveryMailFlagsSql}${scope}) AS flags FROM recovery_bookings b WHERE id=?`).bind(bookingId).first();
  return readRecoveryMailFlags(row?.flags);
}

function providerId(value) {
  const id = typeof value === 'string' ? value.trim().replace(/^<|>$/g, '') : '';
  return id && id.length <= 400 && !/[\s<>]/.test(id) ? id : null;
}

function providerFetch(env, path, init = {}, timeout = 10_000) {
  return fetch(BREVO + path, { ...init, headers: { 'api-key': env.BREVO_API_KEY, ...init.headers }, signal: AbortSignal.timeout(timeout) });
}

async function finishAttempt(env, row, attempt, number, outcome, state, delivery, { messageId = null, next = 0, error = null } = {}) {
  const db = env.RECOVERY_DB;
  await db.batch([
    db.prepare("UPDATE recovery_email_attempts SET outcome=?, provider_message_id=? WHERE id=? AND outcome='sending'")
      .bind(outcome, messageId, attempt),
    db.prepare(`UPDATE recovery_emails SET state=?, delivery_status=?, next_attempt_ms=?, last_error=?, sent_ms=?
      WHERE id=? AND attempt_count=? AND state='sending'`)
      .bind(state, delivery, next, error, messageId ? Date.now() : null, row.id, number),
  ]);
}

export async function deliverRecoveryEmails(env, bookingId, ctx, onlyEmailId = null, timeout = 10_000) {
  if (!env.BREVO_API_KEY) return;
  const db = env.RECOVERY_DB;
  const { results } = await db.prepare(`SELECT * FROM recovery_emails
    WHERE booking_id=? AND state='queued' AND next_attempt_ms<=? AND (? IS NULL OR id=?)
    ORDER BY created_ms,id LIMIT 6`).bind(bookingId, Date.now(), onlyEmailId, onlyEmailId).all();

  let accepted = false;
  for (const row of results) {
    const attempt = crypto.randomUUID();
    const now = Date.now();
    const claim = await db.prepare(`UPDATE recovery_emails
      SET state='sending', delivery_status='unknown', attempt_count=attempt_count+1, send_started_ms=?
      WHERE id=? AND state='queued' AND next_attempt_ms<=? AND attempt_count<?
        AND EXISTS(SELECT 1 FROM recovery_bookings WHERE id=recovery_emails.booking_id AND status=? AND notification_version=recovery_emails.booking_version AND NOT EXISTS(SELECT 1 FROM recovery_reschedule_operations r WHERE r.booking_id=recovery_bookings.id AND r.state='applying'))
      RETURNING attempt_count`).bind(now, row.id, now, MAX_ATTEMPTS, expected(row.kind)).first();
    if (!claim) continue;
    const number = claim.attempt_count;
    await db.prepare(`INSERT INTO recovery_email_attempts(id,email_id,attempt_number,started_ms) VALUES(?,?,?,?)`)
      .bind(attempt, row.id, number, now).run();
    // A cancellation might have committed between claiming and writing the attempt.
    const current = await db.prepare(`SELECT 1 FROM recovery_bookings WHERE id=? AND status=? AND notification_version=? AND NOT EXISTS(SELECT 1 FROM recovery_reschedule_operations r WHERE r.booking_id=recovery_bookings.id AND r.state='applying')`)
      .bind(bookingId, expected(row.kind), row.booking_version).first();
    if (!current) {
      await finishAttempt(env, row, attempt, number, 'superseded', 'superseded', 'unknown');
      continue;
    }
    let response;
    let data;
    try {
      response = await providerFetch(env, '/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: SENDER, replyTo: SENDER, to: [{ email: row.recipient }], subject: row.subject,
          textContent: row.body, headers: { idempotencyKey: attempt }, tags: [ATTEMPT_TAG + attempt, 'briefbooth-booking-' + bookingId] }),
      }, timeout);
      data = await response.json().catch(() => ({}));
    } catch {
      // A network failure may still mean Brevo accepted the message.
      await finishAttempt(env, row, attempt, number, 'unknown', 'uncertain', 'unknown', { error: 'brevo_network' });
      continue;
    }
    const messageId = response.ok ? providerId(data?.messageId) : null;
    if (messageId) {
      await finishAttempt(env, row, attempt, number, 'accepted', 'sent', 'accepted', { messageId });
      accepted = true;
    } else if (response.ok || response.status >= 500 || data?.code === 'duplicate_parameter') {
      await finishAttempt(env, row, attempt, number, 'unknown', 'uncertain', 'unknown', { error: 'brevo_acceptance_unknown' });
    } else if (response.status === 429 && number < MAX_ATTEMPTS) {
      await finishAttempt(env, row, attempt, number, 'rejected', 'queued', 'unknown', { next: Date.now() + CHECK_INTERVAL, error: 'brevo_429' });
    } else {
      await finishAttempt(env, row, attempt, number, 'rejected', 'sent', 'failed', { error: 'brevo_' + response.status });
    }
  }
  if (accepted) scheduleRecoveryMailChecks(env, bookingId, ctx);
}

function eventDetails(data) {
  if (!data || typeof data !== 'object') return null;
  const id = providerId(data['message-id'] ?? data.messageId);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const event = typeof data.event === 'string' ? data.event.toLowerCase().replace(/[^a-z]/g, '') : '';
  if (!id || !email || email.length > 254 || !event) return null;
  return { id, email, event, reason: typeof data.reason === 'string' ? data.reason : '' };
}

async function applyRecoveryMailEvent(env, attempt, details) {
  const { event, reason } = details;
  const db = env.RECOVERY_DB;
  if (DELIVERED.has(event)) {
    await db.batch([
      db.prepare("UPDATE recovery_email_attempts SET outcome='delivered' WHERE id=?").bind(attempt.id),
      db.prepare(`UPDATE recovery_emails SET state='sent', delivery_status='delivered', next_attempt_ms=0,
        sent_ms=COALESCE(sent_ms,?), last_error=NULL WHERE id=? AND state<>'superseded'`)
        .bind(Date.now(), attempt.email_id),
    ]);
    return null;
  }
  if (!TERMINAL.has(event)) return null;
  const spamCopBounce = (event === 'softbounce' || event === 'softbounces') && /\b551\b/.test(reason) && /spamcop/i.test(reason);
  const retryable = spamCopBounce && attempt.attempt_number < MAX_ATTEMPTS;
  const [, update] = await db.batch([
    db.prepare("UPDATE recovery_email_attempts SET outcome='failed' WHERE id=? AND outcome='accepted'").bind(attempt.id),
    db.prepare(`UPDATE recovery_emails SET state=?, delivery_status=?, next_attempt_ms=0, last_error=?
      WHERE id=? AND attempt_count=? AND state='sent' AND delivery_status='accepted'
        AND EXISTS(SELECT 1 FROM recovery_bookings WHERE id=recovery_emails.booking_id AND status=? AND notification_version=recovery_emails.booking_version AND NOT EXISTS(SELECT 1 FROM recovery_reschedule_operations r WHERE r.booking_id=recovery_bookings.id AND r.state='applying'))
        AND EXISTS(SELECT 1 FROM recovery_email_attempts WHERE id=? AND outcome='failed')`)
      .bind(retryable ? 'queued' : 'sent', retryable ? 'unknown' : 'failed', spamCopBounce ? 'brevo_spamcop_551' : 'brevo_' + event,
        attempt.email_id, attempt.attempt_number, expected(attempt.kind), attempt.id),
  ]);
  return update.meta.changes && retryable ? attempt.email_id : null;
}

export async function reconcileRecoveryMail(env, bookingId, { polling = false, timeout = 5_000 } = {}) {
  const db = env.RECOVERY_DB;
  const now = Date.now();
  // A crashed worker can leave an in-flight attempt. Do not start another on guesswork.
  if (!polling) await db.prepare(`UPDATE recovery_emails SET state='uncertain', last_error='brevo_acceptance_unknown'
    WHERE booking_id=? AND state='sending' AND send_started_ms<?`).bind(bookingId, now - CHECK_INTERVAL).run();
  const { results } = await db.prepare(`SELECT a.id,a.email_id,a.attempt_number,a.provider_message_id,e.recipient,e.kind FROM recovery_email_attempts a
    JOIN recovery_emails e ON e.id=a.email_id JOIN recovery_bookings b ON b.id=e.booking_id
    WHERE b.id=? AND ${CURRENT} AND a.attempt_number=e.attempt_count AND a.provider_message_id IS NOT NULL
      AND e.delivery_status='accepted' AND a.last_checked_ms<? LIMIT 6`).bind(bookingId, polling ? now + 1 : now - CHECK_INTERVAL).all();
  const retries = await Promise.all(results.map(async row => {
    const checked = await db.prepare(`UPDATE recovery_email_attempts SET last_checked_ms=?
      WHERE id=? AND last_checked_ms<? RETURNING id`).bind(now, row.id, polling ? now + 1 : now - CHECK_INTERVAL).first();
    if (!checked) return;
    let data;
    try {
      const query = new URLSearchParams({ messageId: '<' + row.provider_message_id + '>', email: row.recipient, days: '7', limit: '50' });
      const response = await providerFetch(env, '/statistics/events?' + query, {}, timeout);
      if (!response.ok) return;
      data = await response.json();
    } catch { return; }
    if (!Array.isArray(data?.events)) return;
    const exact = data.events.filter(event => {
      const details = eventDetails(event);
      return details?.id === row.provider_message_id && details.email === row.recipient.toLowerCase();
    });
    const delivered = exact.find(event => DELIVERED.has(eventDetails(event).event));
    const terminal = exact.find(event => TERMINAL.has(eventDetails(event).event));
    if (delivered || terminal) return applyRecoveryMailEvent(env, row, eventDetails(delivered || terminal));
  }));
  return { checking: results.length > 0, retries: retries.filter(Boolean) };
}

export function scheduleRecoveryMailChecks(env, bookingId, ctx, retries = []) {
  if (!ctx?.waitUntil) return;
  ctx.waitUntil((async () => {
    const deadline = Date.now() + 24_000;
    const sendRetries = async (emailIds) => {
      const timeout = Math.min(3_000, deadline - Date.now());
      if (timeout > 0) await Promise.all(emailIds.map(emailId => deliverRecoveryEmails(env, bookingId, null, emailId, timeout)));
    };
    await sendRetries(retries);
    for (const delay of POLL_DELAYS) {
      if (Date.now() + delay + 2_500 >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      const { checking, retries: queued } = await reconcileRecoveryMail(env, bookingId, { polling: true, timeout: 2_500 });
      await sendRetries(queued);
      if (!checking) break;
    }
  })());
}

