import { liveSnapshot, replay, type Match, type MatchEvent } from "@segnapunti/engine";
import { deleteMatch, getValue, listMatches, loadEvents, setValue } from "./db";

export const LIVE_URL: string = import.meta.env.VITE_LIVE_URL ?? "";

/** Stays on this device: the key is what lets it write, so it never goes in the match file. */
export interface Live {
  code: string;
  key: string;
  dirty: boolean;
  sentAt: number | null;
}

const slot = (matchId: string): string => `live:${matchId}`;

export const liveOf = (matchId: string): Promise<Live | undefined> => getValue<Live>(slot(matchId));

export const liveLink = (live: Live): string => `${LIVE_URL}/s/${live.code}`;

function random(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function enableLive(matchId: string): Promise<Live> {
  const known = await liveOf(matchId);
  if (known) return known;
  const live: Live = { code: random(16), key: random(24), dirty: true, sentAt: null };
  await setValue(slot(matchId), live);
  return live;
}

const sending = new Map<string, Promise<boolean>>();
const again = new Set<string>();

async function send(match: Match, events: MatchEvent[], live: Live): Promise<boolean> {
  try {
    const response = await fetch(`${LIVE_URL}/partite/${live.code}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${live.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(liveSnapshot(match, events)),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Sends the latest copy. Points arriving during a send are covered by one more send right after. */
export async function pushLive(match: Match, events: MatchEvent[]): Promise<boolean> {
  const running = sending.get(match.id);
  if (running) {
    again.add(match.id);
    return running;
  }
  const live = await liveOf(match.id);
  if (!live) return true;
  const work = (async () => {
    await setValue(slot(match.id), { ...live, dirty: true });
    const ok = await send(match, events, live);
    await setValue(slot(match.id), { ...live, dirty: !ok, sentAt: ok ? Date.now() : live.sentAt });
    return ok;
  })();
  sending.set(match.id, work);
  const ok = await work;
  sending.delete(match.id);
  if (again.delete(match.id)) return pushLive(match, events);
  return ok;
}

/** Sends what the board could not: a match finished without network goes out once it is back. */
export async function flushLive(): Promise<void> {
  if (!LIVE_URL) return;
  for (const match of await listMatches()) {
    const live = await liveOf(match.id);
    if (live?.dirty) await pushLive(match, await loadEvents(match.id));
  }
}

export async function disableLive(matchId: string): Promise<boolean> {
  const live = await liveOf(matchId);
  if (!live) return true;
  try {
    const response = await fetch(`${LIVE_URL}/partite/${live.code}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${live.key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  await setValue(slot(matchId), null);
  return true;
}

/** Deletes a match and tries to take its public page down with it. */
export async function removeMatch(matchId: string): Promise<{ linkStillOnline: boolean }> {
  const offline = (await liveOf(matchId)) ? !(await disableLive(matchId)) : false;
  await deleteMatch(matchId);
  return { linkStillOnline: offline };
}

export function shareText(match: Match, events: MatchEvent[]): string {
  const { setsWon } = replay(match, events).state;
  return `${match.home.name} ${setsWon.home}–${setsWon.guest} ${match.guest.name}: segui la partita`;
}
