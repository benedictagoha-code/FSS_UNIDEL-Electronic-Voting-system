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
  await loadNominationCentre();
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

async function loadNominationCentre() {
  const opportunities = $('#nominationOpportunities');
  const mine = $('#myNominations');
  if (!opportunities || !mine) return;
  try {
    const [available, submitted] = await Promise.all([api('/api/nominations/open'), api('/api/nominations/mine')]);
    opportunities.replaceChildren();
    if (!available.opportunities.length) {
      const empty=document.createElement('p'); empty.className='muted'; empty.textContent='There are no open nomination opportunities at this time.'; opportunities.append(empty);
    }
    available.opportunities.forEach(item => {
      const card=document.createElement('form'); card.className='opportunity-card';
      const heading=document.createElement('strong'); heading.textContent=item.office_title;
      const sub=document.createElement('small'); sub.textContent=item.election_title+' · '+item.seats+' seat(s) · Nomination fee: ₦'+(Number(item.nomination_fee_kobo)/100).toLocaleString('en-NG',{minimumFractionDigits:2});
      const manifesto=document.createElement('textarea'); manifesto.name='manifesto'; manifesto.maxLength=5000; manifesto.placeholder='Optional manifesto (up to 5,000 characters)';
      const channel=document.createElement('select'); channel.name='paymentChannel';
      ['Zenith Bank','OPay','Moniepoint','Other bank transfer'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;channel.append(o);});
      const ref=document.createElement('input'); ref.name='transactionReference'; ref.required=true; ref.minLength=4; ref.maxLength=120; ref.placeholder='Payment transaction reference';
      const submit=document.createElement('button'); submit.type='submit'; submit.className='primary'; submit.textContent='Submit nomination';
      const label1=document.createElement('label'); label1.textContent='Payment channel'; label1.append(channel);
      const label2=document.createElement('label'); label2.textContent='Transaction reference'; label2.append(ref);
      const label3=document.createElement('label'); label3.textContent='Manifesto (optional)'; label3.append(manifesto);
      card.append(heading,sub,label1,label2,label3,submit);
      card.addEventListener('submit',async ev=>{
        ev.preventDefault(); submit.disabled=true; submit.textContent='Submitting…';
        try{
          const result=await api('/api/nominations',{method:'POST',body:JSON.stringify({electionId:item.election_id,officeId:item.office_id,manifesto:manifesto.value,paymentChannel:channel.value,transactionReference:ref.value})});
          showNotice('Nomination submitted. Reference: '+result.nomination.reference+'. Payment verification is pending.');
          await loadNominationCentre();
        }catch(error){showNotice(error.message,'error');}
        finally{submit.disabled=false;submit.textContent='Submit nomination';}
      });
      opportunities.append(card);
    });
    mine.replaceChildren();
    if(!submitted.nominations.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='You have not submitted any nominations yet.';mine.append(empty);}
    submitted.nominations.forEach(n=>{
      const row=document.createElement('div');row.className='nomination-row';
      const info=document.createElement('div');const title=document.createElement('strong');title.textContent=n.office_title;
      const details=document.createElement('small');details.textContent=n.election_title+' · '+n.reference+' · Payment: '+n.verification_status+' · Eligibility: '+n.eligibility_status;
      info.append(title,details);
      const download=document.createElement('a');download.className='download-link';download.href='/api/nominations/'+encodeURIComponent(n.id)+'/form.pdf';download.textContent='Download PDF form';
      row.append(info,download);mine.append(row);
    });
  }catch(error){opportunities.textContent=error.message;mine.textContent='Unable to load nomination records.';}
}
$('#refreshNominations')?.addEventListener('click',loadNominationCentre);
