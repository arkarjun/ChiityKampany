/**
 * Auth.gs
 * Every function callable from the browser (via google.script.run) that
 * changes data or reveals admin-only information should call
 * requireRole_() first. Identity comes from the signed-in Google account
 * (Session.getActiveUser()), never from anything the client sends — a
 * client can lie about who it is, but it can't fake being signed in as
 * someone else's Google account.
 */

/** Returns the signed-in user's row from the Users sheet, or null if they're not listed. */
function getCurrentUser_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) return null;
  const users = readAll_(SHEETS.USERS);
  const match = users.find(function (u) {
    return String(u.Email).toLowerCase() === email.toLowerCase() && u.Active === true;
  });
  return match || null;
}

/** Throws if the signed-in user isn't active in the Users sheet, or doesn't hold one of the allowed roles. */
function requireRole_(allowedRoles) {
  const user = getCurrentUser_();
  if (!user) {
    throw new Error('Access denied: your Google account is not registered in Chitty Kampany. Ask an admin to add you to the Users sheet.');
  }
  if (allowedRoles.indexOf(user.Role) === -1) {
    throw new Error('Access denied: this action requires ' + allowedRoles.join(' or ') + ' access.');
  }
  return user;
}

/**
 * Called by both Agent.html and Admin.html on load to find out who's
 * signed in and what they're allowed to see. The client uses this to
 * decide which screen to render — the server-side requireRole_() calls
 * are the real enforcement, this is just so the UI doesn't dead-end.
 */
/**
 * Guards against locking the committee out of its own Admin panel: refuses
 * to deactivate or demote the last remaining active ADMIN. Call this before
 * any change that could remove someone's admin status.
 */
function assertNotLastAdmin_(targetEmail) {
  const activeAdmins = readAll_(SHEETS.USERS).filter(function (u) {
    return u.Role === ROLE.ADMIN && u.Active === true;
  });
  const isOnlyAdmin = activeAdmins.length === 1 &&
    String(activeAdmins[0].Email).toLowerCase() === String(targetEmail).toLowerCase();
  if (isOnlyAdmin) {
    throw new Error('Can\'t do that — ' + targetEmail + ' is the only active admin left. Add another admin first.');
  }
}

function whoAmI() {
  const user = getCurrentUser_();
  if (!user) {
    return { registered: false, email: Session.getActiveUser().getEmail() || '(unknown)' };
  }
  return { registered: true, email: user.Email, name: user.Name, role: user.Role };
}
