/**
 * Notifications.gs
 * Email is sent automatically via Apps Script's own mail service — no
 * external account, no cost, no setup beyond the script owner's Gmail
 * quota (about 100/day on a personal account, ~1500/day on Workspace).
 * WhatsApp in v1 is a manual tap-to-send: we build a pre-filled wa.me
 * link and the agent/admin taps it themselves. No Business API, no
 * verification, no per-message cost.
 */

function getConfigValue_(key, fallback) {
  const rows = readAll_(SHEETS.CONFIG);
  const row = rows.find(function (r) { return r.Key === key; });
  return row ? row.Value : fallback;
}

function sendPaymentReceiptEmail_(member, chit, amount, mode, date) {
  if (!member.Email) return; // no email on file, nothing to send
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const subject = committeeName + ' — Payment received for ' + chit.Name;
  const body = 'Hi ' + member.Name + ',\n\n' +
    'We recorded a payment of Rs. ' + amount + ' (' + mode + ') on ' + formatDate_(date) +
    ' for your chit "' + chit.Name + '".\n\n' +
    'Thank you,\n' + committeeName;
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
  const subject = committeeName + ' — Draw result for ' + chit.Name;
  const body = 'Hi ' + winnerMember.Name + ',\n\n' +
    'Congratulations — you won round ' + drawResult.roundNumber + ' of "' + chit.Name + '".\n' +
    'Payout: Rs. ' + drawResult.netPayout + '\n\n' +
    committeeName;
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

function buildPaymentReceiptWhatsAppLink_(member, chit, amount, mode, date) {
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const message = committeeName + ': Payment received - Rs. ' + amount + ' (' + mode + ') on ' +
    formatDate_(date) + ' for chit "' + chit.Name + '". Thank you.';
  return buildWhatsAppLink_(member.Phone, message);
}

function buildDrawResultWhatsAppLink_(winnerMember, chit, drawResult) {
  const committeeName = getConfigValue_('CommitteeName', 'Chitty Kampany');
  const message = committeeName + ': Congratulations! You won round ' + drawResult.roundNumber +
    ' of chit "' + chit.Name + '". Payout: Rs. ' + drawResult.netPayout + '.';
  return buildWhatsAppLink_(winnerMember.Phone, message);
}
