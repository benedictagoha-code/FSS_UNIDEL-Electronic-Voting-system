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

    const nominationResponse = await candidate('/api/nominations/',{method:'POST',body:{
      electionId,officeId,manifesto:'A test manifesto.',
      paymentChannel:'Zenith Bank',transactionReference:'MOCK-PAYMENT-REF-001'
    }});
    assert.equal(nominationResponse.status,201,'candidate should submit a nomination');
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

    const cast = await candidate(`/api/voting/${electionId}/ballot`,{
      method:'POST',body:{
        authorisationToken:authorisation.body.authorisationToken,
        selections:[{officeId,nominationIds:[candidateNomination]}]
      }
    });
    assert.equal(cast.status,201,'valid ballot should be accepted');

    const duplicateAuth = await candidate(`/api/voting/${electionId}/authorise`,{method:'POST',body:{}});
    assert.equal(duplicateAuth.status,409,'a voter must not receive a second ballot authorisation');

    const participation = await admin(`/api/admin/elections/${electionId}/participation`);
    assert.equal(participation.status,200,'admin should view aggregate turnout');
    assert.ok(participation.body.participatingVoters>=1);
    assert.ok(!JSON.stringify(participation.body).includes(candidateNomination),'turnout report must not expose ballot selections');

    const hiddenResults = await candidate(`/api/voting/${electionId}/results`);
    assert.equal(hiddenResults.status,404,'results must remain hidden before publication');

    const closeVoting = await admin(`/api/admin/elections/${electionId}/close-voting`,{method:'POST',body:{}});
    assert.equal(closeVoting.status,200,'admin should close voting');
    const publish = await admin(`/api/admin/elections/${electionId}/publish-results`,{method:'POST',body:{}});
    assert.equal(publish.status,200,'authorised admin should publish results');

    const results = await candidate(`/api/voting/${electionId}/results`);
    assert.equal(results.status,200,'published results should become visible');
    assert.equal(results.body.totalVoters,1,'results should report one accepted participation record');
    assert.equal(results.body.results[0].votes,1,'published tally should count the accepted selection');

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

  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    await pool.query(`TRUNCATE ${tables.join(',')} RESTART IDENTITY CASCADE`);
    await pool.end();
  }
});
