const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const state = {
  token: null,
  user: null,
  positions: [],
  choices: {},      // positionId -> ordered array of candidate ids
  view: 'signin',
  receipt: null,
  data: null
};

/* ------------------------------------------------------------------- api */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The server could not complete that.');
  return data;
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3600);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const go = (view) => { state.view = view; render(); window.scrollTo(0, 0); };

/* ----------------------------------------------------------------- views */

function signinView() {
  return `
    <header class="masthead">
      <div class="masthead-body">
        <h1>Supreme Student Government</h1>
        <p class="lede">Annual election of officers, School Year 2026&ndash;2027</p>
      </div>
      <aside class="stub">
        <span class="stub-label">Ballot stub</span>
        <span class="stub-code">&mdash;&mdash;&mdash;&mdash;</span>
        <span class="fine">Issued after you seal your ballot.</span>
      </aside>
    </header>

    <h2>Sign in to vote</h2>
    <p class="lede">Use the student number on your ID and the access code the election committee gave you. Each code opens the ballot once.</p>

    <div class="field">
      <label for="sn">Student number</label>
      <input id="sn" type="text" autocomplete="off" placeholder="2026-1000">
    </div>
    <div class="field">
      <label for="ac">Access code</label>
      <input id="ac" type="text" autocomplete="off" placeholder="DEMO01">
    </div>
    <p id="err" class="error"></p>
    <div class="row">
      <button id="signin">Open my ballot</button>
      <button class="ghost" id="to-verify">Check a receipt</button>
    </div>
    <p class="fine" style="margin-top:2rem">Demo logins &mdash; voter 2026-1000 / DEMO01, committee COMELEC-01 / ADMIN01.</p>
  `;
}

function candidateRow(post, cand) {
  const picks = state.choices[post.id] || [];
  const at = picks.indexOf(cand.id);
  const picked = at !== -1;
  const mark = post.method === 'irv' ? (picked ? at + 1 : '') : picked ? '&#10003;' : '';
  const ordinal = ['1st choice', '2nd choice', '3rd choice'][at] || (picked ? `${at + 1}th choice` : '');
  return `
    <button class="pick ${picked ? 'picked' : ''}" data-post="${post.id}" data-cand="${cand.id}"
            aria-pressed="${picked}">
      <span class="oval" aria-hidden="true">${mark}</span>
      <span>
        <span class="cand-name">${esc(cand.name)}</span>
        <span class="cand-meta"> &middot; ${esc(cand.party)} &middot; ${esc(cand.yearLevel)}</span>
        ${picked && post.method === 'irv' ? `<div class="rank-tag">${ordinal}</div>` : ''}
        <p class="cand-plat">${esc(cand.platform)}</p>
      </span>
    </button>`;
}

function ballotView() {
  const marked = state.positions.filter((p) => (state.choices[p.id] || []).length > 0).length;
  const posts = state.positions
    .map((post) => {
      const picks = state.choices[post.id] || [];
      const rule =
        post.method === 'irv'
          ? 'Rank as many as you want'
          : `Choose up to ${post.seats} &middot; ${post.seats - picks.length} left`;
      return `
        <section class="post">
          <div class="post-head">
            <h2>${esc(post.title)}</h2>
            <span class="post-rule">${rule}</span>
          </div>
          ${
            post.method === 'irv'
              ? `<p class="fine">Tap your favourite first. If they are eliminated, your ballot moves to your next choice.</p>`
              : `<p class="fine">${post.seats} seats. Mark everyone you would be happy to see elected.</p>`
          }
          ${post.candidates.map((c) => candidateRow(post, c)).join('')}
          ${picks.length === 0 ? `<p class="abstained">Left blank &mdash; counted as an abstention.</p>` : ''}
        </section>`;
    })
    .join('');

  return `
    <header class="masthead">
      <div class="masthead-body">
        <h1>Your ballot</h1>
        <p class="lede">${esc(state.user.name)} &middot; ${esc(state.user.yearLevel)}</p>
      </div>
      <aside class="stub">
        <span class="stub-label">Marked</span>
        <span class="stub-code">${marked} of ${state.positions.length}</span>
        <span class="fine">Blank posts are allowed.</span>
      </aside>
    </header>
    ${posts}
    <div class="actionbar">
      <span class="fine">Nothing is recorded until you seal the ballot.</span>
      <button id="to-review">Review ballot</button>
    </div>`;
}

function reviewView() {
  const lines = state.positions
    .map((post) => {
      const picks = state.choices[post.id] || [];
      const names = picks.map((id) => {
        const c = post.candidates.find((x) => x.id === id);
        return esc(c.name);
      });
      const body = names.length
        ? post.method === 'irv'
          ? names.map((n, i) => `${i + 1}. ${n}`).join('<br>')
          : names.join('<br>')
        : '<span class="abstained">Abstain</span>';
      return `
        <section class="post">
          <div class="post-head"><h2>${esc(post.title)}</h2>
            <button class="quiet" data-edit="${post.id}">Change</button></div>
          <p>${body}</p>
        </section>`;
    })
    .join('');

  return `
    <h1>Check before you seal</h1>
    <p class="lede">Once sealed, a ballot cannot be opened, changed or withdrawn &mdash; not by you, not by the committee.</p>
    ${lines}
    <p id="err" class="error"></p>
    <div class="actionbar">
      <button class="ghost" id="back-ballot">Keep editing</button>
      <button class="seal" id="seal">Seal my ballot</button>
    </div>`;
}

function receiptView() {
  const r = state.receipt;
  return `
    <header class="masthead torn">
      <div class="masthead-body">
        <h1>Ballot sealed</h1>
        <p class="lede">Your vote is in the count. Your name is not attached to it anywhere.</p>
      </div>
      <aside class="stub">
        <span class="stub-label">Serial</span>
        <span class="stub-code">${esc(r.serial)}</span>
      </aside>
    </header>

    <h2>Keep this receipt</h2>
    <p>Write it down or screenshot it. After the count, paste it into the receipt checker to confirm your ballot is still in the sealed pile.</p>
    <div class="box good">
      <span class="stub-label">Receipt code</span>
      <div class="stub-code">${esc(r.receipt)}</div>
    </div>
    <p class="fine">The receipt proves your ballot exists and was not removed. It does not reveal who you voted for, so nobody can use it to pressure or pay you.</p>
    <div class="row" style="margin-top:1.4rem">
      <button id="to-verify">Check it now</button>
      <button class="ghost" id="signout">Done</button>
    </div>`;
}

function verifyView() {
  return `
    <h1>Receipt checker</h1>
    <p class="lede">Paste the code from your ballot stub. Anyone can do this, at any time, without signing in.</p>
    <div class="field">
      <label for="rc">Receipt code</label>
      <input id="rc" type="text" autocomplete="off">
    </div>
    <div class="row"><button id="check">Check receipt</button>
      <button class="ghost" id="home">Back</button></div>
    <div id="verdict"></div>`;
}

function bars(rows, { majorityAt, winners = [], out = [], seats } = {}) {
  const max = Math.max(...rows.map((r) => r.votes), 1);
  return rows
    .map((r, i) => {
      const cls = winners.includes(r.candidateId) ? 'win' : out.includes(r.candidateId) ? 'out' : '';
      const cut = seats && i === seats - 1 ? `<div class="seat-cut">Last seat filled here</div>` : '';
      return `
        <div class="bar-row ${cls}">
          <div class="bar-top"><span>${esc(r.name)} <span class="cand-meta">${esc(r.party)}</span></span>
            <span>${r.votes} &middot; ${r.share}%</span></div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(r.votes / max) * 100}%"></div>
            ${majorityAt ? `<div class="majority-line" style="left:${Math.min((majorityAt / max) * 100, 100)}%" title="majority"></div>` : ''}
          </div>
        </div>${cut}`;
    })
    .join('');
}

function resultsView() {
  const d = state.data;
  const blocks = d.results
    .map((r) => {
      const winnerIds = r.winners.map((w) => w.id);
      if (r.method === 'approval') {
        return `
          <section class="post">
            <div class="post-head"><h2>${esc(r.title)}</h2>
              <span class="post-rule">${r.seats} seats &middot; approval</span></div>
            ${bars(r.standing, { winners: winnerIds, seats: r.seats })}
            <p class="fine">${r.abstentions} ballots left this post blank.</p>
          </section>`;
      }
      const rounds = r.rounds
        .map((rd, i) => {
          const elim = (rd.eliminated || []).map((e) => e.id);
          const last = i === r.rounds.length - 1;
          return `
            <div class="round">
              <div class="round-label">Round ${rd.round} &middot; ${rd.active} ballots counting &middot; ${rd.majorityNeeded} needed to win</div>
              ${bars(rd.counts, { majorityAt: rd.majorityNeeded, winners: last ? winnerIds : [], out: elim })}
              ${elim.length ? `<p class="fine">Eliminated: ${rd.eliminated.map((e) => esc(e.name)).join(', ')}. These ballots move to their next choice.</p>` : ''}
            </div>`;
        })
        .join('');
      const verdict = r.tie
        ? `<p class="error">Tied: ${r.tie.map((t) => esc(t.name)).join(' and ')}. Resolve by drawing lots before the committee.</p>`
        : `<p><span class="won">${esc(r.winners[0]?.name || 'No winner')}</span> wins with a majority of the ballots still counting.</p>`;
      return `
        <section class="post">
          <div class="post-head"><h2>${esc(r.title)}</h2>
            <span class="post-rule">${r.rounds.length} round${r.rounds.length > 1 ? 's' : ''} &middot; instant runoff</span></div>
          ${verdict}
          ${rounds}
          <p class="fine">${r.abstentions} ballots left this post blank.</p>
        </section>`;
    })
    .join('');

  return `
    <h1>Results</h1>
    <p class="lede">${d.turnout.voted} of ${d.turnout.registered} students voted &mdash; ${d.turnout.percent}% turnout.</p>
    <div class="box ${d.chain.ok && d.turnout.reconciled ? 'good' : 'bad'}">
      ${
        d.chain.ok && d.turnout.reconciled
          ? `<strong>Count checks out.</strong> Sealed ballots match the roster exactly (${d.turnout.sealed} and ${d.turnout.voted}), and the ${d.chain.entries} log entries still hash in sequence.`
          : `<strong>Do not certify this count.</strong> Ballots and roster disagree, or the log was altered. Stop and investigate before announcing anything.`
      }
    </div>
    ${blocks}
    <div class="actionbar"><button class="ghost" id="home">Back</button></div>`;
}

function committeeView() {
  const d = state.data;
  const t = d.turnout;
  return `
    <h1>Election committee</h1>
    <p class="lede">Signed in as ${esc(state.user.name)}.</p>
    <div class="stats">
      <div><div class="num">${t.voted}</div><div class="stat-label">Ballots cast</div></div>
      <div><div class="num">${t.percent}%</div><div class="stat-label">Turnout</div></div>
      <div><div class="num">${t.registered - t.voted}</div><div class="stat-label">Yet to vote</div></div>
      <div><div class="num">${d.chain.entries}</div><div class="stat-label">Log entries</div></div>
    </div>

    <div class="box ${t.reconciled ? 'good' : 'bad'}">
      <strong>${t.reconciled ? 'Roster and ballot box agree.' : 'Roster and ballot box disagree.'}</strong>
      <div class="fine">${t.voted} students are marked as having voted; ${t.sealed} sealed ballots are in the box.</div>
    </div>
    <div class="box ${d.chain.ok ? 'good' : 'bad'}">
      <strong>${d.chain.ok ? 'Audit log intact.' : `Audit log broken at entry ${d.chain.brokenAt}.`}</strong>
      <div class="fine hash">Chain head ${esc(d.chain.head || '')}</div>
    </div>

    <h2>Controls</h2>
    <div class="row" style="margin:0.8rem 0 1.6rem">
      <button id="toggle-open">${d.open ? 'Close voting' : 'Reopen voting'}</button>
      <button class="ghost" id="toggle-pub">${d.published ? 'Unpublish results' : 'Publish results to students'}</button>
      <button class="ghost" id="see-results">View count</button>
    </div>

    <h2>Recent log</h2>
    <table class="log"><tbody>
      ${d.entries
        .slice(0, 15)
        .map(
          (e) => `<tr><td>${e.seq}</td><td>${esc(e.event)}</td>
            <td class="hash">${esc(e.entry_hash.slice(0, 16))}&hellip;</td></tr>`
        )
        .join('')}
    </tbody></table>
    <div class="actionbar"><button class="ghost" id="signout">Sign out</button></div>`;
}

/* -------------------------------------------------------------- rendering */

function render() {
  const views = {
    signin: signinView,
    ballot: ballotView,
    review: reviewView,
    receipt: receiptView,
    verify: verifyView,
    results: resultsView,
    committee: committeeView
  };
  app.innerHTML = views[state.view]();
  wire();
}

function on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

function wire() {
  on('to-verify', () => go('verify'));
  on('home', () => go(state.token ? (state.user.role === 'committee' ? 'committee' : 'ballot') : 'signin'));
  on('back-ballot', () => go('ballot'));
  on('to-review', () => go('review'));
  on('signout', () => { state.token = null; state.user = null; state.choices = {}; go('signin'); });

  on('signin', async () => {
    const studentNo = document.getElementById('sn').value;
    const accessCode = document.getElementById('ac').value;
    try {
      const me = await api('/api/login', { method: 'POST', body: { studentNo, accessCode } });
      state.token = me.token;
      state.user = me;
      if (me.role === 'committee') return loadCommittee();
      if (me.hasVoted) return fail('Our roster already records a ballot for you. If that is wrong, see the committee.');
      const b = await api('/api/ballot');
      state.positions = b.positions;
      state.choices = Object.fromEntries(b.positions.map((p) => [p.id, []]));
      if (!b.open) return fail('Voting is closed.');
      go('ballot');
    } catch (e) {
      fail(e.message);
    }
  });

  document.querySelectorAll('.pick').forEach((btn) =>
    btn.addEventListener('click', () => {
      const post = state.positions.find((p) => p.id === btn.dataset.post);
      const picks = state.choices[post.id];
      const at = picks.indexOf(btn.dataset.cand);
      if (at !== -1) picks.splice(at, 1);
      else if (post.method === 'approval' && picks.length >= post.seats)
        return toast(`${post.title} allows ${post.seats}. Unmark one first.`);
      else picks.push(btn.dataset.cand);
      render();
    })
  );

  document.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => go('ballot'))
  );

  on('seal', async () => {
    try {
      state.receipt = await api('/api/vote', { method: 'POST', body: { choices: state.choices } });
      state.token = null;
      go('receipt');
    } catch (e) {
      fail(e.message);
    }
  });

  on('check', async () => {
    const receipt = document.getElementById('rc').value;
    const out = document.getElementById('verdict');
    try {
      const r = await api('/api/verify', { method: 'POST', body: { receipt } });
      out.innerHTML = r.found
        ? `<div class="box good"><strong>Found.</strong><div class="fine">Ballot ${esc(r.serial)}, sealed ${new Date(r.sealed_at).toLocaleString()}. It is in the count.</div></div>`
        : `<div class="box bad"><strong>Not found.</strong><div class="fine">No sealed ballot carries that code. Check for a typo, then report it to the committee.</div></div>`;
    } catch (e) {
      out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  });

  on('toggle-open', async () => {
    await api('/api/admin/election', { method: 'POST', body: { open: !state.data.open } });
    loadCommittee();
  });
  on('toggle-pub', async () => {
    await api('/api/admin/election', { method: 'POST', body: { publishResults: !state.data.published } });
    loadCommittee();
  });
  on('see-results', async () => {
    state.data = await api('/api/results');
    go('results');
  });
}

function fail(message) {
  const el = document.getElementById('err');
  if (el) el.textContent = message;
  else toast(message);
}

async function loadCommittee() {
  const [audit, status] = await Promise.all([api('/api/admin/audit'), api('/api/status')]);
  state.data = { ...audit, open: status.open, published: status.resultsPublished };
  go('committee');
}

render();
