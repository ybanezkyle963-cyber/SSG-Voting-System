import { db, audit, setSetting, rand, tx } from './db.js';

const positions = [
  ['president', 'President', 1, 'irv', 1],
  ['vice-president', 'Vice President', 1, 'irv', 2],
  ['secretary', 'Secretary', 1, 'irv', 3],
  ['treasurer', 'Treasurer', 1, 'irv', 4],
  ['auditor', 'Auditor', 1, 'irv', 5],
  ['pio', 'Public Information Officer', 1, 'irv', 6],
  ['representatives', 'Year Level Representatives', 4, 'approval', 7]
];

const candidates = [
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

const wipe = () => tx(() => {
  db.exec('DELETE FROM ballots; DELETE FROM sessions; DELETE FROM audit_log; DELETE FROM candidates; DELETE FROM positions; DELETE FROM voters; DELETE FROM settings;');

  const p = db.prepare('INSERT INTO positions (id, title, seats, method, sort_order) VALUES (?,?,?,?,?)');
  positions.forEach((row) => p.run(...row));

  const c = db.prepare('INSERT INTO candidates (id, position_id, name, party, year_level, platform, sort_order) VALUES (?,?,?,?,?,?,?)');
  candidates.forEach((row, i) => c.run(row[0], row[1], row[2], row[3], row[4], row[5], i + 1));

  const v = db.prepare('INSERT INTO voters (student_no, full_name, year_level, access_code, role) VALUES (?,?,?,?,?)');
  for (let i = 0; i < 180; i++) {
    const no = `2026-${String(1000 + i)}`;
    const name = `${given[i % given.length]} ${surnames[(i * 7) % surnames.length]}`;
    v.run(no, name, levels[i % levels.length], rand(3).toUpperCase(), 'voter');
  }
  // Predictable demo logins.
  db.prepare('UPDATE voters SET access_code = ? WHERE student_no = ?').run('DEMO01', '2026-1000');
  db.prepare('UPDATE voters SET access_code = ? WHERE student_no = ?').run('DEMO02', '2026-1001');
  v.run('COMELEC-01', 'Election Committee', 'Faculty', 'ADMIN01', 'committee');

  setSetting('election_open', '1');
  setSetting('results_published', '0');
});

wipe();
audit('election.seeded', { positions: positions.length, candidates: candidates.length, voters: 180 });

console.log('Seeded 180 voters, 7 positions, 20 candidates.');
console.log('  Voter     : 2026-1000 / DEMO01   (also 2026-1001 / DEMO02)');
console.log('  Committee : COMELEC-01 / ADMIN01');
