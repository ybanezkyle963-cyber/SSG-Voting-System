/**
 * Counting rules, ported from `server/tally.js`.
 *
 * These are deliberately the same pure functions the server runs, so the screen
 * can re-derive the count from the published ballots and check the committee's
 * numbers rather than take them on faith.
 */

export interface RoundCount {
  candidateId: string
  votes: number
  share: number
}

export interface CountRound {
  round: number
  active: number
  exhausted: number
  majorityNeeded: number
  counts: RoundCount[]
  eliminated: string[] | null
}

export interface IrvOutcome {
  method: 'irv'
  winners: string[]
  tie: string[] | null
  rounds: CountRound[]
}

export interface ApprovalOutcome {
  method: 'approval'
  winners: string[]
  tie: string[] | null
  seats: number
  standing: RoundCount[]
}

/** Single-seat posts. Each ballot is an ordered list of candidate ids. */
export function instantRunoff(rankedBallots: string[][], candidateIds: string[]): IrvOutcome {
  const continuing = new Set(candidateIds)
  const rounds: CountRound[] = []
  const ballots = rankedBallots.filter((b) => b.length > 0)

  for (;;) {
    const counts = new Map<string, number>([...continuing].map((id) => [id, 0]))
    let exhausted = 0

    for (const ballot of ballots) {
      const top = ballot.find((id) => continuing.has(id))
      if (top === undefined) exhausted += 1
      else counts.set(top, (counts.get(top) ?? 0) + 1)
    }

    const active = ballots.length - exhausted
    const standing: [string, number][] = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )
    const [leader, leaderVotes] = standing[0]
    const majority = Math.floor(active / 2) + 1

    const round: CountRound = {
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
    }

    if (leaderVotes >= majority || continuing.size <= 2 || active === 0) {
      rounds.push(round)
      const runnerUp = standing[1]
      const tied = !!runnerUp && runnerUp[1] === leaderVotes
      return {
        method: 'irv',
        winners: tied ? [] : [leader],
        tie: tied ? standing.filter(([, v]) => v === leaderVotes).map(([id]) => id) : null,
        rounds
      }
    }

    const lowest = standing[standing.length - 1][1]
    const bottom = standing.filter(([, v]) => v === lowest).map(([id]) => id)
    // Tie at the bottom: drop them together only if that cannot change who leads.
    const dropped = bottom.length * lowest < standing[standing.length - 2][1] ? bottom : [bottom[0]]
    round.eliminated = dropped
    rounds.push(round)
    dropped.forEach((id) => continuing.delete(id))
  }
}

/** Multi-seat posts. Each ballot is an unordered list of approved ids. */
export function approval(
  approvalBallots: string[][],
  candidateIds: string[],
  seats: number
): ApprovalOutcome {
  const counts = new Map<string, number>(candidateIds.map((id) => [id, 0]))
  for (const ballot of approvalBallots) {
    for (const id of new Set(ballot)) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  const voters = approvalBallots.filter((b) => b.length > 0).length
  const standing: RoundCount[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([candidateId, votes]) => ({
      candidateId,
      votes,
      share: voters ? +((votes / voters) * 100).toFixed(2) : 0
    }))

  const cutoff = standing[seats - 1]?.votes ?? 0
  const atCutoff = standing.filter((c) => c.votes === cutoff)
  const above = standing.filter((c) => c.votes > cutoff)
  const tie = above.length + atCutoff.length > seats ? atCutoff.map((c) => c.candidateId) : null

  return {
    method: 'approval',
    winners: tie ? above.map((c) => c.candidateId) : standing.slice(0, seats).map((c) => c.candidateId),
    tie,
    seats,
    standing
  }
}
