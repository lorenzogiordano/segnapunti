import { setWinner, targetFor } from "./rules";
import type { Match, MatchEvent, MatchState, Replay, Step, Team } from "./types";

function initialState(match: Match): MatchState {
  const start = match.start;
  const sets = start ? start.sets.map((s) => ({ ...s })) : [];
  const setsWon = { home: 0, guest: 0 };
  for (const s of sets) setsWon[s.home > s.guest ? "home" : "guest"] += 1;
  const state: MatchState = {
    sets,
    setIndex: sets.length,
    home: start?.home ?? 0,
    guest: start?.guest ?? 0,
    setsWon,
    timeoutsUsed: { home: 0, guest: 0 },
    serving: null,
    timeoutRunning: null,
    over: false,
    winner: null,
  };
  closeIfWon(match, state);
  return state;
}

function closeIfWon(match: Match, state: MatchState): "setClosed" | "matchClosed" | null {
  const target = targetFor(match.rules, state.setIndex);
  const winner = setWinner(state.home, state.guest, target, match.rules.minLead);
  if (!winner) return null;
  state.sets.push({ home: state.home, guest: state.guest });
  state.setsWon[winner] += 1;
  state.timeoutRunning = null;
  if (state.setsWon[winner] >= match.rules.setsToWin) {
    state.over = true;
    state.winner = winner;
    return "matchClosed";
  }
  state.setIndex += 1;
  state.home = 0;
  state.guest = 0;
  state.timeoutsUsed = { home: 0, guest: 0 };
  state.serving = null;
  return "setClosed";
}

/** Events still in force: each undo removes its target, which must be the last active event. */
export function activeEvents(events: MatchEvent[]): { active: MatchEvent[]; ignored: MatchEvent[] } {
  const active: MatchEvent[] = [];
  const ignored: MatchEvent[] = [];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type !== "undo") {
      active.push(event);
    } else if (active[active.length - 1]?.id === event.target) {
      active.pop();
    } else {
      ignored.push(event);
    }
  }
  return { active, ignored };
}

/** Rebuilds the whole match from its log: nothing but the log is ever stored. */
export function replay(match: Match, events: MatchEvent[]): Replay {
  const { active, ignored } = activeEvents(events);
  const state = initialState(match);
  const steps: Step[] = [];

  for (const event of active) {
    const setIndex = state.setIndex;
    let effect: Step["effect"] = "ignored";

    if (event.type === "point" && !state.over) {
      state[event.team] += 1;
      state.serving = event.team;
      state.timeoutRunning = null;
      const closed = closeIfWon(match, state);
      const scored = { home: state.home, guest: state.guest };
      if (closed) Object.assign(scored, state.sets[state.sets.length - 1]);
      effect = closed ?? "point";
      steps.push({ event, effect, setIndex, ...scored });
      continue;
    }
    if (event.type === "timeout" && !state.over && state.timeoutsUsed[event.team] < match.rules.timeoutsPerSet) {
      state.timeoutsUsed[event.team] += 1;
      state.timeoutRunning = { team: event.team, t: event.t };
      effect = "timeout";
    } else if (event.type === "timeoutEnd" && state.timeoutRunning?.team === event.team) {
      state.timeoutRunning = null;
      effect = "timeoutEnd";
    }

    if (effect === "ignored") ignored.push(event);
    else steps.push({ event, effect, setIndex, home: state.home, guest: state.guest });
  }

  return { steps, state, ignored };
}

export const teamName = (match: Match, team: Team): string => match[team].name;
