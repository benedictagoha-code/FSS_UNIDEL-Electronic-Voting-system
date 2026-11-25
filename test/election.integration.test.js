import { test } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';

const enabled = Boolean(process.env.DATABASE_URL);

test('mock election: registration, nomination, payment, eligibility, secret ballot and publication', { skip: !enabled }, async () => {
  process.env.SESSION_SECRET ||= 'test-session-secret-at-least-32-characters-long';
  process.env.OTP_PEPPER ||= 'test-otp-pepper-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';

  const [{ default: app }, { pool }] = await Promise.all([
    import('../src/app.js'),
    import('../src/db.js')
  ]);

  const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
  assert.match(databaseName, /_test$/, 'integration tests may only run against a database whose name ends in _test');

  const tables = [
    'audit_logs','moderation_actions','election_voter_eligibility','voting_authorisations',
    'ballot_selections','ballots','voter_participation','nomination_documents',
    'nomination_payments','nominations','election_offices','elections',
    'nomination_payment_settings','password_reset_otps','admin_roles','student_profiles','users'
  ];

  let server;
  try {
    await pool.query(`TRUNCATE ${tables.join(',')} RESTART IDENTITY CASCADE`);

    const adminHash = await argon2.hash('Admin-Test-Password-2026', { type: argon2.argon2id });
    const adminResult = await pool.query(
      `INSERT INTO users(matric_number,phone_e164,password_hash)
       VALUES('ADMIN-TEST-001','+2348010000001',$1) RETURNING id`,
      [adminHash]
    );
    const adminId = adminResult.rows[0].id;
    await pool.query(
      `INSERT INTO student_profiles(user_id,full_name,sex,department,level,matric_type)
       VALUES($1,'Test Election Administrator','Male','Psychology','600','matriculation')`,
      [adminId]
    );
    await pool.query(
      "INSERT INTO admin_roles(user_id,role,granted_by) VALUES($1,'super_admin',$1)",
      [adminId]
    );

    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    const crossOrigin = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(crossOrigin.status, 403, 'cross-origin state changes must be rejected');

    const sameOrigin = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(sameOrigin.status, 400, 'same-origin request should reach input validation');

    function client() {
      let cookie = '';
      return async (path, options = {}) => {
        const headers = { ...(options.body ? { 'content-type':'application/json' } : {}), ...(cookie ? { cookie } : {}), ...options.headers };
        const response = await fetch(base + path, {
          method: options.method || 'GET',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          redirect: 'manual'
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const type = response.headers.get('content-type') || '';
        const payload = type.includes('application/json') ? await response.json() : await response.text();
        return { status:response.status, body:payload };
      };
    }

    const admin = client();
    const loginAdmin = await admin('/api/auth/login', {
      method:'POST', body:{ matricNumber:'ADMIN-TEST-001', password:'Admin-Test-Password-2026' }
    });
    assert.equal(loginAdmin.status,200,'administrator should sign in');

    const register = async (record) => {
      const response = await fetch(base + '/api/auth/register', {
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(record)
      });
      return { status:response.status, body:await response.json() };
    };
    const candidateReg = await register({
      fullName:'Test Candidate',sex:'Female',department:'Psychology',level:'400',
      matricType:'matriculation',matricNumber:'PSY-TEST-4001',
      phoneNumber:'+2348010000002',password:'Candidate-Test-Password-2026'
    });
    assert.equal(candidateReg.status,201,'candidate self-registration should succeed');
    const excludedReg = await register({
      fullName:'Excluded Test Voter',sex:'Male',department:'Sociology',level:'300',
      matricType:'matriculation',matricNumber:'SOC-TEST-3001',
      phoneNumber:'+2348010000003',password:'Voter-Test-Password-2026'
    });
    assert.equal(excludedReg.status,201,'voter self-registration should succeed');
    const duplicateRegistration = await register({
      fullName:'Duplicate Test Student',sex:'Female',department:'Psychology',level:'400',
      matricType:'matriculation',matricNumber:'PSY-TEST-4001',
      phoneNumber:'+2348010000004',password:'Candidate-Test-Password-2026'
    });
    assert.equal(duplicateRegistration.status,409,'duplicate matriculation numbers must be rejected');

    const electionResponse = await admin('/api/admin/elections', { method:'POST', body:{
      title:'Automated Mock Faculty Election',description:'Non-production integration test'
    }});
    assert.equal(electionResponse.status,201,'admin should create an election');
    const electionId = electionResponse.body.election.id;

    const officeResponse = await admin(`/api/admin/elections/${electionId}/offices`, {
      method:'POST',body:{title:'Mock Faculty President',nominationFeeNaira:1000,seats:1}
    });
    assert.equal(officeResponse.status,201,'admin should create an office');
    const officeId = officeResponse.body.office.id;

    const openNominations = await admin(`/api/admin/elections/${electionId}/open-nominations`,{method:'POST',body:{}});
    assert.equal(openNominations.status,200,'admin should open nominations');

    const candidate = client();
    const candidateLogin = await candidate('/api/auth/login',{method:'POST',body:{
      matricNumber:'PSY-TEST-4001',password:'Candidate-Test-Password-2026'
    }});
    assert.equal(candidateLogin.status,200,'candidate should sign in');

    const nominationPayload = {
      electionId,officeId,manifesto:'A test manifesto.',
      paymentChannel:'Zenith Bank',transactionReference:'MOCK-PAYMENT-REF-001'
    };
    const simultaneousNominations = await Promise.all([
      candidate('/api/nominations/',{method:'POST',body:nominationPayload}),
      candidate('/api/nominations/',{method:'POST',body:nominationPayload})
    ]);
    assert.equal(simultaneousNominations.filter(x=>x.status===201).length,1,
      'only one simultaneous nomination for the same office may be accepted');
    assert.equal(simultaneousNominations.filter(x=>x.status===409).length,1,
      'the concurrent duplicate nomination must be rejected');
    const nominationResponse = simultaneousNominations.find(x=>x.status===201);
    const nominationId = nominationResponse.body.nomination.id;

    const payments = await admin('/api/admin/nomination-payments');
    assert.equal(payments.status,200);
    const payment = payments.body.payments.find(item => item.nomination_id===nominationId);
    assert.ok(payment,'payment record should be visible to finance administrators');

    const paymentDecision = await admin(`/api/admin/nomination-payments/${payment.id}/decision`,{
      method:'POST',body:{decision:'verified',reason:'Mock payment verified for integration test.'}
    });
    assert.equal(paymentDecision.status,200,'finance admin should verify payment');

    const nominationDecision = await admin(`/api/admin/nominations/${nominationId}/eligibility`,{
      method:'POST',body:{decision:'approved',reason:'Mock candidate meets test requirements.'}
    });
    assert.equal(nominationDecision.status,200,'election admin should approve paid nomination');

    const excluded = await client();
    const excludedLogin = await excluded('/api/auth/login',{method:'POST',body:{
      matricNumber:'SOC-TEST-3001',password:'Voter-Test-Password-2026'
    }});
    assert.equal(excludedLogin.status,200,'second student should sign in');

    const voterList = await admin(`/api/admin/elections/${electionId}/voters`);
    assert.equal(voterList.status,200,'admin should view election voters');
    const excludedUser = voterList.body.voters.find(v => v.matric_number==='SOC-TEST-3001');
    assert.ok(excludedUser,'registered voter should appear in voter list');

    const excludeResponse = await admin(`/api/admin/elections/${electionId}/voters/${excludedUser.id}/eligibility`,{
      method:'PUT',body:{eligible:false,reason:'Excluded for mock election test.'}
    });
    assert.equal(excludeResponse.status,200,'admin should be able to exclude a voter before voting opens');

    const closeNominations = await admin(`/api/admin/elections/${electionId}/close-nominations`,{method:'POST',body:{}});
    assert.equal(closeNominations.status,200,'nominations should close after all candidates are reviewed');
    assert.equal(closeNominations.body.offices[0].unopposed,true,'single approved candidate should be marked unopposed');

    const now = Date.now();
    const openVoting = await admin(`/api/admin/elections/${electionId}/open-voting`,{
      method:'POST',body:{
        opensAt:new Date(now-60_000).toISOString(),
        closesAt:new Date(now+3_600_000).toISOString()
      }
    });
    assert.equal(openVoting.status,200,'admin should open voting after nominations close');

    const lockedEligibility = await admin(`/api/admin/elections/${electionId}/voters/${excludedUser.id}/eligibility`,{
      method:'PUT',body:{eligible:true,reason:'Attempted change after voting started'}
    });
    assert.equal(lockedEligibility.status,409,'voter eligibility must lock after the actual voting start time');

    const excludedBallot = await excluded(`/api/voting/${electionId}/ballot`);
    assert.equal(excludedBallot.status,404,'excluded voter must not retrieve the ballot');
    const excludedAuth = await excluded(`/api/voting/${electionId}/authorise`,{method:'POST',body:{}});
    assert.equal(excludedAuth.status,403,'excluded voter must not receive voting authorisation');

    const ballot = await candidate(`/api/voting/${electionId}/ballot`);
    assert.equal(ballot.status,200,'eligible candidate/student should retrieve ballot');
    const candidateNomination = ballot.body.offices[0].candidates[0].nominationId;
    const authorisation = await candidate(`/api/voting/${electionId}/authorise`,{method:'POST',body:{}});
    assert.equal(authorisation.status,200,'eligible voter should receive a one-time authorisation token');
    assert.equal(authorisation.body.expiresInSeconds,600);

    const ballotPayload = {
      authorisationToken:authorisation.body.authorisationToken,
      selections:[{officeId,nominationIds:[candidateNomination]}]
    };
    // Eligibility and account status are rechecked at submission, not only
    // when the one-time authorisation token is issued.
    await pool.query("UPDATE users SET account_status='suspended' WHERE matric_number='PSY-TEST-4001'");
    const suspendedVoterSubmission = await candidate(`/api/voting/${electionId}/ballot`,{
      method:'POST',body:ballotPayload
    });
    assert.equal(suspendedVoterSubmission.status,403,
      'a suspended student must not submit a ballot even with a previously issued token');
    await pool.query("UPDATE users SET account_status='active' WHERE matric_number='PSY-TEST-4001'");
    const simultaneousBallots = await Promise.all([
      candidate(`/api/voting/${electionId}/ballot`,{method:'POST',body:ballotPayload}),
      candidate(`/api/voting/${electionId}/ballot`,{method:'POST',body:ballotPayload})
    ]);
    assert.equal(simultaneousBallots.filter(x=>x.status===201).length,1,
      'only one simultaneous ballot submission may be accepted for a voter');
    assert.equal(simultaneousBallots.filter(x=>x.status===401).length,1,
      'the second simultaneous submission must find its authorisation consumed');

    const duplicateAuth = await candidate(`/api/voting/${electionId}/authorise`,{method:'POST',body:{}});
    assert.equal(duplicateAuth.status,409,'a voter must not receive a second ballot authorisation');

    // An administrator who is also a registered, eligible student retains
    // the same voting rights as any other eligible student.
    const adminBallot = await admin(`/api/voting/${electionId}/ballot`);
    assert.equal(adminBallot.status,200,'administrator with an active student profile should be allowed to vote');
    const adminCandidateId = adminBallot.body.offices[0].candidates[0].nominationId;
    const adminAuthorisation = await admin(`/api/voting/${electionId}/authorise`,{method:'POST',body:{}});
    assert.equal(adminAuthorisation.status,200,'eligible student-administrator should receive voting authorisation');
    const adminCast = await admin(`/api/voting/${electionId}/ballot`,{
      method:'POST',body:{
        authorisationToken:adminAuthorisation.body.authorisationToken,
        selections:[{officeId,nominationIds:[adminCandidateId]}]
      }
    });
    assert.equal(adminCast.status,201,'student-administrator ballot should be accepted');

    const participation = await admin(`/api/admin/elections/${electionId}/participation`);
    assert.equal(participation.status,200,'admin should view aggregate turnout');
    assert.ok(participation.body.participatingVoters>=1);
    assert.ok(!JSON.stringify(participation.body).includes(candidateNomination),'turnout report must not expose ballot selections');

    const hiddenResults = await candidate(`/api/voting/${electionId}/results`);
    assert.equal(hiddenResults.status,404,'results must remain hidden before publication');

    const unreasonedEarlyClose = await admin(`/api/admin/elections/${electionId}/close-voting`,{method:'POST',body:{}});
    assert.equal(unreasonedEarlyClose.status,409,
      'voting before its scheduled close must require a documented reason');
    const closeVoting = await admin(`/api/admin/elections/${electionId}/close-voting`,{
      method:'POST',body:{reason:'Emergency closure for the integration test.'}
    });
    assert.equal(closeVoting.status,200,'authorised early closure with a reason should succeed');
    assert.equal(closeVoting.body.earlyClose,true,'the API should identify an early closure');
    const earlyCloseAudit = await pool.query(
      `SELECT metadata FROM audit_logs WHERE entity_type='election' AND entity_id=$1 AND action='election.voting_closed' ORDER BY id DESC LIMIT 1`,
      [electionId]
    );
    assert.equal(earlyCloseAudit.rows[0].metadata.earlyClose,true,
      'early closure must be recorded in the audit trail');
    assert.equal(earlyCloseAudit.rows[0].metadata.reason,'Emergency closure for the integration test.',
      'the reason for early closure must be retained in the audit trail');
    const publish = await admin(`/api/admin/elections/${electionId}/publish-results`,{method:'POST',body:{}});
    assert.equal(publish.status,200,'authorised admin should publish results');

    const results = await candidate(`/api/voting/${electionId}/results`);
    assert.equal(results.status,200,'published results should become visible');
    assert.equal(results.body.totalVoters,2,'results should report both the student and eligible student-administrator participation records');
    assert.equal(results.body.results[0].votes,2,'published tally should count both accepted selections');

    const ballotSchema = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ballots'`
    );
    assert.ok(!ballotSchema.rows.some(row=>row.column_name==='voter_user_id'),'ballot table must not store voter identity');

    const ballotSelectionSchema = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ballot_selections'`
    );
    assert.ok(!ballotSelectionSchema.rows.some(row=>row.column_name==='voter_user_id'),'ballot selections must not store voter identity');

    const secondElection = await admin('/api/admin/elections',{method:'POST',body:{
      title:'Second Mock Election for Constraint Test',description:'Cross-election reference rejection test'
    }});
    assert.equal(secondElection.status,201);
    const secondOffice = await admin(`/api/admin/elections/${secondElection.body.election.id}/offices`,{
      method:'POST',body:{title:'Second Mock Office',nominationFeeNaira:0,seats:1}
    });
    assert.equal(secondOffice.status,201);
    const ballotRow = await pool.query('SELECT id FROM ballots WHERE election_id=$1',[electionId]);
    await assert.rejects(
      pool.query(
        `INSERT INTO ballot_selections(ballot_id,election_id,office_id,candidate_nomination_id)
         VALUES($1,$2,$3,$4)`,
        [ballotRow.rows[0].id,secondElection.body.election.id,secondOffice.body.office.id,nominationId]
      ),
      error => error.code==='23503',
      'database must reject a ballot selection tied to another election'
    );

    // Existing sessions must not retain privileged access after account suspension.
    await pool.query("UPDATE users SET account_status='suspended' WHERE id=$1",[adminId]);
    const suspendedAdminAccess = await admin('/api/admin/me');
    assert.equal(suspendedAdminAccess.status,403,'suspended administrator must immediately lose privileged route access');
    await pool.query("UPDATE users SET account_status='active' WHERE id=$1",[adminId]);
    const restoredAdminAccess = await admin('/api/admin/me');
    assert.equal(restoredAdminAccess.status,200,'restored administrator should regain privileged access');
    await pool.query("UPDATE users SET account_status='deactivated' WHERE id=$1",[adminId]);
    const deactivatedAdminAccess = await admin('/api/admin/me');
    assert.equal(deactivatedAdminAccess.status,403,'deactivated administrator must immediately lose privileged route access');
    await pool.query("UPDATE users SET account_status='active' WHERE id=$1",[adminId]);
    const reactivatedAdminAccess = await admin('/api/admin/me');
    assert.equal(reactivatedAdminAccess.status,200,'reactivated administrator should regain privileged access');

    // Concurrent attempts to demote both super administrators must not remove
    // the final super-admin safeguard.
    const secondAdminHash = await argon2.hash('Second-Admin-Test-Password-2026',{type:argon2.argon2id});
    const secondAdmin = await pool.query(
      `INSERT INTO users(matric_number,phone_e164,password_hash)
       VALUES('ADMIN-TEST-002','+2348010000005',$1) RETURNING id`,
      [secondAdminHash]
    );
    const secondAdminId = secondAdmin.rows[0].id;
    await pool.query(
      `INSERT INTO student_profiles(user_id,full_name,sex,department,level,matric_type)
       VALUES($1,'Second Test Administrator','Female','Sociology','500','matriculation')`,
      [secondAdminId]
    );
    await pool.query(
      "INSERT INTO admin_roles(user_id,role,granted_by) VALUES($1,'super_admin',$2)",
      [secondAdminId,adminId]
    );
    const concurrentDemotions = await Promise.all([
      admin(`/api/admin/administrators/${adminId}/roles`,{method:'POST',body:{role:'moderator'}}),
      admin(`/api/admin/administrators/${secondAdminId}/roles`,{method:'POST',body:{role:'moderator'}})
    ]);
    assert.equal(concurrentDemotions.filter(x=>x.status===200).length,1,
      'only one of two concurrent super-admin demotions may succeed');
    const remainingSuperAdmins = await pool.query(
      "SELECT COUNT(*)::int AS count FROM admin_roles WHERE role='super_admin'"
    );
    assert.equal(remainingSuperAdmins.rows[0].count,1,
      'concurrent role changes must preserve exactly one super administrator');

  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    await pool.query(`TRUNCATE ${tables.join(',')} RESTART IDENTITY CASCADE`);
    await pool.end();
  }
});
