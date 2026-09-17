/**
 * Counting rules for the SSG election.
 *
 * Single-seat posts (President, VP, Secretary, Treasurer, Auditor, PIO) use
 * instant-runoff. A voter ranks as many candidates as they like. If nobody has
 * more than half the continuing ballots, the last-placed candidate is dropped
 * and those ballots move to their next surviving choice. This is what makes the
 * result "accurate": the winner is the one a majority prefers over the field,
 * not just whoever placed first in a split three-way race.
 *
 * Multi-seat posts (Representatives) use approval voting. A voter marks every
 * candidate they would be content to have in office, up to the number of seats,
 * and the highest approval totals fill the seats.
 *
 * Both functions are pure: same ballots in, same result out. Nothing here
 * touches the database, so the count can be re-run and re-checked by anyone.
 */

/** @param {string[][]} rankedBallots each ballot is an ordered list of candidate ids */
export function instantRunoff(rankedBallots, candidateIds) {
  let continuing = new Set(candidateIds);
  const rounds = [];
  const ballots = rankedBallots.filter((b) => b.length > 0);

  while (true) {
    const counts = new Map([...continuing].map((id) => [id, 0]));
    let exhausted = 0;

    for (const ballot of ballots) {
      const top = ballot.find((id) => continuing.has(id));
      if (top === undefined) exhausted += 1;
      else counts.set(top, counts.get(top) + 1);
    }

    const active = ballots.length - exhausted;
    const standing = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [leader, leaderVotes] = standing[0];
    const majority = Math.floor(active / 2) + 1;

    const round = {
      round: rounds.length + 1,
      active,
      exhausted,
      majorityNeeded: majority,
      counts: standing.map(([id, votes]) => ({
        candidateId: id,
        votes,
        share: active ? +((votes / active) * 100).toFixed(2) : 0
      })),
      eliminated: null
    };

    if (leaderVotes >= majority || continuing.size <= 2 || active === 0) {
      rounds.push(round);
      const runnerUp = standing[1];
      const tied = runnerUp && runnerUp[1] === leaderVotes;
      return {
        method: 'irv',
        winners: tied ? [] : [leader],
        tie: tied ? standing.filter(([, v]) => v === leaderVotes).map(([id]) => id) : null,
        rounds
      };
    }

    const lowest = standing[standing.length - 1][1];
    const bottom = standing.filter(([, v]) => v === lowest).map(([id]) => id);
    // Tie at the bottom: drop them together only if that cannot change who leads.
    const dropped = bottom.length * lowest < standing[standing.length - 2][1] ? bottom : [bottom[0]];
    round.eliminated = dropped;
    rounds.push(round);
    dropped.forEach((id) => continuing.delete(id));
  }
}

/** @param {string[][]} approvalBallots each ballot is an unordered list of approved ids */
export function approval(approvalBallots, candidateIds, seats) {
  const counts = new Map(candidateIds.map((id) => [id, 0]));
  for (const ballot of approvalBallots) {
    for (const id of new Set(ballot)) {
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
  }
  const voters = approvalBallots.filter((b) => b.length > 0).length;
  const standing = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([candidateId, votes]) => ({
      candidateId,
      votes,
      share: voters ? +((votes / voters) * 100).toFixed(2) : 0
    }));

  const cutoff = standing[seats - 1]?.votes ?? 0;
  const atCutoff = standing.filter((c) => c.votes === cutoff);
  const above = standing.filter((c) => c.votes > cutoff);
  const tie = above.length + atCutoff.length > seats ? atCutoff.map((c) => c.candidateId) : null;

  return {
    method: 'approval',
    winners: tie ? above.map((c) => c.candidateId) : standing.slice(0, seats).map((c) => c.candidateId),
    tie,
    seats,
    standing
  };
}
