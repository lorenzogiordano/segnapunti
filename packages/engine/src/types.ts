export const FORMAT_NAME = "misto-e-bello-match";
export const FORMAT_VERSION = 1;

export type Team = "home" | "guest";

export interface TeamInfo {
  name: string;
  color: string;
}

export interface Rules {
  setsToWin: number;
  pointsPerSet: number;
  pointsLastSet: number;
  minLead: number;
  timeoutsPerSet: number;
  timeoutSeconds: number;
}

export interface SetScore {
  home: number;
  guest: number;
}

/** Declared state a match starts from when it continues on another device. */
export interface StartState extends SetScore {
  sets: SetScore[];
}

export interface Match {
  id: string;
  createdAt: number;
  timeZone: string;
  home: TeamInfo;
  guest: TeamInfo;
  us: Team | null;
  scoring: "official" | "copy";
  rules: Rules;
  left: Team;
  start: StartState | null;
  setTimes: { start: number; end: number }[] | null;
  device: string;
  appVersion: string;
}

interface EventBase {
  id: string;
  seq: number;
  /** Moment of the event in UTC ms; null for points imported from the old app. */
  t: number | null;
  /** Minutes to add to UTC to get local time. */
  tz: number;
}

export type MatchEvent =
  | (EventBase & { type: "point"; team: Team })
  | (EventBase & { type: "timeout"; team: Team })
  | (EventBase & { type: "timeoutEnd"; team: Team })
  | (EventBase & { type: "undo"; target: string });

export type Effect =
  | "point"
  | "setClosed"
  | "matchClosed"
  | "timeout"
  | "timeoutEnd"
  | "undo"
  | "ignored";

export interface MatchState {
  /** Closed sets, in order. */
  sets: SetScore[];
  /** Number of the set in progress, from 0. */
  setIndex: number;
  home: number;
  guest: number;
  setsWon: Record<Team, number>;
  timeoutsUsed: Record<Team, number>;
  serving: Team | null;
  /** Team whose time-out has not been ended by "Si riprende". */
  timeoutRunning: { team: Team; t: number | null } | null;
  over: boolean;
  winner: Team | null;
}

export interface Step {
  event: MatchEvent;
  effect: Effect;
  /** Set the event belongs to, from 0. */
  setIndex: number;
  /** Score of that set after the event. */
  home: number;
  guest: number;
}

export interface Replay {
  /** Active events only, in order, with their effect. */
  steps: Step[];
  state: MatchState;
  /** Events the rules did not accept, such as a third time-out. */
  ignored: MatchEvent[];
}
