import {
  nextUndo,
  otherTeam,
  pointTime,
  replay,
  type Match,
  type MatchEvent,
  type Replay,
  type Team,
  type UndoPlan,
} from "@segnapunti/engine";
import { appendEvent, getValue, loadEvents, loadMatch, saveMatch, setValue } from "../db";
import { LIVE_URL, disableLive, enableLive, liveLink, liveOf, pushLive, removeMatch, shareText, type Live } from "../live";
import { copyLink, exportFile, shareLink, shareResult } from "../share";
import { noteRejectedTap, noteWrite } from "../pwa";
import { confirmBox, esc, textOn, toast } from "../util";
import { keepScreenOn, screenOnState } from "../wakelock";

const MOVE_LIMIT = 12; // px a finger may slide and still count as a tap
const EDGE = 24; // px along the screen sides that give no point: thumbs holding the tablet
const UNDO_GUARD = 1000;
const HOLD_MS = 2000;

const sideTeams = (match: Match): [Team, Team] => [match.left, otherTeam(match.left)];

function undoLabel(match: Match, plan: UndoPlan | null): string {
  if (!plan) return "niente da annullare";
  const name = match[plan.team].name;
  switch (plan.kind) {
    case "point":
      return `toglie il punto a ${name} (${plan.before[plan.team]} → ${plan.after[plan.team]})`;
    case "reopenSet":
      return `riapre il ${plan.setIndex + 1}° set sul ${plan.score.home}–${plan.score.guest}`;
    case "reopenMatch":
      return `tieni premuto 2 s: riapre la partita sul ${plan.score.home}–${plan.score.guest}`;
    case "timeout":
      return `toglie il time-out di ${name}`;
    case "timeoutEnd":
      return `il time-out di ${name} riprende`;
  }
}

class Board {
  private game: Replay;
  private lockMs = 2000;
  private lockedUntil = 0;
  private undoBlockedUntil = 0;
  private flash: Team | null = null;
  private notSaved = false;
  private menuOpen = false;
  private tick = 0;
  private unlock = 0;
  private busy = false;
  private writes: Promise<void> = Promise.resolve();
  private pointers = new Map<number, { x: number; y: number; team: Team | null }>();
  private multiTouch = false;
  private live: Live | null = null;
  private liveOk = true;
  private liveRetry = 0;

  constructor(
    private root: HTMLElement,
    private match: Match,
    private events: MatchEvent[],
  ) {
    this.game = replay(match, events);
  }

  async start(): Promise<void> {
    this.lockMs = (await getValue<number>("lockMs")) ?? 2000;
    await setValue("openMatch", this.match.id);
    this.live = (await liveOf(this.match.id)) ?? null;
    this.bindPointers();
    this.render();
    void this.publish();
    void keepScreenOn();
  }

  stop(): void {
    clearInterval(this.tick);
    this.tick = 0;
    clearTimeout(this.unlock);
    clearTimeout(this.liveRetry);
  }

  /** Never in the way of scoring: a failed send only changes a label and tries again. */
  private async publish(): Promise<void> {
    if (!this.live) return;
    clearTimeout(this.liveRetry);
    this.liveOk = await pushLive(this.match, this.events);
    const label = this.root.querySelector<HTMLElement>("#live-status");
    if (label) label.textContent = this.liveLabel();
    if (!this.liveOk) this.liveRetry = window.setTimeout(() => void this.publish(), 15_000);
  }

  private liveLabel(): string {
    if (!this.live) return "";
    return this.liveOk ? " · in diretta" : " · diretta in attesa di rete";
  }

  private nextSeq(): number {
    return this.events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  }

  /** Saves first, shows after: a point on screen is a point on disk. */
  private add(partial: Record<string, unknown>, now: number): Promise<void> {
    // One at a time, so two quick actions can never take the same progressive number.
    this.writes = this.writes.then(() => this.write(partial, now));
    return this.writes;
  }

  private async write(partial: Record<string, unknown>, now: number): Promise<void> {
    const event = {
      id: crypto.randomUUID(),
      seq: this.nextSeq(),
      t: now,
      tz: -new Date(now).getTimezoneOffset(),
      ...partial,
    } as MatchEvent;
    const began = performance.now();
    try {
      await appendEvent(this.match.id, event);
      noteWrite(performance.now() - began);
    } catch {
      this.notSaved = true;
    }
    this.events.push(event);
    this.game = replay(this.match, this.events);
    void this.publish();
  }

  private async givePoint(team: Team): Promise<void> {
    const now = Date.now();
    if (this.game.state.over || this.busy) return;
    if (now < this.lockedUntil) {
      noteRejectedTap();
      const hint = this.root.querySelector<HTMLElement>("#hint");
      if (hint) hint.textContent = "Bloccato: tocco ignorato";
      return;
    }
    this.lockedUntil = now + this.lockMs;
    this.busy = true;
    await this.add({ type: "point", team, t: pointTime(this.events, now) }, now);
    this.busy = false;
    this.flash = team;
    this.render();
    clearTimeout(this.unlock);
    this.unlock = window.setTimeout(() => {
      this.flash = null;
      this.render();
    }, this.lockMs);
  }

  private async undo(): Promise<void> {
    const plan = nextUndo(this.match, this.events);
    const now = Date.now();
    if (!plan || now < this.undoBlockedUntil) return;
    this.undoBlockedUntil = now + UNDO_GUARD;
    await this.add({ type: "undo", target: plan.target.id }, now);
    // The next tap is usually the correction, so it must not wait for the lock.
    this.lockedUntil = 0;
    this.flash = null;
    clearTimeout(this.unlock);
    this.render();
  }

  private bindPointers(): void {
    const teamAt = (e: PointerEvent): Team | null =>
      ((e.target as HTMLElement).closest<HTMLElement>("[data-team]")?.dataset.team as Team | undefined) ?? null;

    this.root.addEventListener("pointerdown", (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, team: teamAt(e) });
      if (this.pointers.size > 1) this.multiTouch = true;
    });
    this.root.addEventListener("pointerup", (e) => {
      const down = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      const multi = this.multiTouch;
      if (!this.pointers.size) this.multiTouch = false;
      if (!down?.team) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const atEdge = down.x < EDGE || down.x > window.innerWidth - EDGE;
      if (multi || moved > MOVE_LIMIT || atEdge) return noteRejectedTap();
      void this.givePoint(down.team);
    });
    this.root.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.multiTouch = false;
    });
  }

  private timeoutLeft(): number {
    const running = this.game.state.timeoutRunning;
    if (!running?.t) return 0;
    return Math.ceil(this.match.rules.timeoutSeconds - (Date.now() - running.t) / 1000);
  }

  /** A clock only while a time-out is counting down: no timer wakes the tablet the rest of the match. */
  private syncTick(): void {
    const counting = Boolean(this.root.querySelector("#countdown"));
    if (counting && !this.tick) this.tick = window.setInterval(() => this.updateCountdown(), 1000);
    if (!counting && this.tick) {
      clearInterval(this.tick);
      this.tick = 0;
    }
  }

  private updateCountdown(): void {
    const el = this.root.querySelector<HTMLElement>("#countdown");
    if (!el) return;
    const left = this.timeoutLeft();
    if (left > 0) el.textContent = `${left} s`;
    else this.render();
  }

  private half(team: Team, side: "left" | "right"): string {
    const { state } = this.game;
    const { name, color } = this.match[team];
    const classes = ["half", side, this.flash === team ? "flash" : this.flash ? "dim" : ""].join(" ");
    return `
      <button class="${classes}" data-team="${team}" style="--team:${color};--on:${textOn(color)}" aria-label="Punto a ${esc(name)}" ${state.over ? "disabled" : ""}>
        <span class="name">${esc(name)}</span>
        <span class="sets"><small>SET</small><b>${state.setsWon[team]}</b></span>
        ${state.serving === team ? `<span class="serve">● in battuta</span>` : ""}
        <span class="pts">${state[team]}</span>
        ${state.home + state.guest === 0 && !this.game.steps.length ? `<span class="tip">tocca per dare il punto</span>` : ""}
      </button>`;
  }

  private timeoutButton(team: Team): string {
    const { state } = this.game;
    const { rules } = this.match;
    const used = state.timeoutsUsed[team];
    if (state.timeoutRunning?.team === team && this.timeoutLeft() > 0) {
      return `<button class="btn tool running" data-do="resume" data-for="${team}">Si riprende <small id="countdown">${this.timeoutLeft()} s</small></button>`;
    }
    const dots = Array.from({ length: rules.timeoutsPerSet }, (_, i) => `<i class="${i < rules.timeoutsPerSet - used ? "" : "used"}"></i>`).join("");
    const off = used >= rules.timeoutsPerSet || state.over;
    return `<button class="btn tool" data-do="timeout" data-for="${team}" ${off ? "disabled" : ""}>Time-out <span class="dots">${dots}</span></button>`;
  }

  private overlay(): string {
    const { state } = this.game;
    if (state.over) {
      const winner = this.match[state.winner as Team].name;
      return `
        <div class="card end">
          <small>PARTITA FINITA</small>
          <b>${esc(winner)} ${Math.max(state.setsWon.home, state.setsWon.guest)}–${Math.min(state.setsWon.home, state.setsWon.guest)}</b>
          <div class="card-actions">
            <button class="btn primary" data-do="share">Condividi risultato</button>
            <button class="btn" data-do="export">Esporta partita</button>
            <a class="btn" href="#/report/${encodeURIComponent(this.match.id)}">Report</a>
            <a class="btn" href="#/" data-do="leave">Chiudi</a>
          </div>
        </div>`;
    }
    const last = state.sets[state.sets.length - 1];
    if (last && state.home + state.guest === 0) {
      const team: Team = last.home > last.guest ? "home" : "guest";
      return `
        <div class="card passive">
          <small>${state.sets.length}° SET FINITO</small>
          <b>${esc(this.match[team].name)} ${Math.max(last.home, last.guest)}–${Math.min(last.home, last.guest)}</b>
          <span>Resta qui fino al primo punto del ${state.setIndex + 1}° set.</span>
        </div>`;
    }
    return "";
  }

  private menu(): string {
    if (!this.menuOpen) return "";
    const { home, guest } = this.match;
    return `
      <div class="sheet">
        <div class="sheet-box">
          <h2>Menu</h2>
          <form id="teams" class="form compact">
            <div class="team-row"><label>Casa<input name="home" maxlength="30" value="${esc(home.name)}" /></label><label class="color">Colore<input name="homeColor" type="color" value="${home.color}" /></label></div>
            <div class="team-row"><label>Ospiti<input name="guest" maxlength="30" value="${esc(guest.name)}" /></label><label class="color">Colore<input name="guestColor" type="color" value="${guest.color}" /></label></div>
            <label>Blocco dopo un punto
              <select name="lock">${[1000, 1500, 2000, 3000, 4000].map((ms) => `<option value="${ms}" ${ms === this.lockMs ? "selected" : ""}>${ms / 1000} s</option>`).join("")}</select>
            </label>
          </form>
          <p class="status">Schermo sempre acceso: ${esc(screenOnState())}</p>
          ${
            this.live
              ? `<div class="linkbox">Link per seguire la partita
                  <a class="livelink" href="${esc(liveLink(this.live))}" target="_blank" rel="noopener">${esc(liveLink(this.live))}</a>
                  <div class="card-actions">
                    <button class="btn" data-do="live-copy">Copia il link</button>
                    <button class="btn" data-do="live-send">Condividi il link</button>
                  </div>
                </div>`
              : ""
          }
          <div class="card-actions">
            <button class="btn primary" data-do="menu-save">Salva e torna al gioco</button>
            ${LIVE_URL && !this.live ? `<button class="btn" data-do="live">Crea il link per seguire</button>` : ""}
            ${this.live ? `<button class="btn" data-do="live-off">Disattiva il link</button>` : ""}
            <button class="btn" data-do="export">Esporta partita</button>
            <button class="btn" data-do="share">Condividi risultato</button>
            <a class="btn" href="#/report/${encodeURIComponent(this.match.id)}">Report</a>
            <a class="btn" href="#/" data-do="leave">Torna alle partite</a>
            <button class="btn danger" data-do="delete">Elimina la partita</button>
          </div>
        </div>
      </div>`;
  }

  private render(): void {
    const { state } = this.game;
    const [left, right] = sideTeams(this.match);
    const plan = nextUndo(this.match, this.events);
    const partials = state.sets.map((s) => `${s.home}–${s.guest}`).join(" · ");
    const locked = this.flash ? `<span class="lockmsg" style="--lock:${this.lockMs}ms"><i class="ring"></i><span id="hint">Punto a ${esc(this.match[this.flash].name)}</span></span>` : "";

    this.root.innerHTML = `
      <div class="board">
        ${this.notSaved ? `<div class="alarm">NON SALVATO: esporta subito la partita dal menu</div>` : ""}
        <div class="top">
          <div class="sync"><i></i>Salvato sul tablet<span id="live-status">${esc(this.liveLabel())}</span></div>
          ${locked || `<div class="setinfo"><b>${state.over ? "FINE" : `${state.setIndex + 1}° SET`}</b><span>${esc(partials)}</span></div>`}
          <button class="btn menu" data-do="menu">Menu</button>
        </div>
        <div class="halves">${this.half(left, "left")}${this.half(right, "right")}</div>
        <div class="bottom">
          ${this.timeoutButton(left)}
          <button class="btn tool undo" id="undo" data-do="undo" ${plan ? "" : "disabled"}>Annulla <small>${esc(undoLabel(this.match, plan))}</small></button>
          <button class="btn tool swap" data-do="swap">⇄ Lati</button>
          ${this.timeoutButton(right)}
        </div>
        ${this.overlay()}
        ${this.menu()}
      </div>`;

    this.root.querySelectorAll<HTMLElement>("[data-do]").forEach((el) => this.bindAction(el));
    this.syncTick();
  }

  private bindAction(el: HTMLElement): void {
    const action = el.dataset.do;
    if (action === "undo" && this.game.state.over) {
      // Reopening a finished match takes a long press: the result may already be out.
      let timer = 0;
      el.addEventListener("pointerdown", () => {
        timer = window.setTimeout(() => void this.undo(), HOLD_MS);
      });
      for (const end of ["pointerup", "pointerleave", "pointercancel"]) {
        el.addEventListener(end, () => clearTimeout(timer));
      }
      return;
    }
    el.addEventListener("click", () => void this.act(action, el.dataset.for as Team));
  }

  private async act(action: string | undefined, team: Team): Promise<void> {
    const now = Date.now();
    switch (action) {
      case "undo":
        return this.undo();
      case "timeout":
        await this.add({ type: "timeout", team }, now);
        break;
      case "resume":
        await this.add({ type: "timeoutEnd", team }, now);
        break;
      case "swap":
        this.match.left = otherTeam(this.match.left);
        await saveMatch(this.match);
        break;
      case "menu":
        this.menuOpen = true;
        break;
      case "menu-save":
        await this.saveMenu();
        break;
      case "live":
        this.live = await enableLive(this.match.id);
        void this.publish();
        break;
      case "live-copy":
        return copyLink(liveLink(this.live as Live));
      case "live-send":
        return shareLink(shareText(this.match, this.events), liveLink(this.live as Live));
      case "delete":
        return this.deleteMatch();
      case "live-off":
        if (await disableLive(this.match.id)) {
          this.live = null;
          toast("Link disattivato: la pagina non è più pubblica.");
        } else {
          toast("Serve internet per disattivare il link.");
        }
        break;
      case "share":
        return shareResult(this.match, this.events);
      case "export":
        return exportFile(this.match, this.events);
      case "leave":
        await setValue("openMatch", null);
        return;
      default:
        return;
    }
    this.render();
  }

  private async deleteMatch(): Promise<void> {
    const { home, guest } = this.match;
    const sure = await confirmBox(
      "Eliminare la partita?",
      `${home.name} – ${guest.name}: punti e report spariscono da questo dispositivo e non si possono recuperare.`,
      "Elimina",
      "Tieni la partita",
    );
    if (!sure) return;
    const { linkStillOnline } = await removeMatch(this.match.id);
    if (linkStillOnline) toast("Partita eliminata. Senza internet il link resta online con l'ultimo punteggio.");
    location.hash = "#/";
  }

  private async saveMenu(): Promise<void> {
    const data = new FormData(this.root.querySelector<HTMLFormElement>("#teams")!);
    const text = (key: string): string => String(data.get(key) ?? "").trim();
    this.match.home = { name: text("home") || this.match.home.name, color: text("homeColor") };
    this.match.guest = { name: text("guest") || this.match.guest.name, color: text("guestColor") };
    this.lockMs = Number(text("lock"));
    await saveMatch(this.match);
    await setValue("lockMs", this.lockMs);
    this.menuOpen = false;
    void this.publish();
  }
}

let current: Board | null = null;

export function leaveBoard(): void {
  current?.stop();
  current = null;
}

export async function boardScreen(root: HTMLElement, id: string): Promise<void> {
  const match = await loadMatch(id);
  if (!match) {
    toast("Partita non trovata su questo dispositivo.");
    location.hash = "#/";
    return;
  }
  // A fresh element: the pointer listeners die with the board.
  const host = document.createElement("div");
  root.replaceChildren(host);
  current = new Board(host, match, await loadEvents(id));
  await current.start();
}
