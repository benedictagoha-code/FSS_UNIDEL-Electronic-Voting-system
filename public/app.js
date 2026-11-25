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
  try {
    const admin = await api('/api/admin/me');
    $('#adminPanel').hidden = false;
    const roles = admin.roles || [];
    $('#electionAdminTools').hidden = !roles.some(r => ['super_admin','election_admin'].includes(r));
    $('#resultsAdminTools').hidden = !roles.some(r => ['super_admin','results_officer'].includes(r));
    $('#nominationAdminTools').hidden = !roles.some(r => ['super_admin','election_admin'].includes(r));
    $('#financeAdminTools').hidden = !roles.some(r => ['super_admin','finance_admin'].includes(r));
    if (!$('#financeAdminTools').hidden) { await loadPaymentSettings(); await loadPayments(); }
    if (!$('#electionAdminTools').hidden) await loadAdminElections();
    if (!$('#nominationAdminTools').hidden) await loadEligibilityQueue();
  } catch { $('#adminPanel').hidden = true; }
  await loadNominationCentre();
  await loadVotingCentre();
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
 const opportunities=$('#nominationOpportunities'), mine=$('#myNominations');
 if(!opportunities||!mine)return;
 try{
  const [available,submitted,paymentInfo]=await Promise.all([
   api('/api/nominations/open'),api('/api/nominations/mine'),api('/api/nominations/payment-instructions')
  ]);
  const instructionBox=$('#candidatePaymentInstructions');
  if(instructionBox){
   instructionBox.replaceChildren();
   if(paymentInfo.paymentInstructions){
    const p=paymentInfo.paymentInstructions,title=document.createElement('strong'),account=document.createElement('p'),notes=document.createElement('small');
    title.textContent='Payment account: '+p.bank_name;
    account.textContent='Account name: '+p.account_name+' · Account number: '+p.account_number;
    notes.textContent=p.payment_instructions||'Use the correct nomination fee for the selected office and retain your transaction reference.';
    instructionBox.append(title,account,notes);
   }else instructionBox.textContent='Payment account details have not yet been published by the Faculty administrators.';
  }
  opportunities.replaceChildren();
  if(!available.opportunities.length){const p=document.createElement('p');p.className='muted';p.textContent='There are no open nomination opportunities at this time.';opportunities.append(p);}
  available.opportunities.forEach(item=>{
   const form=document.createElement('form');form.className='opportunity-card';
   const title=document.createElement('strong'),meta=document.createElement('small');
   title.textContent=item.office_title;meta.textContent=item.election_title+' · '+item.seats+' seat(s) · Fee: ₦'+(Number(item.nomination_fee_kobo)/100).toLocaleString('en-NG',{minimumFractionDigits:2});
   const channel=document.createElement('select');['Zenith Bank','OPay','Moniepoint','Other bank transfer'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;channel.append(o);});
   const ref=document.createElement('input');ref.required=true;ref.minLength=4;ref.maxLength=120;ref.placeholder='Payment transaction reference';
   const manifesto=document.createElement('textarea');manifesto.maxLength=5000;manifesto.placeholder='Optional manifesto (up to 5,000 characters)';
   const labelled=(label,control)=>{const l=document.createElement('label');l.textContent=label;l.append(control);return l;};
   const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent='Submit nomination';
   form.append(title,meta,labelled('Payment channel',channel),labelled('Transaction reference',ref),labelled('Manifesto (optional)',manifesto),submit);
   form.addEventListener('submit',async e=>{
    e.preventDefault();submit.disabled=true;
    try{const result=await api('/api/nominations',{method:'POST',body:JSON.stringify({electionId:item.election_id,officeId:item.office_id,manifesto:manifesto.value,paymentChannel:channel.value,transactionReference:ref.value})});showNotice('Nomination submitted. Reference: '+result.nomination.reference+'. Payment verification is pending.');await loadNominationCentre();}
    catch(err){showNotice(err.message,'error');}finally{submit.disabled=false;}
   });opportunities.append(form);
  });
  mine.replaceChildren();
  if(!submitted.nominations.length){const p=document.createElement('p');p.className='muted';p.textContent='You have not submitted any nominations yet.';mine.append(p);}
  submitted.nominations.forEach(n=>{
   const row=document.createElement('div');row.className='nomination-row';
   const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small');
   title.textContent=n.office_title;meta.textContent=n.election_title+' · '+n.reference+' · Payment: '+n.verification_status+' · Eligibility: '+n.eligibility_status;info.append(title,meta);
   const a=document.createElement('a');a.className='download-link';a.href='/api/nominations/'+encodeURIComponent(n.id)+'/form.pdf';a.textContent='Download PDF form';row.append(info,a);mine.append(row);
  });
 }catch(err){opportunities.textContent=err.message;mine.textContent='Unable to load nomination records.';}
}
$('#refreshNominations')?.addEventListener('click',loadNominationCentre);

$('#createElectionForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,d=formData(f);
 const payload={title:d.title,description:d.description};
 if(d.nominationOpensAt)payload.nominationOpensAt=new Date(d.nominationOpensAt).toISOString();
 if(d.nominationClosesAt)payload.nominationClosesAt=new Date(d.nominationClosesAt).toISOString();
 try{const r=await api('/api/admin/elections',{method:'POST',body:JSON.stringify(payload)});showNotice('Draft election created. Election ID: '+r.election.id);f.reset();}
 catch(err){showNotice(err.message,'error');}
});
$('#createOfficeForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{const r=await api('/api/admin/elections/'+encodeURIComponent(d.electionId)+'/offices',{method:'POST',body:JSON.stringify({title:d.title,nominationFeeNaira:Number(d.nominationFeeNaira),seats:Number(d.seats)})});showNotice('Office added: '+r.office.title);e.currentTarget.reset();}
 catch(err){showNotice(err.message,'error');}
});
$('#openNominationsForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{await api('/api/admin/elections/'+encodeURIComponent(d.electionId)+'/open-nominations',{method:'POST',body:'{}'});showNotice('Nominations opened for the election.');e.currentTarget.reset();await loadNominationCentre();}
 catch(err){showNotice(err.message,'error');}
});
async function loadPaymentSettings(){
 try{const r=await api('/api/admin/nomination-payment-settings');if(r.settings){const f=$('#paymentSettingsForm');f.elements.bankName.value=r.settings.bank_name;f.elements.accountName.value=r.settings.account_name;f.elements.accountNumber.value=r.settings.account_number;f.elements.instructions.value=r.settings.payment_instructions||'';}}
 catch(err){showNotice(err.message,'error');}
}
$('#paymentSettingsForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{await api('/api/admin/nomination-payment-settings',{method:'PUT',body:JSON.stringify({bankName:d.bankName,accountName:d.accountName,accountNumber:d.accountNumber,instructions:d.instructions})});showNotice('Nomination payment account instructions saved.');}
 catch(err){showNotice(err.message,'error');}
});
async function loadPayments(){
 const box=$('#paymentQueue');box.textContent='Loading…';
 try{
  const r=await api('/api/admin/nomination-payments');box.replaceChildren();
  if(!r.payments.length){box.textContent='No nomination payment records yet.';return;}
  r.payments.forEach(p=>{
   const row=document.createElement('div');row.className='payment-row';
   const info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');
   name.textContent=p.full_name+' · '+p.office_title;meta.textContent=p.election_title+' · '+p.reference+' · '+p.matric_number+' · ₦'+(Number(p.amount_kobo)/100).toLocaleString('en-NG',{minimumFractionDigits:2})+' · '+p.payment_channel+' · Ref: '+p.transaction_reference+' · '+p.verification_status;info.append(name,meta);row.append(info);
   if(p.verification_status==='pending'){
    const actions=document.createElement('div');actions.className='user-actions';
    for(const decision of ['verified','rejected']){const b=document.createElement('button');b.type='button';b.textContent=decision==='verified'?'Verify payment':'Reject payment';b.addEventListener('click',async()=>{const reason=prompt('Reason for '+decision+' decision (minimum 5 characters):');if(!reason||reason.trim().length<5)return;try{await api('/api/admin/nomination-payments/'+encodeURIComponent(p.id)+'/decision',{method:'POST',body:JSON.stringify({decision,reason:reason.trim()})});showNotice('Payment decision recorded.');await loadPayments();}catch(err){showNotice(err.message,'error');}});actions.append(b);}
    row.append(actions);
   }box.append(row);
  });
 }catch(err){box.textContent=err.message;}
}
$('#refreshPayments')?.addEventListener('click',loadPayments);

async function loadEligibilityQueue(){
 const box=$('#eligibilityQueue');box.textContent='Loading…';
 try{
  const r=await api('/api/admin/nominations?status=pending');box.replaceChildren();
  if(!r.nominations.length){box.textContent='No pending candidate nominations.';return;}
  r.nominations.forEach(n=>{
   const row=document.createElement('div');row.className='payment-row';
   const info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');
   name.textContent=n.full_name+' · '+n.office_title;
   meta.textContent=n.election_title+' · '+n.reference+' · '+n.matric_number+' · '+n.department+' · Payment: '+(n.verification_status||'not recorded');
   info.append(name,meta);row.append(info);
   const actions=document.createElement('div');actions.className='user-actions';
   for(const decision of ['approved','rejected']){
    const b=document.createElement('button');b.type='button';b.textContent=decision==='approved'?'Approve candidate':'Reject nomination';
    b.addEventListener('click',async()=>{const reason=prompt('Reason for '+decision+' decision (minimum 5 characters):');if(!reason||reason.trim().length<5)return;try{await api('/api/admin/nominations/'+encodeURIComponent(n.id)+'/eligibility',{method:'POST',body:JSON.stringify({decision,reason:reason.trim()})});showNotice('Candidate eligibility decision recorded.');await loadEligibilityQueue();}catch(err){showNotice(err.message,'error');}});
    actions.append(b);
   }
   row.append(actions);box.append(row);
  });
 }catch(err){box.textContent=err.message;}
}
$('#refreshEligibility')?.addEventListener('click',loadEligibilityQueue);

async function loadVotingCentre(){
 const box=$('#votingElections'),resultsBox=$('#publishedResults');
 if(!box)return;
 try{
  const [open,published]=await Promise.all([api('/api/voting/open'),api('/api/voting/published')]);
  box.replaceChildren();
  if(!open.elections.length){const p=document.createElement('p');p.className='muted';p.textContent='There are no elections currently open for voting.';box.append(p);}
  open.elections.forEach(election=>{
   const row=document.createElement('div');row.className='nomination-row';
   const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small');
   title.textContent=election.title;meta.textContent=election.has_voted?'Your participation has already been recorded.':'Voting closes '+new Date(election.voting_closes_at).toLocaleString();info.append(title,meta);row.append(info);
   if(!election.has_voted){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Open ballot';button.addEventListener('click',()=>openBallot(election.id));row.append(button);}
   box.append(row);
  });
  resultsBox.replaceChildren();
  if(!published.elections.length){const p=document.createElement('p');p.className='muted';p.textContent='No election results have been published.';resultsBox.append(p);}
  published.elections.forEach(e=>{
   const row=document.createElement('div');row.className='nomination-row';
   const title=document.createElement('strong');title.textContent=e.title;
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='View results';button.addEventListener('click',()=>showElectionResults(e.id));
   row.append(title,button);resultsBox.append(row);
  });
 }catch(error){box.textContent=error.message;}
}
async function openBallot(electionId){
 const container=$('#ballotContainer');container.hidden=false;container.textContent='Preparing your ballot…';
 try{
  const data=await api('/api/voting/'+encodeURIComponent(electionId)+'/ballot');
  const auth=await api('/api/voting/'+encodeURIComponent(electionId)+'/authorise',{method:'POST',body:'{}'});
  container.replaceChildren();
  const heading=document.createElement('h3');heading.textContent=data.election.title+' — Official ballot';
  const note=document.createElement('p');note.className='muted';note.textContent='Select up to the number of seats shown for each office. You may leave an office blank. Your selections cannot be changed after submission.';
  const form=document.createElement('form');form.className='ballot-form';
  data.offices.forEach(office=>{
   const section=document.createElement('fieldset');section.className='ballot-office';
   const legend=document.createElement('legend');legend.textContent=office.title+' (up to '+office.seats+')';section.append(legend);
   if(!office.candidates.length){const p=document.createElement('p');p.textContent='No approved candidates are listed for this office.';section.append(p);}
   office.candidates.forEach(candidate=>{
    const label=document.createElement('label'),input=document.createElement('input');
    input.type=Number(office.seats)===1?'radio':'checkbox';input.name='office-'+office.id;input.value=candidate.nominationId;
    if(input.type==='checkbox')input.addEventListener('change',()=>{const chosen=section.querySelectorAll('input:checked');if(chosen.length>Number(office.seats)){input.checked=false;showNotice('You may select no more than '+office.seats+' candidates for '+office.title+'.','error');}});
    const text=document.createElement('span');text.textContent=candidate.name+' — '+candidate.department;
    label.append(input,text);
    if(candidate.manifesto){const details=document.createElement('small');details.textContent=candidate.manifesto;label.append(details);}
    section.append(label);
   });
   form.append(section);
  });
  const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent='Submit my ballot';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Cancel';cancel.addEventListener('click',()=>{container.hidden=true;container.replaceChildren();});
  form.append(submit,cancel);
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(!window.confirm('Submit your ballot now? Your selections cannot be changed.'))return;
   submit.disabled=true;submit.textContent='Submitting ballot…';
   const selections=data.offices.map(office=>({officeId:office.id,nominationIds:[...form.querySelectorAll('[name="office-'+office.id+'"]:checked')].map(x=>x.value)}));
   try{
    const result=await api('/api/voting/'+encodeURIComponent(electionId)+'/ballot',{method:'POST',body:JSON.stringify({authorisationToken:auth.authorisationToken,selections})});
    container.replaceChildren();container.hidden=true;showNotice(result.message);await loadVotingCentre();
   }catch(error){showNotice(error.message,'error');submit.disabled=false;submit.textContent='Submit my ballot';}
  });
  container.append(heading,note,form);container.scrollIntoView({behavior:'smooth',block:'start'});
 }catch(error){container.textContent=error.message;showNotice(error.message,'error');}
}
async function showElectionResults(electionId){
 const box=$('#resultsDetail');box.hidden=false;box.textContent='Loading results…';
 try{
  const data=await api('/api/voting/'+encodeURIComponent(electionId)+'/results');
  box.replaceChildren();const heading=document.createElement('h3');heading.textContent=data.election.title+' — Published results';
  const participation=document.createElement('p');participation.className='muted';participation.textContent='Total participating voters: '+data.totalVoters;
  box.append(heading,participation);
  const grouped=new Map();
  data.results.forEach(r=>{if(!grouped.has(r.office_title))grouped.set(r.office_title,[]);if(r.nomination_id)grouped.get(r.office_title).push(r);});
  for(const [office,candidates] of grouped){
   const section=document.createElement('section');section.className='result-office';const title=document.createElement('strong');title.textContent=office;section.append(title);
   candidates.forEach(c=>{const p=document.createElement('p');p.textContent=c.full_name+' ('+c.department+'): '+c.votes+' vote(s)';section.append(p);});
   box.append(section);
  }
  box.scrollIntoView({behavior:'smooth',block:'start'});
 }catch(error){box.textContent=error.message;}
}
$('#refreshVoting')?.addEventListener('click',loadVotingCentre);

async function loadAdminElections(){
 const box=$('#adminElectionList');if(!box)return;
 try{
  const r=await api('/api/admin/elections');box.replaceChildren();
  if(!r.elections.length){box.textContent='No elections created yet.';return;}
  r.elections.forEach(e=>{const p=document.createElement('p');p.textContent=e.title+' · '+e.status+' · ID: '+e.id;box.append(p);});
 }catch(error){box.textContent=error.message;}
}
$('#closeNominationsForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{await api('/api/admin/elections/'+encodeURIComponent(d.electionId)+'/close-nominations',{method:'POST',body:'{}'});showNotice('Nominations closed.');e.currentTarget.reset();await loadAdminElections();}
 catch(error){showNotice(error.message,'error');}
});
$('#openVotingForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{await api('/api/admin/elections/'+encodeURIComponent(d.electionId)+'/open-voting',{method:'POST',body:JSON.stringify({opensAt:new Date(d.opensAt).toISOString(),closesAt:new Date(d.closesAt).toISOString()})});showNotice('Voting schedule saved and voting opened.');e.currentTarget.reset();await loadAdminElections();await loadVotingCentre();}
 catch(error){showNotice(error.message,'error');}
});
$('#closeVotingForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{await api('/api/admin/elections/'+encodeURIComponent(d.electionId)+'/close-voting',{method:'POST',body:'{}'});showNotice('Voting closed.');e.currentTarget.reset();await loadAdminElections();}
 catch(error){showNotice(error.message,'error');}
});
$('#publishResultsForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const d=formData(e.currentTarget);
 try{await api('/api/admin/elections/'+encodeURIComponent(d.electionId)+'/publish-results',{method:'POST',body:'{}'});showNotice('Results published.');e.currentTarget.reset();await loadAdminElections();await loadVotingCentre();}
 catch(error){showNotice(error.message,'error');}
});
