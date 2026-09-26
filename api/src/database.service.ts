import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/**
 * Owns the Postgres connection, the schema and the audit chain.
 *
 * The database is Vercel Postgres (Neon) via DATABASE_URL. Schema creation and
 * first seeding happen automatically on boot, so a fresh database becomes a
 * runnable election with no manual step.
 */

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const rand = (n = 16) => randomBytes(n).toString('hex');

@Injectable()
export class DatabaseService implements OnModuleInit {
  readonly pool = new Pool({
    connectionString:
      process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    max: 3,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.POSTGRES_URL || process.env.DATABASE_URL || '')
      ? false
      : { rejectUnauthorized: false }
  });

  async onModuleInit() {
    // Cold-start safety: concurrent lambda instances booting at once would
    // otherwise race the schema creation and the seed. An advisory lock lets
    // one finish while the others find the work already done.
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('ssg-election-schema'))");
      await this.ensureSchema(client);
      await this.seedIfEmpty(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('ssg-election-schema'))");
      client.release();
    }
  }

  async ensureSchema(client: { query: (sql: string) => Promise<unknown> }) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS voters (
        student_no   TEXT PRIMARY KEY,
        full_name    TEXT NOT NULL,
        year_level   TEXT NOT NULL,
        access_code  TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'voter',
        has_voted    INTEGER NOT NULL DEFAULT 0,
        voted_at     TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        student_no TEXT NOT NULL REFERENCES voters(student_no),
        role       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS positions (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        seats      INTEGER NOT NULL DEFAULT 1,
        method     TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id          TEXT PRIMARY KEY,
        position_id TEXT NOT NULL REFERENCES positions(id),
        name        TEXT NOT NULL,
        party       TEXT NOT NULL,
        year_level  TEXT NOT NULL,
        platform    TEXT NOT NULL,
        sort_order  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ballots (
        serial       TEXT PRIMARY KEY,
        receipt      TEXT NOT NULL UNIQUE,
        choices_json TEXT NOT NULL,
        sealed_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        seq        SERIAL PRIMARY KEY,
        at         TEXT NOT NULL,
        event      TEXT NOT NULL,
        detail     TEXT NOT NULL,
        prev_hash  TEXT NOT NULL,
        entry_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  async seedIfEmpty(client: { query: (sql: string, values?: unknown[]) => Promise<any> }) {
    const counted = await client.query('SELECT COUNT(*)::int AS n FROM voters');
    if (counted.rows[0].n > 0) return;

    const positions: [string, string, number, string, number][] = [
      ['president', 'President', 1, 'irv', 1],
      ['vice-president', 'Vice President', 1, 'irv', 2],
      ['secretary', 'Secretary', 1, 'irv', 3],
      ['treasurer', 'Treasurer', 1, 'irv', 4],
      ['auditor', 'Auditor', 1, 'irv', 5],
      ['pio', 'Public Information Officer', 1, 'irv', 6],
      ['representatives', 'Year Level Representatives', 4, 'approval', 7]
    ];
    const candidates: [string, string, string, string, string, string][] = [
      ['pres-1', 'president', 'Althea Marasigan', 'Buklod', 'Grade 12', 'Publish the SSG budget every month and open the org fund to student questions.'],
      ['pres-2', 'president', 'Rafael Domingo', 'Sulong', 'Grade 12', 'A working student lounge and a review week free of major school events.'],
      ['pres-3', 'president', 'Nadine Ocampo', 'Independent', 'Grade 11', 'Bring back the inter-year sports league and fund four new club charters.'],
      ['vp-1', 'vice-president', 'Joaquin Reyes', 'Buklod', 'Grade 11', 'One officer on duty at the SSG desk during every lunch break.'],
      ['vp-2', 'vice-president', 'Bea Villanueva', 'Sulong', 'Grade 12', 'Run the committee system properly so projects stop dying in planning.'],
      ['sec-1', 'secretary', 'Miguel Santibañez', 'Sulong', 'Grade 11', 'Minutes posted within 48 hours of every meeting.'],
      ['sec-2', 'secretary', 'Kyla Ferrer', 'Buklod', 'Grade 10', 'A shared calendar so clubs stop booking the same dates.'],
      ['tre-1', 'treasurer', 'Danilo Aquino', 'Buklod', 'Grade 12', 'Itemised receipts for every event, posted on the SSG board.'],
      ['tre-2', 'treasurer', 'Patricia Lim', 'Independent', 'Grade 11', 'Cut event fees by moving printing and tarpaulins in-house.'],
      ['aud-1', 'auditor', 'Ysabel Cruz', 'Sulong', 'Grade 12', 'A published quarterly audit, not just an end-of-year summary.'],
      ['aud-2', 'auditor', 'Enrique Bautista', 'Buklod', 'Grade 11', 'Spot-check every disbursement above one thousand pesos.'],
      ['pio-1', 'pio', 'Trisha Mendoza', 'Buklod', 'Grade 10', 'Announcements in Filipino and English, posted the same day.'],
      ['pio-2', 'pio', 'Carlo Panganiban', 'Independent', 'Grade 12', 'A weekly two-minute recap so nobody misses deadlines.'],
      ['rep-1', 'representatives', 'Lourdes Katigbak', 'Buklod', 'Grade 12', 'Seniors need a clear graduation-fee schedule by August.'],
      ['rep-2', 'representatives', 'Emman Salvador', 'Sulong', 'Grade 12', 'Longer library hours during exam weeks.'],
      ['rep-3', 'representatives', 'Jasmine Ilagan', 'Independent', 'Grade 11', 'Repair the covered walkway before rainy season.'],
      ['rep-4', 'representatives', 'Noel Fajardo', 'Buklod', 'Grade 11', 'A canteen price board that is actually kept up to date.'],
      ['rep-5', 'representatives', 'Chesca Bituin', 'Sulong', 'Grade 10', 'Orientation buddies for every incoming section.'],
      ['rep-6', 'representatives', 'Arvin Gutierrez', 'Independent', 'Grade 10', 'Charging stations and working fans in every classroom.']
    ];
    const surnames = ['Alvarez','Bautista','Castillo','Dela Cruz','Espinosa','Fernandez','Garcia','Hernandez','Ignacio','Jimenez','Lorenzo','Mercado','Navarro','Ortega','Pascual','Quinto','Ramos','Silvestre','Torres','Uy','Valdez','Yap'];
    const given = ['Aiza','Bryan','Cielo','Dennis','Elaine','Francis','Grace','Hector','Ivy','Jonas','Karla','Leo','Mika','Nico','Olivia','Paulo','Queenie','Rico','Sam','Tina','Ulysses','Vien'];
    const levels = ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

    try {
      await client.query('BEGIN');
      await this.insertRows(client, 'positions (id,title,seats,method,sort_order)', positions);
      await this.insertRows(
        client,
        'candidates (id,position_id,name,party,year_level,platform,sort_order)',
        candidates.map((c, i) => [...c, i + 1])
      );
      const voterRows: (string | number)[][] = [];
      for (let i = 0; i < 180; i++) {
        const no = `2026-${String(1000 + i)}`;
        const name = `${given[i % given.length]} ${surnames[(i * 7) % surnames.length]}`;
        voterRows.push([no, name, levels[i % levels.length], rand(3).toUpperCase(), 'voter']);
      }
      await this.insertRows(client, 'voters (student_no,full_name,year_level,access_code,role)', voterRows);
      // Predictable demo access codes for the seeded roster.
      await client.query("UPDATE voters SET access_code='DEMO01' WHERE student_no='2026-1000'");
      await client.query("UPDATE voters SET access_code='DEMO02' WHERE student_no='2026-1001'");
      // The committee login: admin / admin by default.
      await client.query("INSERT INTO voters (student_no,full_name,year_level,access_code,role) VALUES ('admin','Election Committee','Faculty','admin','committee')");
      await client.query("INSERT INTO settings (key,value) VALUES ('election_open','1'),('results_published','0') ON CONFLICT (key) DO NOTHING");
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    await this.audit('election.seeded', { positions: positions.length, candidates: candidates.length, voters: 180 });
  }

  /**
   * Multi-row INSERT in chunks. A serverless cold start shares its time budget
   * with every other boot, and one round-trip per row over the internet made
   * the seed take a minute -- past Vercel's function limit. Chunking cuts the
   * whole seed to a handful of round-trips.
   */
  private async insertRows(
    client: { query: (sql: string, values?: unknown[]) => Promise<any> },
    tableAndColumns: string,
    rows: (string | number)[][]
  ) {
    const chunkSize = 40;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const placeholders: string[] = [];
      const values: (string | number)[] = [];
      chunk.forEach((row, r) => {
        const base = r * row.length;
        placeholders.push(`(${row.map((_, c) => `$${base + c + 1}`).join(',')})`);
        values.push(...row);
      });
      await client.query(
        `INSERT INTO ${tableAndColumns} VALUES ${placeholders.join(',')}`,
        values
      );
    }
  }

  /* --------------------------------------------------------------- helpers */

  async setting(key: string, fallback: string): Promise<string> {
    const { rows } = await this.pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    return rows[0]?.value ?? fallback;
  }

  async setSetting(key: string, value: string) {
    await this.pool.query(
      'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
      [key, value]
    );
  }

  async audit(event: string, detail: Record<string, unknown> = {}) {
    const { rows } = await this.pool.query('SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1');
    const prevHash = rows[0]?.entry_hash ?? 'genesis';
    const at = new Date().toISOString();
    const body = JSON.stringify(detail);
    const entryHash = sha256(`${prevHash}|${at}|${event}|${body}`);
    await this.pool.query(
      'INSERT INTO audit_log (at,event,detail,prev_hash,entry_hash) VALUES ($1,$2,$3,$4,$5)',
      [at, event, body, prevHash, entryHash]
    );
  }

  async verifyAuditChain(): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
    const { rows } = await this.pool.query('SELECT * FROM audit_log ORDER BY seq ASC');
    let prevHash = 'genesis';
    for (const r of rows) {
      const expected = sha256(`${prevHash}|${r.at}|${r.event}|${r.detail}`);
      if (r.prev_hash !== prevHash || r.entry_hash !== expected) return { ok: false, entries: rows.length, brokenAt: r.seq };
      prevHash = r.entry_hash;
    }
    return { ok: true, entries: rows.length };
  }

  async turnout() {
    const total = (await this.pool.query("SELECT COUNT(*)::int n FROM voters WHERE role='voter'")).rows[0].n;
    const voted = (await this.pool.query("SELECT COUNT(*)::int n FROM voters WHERE role='voter' AND has_voted=1")).rows[0].n;
    const sealed = (await this.pool.query('SELECT COUNT(*)::int n FROM ballots')).rows[0].n;
    return { registered: total, voted, sealed, percent: total ? +((voted / total) * 100).toFixed(1) : 0, reconciled: voted === sealed };
  }

  async currentUser(token: string | null) {
    if (!token) return null;
    const { rows } = await this.pool.query(
      `SELECT s.token, s.role, v.student_no, v.full_name, v.year_level, v.has_voted
         FROM sessions s JOIN voters v ON v.student_no = s.student_no
        WHERE s.token=$1 AND s.expires_at > $2`,
      [token, new Date().toISOString()]
    );
    return rows[0] ?? null;
  }

  async createSession(studentNo: string, role: string) {
    const token = rand(24);
    const now = new Date();
    await this.pool.query(
      'INSERT INTO sessions (token,student_no,role,created_at,expires_at) VALUES ($1,$2,$3,$4,$5)',
      [token, studentNo, role, now.toISOString(), new Date(now.getTime() + 2 * 3600_000).toISOString()]
    );
    return token;
  }
}
