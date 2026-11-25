import { Router } from 'express';
import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();
const candidate = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const result = await pool.query(
      "SELECT u.id, u.account_status, p.full_name, u.matric_number, p.department, p.level FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.id=$1",
      [req.session.userId]
    );
    if (!result.rowCount || result.rows[0].account_status !== 'active') return res.status(403).json({ error: 'Your account is not active.' });
    req.student = result.rows[0];
    next();
  } catch (error) { next(error); }
};

router.get('/open', candidate, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.id AS election_id, e.title AS election_title, e.description,
              o.id AS office_id, o.title AS office_title, o.nomination_fee_kobo, o.seats
       FROM elections e JOIN election_offices o ON o.election_id=e.id
       WHERE e.status='nominations_open'
         AND (e.nomination_opens_at IS NULL OR e.nomination_opens_at <= NOW())
         AND (e.nomination_closes_at IS NULL OR e.nomination_closes_at >= NOW())
       ORDER BY e.created_at DESC, o.title`
    );
    res.json({ opportunities: result.rows });
  } catch (error) { next(error); }
});

router.get('/mine', candidate, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT n.id, n.reference, n.submitted_at, n.eligibility_status, e.title AS election_title,
              o.title AS office_title, p.amount_kobo, p.payment_channel, p.transaction_reference,
              p.verification_status
       FROM nominations n JOIN elections e ON e.id=n.election_id
       JOIN election_offices o ON o.id=n.office_id
       LEFT JOIN nomination_payments p ON p.nomination_id=n.id
       WHERE n.candidate_user_id=$1 ORDER BY n.submitted_at DESC`,
      [req.session.userId]
    );
    res.json({ nominations: result.rows });
  } catch (error) { next(error); }
});

const submitSchema = z.object({
  electionId: z.string().uuid(),
  officeId: z.string().uuid(),
  manifesto: z.string().trim().max(5000).optional().default(''),
  paymentChannel: z.enum(['Zenith Bank','OPay','Moniepoint','Other bank transfer']),
  transactionReference: z.string().trim().min(4).max(120)
});

router.post('/', candidate, async (req, res, next) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the nomination and payment details.', details: parsed.error.flatten().fieldErrors });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { electionId, officeId, manifesto, paymentChannel, transactionReference } = parsed.data;
    const office = await client.query(
      `SELECT e.id AS election_id, e.status, e.nomination_opens_at, e.nomination_closes_at,
              o.id AS office_id, o.title, o.nomination_fee_kobo
       FROM elections e JOIN election_offices o ON o.election_id=e.id
       WHERE e.id=$1 AND o.id=$2 FOR UPDATE OF e,o`,
      [electionId, officeId]
    );
    if (!office.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Election office not found.' }); }
    const item = office.rows[0];
    if (item.status !== 'nominations_open' || (item.nomination_opens_at && new Date(item.nomination_opens_at) > new Date()) || (item.nomination_closes_at && new Date(item.nomination_closes_at) < new Date())) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'Nominations are not currently open for this office.' });
    }
    const reference = 'FSS-NOM-' + new Date().getUTCFullYear() + '-' + cryptoRandom();
    const inserted = await client.query(
      `INSERT INTO nominations (reference,election_id,office_id,candidate_user_id,manifesto)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,reference,submitted_at`,
      [reference,electionId,officeId,req.session.userId,manifesto]
    );
    await client.query(
      `INSERT INTO nomination_payments (nomination_id,amount_kobo,payment_channel,transaction_reference)
       VALUES ($1,$2,$3,$4)`,
      [inserted.rows[0].id,item.nomination_fee_kobo,paymentChannel,transactionReference]
    );
    await client.query(
      "INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'nomination.submitted','nomination',$2,$3::jsonb)",
      [req.session.userId,inserted.rows[0].id,JSON.stringify({reference,office:item.title})]
    );
    await client.query('COMMIT');
    res.status(201).json({ nomination: {...inserted.rows[0], officeTitle:item.title, amountKobo:item.nomination_fee_kobo, paymentStatus:'pending'} });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'You have already submitted a nomination for this office in this election.' });
    next(error);
  } finally { client.release(); }
});

function cryptoRandom() { return crypto.randomBytes(5).toString('hex').toUpperCase(); }

router.get('/:id/form.pdf', candidate, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT n.id,n.reference,n.submitted_at,n.manifesto,n.eligibility_status,
              e.title AS election_title,o.title AS office_title,p.amount_kobo,p.payment_channel,
              p.transaction_reference,p.verification_status,s.full_name,u.matric_number,
              s.department,s.level,s.matric_type
       FROM nominations n JOIN elections e ON e.id=n.election_id
       JOIN election_offices o ON o.id=n.office_id JOIN users u ON u.id=n.candidate_user_id
       JOIN student_profiles s ON s.user_id=u.id
       LEFT JOIN nomination_payments p ON p.nomination_id=n.id
       WHERE n.id=$1 AND n.candidate_user_id=$2`,
      [req.params.id,req.session.userId]
    );
    if (!result.rowCount) return res.status(404).json({error:'Nomination form not found.'});
    const n=result.rows[0];
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${n.reference}.pdf"`);
    const doc=new PDFDocument({size:'A4',margin:54,info:{Title:'FSS@UNIDEL Nomination Form',Author:'Faculty of the Social Sciences, UNIDEL'}});
    doc.pipe(res);
    doc.fillColor('#123b5d').fontSize(18).font('Helvetica-Bold').text('UNIVERSITY OF DELTA, AGBOR',{align:'center'});
    doc.moveDown(.25).fontSize(13).text('FACULTY OF THE SOCIAL SCIENCES',{align:'center'});
    doc.moveDown(.25).fontSize(11).text('ELECTRONIC ELECTION — CANDIDATE NOMINATION FORM',{align:'center'});
    doc.moveDown().strokeColor('#b17a32').moveTo(54,doc.y).lineTo(541,doc.y).stroke();
    doc.moveDown(1).fillColor('#172b3a').fontSize(11).font('Helvetica-Bold').text('NOMINATION REFERENCE: '+n.reference);
    doc.moveDown().font('Helvetica-Bold').text('ELECTION DETAILS');
    doc.font('Helvetica').text('Election: '+n.election_title).text('Office nominated for: '+n.office_title);
    doc.moveDown().font('Helvetica-Bold').text('CANDIDATE DETAILS');
    doc.font('Helvetica').text('Full name: '+n.full_name).text((n.matric_type==='registration'?'Registration number: ':'Matriculation number: ')+n.matric_number).text('Department: '+n.department).text('Level: '+n.level);
    doc.moveDown().font('Helvetica-Bold').text('PAYMENT DETAILS');
    doc.font('Helvetica').text('Nomination fee: NGN '+(Number(n.amount_kobo)/100).toLocaleString('en-NG',{minimumFractionDigits:2})).text('Payment channel: '+(n.payment_channel||'Not submitted')).text('Transaction reference: '+(n.transaction_reference||'Not supplied')).text('Payment verification: '+(n.verification_status||'Pending'));
    doc.moveDown().font('Helvetica-Bold').text('MANIFESTO / DECLARATION');
    doc.font('Helvetica').text(n.manifesto||'No manifesto supplied.',{width:480});
    doc.moveDown(1.5).fontSize(9).fillColor('#637789').text('This document confirms that a nomination record was submitted electronically. It is not confirmation of payment verification or candidate eligibility. Eligibility is subject to review and approval by the authorised election administrators.');
    doc.moveDown(2).fillColor('#172b3a').fontSize(10).text('Submitted: '+new Date(n.submitted_at).toLocaleString('en-NG',{timeZone:'Africa/Lagos'}));
    doc.end();
  } catch (error) { next(error); }
});

export default router;
