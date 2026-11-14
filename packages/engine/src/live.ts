import { replay } from "./replay";
import type { Match, MatchEvent, SetScore, Team, TeamInfo } from "./types";

/** The public copy of a match: what anyone with the link can read, and nothing else. */
export interface LiveSnapshot {
  v: 1;
  /** Last event included: an older copy arriving late never replaces a newer one. */
  seq: number;
  home: TeamInfo;
  guest: TeamInfo;
  sets: SetScore[];
  setIndex: number;
  score: SetScore;
  setsWon: Record<Team, number>;
  serving: Team | null;
  timeout: Team | null;
  over: boolean;
  winner: Team | null;
  official: boolean;
}

export function liveSnapshot(match: Match, events: MatchEvent[]): LiveSnapshot {
  const { state } = replay(match, events);
  const last = state.over ? state.sets[state.sets.length - 1] : null;
  return {
    v: 1,
    seq: events.reduce((max, e) => Math.max(max, e.seq), 0),
    home: match.home,
    guest: match.guest,
    sets: state.sets,
    setIndex: state.setIndex,
    score: last ?? { home: state.home, guest: state.guest },
    setsWon: state.setsWon,
    serving: state.serving,
    timeout: state.timeoutRunning?.team ?? null,
    over: state.over,
    winner: state.winner,
    official: match.scoring === "official",
  };
}
