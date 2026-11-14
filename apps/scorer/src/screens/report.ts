import { fileName, matchStats, replay, resultText, type Match, type MatchStats, type Run, type SetStats, type Team } from "@segnapunti/engine";
import { loadEvents, loadMatch } from "../db";
import { native } from "../native";
import { exportFile, shareResult } from "../share";
import { dateIt, esc, textOn, timeIt } from "../util";

const score = (s: { home: number; guest: number }): string => `${s.home}-${s.guest}`;
const minutes = (ms: number): string => `${Math.round(ms / 60_000)} min`;

function setDuration(match: Match, set: SetStats): number | null {
  const old = match.setTimes?.[set.index];
  return set.durationMs ?? (old ? old.end - old.start : null);
}

function setChart(match: Match, set: SetStats, columns: number, yMax: number): string {
  const W = 1000;
  const longest = Math.max(match.home.name.length, match.guest.name.length);
  const left = Math.max(64, Math.round(14 + 6.6 * longest));
  const cw = (W - left - 8) / columns;
  const rowH = 20;
  const out: string[] = [];

  (["home", "guest"] as Team[]).forEach((team, row) => {
    const y = 6 + row * (rowH + 2);
    const { name, color } = match[team];
    out.push(`<text x="${left - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" class="rowlab">${esc(name)}</text>`);
    set.points.forEach((point, i) => {
      const x = left + i * cw;
      const mine = point.team === team;
      out.push(`<rect x="${(x + 1).toFixed(1)}" y="${y}" width="${(cw - 2).toFixed(1)}" height="${rowH}" rx="3" fill="${mine ? color : "#f1f0ec"}"/>`);
      if (mine) out.push(`<text x="${(x + cw / 2).toFixed(1)}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cell" fill="${textOn(color)}">${point[team]}</text>`);
    });
  });

  const top = 6 + 2 * (rowH + 2) + 14;
  const height = 150;
  const mid = top + height / 2;
  const k = height / 2 / yMax;
  const Y = (d: number): number => mid - d * k;
  const right = left + columns * cw;
  const step = yMax <= 8 ? 2 : 4;
  for (let v = -yMax; v <= yMax; v += step) {
    if (v === 0) continue;
    out.push(`<line x1="${left}" x2="${right}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/>`);
    out.push(`<text x="${left - 8}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="axis">+${Math.abs(v)}</text>`);
  }
  out.push(`<text x="${left + 6}" y="${top + 10}" class="axis">▲ avanti ${esc(match.home.name)}</text>`);
  out.push(`<text x="${left + 6}" y="${top + height - 4}" class="axis">▼ avanti ${esc(match.guest.name)}</text>`);

  const xs = [left, ...set.points.map((_, i) => left + (i + 0.5) * cw)];
  const diffs = [0, ...set.points.map((p) => p.home - p.guest)];
  const line = diffs.map((d, i) => `${xs[i]!.toFixed(1)},${Y(d).toFixed(1)}`).join(" ");
  const area = `${left},${mid} ${line} ${xs[xs.length - 1]!.toFixed(1)},${mid}`;
  const clip = `c${set.index}`;
  out.push(`<clipPath id="${clip}u"><rect x="0" y="${top - 5}" width="${W}" height="${mid - top + 5}"/></clipPath>`);
  out.push(`<clipPath id="${clip}d"><rect x="0" y="${mid}" width="${W}" height="${height}"/></clipPath>`);
  out.push(`<polygon points="${area}" fill="${match.home.color}" opacity=".16" clip-path="url(#${clip}u)"/>`);
  out.push(`<polygon points="${area}" fill="${match.guest.color}" opacity=".16" clip-path="url(#${clip}d)"/>`);
  out.push(`<line x1="${left}" x2="${right}" y1="${mid}" y2="${mid}" class="zero"/>`);
  for (const timeout of set.timeouts) {
    const x = (xs[timeout.afterPoint] ?? right) + cw / 2;
    out.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top}" y2="${top + height}" class="to"/>`);
    out.push(`<text x="${(x + 4).toFixed(1)}" y="${top + height - 4}" class="axis">time-out ${esc(match[timeout.team].name)}</text>`);
  }
  out.push(`<polyline points="${line}" class="worm"/>`);

  let at = 0;
  for (const run of set.runs) {
    at += run.length;
    if (run.length < 4) continue;
    const x = xs[at]!;
    const d = diffs[at]!;
    const y = run.team === "home" ? Y(d) - 9 : Y(d) + 17;
    out.push(`<circle cx="${x.toFixed(1)}" cy="${Y(d).toFixed(1)}" r="4" fill="${match[run.team].color}" class="dot"/>`);
    out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="runlab">+${run.length} di fila</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${top + height + 14}" role="img" aria-label="Andamento del ${set.index + 1}° set">${out.join("")}</svg>`;
}

const runText = (run: Run | null): string =>
  run ? `<b>${run.length}</b> <span class="muted">da ${score(run.from)} a ${score(run.to)}</span>` : "—";

function setBlock(match: Match, set: SetStats, columns: number, yMax: number): string {
  const duration = setDuration(match, set);
  const winner = set.winner ? match[set.winner].name : null;
  const swatch = (team: Team): string => `<i class="sw" style="background:${match[team].color}"></i>`;
  const detail = set.points.length
    ? `${setChart(match, set, columns, yMax)}
       <div class="facts">
         <div>${swatch("home")}Serie migliore ${esc(match.home.name)}: ${runText(set.bestRun.home)}</div>
         <div>${swatch("guest")}Serie migliore ${esc(match.guest.name)}: ${runText(set.bestRun.guest)}</div>
         <div>Massimo vantaggio: ${esc(match.home.name)} <b>+${set.maxLead.home}</b> · ${esc(match.guest.name)} <b>+${set.maxLead.guest}</b></div>
         <div>Pareggi: <b>${set.ties}</b> · cambi di vantaggio: <b>${set.leadChanges}</b></div>
       </div>`
    : `<p class="muted">Punti senza dettaglio: segnati su un altro dispositivo.</p>`;
  return `
    <section class="rset">
      <div class="rset-head">
        <h2>${set.index + 1}° set <span>${set.home} – ${set.guest}</span></h2>
        <div class="muted">${winner ? `vince <b>${esc(winner)}</b>` : "in corso"}${duration !== null ? ` · ${minutes(duration)}` : ""}</div>
      </div>
      ${detail}
    </section>`;
}

function gapsBlock(match: Match, stats: MatchStats): string {
  const { gaps } = stats;
  if (!gaps.count || gaps.medianMs === null) return "";
  return `
    <section class="rset">
      <h2>Tempo tra un punto e l'altro</h2>
      <p class="muted">Tempo tra due tocchi: comprende scambio, battuta, festeggiamenti e discussioni. Sono esclusi time-out e pause tra i set. Mediana: <b>${Math.round(gaps.medianMs / 1000)} s</b>.</p>
      <table class="rtable"><thead><tr><th>Punti</th><th class="num">Vinti da ${esc(match.home.name)}</th><th class="num">Vinti da ${esc(match.guest.name)}</th></tr></thead>
      <tbody>${gaps.bands.map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${b.home}</td><td class="num">${b.guest}</td></tr>`).join("")}</tbody></table>
    </section>`;
}

export async function reportScreen(root: HTMLElement, id: string): Promise<void> {
  const match = await loadMatch(id);
  if (!match) {
    location.hash = "#/";
    return;
  }
  const events = await loadEvents(id);
  const stats = matchStats(match, events);
  const { state } = replay(match, events);
  const columns = Math.max(50, ...stats.sets.map((s) => s.points.length + 1));
  const biggest = Math.max(6, ...stats.sets.flatMap((s) => [s.maxLead.home, s.maxLead.guest]));
  const yMax = Math.ceil(biggest / 2) * 2;
  const first = stats.sets.find((s) => s.firstT !== null)?.firstT ?? match.setTimes?.[0]?.start ?? match.createdAt;
  const last = [...stats.sets].reverse().find((s) => s.lastT !== null)?.lastT ?? match.setTimes?.at(-1)?.end ?? null;
  const swatch = (team: Team): string => `<i class="sw" style="background:${match[team].color}"></i>`;
  const tz = match.timeZone;

  document.title = fileName(match, state);
  root.innerHTML = `
    <main class="report">
      <nav class="noprint">
        <a class="btn" href="#/">Partite</a>
        ${state.over ? "" : `<a class="btn" href="#/partita/${encodeURIComponent(id)}">Torna al tabellone</a>`}
        <button class="btn primary" id="print">Stampa o salva PDF</button>
        <button class="btn" id="share">Condividi risultato</button>
        <button class="btn" id="export">Esporta partita</button>
      </nav>
      <header class="rhead">
        <div>
          <div class="muted">${esc(dateIt(first, tz))} · ${esc(timeIt(first, tz))}${last ? `–${esc(timeIt(last, tz))}` : ""}${match.scoring === "copy" ? " · copia della squadra, non ufficiale" : ""}</div>
          <h1>${swatch("home")}${esc(match.home.name)} <span>${state.setsWon.home} – ${state.setsWon.guest}</span> ${esc(match.guest.name)}${swatch("guest")}</h1>
        </div>
        <div class="muted right">Punti totali: <b>${stats.points.home}</b> – <b>${stats.points.guest}</b><br />${esc(resultText(match, state).split("(")[1]?.replace(")", "") ?? "")}</div>
      </header>
      <table class="rtable">
        <thead><tr><th>Set</th><th class="num">Punteggio</th><th>Vince</th><th class="num">Serie ${esc(match.home.name)}</th><th class="num">Serie ${esc(match.guest.name)}</th><th class="num">Durata</th></tr></thead>
        <tbody>${stats.sets
          .map((s) => {
            const duration = setDuration(match, s);
            return `<tr><td>${s.index + 1}°</td><td class="num"><b>${s.home}–${s.guest}</b></td><td>${s.winner ? esc(match[s.winner].name) : "in corso"}</td>
              <td class="num">${s.bestRun.home?.length ?? "—"}</td><td class="num">${s.bestRun.guest?.length ?? "—"}</td><td class="num">${duration !== null ? minutes(duration) : "—"}</td></tr>`;
          })
          .join("")}</tbody>
      </table>
      <p class="muted legend">In ogni set, le due righe colorate sono il punteggio punto per punto. Sotto, la linea mostra chi era avanti e di quanto. Sono segnate le serie da 4 punti di fila in su.</p>
      ${stats.sets.map((s) => setBlock(match, s, columns, yMax)).join("")}
      ${gapsBlock(match, stats)}
    </main>`;

  root.querySelector("#print")!.addEventListener("click", () =>
    native ? void native.postMessage({ action: "print", title: document.title }) : window.print(),
  );
  root.querySelector("#share")!.addEventListener("click", () => void shareResult(match, events));
  root.querySelector("#export")!.addEventListener("click", () => void exportFile(match, events));
}
