import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();
const moderationSchema = z.object({
  action: z.enum(['mute','suspend','deactivate','restore']),
  reason: z.string().trim().min(5).max(1000),
  durationHours: z.number().int().min(1).max(8760).optional()
});

function maskPhone(value) {
  if (!value || value.length < 7) return 'Hidden';
  return value.slice(0, 4) + '••••' + value.slice(-3);
}


const roleSchema = z.object({
  role: z.enum(['super_admin','election_admin','finance_admin','moderator','results_officer'])
});

router.get('/administrators', requireAdmin(['super_admin']), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.matric_number, p.full_name, ar.role, ar.created_at
       FROM admin_roles ar
       JOIN users u ON u.id = ar.user_id
       JOIN student_profiles p ON p.user_id = u.id
       ORDER BY p.full_name, ar.role`
    );
    res.json({ administrators: result.rows });
  } catch (error) { next(error); }
});

router.post('/administrators/:userId/roles', requireAdmin(['super_admin']), async (req, res, next) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Select a valid administrator role.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      "SELECT id FROM users WHERE id = $1 AND account_status = 'active' FOR UPDATE",
      [req.params.userId]
    );
    if (!user.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active student account not found.' });
    }
    await client.query(
      `INSERT INTO admin_roles (user_id, role, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, created_at = NOW()`,
      [req.params.userId, parsed.data.role, req.session.userId]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.role_granted', 'user', $2, $3::jsonb)`,
      [req.session.userId, req.params.userId, JSON.stringify({ role: parsed.data.role })]
    );
    await client.query('COMMIT');
    res.json({ message: 'Administrator role assigned.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

router.delete('/administrators/:userId/roles', requireAdmin(['super_admin']), async (req, res, next) => {
  if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'You cannot remove your own administrator role.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const removed = await client.query('DELETE FROM admin_roles WHERE user_id = $1 RETURNING role', [req.params.userId]);
    if (!removed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Administrator role not found.' });
    }
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.role_revoked', 'user', $2, $3::jsonb)`,
      [req.session.userId, req.params.userId, JSON.stringify({ previousRole: removed.rows[0].role })]
    );
    await client.query('COMMIT');
    res.json({ message: 'Administrator role removed.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

router.get('/me', requireAdmin(), (req, res) => {
  res.json({ roles: req.adminRoles });
});

router.get('/users', requireAdmin(['super_admin','moderator']), async (req, res, next) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const status = ['active','suspended','deactivated'].includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '50', 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset || '0', 10) || 0, 0);
  try {
    const result = await pool.query(
      `SELECT u.id, u.matric_number, u.account_status, u.muted_until, u.created_at,
              p.full_name, p.department, p.level, u.phone_e164
       FROM users u JOIN student_profiles p ON p.user_id = u.id
       WHERE ($1::text IS NULL OR u.account_status = $1)
         AND ($2::text = '' OR
              u.matric_number ILIKE '%' || $2 || '%' OR
              p.full_name ILIKE '%' || $2 || '%' OR
              p.department ILIKE '%' || $2 || '%' OR
              p.level ILIKE '%' || $2 || '%')
       ORDER BY p.full_name ASC LIMIT $3 OFFSET $4`,
      [status, search, limit, offset]
    );
    res.json({
      users: result.rows.map(({ phone_e164, ...user }) => ({ ...user, phoneMasked: maskPhone(phone_e164) })),
      limit, offset
    });
  } catch (error) { next(error); }
});

router.post('/users/:userId/moderation', requireAdmin(['super_admin','moderator']), async (req, res, next) => {
  const parsed = moderationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a valid moderation action and reason.', details: parsed.error.flatten().fieldErrors });
  if (req.params.userId === req.session.userId && ['suspend','deactivate'].includes(parsed.data.action)) {
    return res.status(400).json({ error: 'You cannot suspend or deactivate your own account.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.params.userId]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student account not found.' });
    }

    const { action, reason, durationHours } = parsed.data;
    let endsAt = null;
    if (action === 'mute') {
      if (!durationHours) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A mute duration in hours is required.' });
      }
      endsAt = new Date(Date.now() + durationHours * 3600000);
      await client.query('UPDATE users SET muted_until = $1, updated_at = NOW() WHERE id = $2', [endsAt, req.params.userId]);
    } else if (action === 'suspend') {
      await client.query("UPDATE users SET account_status = 'suspended', updated_at = NOW() WHERE id = $1", [req.params.userId]);
    } else if (action === 'deactivate') {
      await client.query("UPDATE users SET account_status = 'deactivated', updated_at = NOW() WHERE id = $1", [req.params.userId]);
    } else {
      await client.query("UPDATE users SET account_status = 'active', muted_until = NULL, updated_at = NOW() WHERE id = $1", [req.params.userId]);
    }

    await client.query(
      `INSERT INTO moderation_actions (target_user_id, actor_user_id, action, reason, ends_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.userId, req.session.userId, action, reason, endsAt]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'user', $3, $4::jsonb)`,
      [req.session.userId, `user.${action}`, req.params.userId, JSON.stringify({ reason, endsAt })]
    );
    await client.query('COMMIT');
    res.json({ message: `Account ${action} action recorded.` });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});


// Election setup and nomination payment review.
const electionSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().max(3000).optional().default(''),
  nominationOpensAt: z.string().datetime().optional(),
  nominationClosesAt: z.string().datetime().optional()
});
const officeSchema = z.object({
  title: z.string().trim().min(2).max(120),
  nominationFeeNaira: z.number().finite().min(0).max(100000000),
  seats: z.number().int().min(1).max(20).optional().default(1)
});
const paymentSettingsSchema = z.object({
  bankName: z.string().trim().min(2).max(100),
  accountName: z.string().trim().min(2).max(180),
  accountNumber: z.string().trim().min(6).max(30),
  instructions: z.string().max(2000).optional().default('')
});
const paymentDecisionSchema = z.object({ decision: z.enum(['verified','rejected']), reason: z.string().trim().min(5).max(1000) });

router.post('/elections', requireAdmin(['super_admin','election_admin']), async (req,res,next)=>{
  const parsed=electionSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Provide a valid election title and nomination dates.'});
  const d=parsed.data;
  if(d.nominationOpensAt&&d.nominationClosesAt&&new Date(d.nominationClosesAt)<=new Date(d.nominationOpensAt)) return res.status(400).json({error:'Nomination closing time must be after opening time.'});
  try{
    const r=await pool.query(
      "INSERT INTO elections(title,description,status,nomination_opens_at,nomination_closes_at,created_by) VALUES($1,$2,'draft',$3,$4,$5) RETURNING *",
      [d.title,d.description,d.nominationOpensAt||null,d.nominationClosesAt||null,req.session.userId]);
    await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'election.created','election',$2)",[req.session.userId,r.rows[0].id]);
    res.status(201).json({election:r.rows[0]});
  }catch(e){next(e);}
});
router.post('/elections/:id/offices', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  const p=officeSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Provide a valid office title, fee and number of seats.'});
  try{
    const r=await pool.query("INSERT INTO election_offices(election_id,title,nomination_fee_kobo,seats) SELECT id,$2,$3,$4 FROM elections WHERE id=$1 AND status='draft' RETURNING *",
      [req.params.id,p.data.title,Math.round(p.data.nominationFeeNaira*100),p.data.seats]);
    if(!r.rowCount)return res.status(404).json({error:'Draft election not found.'});
    res.status(201).json({office:r.rows[0]});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'That office already exists in this election.'});next(e);}
});
router.post('/elections/:id/open-nominations', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  try{
    const r=await pool.query("UPDATE elections SET status='nominations_open' WHERE id=$1 AND status='draft' AND EXISTS(SELECT 1 FROM election_offices WHERE election_id=$1) RETURNING id,title",
      [req.params.id]);
    if(!r.rowCount)return res.status(409).json({error:'Election must be a draft with at least one office before nominations can open.'});
    await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'election.nominations_opened','election',$2)",[req.session.userId,req.params.id]);
    res.json({election:r.rows[0],message:'Nominations are now open.'});
  }catch(e){next(e);}
});
router.put('/nomination-payment-settings', requireAdmin(['super_admin','finance_admin']), async(req,res,next)=>{
  const p=paymentSettingsSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Provide valid payment account details.'});
  try{
    await pool.query(`INSERT INTO nomination_payment_settings(id,bank_name,account_name,account_number,payment_instructions,updated_by)
      VALUES(1,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET bank_name=EXCLUDED.bank_name,account_name=EXCLUDED.account_name,
      account_number=EXCLUDED.account_number,payment_instructions=EXCLUDED.payment_instructions,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [p.data.bankName,p.data.accountName,p.data.accountNumber,p.data.instructions,req.session.userId]);
    res.json({message:'Nomination payment instructions updated.'});
  }catch(e){next(e);}
});
router.get('/nomination-payment-settings', requireAdmin(['super_admin','finance_admin']), async(req,res,next)=>{
  try{const r=await pool.query("SELECT bank_name,account_name,account_number,payment_instructions,updated_at FROM nomination_payment_settings WHERE id=1");res.json({settings:r.rows[0]||null});}
  catch(e){next(e);}
});
router.get('/nomination-payments', requireAdmin(['super_admin','finance_admin']), async(req,res,next)=>{
  try{
    const r=await pool.query(`SELECT p.id,p.amount_kobo,p.payment_channel,p.transaction_reference,p.verification_status,p.submitted_at,
      n.id AS nomination_id,n.reference,e.title AS election_title,o.title AS office_title,s.full_name,u.matric_number,s.department
      FROM nomination_payments p JOIN nominations n ON n.id=p.nomination_id JOIN elections e ON e.id=n.election_id
      JOIN election_offices o ON o.id=n.office_id JOIN users u ON u.id=n.candidate_user_id JOIN student_profiles s ON s.user_id=u.id
      ORDER BY CASE p.verification_status WHEN 'pending' THEN 0 ELSE 1 END,p.submitted_at DESC LIMIT 200`);
    res.json({payments:r.rows});
  }catch(e){next(e);}
});
router.post('/nomination-payments/:id/decision', requireAdmin(['super_admin','finance_admin']), async(req,res,next)=>{
  const p=paymentDecisionSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Provide a verification decision and reason.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query("SELECT id,verification_status,nomination_id FROM nomination_payments WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Payment record not found.'});}
    if(r.rows[0].verification_status!=='pending'){await client.query('ROLLBACK');return res.status(409).json({error:'This payment has already been reviewed.'});}
    await client.query("UPDATE nomination_payments SET verification_status=$1,verified_by=$2,verified_at=NOW() WHERE id=$3",[p.data.decision,req.session.userId,req.params.id]);
    await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'nomination_payment',$3,$4::jsonb)",
      [req.session.userId,'nomination_payment.'+p.data.decision,req.params.id,JSON.stringify({reason:p.data.reason,nominationId:r.rows[0].nomination_id})]);
    await client.query('COMMIT');
    res.json({message:'Payment '+p.data.decision+'. Candidate eligibility remains a separate decision.'});
  }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});


const nominationDecisionSchema = z.object({
  decision: z.enum(['approved','rejected']),
  reason: z.string().trim().min(5).max(1000)
});
router.get('/nominations', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  try{
    const status=['pending','approved','rejected','withdrawn'].includes(req.query.status)?req.query.status:null;
    const r=await pool.query(`SELECT n.id,n.reference,n.eligibility_status,n.submitted_at,n.candidate_user_id,
      e.title AS election_title,o.title AS office_title,s.full_name,u.matric_number,s.department,
      p.verification_status,p.amount_kobo
      FROM nominations n JOIN elections e ON e.id=n.election_id JOIN election_offices o ON o.id=n.office_id
      JOIN users u ON u.id=n.candidate_user_id JOIN student_profiles s ON s.user_id=u.id
      LEFT JOIN nomination_payments p ON p.nomination_id=n.id
      WHERE ($1::text IS NULL OR n.eligibility_status=$1)
      ORDER BY CASE n.eligibility_status WHEN 'pending' THEN 0 ELSE 1 END,n.submitted_at DESC LIMIT 250`,[status]);
    res.json({nominations:r.rows});
  }catch(e){next(e);}
});
router.post('/nominations/:id/eligibility', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  const p=nominationDecisionSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Provide an eligibility decision and reason.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(`SELECT n.id,n.eligibility_status,p.verification_status
      FROM nominations n LEFT JOIN nomination_payments p ON p.nomination_id=n.id
      WHERE n.id=$1 FOR UPDATE OF n`,[req.params.id]);
    if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Nomination not found.'});}
    if(r.rows[0].eligibility_status!=='pending'){await client.query('ROLLBACK');return res.status(409).json({error:'This nomination has already been reviewed.'});}
    if(p.data.decision==='approved' && r.rows[0].verification_status!=='verified'){await client.query('ROLLBACK');return res.status(409).json({error:'Payment must be verified before candidate eligibility can be approved.'});}
    await client.query('UPDATE nominations SET eligibility_status=$1 WHERE id=$2',[p.data.decision,req.params.id]);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'nomination',$3,$4::jsonb)`,[req.session.userId,'nomination.eligibility_'+p.data.decision,req.params.id,JSON.stringify({reason:p.data.reason})]);
    await client.query('COMMIT');
    res.json({message:'Candidate eligibility decision recorded.'});
  }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});


const votingWindowSchema = z.object({
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime()
});
router.post('/elections/:id/close-nominations', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  try{
    const r=await pool.query("UPDATE elections SET status='nominations_closed' WHERE id=$1 AND status='nominations_open' RETURNING id,title",
      [req.params.id]);
    if(!r.rowCount)return res.status(409).json({error:'Only an election with open nominations can be closed for nominations.'});
    await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'election.nominations_closed','election',$2)",[req.session.userId,req.params.id]);
    res.json({election:r.rows[0],message:'Nominations have closed.'});
  }catch(e){next(e);}
});
router.post('/elections/:id/open-voting', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  const p=votingWindowSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Provide valid voting opening and closing dates.'});
  if(new Date(p.data.closesAt)<=new Date(p.data.opensAt))return res.status(400).json({error:'Voting must close after it opens.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const election=await client.query("SELECT id,status FROM elections WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!election.rowCount||election.rows[0].status!=='nominations_closed'){
      await client.query('ROLLBACK');return res.status(409).json({error:'Close nominations before opening voting.'});
    }
    const check=await client.query(
      `SELECT o.title FROM election_offices o
       WHERE o.election_id=$1 AND NOT EXISTS(
        SELECT 1 FROM nominations n WHERE n.election_id=o.election_id AND n.office_id=o.id AND n.eligibility_status='approved'
       ) LIMIT 1`,[req.params.id]);
    if(check.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Every office must have at least one approved candidate. Missing: '+check.rows[0].title});}
    await client.query("UPDATE elections SET status='voting_open',voting_opens_at=$1,voting_closes_at=$2 WHERE id=$3",
      [p.data.opensAt,p.data.closesAt,req.params.id]);
    await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'election.voting_opened','election',$2)",[req.session.userId,req.params.id]);
    await client.query('COMMIT');
    res.json({message:'Voting has been scheduled and opened.',opensAt:p.data.opensAt,closesAt:p.data.closesAt});
  }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});
router.post('/elections/:id/close-voting', requireAdmin(['super_admin','election_admin']), async(req,res,next)=>{
  try{
    const r=await pool.query("UPDATE elections SET status='closed' WHERE id=$1 AND status='voting_open' RETURNING id,title",
      [req.params.id]);
    if(!r.rowCount)return res.status(409).json({error:'This election is not currently open for voting.'});
    await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'election.voting_closed','election',$2)",[req.session.userId,req.params.id]);
    res.json({election:r.rows[0],message:'Voting has been closed.'});
  }catch(e){next(e);}
});
router.post('/elections/:id/publish-results', requireAdmin(['super_admin','results_officer']), async(req,res,next)=>{
  try{
    const r=await pool.query("UPDATE elections SET status='results_published' WHERE id=$1 AND status='closed' RETURNING id,title",
      [req.params.id]);
    if(!r.rowCount)return res.status(409).json({error:'Close voting before publishing results.'});
    await pool.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'election.results_published','election',$2)",[req.session.userId,req.params.id]);
    res.json({election:r.rows[0],message:'Election results have been published.'});
  }catch(e){next(e);}
});
router.get('/elections', requireAdmin(['super_admin','election_admin','results_officer']), async(req,res,next)=>{
  try{
    const r=await pool.query("SELECT id,title,status,nomination_opens_at,nomination_closes_at,voting_opens_at,voting_closes_at FROM elections ORDER BY created_at DESC");
    res.json({elections:r.rows});
  }catch(e){next(e);}
});

export default router;
