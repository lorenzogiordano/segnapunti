import { FORMAT_NAME, FORMAT_VERSION, type Match, type MatchEvent, type MatchState } from "./types";

export interface MatchFile {
  format: string;
  version: number;
  match: Match;
  events: MatchEvent[];
}

export function exportMatch(match: Match, events: MatchEvent[]): MatchFile {
  return { format: FORMAT_NAME, version: FORMAT_VERSION, match, events: [...events].sort((a, b) => a.seq - b.seq) };
}

export class MatchFileError extends Error {}

/** Reads a match file; a file from a newer app is refused instead of being guessed at. */
export function parseMatchFile(text: string): MatchFile {
  let data: Partial<MatchFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MatchFileError("Questo non è un file di partita.");
  }
  if (data?.format !== FORMAT_NAME) throw new MatchFileError("Questo non è un file di partita.");
  if (typeof data.version !== "number" || data.version > FORMAT_VERSION) {
    throw new MatchFileError("Il file viene da una versione più nuova dell'app: aggiorna l'app e riprova.");
  }
  if (!data.match?.id || !Array.isArray(data.events)) throw new MatchFileError("Il file della partita è incompleto.");
  return data as MatchFile;
}

/** Events of `incoming` not already known by id: importing twice adds nothing. */
export function newEvents(existing: MatchEvent[], incoming: MatchEvent[]): MatchEvent[] {
  const known = new Set(existing.map((e) => e.id));
  return incoming.filter((e) => !known.has(e.id));
}

/** Text for the league's WhatsApp group: home team first, sets won, partials. */
export function resultText(match: Match, state: MatchState): string {
  const partials = state.sets.map((s) => `${s.home}-${s.guest}`).join(", ");
  const score = `${state.setsWon.home}-${state.setsWon.guest}`;
  return `${match.home.name} – ${match.guest.name} ${score}${partials ? ` (${partials})` : ""}`;
}

const safe = (name: string): string => name.replace(/[\\/:*?"<>|]/g, "").trim();

export function localDate(match: Match): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: match.timeZone }).format(match.createdAt);
}

export function fileName(match: Match, state: MatchState): string {
  return `${localDate(match)} ${safe(match.home.name)} - ${safe(match.guest.name)} ${state.setsWon.home}-${state.setsWon.guest}`;
}
