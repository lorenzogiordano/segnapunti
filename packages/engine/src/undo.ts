import { activeEvents, replay } from "./replay";
import type { Match, MatchEvent, SetScore, Team } from "./types";

export const REDO_WINDOW_MS = 20_000;

export type UndoPlan =
  | { kind: "point"; target: MatchEvent; team: Team; before: SetScore; after: SetScore }
  | { kind: "reopenSet"; target: MatchEvent; team: Team; setIndex: number; score: SetScore }
  | { kind: "reopenMatch"; target: MatchEvent; team: Team; setIndex: number; score: SetScore }
  | { kind: "timeout"; target: MatchEvent; team: Team }
  | { kind: "timeoutEnd"; target: MatchEvent; team: Team };

/** What the next Annulla would do, for the label on the button. */
export function nextUndo(match: Match, events: MatchEvent[]): UndoPlan | null {
  const steps = replay(match, events).steps;
  const last = steps[steps.length - 1];
  if (!last) return null;
  const { event, effect } = last;
  if (event.type === "undo") return null;
  if (event.type === "timeout") return { kind: "timeout", target: event, team: event.team };
  if (event.type === "timeoutEnd") return { kind: "timeoutEnd", target: event, team: event.team };

  const after = { home: last.home, guest: last.guest };
  const before = { ...after, [event.team]: after[event.team] - 1 };
  if (effect === "setClosed") {
    return { kind: "reopenSet", target: event, team: event.team, setIndex: last.setIndex, score: before };
  }
  if (effect === "matchClosed") {
    return { kind: "reopenMatch", target: event, team: event.team, setIndex: last.setIndex, score: before };
  }
  return { kind: "point", target: event, team: event.team, before: after, after: before };
}

/**
 * Moment to store for a new point. A point given right after undoing another one
 * corrects it, so it keeps the original moment: on the video it changes at the right time.
 */
export function pointTime(events: MatchEvent[], now: number): number {
  const last = [...events].sort((a, b) => a.seq - b.seq).pop();
  if (last?.type !== "undo" || last.t === null || now - last.t > REDO_WINDOW_MS) return now;
  const target = events.find((e) => e.id === last.target);
  return target?.type === "point" && target.t !== null ? target.t : now;
}

export { activeEvents };
