import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MISTO_E_BELLO,
  exportMatch,
  fileName,
  liveSnapshot,
  matchStats,
  newEvents,
  nextUndo,
  parseMatchFile,
  pointTime,
  replay,
  resultText,
  setWinner,
  targetFor,
  type Match,
  type MatchEvent,
  type Team,
} from "../src/index";

const match = (over: Partial<Match> = {}): Match => ({
  id: "m",
  createdAt: Date.UTC(2026, 10, 2, 20),
  timeZone: "Europe/Rome",
  home: { name: "Le Bande Bassotte", color: "#1e88e5" },
  guest: { name: "Squadra Ospite", color: "#e53935" },
  us: "home",
  scoring: "official",
  rules: MISTO_E_BELLO,
  left: "home",
  start: null,
  setTimes: null,
  device: "d",
  appVersion: "test",
  ...over,
});

class Log {
  events: MatchEvent[] = [];
  now = 1_000_000;
  private add(e: Record<string, unknown>) {
    const seq = this.events.length + 1;
    this.events.push({ id: `e${seq}`, seq, t: this.now, tz: 60, ...e } as MatchEvent);
    this.now += 30_000;
    return this;
  }
  points(team: Team, n = 1) {
    for (let i = 0; i < n; i += 1) this.add({ type: "point", team });
    return this;
  }
  /** Plays a whole set: the winner reaches `to`, the loser `other`. */
  set(winner: Team, to = 25, other = 0) {
    const loser = winner === "home" ? "guest" : "home";
    return this.points(loser, other).points(winner, to);
  }
  timeout(team: Team) {
    return this.add({ type: "timeout", team });
  }
  timeoutEnd(team: Team) {
    return this.add({ type: "timeoutEnd", team });
  }
  undo() {
    const plan = nextUndo(match(), this.events);
    if (!plan) throw new Error("nothing to undo");
    return this.add({ type: "undo", target: plan.target.id });
  }
}

describe("regole", () => {
  it.each([
    [25, 23, "home"],
    [25, 24, null],
    [26, 24, "home"],
    [30, 28, "home"],
    [24, 26, "guest"],
    [24, 24, null],
  ])("set a 25: %i-%i", (h, a, winner) => {
    expect(setWinner(h, a, 25, 2)).toBe(winner);
  });

  it("il tie-break è il quinto set, a 15", () => {
    expect(targetFor(MISTO_E_BELLO, 3)).toBe(25);
    expect(targetFor(MISTO_E_BELLO, 4)).toBe(15);
    expect(setWinner(15, 13, 15, 2)).toBe("home");
    expect(setWinner(14, 14, 15, 2)).toBeNull();
    expect(setWinner(15, 14, 15, 2)).toBeNull();
  });
});

describe("rilettura del registro", () => {
  it("chiude il set e riparte da 0-0", () => {
    const { state } = replay(match(), new Log().points("home", 24).points("guest", 24).points("home", 2).events);
    expect(state.sets).toEqual([{ home: 26, guest: 24 }]);
    expect(state.setIndex).toBe(1);
    expect([state.home, state.guest]).toEqual([0, 0]);
    expect(state.setsWon.home).toBe(1);
    expect(state.serving).toBeNull();
  });

  it("3-0 finisce al terzo set e rifiuta altri punti", () => {
    const log = new Log().set("home").set("home").set("home").points("guest");
    const { state, ignored } = replay(match(), log.events);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("home");
    expect(state.sets).toHaveLength(3);
    expect(ignored).toHaveLength(1);
  });

  it("3-2 finisce al quinto, a 15 con due punti di scarto", () => {
    const log = new Log().set("home").set("guest").set("home").set("guest").points("home", 14).points("guest", 14);
    expect(replay(match(), log.events).state.over).toBe(false);
    const { state } = replay(match(), log.points("guest", 2).events);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("guest");
    expect(state.sets[4]).toEqual({ home: 14, guest: 16 });
  });

  it("il terzo time-out di un set viene rifiutato, e il set dopo riparte da zero", () => {
    const log = new Log().timeout("home").timeout("home").timeout("home");
    const first = replay(match(), log.events);
    expect(first.state.timeoutsUsed.home).toBe(2);
    expect(first.ignored).toHaveLength(1);
    expect(replay(match(), log.set("guest").events).state.timeoutsUsed.home).toBe(0);
  });

  it("segna chi batte e il time-out in corso", () => {
    const log = new Log().points("guest").timeout("home");
    const running = replay(match(), log.events).state;
    expect(running.serving).toBe("guest");
    expect(running.timeoutRunning?.team).toBe("home");
    expect(replay(match(), log.timeoutEnd("home").events).state.timeoutRunning).toBeNull();
  });

  it("l'ordine è il progressivo, mai l'orologio", () => {
    const log = new Log().points("home").points("guest");
    log.events[0]!.t = 9_999_999_999;
    const steps = replay(match(), [...log.events].reverse()).steps;
    expect(steps.map((s) => s.event.seq)).toEqual([1, 2]);
  });

  it("parte dallo stato dichiarato su un altro dispositivo", () => {
    const start = { sets: [{ home: 25, guest: 20 }], home: 18, guest: 15 };
    const m = match({ start });
    const { state } = replay(m, new Log().points("home", 7).events);
    expect(state.setsWon.home).toBe(2);
    expect(state.sets[1]).toEqual({ home: 25, guest: 15 });
    expect(matchStats(m, []).undetailed).toBe(true);
  });
});

describe("Annulla", () => {
  it("toglie un punto", () => {
    const { state } = replay(match(), new Log().points("home", 2).undo().events);
    expect(state.home).toBe(1);
  });

  it("sul punto vincente riapre il set, senza codice speciale", () => {
    const log = new Log().points("guest", 23).points("home", 24).points("guest", 1).points("guest", 1).points("guest", 1);
    expect(replay(match(), log.events).state.sets).toEqual([{ home: 24, guest: 26 }]);
    const plan = nextUndo(match(), log.events);
    expect(plan).toMatchObject({ kind: "reopenSet", setIndex: 0, score: { home: 24, guest: 25 } });
    const { state } = replay(match(), log.undo().events);
    expect(state.sets).toEqual([]);
    expect([state.home, state.guest, state.setIndex]).toEqual([24, 25, 0]);
  });

  it("dopo la fine riapre la partita", () => {
    const log = new Log().set("home").set("home").set("home");
    expect(nextUndo(match(), log.events)?.kind).toBe("reopenMatch");
    const { state } = replay(match(), log.undo().events);
    expect(state.over).toBe(false);
    expect(state.home).toBe(24);
  });

  it("si ripete attraverso due set", () => {
    const log = new Log().set("home").set("guest");
    for (let i = 0; i < 26; i += 1) log.undo();
    const { state } = replay(match(), log.events);
    expect(state.sets).toHaveLength(0);
    expect(state.home).toBe(24);
  });

  it("toglie un time-out e un 'si riprende'", () => {
    const log = new Log().timeout("home").timeoutEnd("home");
    expect(nextUndo(match(), log.events)?.kind).toBe("timeoutEnd");
    log.undo();
    expect(replay(match(), log.events).state.timeoutRunning?.team).toBe("home");
    expect(nextUndo(match(), log.events)?.kind).toBe("timeout");
    expect(replay(match(), log.undo().events).state.timeoutsUsed.home).toBe(0);
  });

  it("ignora un annulla che non colpisce l'ultimo evento", () => {
    const log = new Log().points("home", 2);
    log.events.push({ id: "x", seq: 3, t: 1, tz: 60, type: "undo", target: "e1" });
    const { state, ignored } = replay(match(), log.events);
    expect(state.home).toBe(2);
    expect(ignored).toHaveLength(1);
  });

  it("senza eventi non c'è niente da annullare", () => {
    expect(nextUndo(match(), [])).toBeNull();
  });

  it("un punto rifatto entro 20 s tiene l'orario del punto annullato", () => {
    const log = new Log().points("home");
    const original = log.events[0]!.t;
    log.undo();
    const undoneAt = log.events[1]!.t as number;
    expect(pointTime(log.events, undoneAt + 5_000)).toBe(original);
    expect(pointTime(log.events, undoneAt + 25_000)).toBe(undoneAt + 25_000);
    expect(pointTime(new Log().points("home").events, 42)).toBe(42);
  });
});

describe("statistiche", () => {
  it("calcola serie, vantaggi, pareggi e cambi di vantaggio", () => {
    const log = new Log().points("home", 3).points("guest", 5).points("home", 2);
    const set = matchStats(match(), log.events).sets[0]!;
    expect(set.runs.map((r) => [r.team, r.length])).toEqual([["home", 3], ["guest", 5], ["home", 2]]);
    expect(set.bestRun.guest).toMatchObject({ length: 5, from: { home: 3, guest: 0 }, to: { home: 3, guest: 5 } });
    expect(set.maxLead).toEqual({ home: 3, guest: 2 });
    expect(set.ties).toBe(2);
    expect(set.leadChanges).toBe(1);
  });

  it("il tempo tra i punti esclude i time-out e i cambi di set", () => {
    const log = new Log().points("home", 3).timeout("guest").points("guest", 1);
    const gaps = matchStats(match(), log.events).gaps;
    expect(gaps.count).toBe(2);
    expect(gaps.medianMs).toBe(30_000);
    expect(gaps.bands.map((b) => b.home + b.guest)).toEqual([0, 2, 0]);
  });
});

describe("file della partita", () => {
  it("andata e ritorno, e import senza doppioni", () => {
    const log = new Log().points("home", 3);
    const file = parseMatchFile(JSON.stringify(exportMatch(match(), log.events)));
    expect(file.events).toHaveLength(3);
    expect(newEvents(log.events, file.events)).toHaveLength(0);
    expect(newEvents(log.events.slice(0, 1), file.events)).toHaveLength(2);
  });

  it("rifiuta file estranei e versioni più nuove", () => {
    expect(() => parseMatchFile("ciao")).toThrow("non è un file");
    expect(() => parseMatchFile("{}")).toThrow("non è un file");
    const newer = { ...exportMatch(match(), []), version: 99 };
    expect(() => parseMatchFile(JSON.stringify(newer))).toThrow("aggiorna l'app");
  });

  it("scrive il risultato per la lega con la squadra di casa per prima", () => {
    const { state } = replay(match(), new Log().set("home", 25, 21).set("guest", 25, 19).events);
    expect(resultText(match(), state)).toBe("Le Bande Bassotte – Squadra Ospite 1-1 (25-21, 19-25)");
    expect(fileName(match(), state)).toBe("2026-11-02 Le Bande Bassotte - Squadra Ospite 1-1");
  });
});

describe("partita vera del 2 novembre 2026", () => {
  const file = parseMatchFile(readFileSync(new URL("./fixtures/partita-2026-11-02.json", import.meta.url), "utf8"));
  const { state } = replay(file.match, file.events);
  const stats = matchStats(file.match, file.events);

  it("finisce 3-2 con i parziali giusti", () => {
    expect(state.sets).toEqual([
      { home: 21, guest: 25 },
      { home: 25, guest: 19 },
      { home: 18, guest: 25 },
      { home: 25, guest: 13 },
      { home: 19, guest: 17 },
    ]);
    expect(state.winner).toBe("home");
    expect(state.setsWon).toEqual({ home: 3, guest: 2 });
    expect(stats.points).toEqual({ home: 108, guest: 99 });
  });

  it("ha il time-out degli ospiti sul 18-9 del quarto set", () => {
    const set4 = stats.sets[3]!;
    expect(set4.timeouts).toEqual([{ team: "guest", afterPoint: 27 }]);
    expect(set4.points[26]).toMatchObject({ home: 18, guest: 9 });
  });

  it("ha le serie migliori del report", () => {
    expect(stats.sets.map((s) => [s.bestRun.home?.length, s.bestRun.guest?.length])).toEqual([
      [6, 5],
      [6, 4],
      [3, 5],
      [6, 2],
      [3, 3],
    ]);
    expect(stats.sets[0]!.bestRun.home).toMatchObject({ from: { home: 6, guest: 9 }, to: { home: 12, guest: 9 } });
    expect(stats.sets[3]!.maxLead.home).toBe(12);
  });
});

describe("copia pubblica", () => {
  it("contiene punteggio e set, non il registro", () => {
    const log = new Log().set("home", 25, 20).points("guest", 3).timeout("home");
    const snap = liveSnapshot(match(), log.events);
    expect(snap.score).toEqual({ home: 0, guest: 3 });
    expect(snap.sets).toEqual([{ home: 25, guest: 20 }]);
    expect(snap.setsWon.home).toBe(1);
    expect(snap.timeout).toBe("home");
    expect(snap.seq).toBe(log.events.length);
    expect(JSON.stringify(snap)).not.toContain("device");
    expect(snap).not.toHaveProperty("events");
  });

  it("a partita finita tiene il punteggio dell'ultimo set", () => {
    const snap = liveSnapshot(match(), new Log().set("home").set("home").set("home", 25, 23).events);
    expect(snap.over).toBe(true);
    expect(snap.score).toEqual({ home: 25, guest: 23 });
  });
});
