/**
 * Notifications.gs
 * Email is sent automatically via Apps Script's own mail service — no
 * external account, no cost, no setup beyond the script owner's Gmail
 * quota (about 100/day on a personal account, ~1500/day on Workspace).
 * WhatsApp in v1 is a manual tap-to-send: we build a pre-filled wa.me
 * link and the agent/admin taps it themselves. No Business API, no
 * verification, no per-message cost.
 *
 * Every message is built from a template stored in the Config sheet (so an
 * admin can customize wording from Admin -> Settings), falling back to the
 * defaults below when nothing's been saved yet. Payment receipts include a
 * {{ref}} token — the real CollectionID — on purpose: it gives a member a
 * concrete code they can quote back to the committee to verify a receipt is
 * genuine, since nothing about how a wa.me link is sent can be locked down
 * (tapping it just opens WhatsApp on the agent's own phone under their own
 * account). It doesn't stop someone determined from typing a fake message by
 * hand, but it means a real receipt is always checkable against the
 * Collections sheet, and a fabricated one is easy to catch on request.
 */

const DEFAULT_PAYMENT_RECEIPT_WHATSAPP_ =
  '{{committeeName}}: Payment received - Rs. {{amount}} ({{mode}}) on {{date}} for chit "{{chitName}}". Ref: {{ref}}. Thank you.';
const DEFAULT_PAYMENT_RECEIPT_EMAIL_ =
  'Hi {{memberName}},\n\nWe recorded a payment of Rs. {{amount}} ({{mode}}) on {{date}} for your chit "{{chitName}}".\nRef: {{ref}}\n\nThank you,\n{{committeeName}}';
const DEFAULT_DRAW_RESULT_WHATSAPP_ =
  '{{committeeName}}: Congratulations! You won round {{roundNumber}} of chit "{{chitName}}". Payout: Rs. {{netPayout}}.';
const DEFAULT_DRAW_RESULT_EMAIL_ =
  'Hi {{memberName}},\n\nCongratulations — you won round {{roundNumber}} of "{{chitName}}".\nPayout: Rs. {{netPayout}}\n\n{{committeeName}}';

function getConfigValue_(key, fallback) {
  const rows = readAll_(SHEETS.CONFIG);
  const row = rows.find(function (r) { return r.Key === key; });
  return row ? row.Value : fallback;
}

/** Upsert: updates the Config row for `key` if it exists, otherwise appends a new one. */
function setConfigValue_(key, value) {
  const rows = readAll_(SHEETS.CONFIG);
  const exists = rows.some(function (r) { return r.Key === key; });
  if (exists) {
    updateRow_(SHEETS.CONFIG, 'Key', key, { Value: value });
  } else {
    appendRow_(SHEETS.CONFIG, { Key: key, Value: value });
  }
}

/** Simple {{token}} substitution. Leaves an unrecognized token untouched rather than blanking it, so a typo in a custom template is easy to spot. */
function renderTemplate_(template, tokens) {
  return String(template).replace(/\{\{(\w+)\}\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : match;
  });
}

function sendPaymentReceiptEmail_(member, chit, amount, mode, date, collectionId) {
  if (!member.Email) return; // no email on file, nothing to send
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const tokens = {
    memberName: member.Name, amount: amount, mode: mode, date: formatDate_(date),
    chitName: chit.Name, committeeName: committeeName, ref: collectionId
  };
  const subject = committeeName + ' — Payment received for ' + chit.Name;
  const body = renderTemplate_(getConfigValue_('PaymentReceiptEmailTemplate', DEFAULT_PAYMENT_RECEIPT_EMAIL_), tokens);
  try {
    MailApp.sendEmail(member.Email, subject, body);
  } catch (err) {
    // Don't let a mail failure block the payment from being recorded — log and move on.
    Logger.log('Email send failed for ' + member.Email + ': ' + err);
  }
}

function sendDrawResultEmail_(winnerMember, chit, drawResult) {
  if (!winnerMember.Email) return;
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const tokens = {
    memberName: winnerMember.Name, roundNumber: drawResult.roundNumber, netPayout: drawResult.netPayout,
    chitName: chit.Name, committeeName: committeeName
  };
  const subject = committeeName + ' — Draw result for ' + chit.Name;
  const body = renderTemplate_(getConfigValue_('DrawResultEmailTemplate', DEFAULT_DRAW_RESULT_EMAIL_), tokens);
  try {
    MailApp.sendEmail(winnerMember.Email, subject, body);
  } catch (err) {
    Logger.log('Email send failed for ' + winnerMember.Email + ': ' + err);
  }
}

/** Builds a wa.me link with a pre-filled message. The agent/admin taps it to actually send. */
function buildWhatsAppLink_(phone, message) {
  if (!phone) return null;
  const digitsOnly = String(phone).replace(/\D/g, '');
  return 'https://wa.me/' + digitsOnly + '?text=' + encodeURIComponent(message);
}

function buildPaymentReceiptWhatsAppLink_(member, chit, amount, mode, date, collectionId) {
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const tokens = {
    memberName: member.Name, amount: amount, mode: mode, date: formatDate_(date),
    chitName: chit.Name, committeeName: committeeName, ref: collectionId
  };
  const message = renderTemplate_(getConfigValue_('PaymentReceiptWhatsAppTemplate', DEFAULT_PAYMENT_RECEIPT_WHATSAPP_), tokens);
  return buildWhatsAppLink_(member.Phone, message);
}

function buildDrawResultWhatsAppLink_(winnerMember, chit, drawResult) {
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const tokens = {
    memberName: winnerMember.Name, roundNumber: drawResult.roundNumber, netPayout: drawResult.netPayout,
    chitName: chit.Name, committeeName: committeeName
  };
  const message = renderTemplate_(getConfigValue_('DrawResultWhatsAppTemplate', DEFAULT_DRAW_RESULT_WHATSAPP_), tokens);
  return buildWhatsAppLink_(winnerMember.Phone, message);
}
