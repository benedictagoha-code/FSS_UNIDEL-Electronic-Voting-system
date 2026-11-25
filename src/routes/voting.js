import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';

const router = Router();

async function requireActiveStudent(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const result = await pool.query(
      "SELECT id, account_status FROM users WHERE id=$1",
      [req.session.userId]
    );
    if (!result.rowCount || result.rows[0].account_status !== 'active') {
      return res.status(403).json({ error: 'Your student account is not active.' });
    }
    next();
  } catch (error) { next(error); }
}

router.use(requireActiveStudent);

router.get('/open', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.id,e.title,e.description,e.voting_opens_at,e.voting_closes_at,
        EXISTS(SELECT 1 FROM voter_participation vp WHERE vp.election_id=e.id AND vp.voter_user_id=$1) AS has_voted
       FROM elections e
       WHERE e.status='voting_open'
         AND (e.voting_opens_at IS NULL OR e.voting_opens_at<=NOW())
         AND (e.voting_closes_at IS NULL OR e.voting_closes_at>=NOW())
       ORDER BY e.voting_opens_at ASC`,
      [req.session.userId]
    );
    res.json({ elections: result.rows });
  } catch (error) { next(error); }
});

router.get('/:electionId/ballot', async (req, res, next) => {
  try {
    const election = await pool.query(
      `SELECT id,title,description,voting_closes_at FROM elections
       WHERE id=$1 AND status='voting_open'
         AND (voting_opens_at IS NULL OR voting_opens_at<=NOW())
         AND (voting_closes_at IS NULL OR voting_closes_at>=NOW())`,
      [req.params.electionId]
    );
    if (!election.rowCount) return res.status(404).json({ error: 'This election is not currently accepting votes.' });
    const participation = await pool.query(
      'SELECT 1 FROM voter_participation WHERE election_id=$1 AND voter_user_id=$2',
      [req.params.electionId, req.session.userId]
    );
    if (participation.rowCount) return res.status(409).json({ error: 'Your vote in this election has already been recorded.' });
    const offices = await pool.query(
      `SELECT o.id AS office_id,o.title AS office_title,o.seats,
        n.id AS nomination_id,n.reference,n.manifesto,s.full_name,s.department
       FROM election_offices o
       LEFT JOIN nominations n ON n.office_id=o.id AND n.election_id=o.election_id AND n.eligibility_status='approved'
       LEFT JOIN users u ON u.id=n.candidate_user_id
       LEFT JOIN student_profiles s ON s.user_id=u.id
       WHERE o.election_id=$1 ORDER BY o.title,s.full_name`,
      [req.params.electionId]
    );
    const grouped = new Map();
    for (const row of offices.rows) {
      if (!grouped.has(row.office_id)) grouped.set(row.office_id, {
        id: row.office_id, title: row.office_title, seats: row.seats, candidates: []
      });
      if (row.nomination_id) grouped.get(row.office_id).candidates.push({
        nominationId: row.nomination_id, name: row.full_name, department: row.department, manifesto: row.manifesto
      });
    }
    res.json({ election: election.rows[0], offices: [...grouped.values()] });
  } catch (error) { next(error); }
});

router.post('/:electionId/authorise', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const election = await client.query(
      `SELECT id FROM elections WHERE id=$1 AND status='voting_open'
       AND (voting_opens_at IS NULL OR voting_opens_at<=NOW())
       AND (voting_closes_at IS NULL OR voting_closes_at>=NOW()) FOR UPDATE`,
      [req.params.electionId]
    );
    if (!election.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Voting is not open for this election.' });
    }
    const prior = await client.query(
      'SELECT 1 FROM voter_participation WHERE election_id=$1 AND voter_user_id=$2',
      [req.params.electionId, req.session.userId]
    );
    if (prior.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Your vote has already been recorded.' });
    }
    await client.query(
      'UPDATE voting_authorisations SET consumed_at=NOW() WHERE election_id=$1 AND voter_user_id=$2 AND consumed_at IS NULL',
      [req.params.electionId, req.session.userId]
    );
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await client.query(
      'INSERT INTO voting_authorisations(election_id,voter_user_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'10 minutes\')',
      [req.params.electionId, req.session.userId, tokenHash]
    );
    await client.query('COMMIT');
    res.json({ authorisationToken: token, expiresInSeconds: 600 });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

const ballotSchema = z.object({
  authorisationToken: z.string().min(30).max(200),
  selections: z.array(z.object({
    officeId: z.string().uuid(),
    nominationIds: z.array(z.string().uuid()).max(20)
  })).min(1).max(50)
});

router.post('/:electionId/ballot', async (req, res, next) => {
  const parsed = ballotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'The ballot details are invalid.' });
  const tokenHash = crypto.createHash('sha256').update(parsed.data.authorisationToken).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const election = await client.query(
      `SELECT id FROM elections WHERE id=$1 AND status='voting_open'
       AND (voting_opens_at IS NULL OR voting_opens_at<=NOW())
       AND (voting_closes_at IS NULL OR voting_closes_at>=NOW()) FOR UPDATE`,
      [req.params.electionId]
    );
    if (!election.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Voting is closed or unavailable.' });
    }
    const auth = await client.query(
      `SELECT id FROM voting_authorisations
       WHERE election_id=$1 AND voter_user_id=$2 AND token_hash=$3
         AND consumed_at IS NULL AND expires_at>NOW()
       FOR UPDATE`,
      [req.params.electionId, req.session.userId, tokenHash]
    );
    if (!auth.rowCount) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Voting authorisation is invalid, expired or already used. Request a new one.' });
    }
    const prior = await client.query(
      'SELECT 1 FROM voter_participation WHERE election_id=$1 AND voter_user_id=$2',
      [req.params.electionId, req.session.userId]
    );
    if (prior.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A vote has already been recorded for your account.' });
    }
    const officeResult = await client.query(
      'SELECT id,seats FROM election_offices WHERE election_id=$1',
      [req.params.electionId]
    );
    const officeMap = new Map(officeResult.rows.map(row => [row.id, Number(row.seats)]));
    const submitted = parsed.data.selections;
    if (submitted.length !== officeMap.size || new Set(submitted.map(x => x.officeId)).size !== submitted.length ||
        submitted.some(x => !officeMap.has(x.officeId) || x.nominationIds.length > officeMap.get(x.officeId) ||
          new Set(x.nominationIds).size !== x.nominationIds.length)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Select candidates within the permitted number of seats for every office.' });
    }
    const allIds = submitted.flatMap(x => x.nominationIds);
    if (allIds.length) {
      const valid = await client.query(
        `SELECT n.id,n.office_id FROM nominations n
         WHERE n.election_id=$1 AND n.eligibility_status='approved' AND n.id=ANY($2::uuid[])`,
        [req.params.electionId, allIds]
      );
      const validMap = new Map(valid.rows.map(row => [row.id,row.office_id]));
      if (validMap.size !== allIds.length || submitted.some(x => x.nominationIds.some(id => validMap.get(id)!==x.officeId))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more selected candidates are not eligible for the selected office.' });
      }
    }
    const ballot = await client.query(
      'INSERT INTO ballots(election_id) VALUES($1) RETURNING id',
      [req.params.electionId]
    );
    for (const office of submitted) {
      for (const nominationId of office.nominationIds) {
        await client.query(
          'INSERT INTO ballot_selections(ballot_id,office_id,candidate_nomination_id) VALUES($1,$2,$3)',
          [ballot.rows[0].id, office.officeId, nominationId]
        );
      }
    }
    await client.query(
      'INSERT INTO voter_participation(election_id,voter_user_id) VALUES($1,$2)',
      [req.params.electionId, req.session.userId]
    );
    await client.query('UPDATE voting_authorisations SET consumed_at=NOW() WHERE id=$1',[auth.rows[0].id]);
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
       VALUES($1,'voting.ballot_cast','election',$2,'{}'::jsonb)`,
      [req.session.userId,req.params.electionId]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Your ballot has been accepted. Your voting participation has been recorded separately from your ballot choices.' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'A vote has already been recorded for this election.' });
    next(error);
  } finally { client.release(); }
});

router.get('/published', async (_req,res,next)=>{
  try{
    const r=await pool.query("SELECT id,title,description FROM elections WHERE status='results_published' ORDER BY created_at DESC");
    res.json({elections:r.rows});
  }catch(error){next(error);}
});

router.get('/:electionId/results', async (req, res, next) => {
  try {
    const election = await pool.query(
      "SELECT id,title,status FROM elections WHERE id=$1 AND status='results_published'",
      [req.params.electionId]
    );
    if (!election.rowCount) return res.status(404).json({ error: 'Results have not been published for this election.' });
    const [totals, participation] = await Promise.all([
      pool.query(
        `SELECT o.id AS office_id,o.title AS office_title,n.id AS nomination_id,s.full_name,s.department,
          COUNT(bs.id)::int AS votes
         FROM election_offices o
         LEFT JOIN nominations n ON n.office_id=o.id AND n.eligibility_status='approved'
         LEFT JOIN users u ON u.id=n.candidate_user_id
         LEFT JOIN student_profiles s ON s.user_id=u.id
         LEFT JOIN ballot_selections bs ON bs.office_id=o.id AND bs.candidate_nomination_id=n.id
         WHERE o.election_id=$1
         GROUP BY o.id,o.title,n.id,s.full_name,s.department
         ORDER BY o.title,votes DESC,s.full_name`,
        [req.params.electionId]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS total_voters FROM voter_participation WHERE election_id=$1',
        [req.params.electionId]
      )
    ]);
    res.json({ election: election.rows[0], totalVoters: participation.rows[0].total_voters, results: totals.rows });
  } catch (error) { next(error); }
});

export default router;
