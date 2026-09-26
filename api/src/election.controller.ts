import { Controller, Get, Post, Body, Headers, HttpException, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from './database.service';
import { instantRunoff, approval } from './tally';

/**
 * The election API. Same routes, same JSON shapes as the original server, so
 * the front end needs no rework: login, status, ballot, vote, receipts,
 * verify, results, admin election/audit.
 */

@Controller('api')
export class ElectionController {
  // Explicit injection: Vercel's esbuild does not emit decorator metadata,
  // so Nest cannot resolve the parameter type on its own.
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private token(auth: string | undefined): string | null {
    return auth?.replace(/^Bearer\s+/i, '') || null;
  }

  private async requireRole(auth: string | undefined, role: 'voter' | 'committee') {
    const user = await this.db.currentUser(this.token(auth));
    if (!user || user.role !== role) {
      throw new HttpException(role === 'committee' ? 'Committee sign-in required.' : 'Sign in to vote.', 403);
    }
    return user;
  }

  @Post('login')
  async login(@Body() body: { studentNo?: string; accessCode?: string }, @Res() res: Response) {
    const studentNo = String(body.studentNo || '').trim();
    const accessCode = String(body.accessCode || '').trim();
    const { rows } = await this.db.pool.query('SELECT * FROM voters WHERE student_no=$1', [studentNo]);
    const voter = rows[0];
    if (!voter || voter.access_code !== accessCode) {
      await this.db.audit('login.rejected', { studentNo });
      throw new HttpException('That student number and access code do not match our roster.', 401);
    }
    const token = await this.db.createSession(voter.student_no, voter.role);
    await this.db.audit('login.accepted', { studentNo: voter.student_no, role: voter.role });
    return res.status(200).json({
      token,
      role: voter.role,
      name: voter.full_name,
      yearLevel: voter.year_level,
      hasVoted: !!voter.has_voted
    });
  }

  @Get('status')
  async status(@Res() res: Response) {
    const open = (await this.db.setting('election_open', '1')) === '1';
    const published = (await this.db.setting('results_published', '0')) === '1';
    return res.status(200).json({ open, resultsPublished: published, turnout: await this.db.turnout() });
  }

  @Get('ballot')
  async ballot(@Headers('authorization') auth: string, @Res() res: Response) {
    const user = await this.db.currentUser(this.token(auth));
    if (!user) throw new HttpException('Sign in to view the ballot.', 401);
    const { rows: positions } = await this.db.pool.query('SELECT * FROM positions ORDER BY sort_order');
    const { rows: candidates } = await this.db.pool.query('SELECT * FROM candidates ORDER BY sort_order');
    const paper = positions.map((p) => ({
      id: p.id,
      title: p.title,
      seats: p.seats,
      method: p.method,
      candidates: candidates
        .filter((c) => c.position_id === p.id)
        .map(({ id, name, party, year_level, platform }) => ({ id, name, party, yearLevel: year_level, platform }))
    }));
    return res.status(200).json({
      positions: paper,
      open: (await this.db.setting('election_open', '1')) === '1',
      hasVoted: !!user.has_voted
    });
  }

  @Post('vote')
  async vote(@Headers('authorization') auth: string, @Body() body: { choices?: Record<string, string[]> }, @Res() res: Response) {
    const user = await this.db.currentUser(this.token(auth));
    if (!user || user.role !== 'voter') throw new HttpException('Sign in to vote.', 401);
    if ((await this.db.setting('election_open', '1')) !== '1') throw new HttpException('Voting is closed.', 409);
    if (user.has_voted) throw new HttpException('Our roster already records a ballot for you.', 409);

    // Server-side validation. The browser is not a trustworthy place to enforce anything.
    const { rows: positions } = await this.db.pool.query('SELECT * FROM positions ORDER BY sort_order');
    const { rows: candidates } = await this.db.pool.query('SELECT id, position_id FROM candidates');
    const clean: Record<string, string[]> = {};
    for (const post of positions) {
      const picked = body.choices?.[post.id] ?? [];
      if (!Array.isArray(picked)) throw new HttpException(`Malformed entry for ${post.title}.`, 400);
      const valid = new Set(candidates.filter((c) => c.position_id === post.id).map((c) => c.id));
      if (picked.some((id: string) => !valid.has(id))) throw new HttpException(`Unknown candidate for ${post.title}.`, 400);
      if (new Set(picked).size !== picked.length) throw new HttpException(`Repeated candidate for ${post.title}.`, 400);
      if (post.method === 'approval' && picked.length > post.seats) {
        throw new HttpException(`${post.title} allows at most ${post.seats} choices.`, 400);
      }
      clean[post.id] = picked; // an empty array is a recorded abstention, not an error
    }

    const serial = randomSerial();
    const sealedAt = new Date().toISOString();
    const payload = JSON.stringify(clean);
    const receipt = sha256(`${serial}|${payload}|${sealedAt}`).slice(0, 32);

    // One transaction: the roster is marked and the ballot is sealed together.
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        'UPDATE voters SET has_voted=1, voted_at=$2 WHERE student_no=$1 AND has_voted=0',
        [user.student_no, sealedAt]
      );
      if (claimed.rowCount !== 1) throw new Error('double-vote blocked');
      await client.query('INSERT INTO ballots (serial,receipt,choices_json,sealed_at) VALUES ($1,$2,$3,$4)', [
        serial,
        receipt,
        payload,
        sealedAt
      ]);
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      throw new HttpException('Our roster already records a ballot for you.', 409);
    } finally {
      client.release();
    }

    // The log records that a ballot was sealed. It never records by whom.
    await this.db.audit('ballot.sealed', { serial, receipt });
    await this.db.pool.query('DELETE FROM sessions WHERE token=$1', [user.token]);
    return res.status(201).json({ serial, receipt, sealedAt });
  }

  @Get('receipts')
  async receipts(@Res() res: Response) {
    const { rows } = await this.db.pool.query('SELECT receipt, sealed_at FROM ballots ORDER BY sealed_at');
    return res.status(200).json({ receipts: rows.map((r) => ({ receipt: r.receipt, sealed_at: r.sealed_at })) });
  }

  @Post('verify')
  async verify(@Body() body: { receipt?: string }, @Res() res: Response) {
    const { rows } = await this.db.pool.query('SELECT serial, sealed_at FROM ballots WHERE receipt=$1', [
      String(body.receipt || '').trim()
    ]);
    return res.status(200).json(rows[0] ? { found: true, ...rows[0] } : { found: false });
  }

  @Get('results')
  async results(@Headers('authorization') auth: string, @Res() res: Response) {
    const user = await this.db.currentUser(this.token(auth));
    const published = (await this.db.setting('results_published', '0')) === '1';
    if (!published && user?.role !== 'committee') {
      throw new HttpException('Results are released once voting closes.', 403);
    }
    return res.status(200).json(await this.computeResults());
  }

  @Post('admin/election')
  async adminElection(@Headers('authorization') auth: string, @Body() body: { open?: boolean; publishResults?: boolean }, @Res() res: Response) {
    const user = await this.db.currentUser(this.token(auth));
    if (user?.role !== 'committee') throw new HttpException('Committee sign-in required.', 403);
    if (body.open !== undefined) {
      await this.db.setSetting('election_open', body.open ? '1' : '0');
      await this.db.audit(body.open ? 'election.opened' : 'election.closed', { by: user.student_no });
    }
    if (body.publishResults !== undefined) {
      await this.db.setSetting('results_published', body.publishResults ? '1' : '0');
      await this.db.audit('results.published', { by: user.student_no, published: !!body.publishResults });
    }
    return res.status(200).json({
      open: (await this.db.setting('election_open', '1')) === '1',
      resultsPublished: (await this.db.setting('results_published', '0')) === '1'
    });
  }

  @Get('admin/audit')
  async adminAudit(@Headers('authorization') auth: string, @Res() res: Response) {
    const user = await this.db.currentUser(this.token(auth));
    if (user?.role !== 'committee') throw new HttpException('Committee sign-in required.', 403);
    const { rows } = await this.db.pool.query('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 100');
    return res.status(200).json({ chain: await this.db.verifyAuditChain(), entries: rows, turnout: await this.db.turnout() });
  }

  private async computeResults() {
    const { rows: positions } = await this.db.pool.query('SELECT * FROM positions ORDER BY sort_order');
    const { rows: candidates } = await this.db.pool.query('SELECT * FROM candidates ORDER BY sort_order');
    const { rows: ballotRows } = await this.db.pool.query('SELECT choices_json FROM ballots');
    const ballots = ballotRows.map((b) => JSON.parse(b.choices_json));
    const names = new Map(candidates.map((c) => [c.id, c]));

    const results = [];
    for (const post of positions) {
      const cast = ballots.map((b) => b[post.id] ?? []);
      const abstentions = cast.filter((c) => c.length === 0).length;
      const ids = candidates.filter((c) => c.position_id === post.id).map((c) => c.id);
      const outcome = post.method === 'irv' ? instantRunoff(cast, ids) : approval(cast, ids, post.seats);
      const label = (id: string) => ({ id, name: names.get(id)?.name, party: names.get(id)?.party });
      results.push({
        positionId: post.id,
        title: post.title,
        seats: post.seats,
        method: post.method,
        abstentions,
        ballotsCast: cast.length,
        winners: outcome.winners.map(label),
        tie: outcome.tie ? outcome.tie.map(label) : null,
        rounds: outcome.rounds?.map((r) => ({
          ...r,
          counts: r.counts.map((c) => ({ ...c, ...label(c.candidateId) })),
          eliminated: r.eliminated?.map(label) ?? null
        })),
        standing: outcome.standing?.map((c) => ({ ...c, ...label(c.candidateId) }))
      });
    }
    return { turnout: await this.db.turnout(), chain: await this.db.verifyAuditChain(), results };
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const randomSerial = () => randomBytes(6).toString('hex').toUpperCase();
