import type { Match, MatchEvent } from "@segnapunti/engine";

// The database version stays 1: format versions live inside the records, so going
// back to an older app can never lock the data away.
const NAME = "segnapunti";

type Stored = MatchEvent & { matchId: string };

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("matches", { keyPath: "id" });
      db.createObjectStore("events", { keyPath: "id" }).createIndex("match", "matchId");
      db.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

/** Runs writes in one transaction and resolves only when they are on disk. */
async function write(stores: string[], work: (tx: IDBTransaction) => void): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite", { durability: "strict" });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    work(tx);
  });
}

async function read<T>(store: string, query: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = query(db.transaction(store).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const saveMatch = (match: Match): Promise<void> => write(["matches"], (tx) => tx.objectStore("matches").put(match));

export const appendEvent = (matchId: string, event: MatchEvent): Promise<void> =>
  write(["events"], (tx) => tx.objectStore("events").add({ ...event, matchId }));

export const addEvents = (matchId: string, events: MatchEvent[]): Promise<void> =>
  write(["events"], (tx) => {
    for (const event of events) tx.objectStore("events").put({ ...event, matchId });
  });

export const loadMatch = (id: string): Promise<Match | undefined> => read("matches", (s) => s.get(id));

export const listMatches = (): Promise<Match[]> => read("matches", (s) => s.getAll());

export async function loadEvents(matchId: string): Promise<MatchEvent[]> {
  const stored = await read<Stored[]>("events", (s) => s.index("match").getAll(matchId));
  return stored.map(({ matchId: _, ...event }) => event as MatchEvent).sort((a, b) => a.seq - b.seq);
}

/** Removes a match for good: its record, every event and what this device kept about it. */
export async function deleteMatch(matchId: string): Promise<void> {
  const db = await open();
  const ids = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db.transaction("events").objectStore("events").index("match").getAllKeys(matchId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await write(["matches", "events", "kv"], (tx) => {
    tx.objectStore("matches").delete(matchId);
    for (const id of ids) tx.objectStore("events").delete(id);
    tx.objectStore("kv").delete(`live:${matchId}`);
  });
  if ((await getValue<string | null>("openMatch")) === matchId) await setValue("openMatch", null);
}

export const getValue = <T>(key: string): Promise<T | undefined> => read("kv", (s) => s.get(key));

export const setValue = (key: string, value: unknown): Promise<void> => write(["kv"], (tx) => tx.objectStore("kv").put(value, key));

export async function deviceId(): Promise<string> {
  const known = await getValue<string>("device");
  if (known) return known;
  const id = crypto.randomUUID();
  await setValue("device", id);
  return id;
}
