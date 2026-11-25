const $ = (selector) => document.querySelector(selector);
const notice = $('#notice');
const authView = $('#authView');
const dashboardView = $('#dashboardView');
let currentUser = null;

function showNotice(message, type = 'success') {
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.hidden = false;
  notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearNotice() { notice.hidden = true; notice.textContent = ''; }
function showTab(tab) {
  clearNotice();
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#registerForm').hidden = tab !== 'register';
  $('#resetRequestForm').hidden = tab !== 'reset';
  $('#resetCompleteForm').hidden = true;
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = busy; button.dataset.originalText ||= button.textContent; button.textContent = busy ? 'Please wait…' : button.dataset.originalText; }
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));

$('#level').addEventListener('change', event => {
  const is100 = event.target.value === '100';
  $('#studentNumberLabel').firstChild.textContent = is100 ? 'Registration number' : 'Matriculation number';
});

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); clearNotice();
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(formData(form)) }); await loadDashboard(); showNotice('You are now signed in.'); }
  catch (error) { showNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#registerForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const data = formData(form); setBusy(form, true); clearNotice();
  if (data.password !== data.confirmPassword) { showNotice('The passwords do not match.', 'error'); setBusy(form, false); return; }
  delete data.confirmPassword;
  data.matricType = data.level === '100' ? 'registration' : 'matriculation';
  try {
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
    form.reset(); showTab('login'); $('#loginForm [name="matricNumber"]').value = data.matricNumber;
    showNotice('Registration successful. You can now sign in using your student number and password.');
  } catch (error) { showNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#resetRequestForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); clearNotice();
  try {
    await api('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify(formData(form)) });
    $('#resetCompleteForm [name="matricNumber"]').value = formData(form).matricNumber;
    showNotice('If the account is eligible, a reset code will be sent to its registered phone number.');
  } catch (error) { showNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});
$('#showResetComplete').addEventListener('click', () => {
  $('#resetRequestForm').hidden = true; $('#resetCompleteForm').hidden = false;
  $('#resetCompleteForm [name="matricNumber"]').value = $('#resetRequestForm [name="matricNumber"]').value;
});
$('#resetCompleteForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); clearNotice();
  try {
    await api('/api/auth/password-reset/complete', { method: 'POST', body: JSON.stringify(formData(form)) });
    form.reset(); showTab('login'); showNotice('Password reset successful. Sign in with your new password.');
  } catch (error) { showNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

async function loadDashboard() {
  const data = await api('/api/auth/me');
  currentUser = data.user;
  authView.hidden = true; dashboardView.hidden = false;
  $('#welcomeName').textContent = `Welcome, ${currentUser.full_name}`;
  $('#studentNumber').textContent = currentUser.matric_number;
  $('#studentDepartment').textContent = currentUser.department;
  $('#studentLevel').textContent = currentUser.level + ' Level';
  try { await api('/api/admin/me'); $('#adminPanel').hidden = false; }
  catch { $('#adminPanel').hidden = true; }
}
$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
  finally { currentUser = null; dashboardView.hidden = true; authView.hidden = false; showTab('login'); showNotice('You have signed out.'); }
});

$('#userSearchForm').addEventListener('submit', async event => {
  event.preventDefault(); const data = formData(event.currentTarget);
  const params = new URLSearchParams();
  if (data.search) params.set('search', data.search);
  if (data.status) params.set('status', data.status);
  const container = $('#userResults'); container.textContent = 'Searching…';
  try {
    const result = await api('/api/admin/users?' + params.toString());
    container.replaceChildren();
    if (!result.users.length) { container.textContent = 'No matching student accounts.'; return; }
    result.users.forEach(user => {
      const row = document.createElement('div'); row.className = 'user-row';
      const info = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = user.full_name;
      const details = document.createElement('small'); details.textContent = `${user.matric_number} · ${user.department} · ${user.level} Level · ${user.phoneMasked} · ${user.account_status}`;
      info.append(name, details);
      const actions = document.createElement('div'); actions.className = 'user-actions';
      const addAction = (label, action) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => moderateUser(user.id, action)); actions.append(button);
      };
      if (user.account_status === 'active') { addAction('Suspend', 'suspend'); addAction('Deactivate', 'deactivate'); }
      else addAction('Restore', 'restore');
      addAction('Mute 24h', 'mute');
      row.append(info, actions); container.append(row);
    });
  } catch (error) { container.textContent = error.message; }
});
async function moderateUser(userId, action) {
  const reason = window.prompt(`Reason for ${action} action:`);
  if (!reason || reason.trim().length < 5) return showNotice('Please provide a reason of at least five characters.', 'error');
  const body = { action, reason: reason.trim() };
  if (action === 'mute') body.durationHours = 24;
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}/moderation`, { method: 'POST', body: JSON.stringify(body) });
    showNotice('The moderation action has been recorded.');
    $('#userSearchForm').requestSubmit();
  } catch (error) { showNotice(error.message, 'error'); }
}

(async () => {
  try { await loadDashboard(); }
  catch { authView.hidden = false; dashboardView.hidden = true; }
})();
