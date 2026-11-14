import { replay } from "./replay";
import type { Match, MatchEvent, SetScore, Step, Team } from "./types";

export interface Run {
  team: Team;
  length: number;
  from: SetScore;
  to: SetScore;
}

export interface PointStep {
  team: Team;
  home: number;
  guest: number;
  t: number | null;
}

export interface SetStats {
  index: number;
  home: number;
  guest: number;
  winner: Team | null;
  points: PointStep[];
  /** Index in `points` after which each time-out was called. */
  timeouts: { team: Team; afterPoint: number }[];
  runs: Run[];
  bestRun: Record<Team, Run | null>;
  maxLead: Record<Team, number>;
  ties: number;
  leadChanges: number;
  /** From the first to the last point, in ms; null without times. */
  durationMs: number | null;
  firstT: number | null;
  lastT: number | null;
}

export interface GapBand {
  label: string;
  home: number;
  guest: number;
}

export interface GapStats {
  count: number;
  medianMs: number | null;
  bands: GapBand[];
}

export interface MatchStats {
  sets: SetStats[];
  points: Record<Team, number>;
  gaps: GapStats;
  /** Points played before the match reached this device. */
  undetailed: boolean;
}

const BANDS = [
  { label: "sotto i 20 s", max: 20_000 },
  { label: "da 20 a 40 s", max: 40_000 },
  { label: "oltre i 40 s", max: Infinity },
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function setStats(index: number, steps: Step[], start: SetScore, winnerScore: SetScore | null): SetStats {
  const points: PointStep[] = [];
  const timeouts: SetStats["timeouts"] = [];
  for (const step of steps) {
    if (step.event.type === "point") {
      points.push({ team: step.event.team, home: step.home, guest: step.guest, t: step.event.t });
    } else if (step.event.type === "timeout") {
      timeouts.push({ team: step.event.team, afterPoint: points.length });
    }
  }

  const runs: Run[] = [];
  const maxLead = { home: Math.max(0, start.home - start.guest), guest: Math.max(0, start.guest - start.home) };
  let ties = 0;
  let leadChanges = 0;
  let leader = Math.sign(start.home - start.guest);
  let previous: SetScore = start;
  for (const point of points) {
    const run = runs[runs.length - 1];
    const score = { home: point.home, guest: point.guest };
    if (run?.team === point.team) {
      run.length += 1;
      run.to = score;
    } else {
      runs.push({ team: point.team, length: 1, from: previous, to: score });
    }
    previous = score;

    const lead = point.home - point.guest;
    maxLead.home = Math.max(maxLead.home, lead);
    maxLead.guest = Math.max(maxLead.guest, -lead);
    const sign = Math.sign(lead);
    if (sign === 0) ties += 1;
    else {
      if (leader !== 0 && sign !== leader) leadChanges += 1;
      leader = sign;
    }
  }

  const best = (team: Team): Run | null =>
    runs.filter((r) => r.team === team).reduce<Run | null>((a, r) => (!a || r.length > a.length ? r : a), null);
  const timed = points.filter((p) => p.t !== null).map((p) => p.t as number);
  const firstT = timed.length ? Math.min(...timed) : null;
  const lastT = timed.length ? Math.max(...timed) : null;
  const final = winnerScore ?? previous;

  return {
    index,
    home: final.home,
    guest: final.guest,
    winner: winnerScore ? (final.home > final.guest ? "home" : "guest") : null,
    points,
    timeouts,
    runs,
    bestRun: { home: best("home"), guest: best("guest") },
    maxLead,
    ties,
    leadChanges,
    durationMs: firstT !== null && lastT !== null ? lastT - firstT : null,
    firstT,
    lastT,
  };
}

function gapStats(sets: SetStats[]): GapStats {
  const gaps: { ms: number; team: Team }[] = [];
  for (const set of sets) {
    set.points.forEach((point, i) => {
      const previous = set.points[i - 1];
      if (!previous || previous.t === null || point.t === null) return;
      if (set.timeouts.some((to) => to.afterPoint === i)) return; // a time-out sits in this gap
      gaps.push({ ms: point.t - previous.t, team: point.team });
    });
  }
  let from = 0;
  const bands = BANDS.map(({ label, max }) => {
    const inBand = gaps.filter((g) => g.ms >= from && g.ms < max);
    from = max;
    return {
      label,
      home: inBand.filter((g) => g.team === "home").length,
      guest: inBand.filter((g) => g.team === "guest").length,
    };
  });
  return { count: gaps.length, medianMs: median(gaps.map((g) => g.ms)), bands };
}

export function matchStats(match: Match, events: MatchEvent[]): MatchStats {
  const { steps, state } = replay(match, events);
  const sets: SetStats[] = [];
  const lastSet = state.over ? state.sets.length - 1 : state.setIndex;
  const declared = match.start?.sets.length ?? 0;
  for (let i = 0; i <= lastSet; i += 1) {
    const closed = state.sets[i] ?? null;
    const start = i === declared && match.start ? { home: match.start.home, guest: match.start.guest } : { home: 0, guest: 0 };
    const own = steps.filter((s) => s.setIndex === i);
    if (i < declared) {
      sets.push(setStats(i, [], closed ?? start, closed));
      continue;
    }
    if (!closed && !own.length) continue; // set not started yet
    sets.push(setStats(i, own, start, closed));
  }

  const points = { home: 0, guest: 0 };
  for (const set of sets) {
    points.home += set.home;
    points.guest += set.guest;
  }
  return { sets, points, gaps: gapStats(sets), undetailed: match.start !== null };
}
