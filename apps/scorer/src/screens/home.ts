import { MatchFileError, newEvents, parseMatchFile, replay, type Match } from "@segnapunti/engine";
import { addEvents, listMatches, loadEvents, loadMatch, saveMatch } from "../db";
import { removeMatch } from "../live";
import { offlineReady, standalone } from "../pwa";
import { confirmBox, esc, timeIt, toast } from "../util";

interface Row {
  match: Match;
  label: string;
  over: boolean;
}

async function rows(): Promise<Row[]> {
  const matches = await listMatches();
  const result: Row[] = [];
  for (const match of matches.sort((a, b) => b.createdAt - a.createdAt)) {
    const { state } = replay(match, await loadEvents(match.id));
    const label = state.over
      ? `${state.setsWon.home}–${state.setsWon.guest}`
      : `in corso · ${state.setsWon.home}–${state.setsWon.guest}, ${state.setIndex + 1}° set ${state.home}–${state.guest}`;
    result.push({ match, label, over: state.over });
  }
  return result;
}

async function importFile(file: File): Promise<void> {
  const data = parseMatchFile(await file.text());
  const known = await loadMatch(data.match.id);
  if (!known) await saveMatch(data.match);
  const fresh = newEvents(await loadEvents(data.match.id), data.events);
  await addEvents(data.match.id, fresh);
  toast(known ? `Partita già presente: ${fresh.length} eventi nuovi` : "Partita importata");
}

export async function homeScreen(root: HTMLElement): Promise<void> {
  const list = await rows();
  const ready = await offlineReady();
  const when = (m: Match): string =>
    `${new Date(m.createdAt).toLocaleDateString("it-IT", { timeZone: m.timeZone })} ${timeIt(m.createdAt, m.timeZone)}`;

  root.innerHTML = `
    <main class="page">
      <header class="page-head">
        <h1>Segnapunti</h1>
        <p class="status ${ready ? "ok" : "warn"}">${ready ? "Pronta per l'uso senza internet" : "Serve internet per finire l'installazione"}</p>
      </header>
      ${standalone() ? "" : `<p class="notice">Stai usando l'app in una scheda del browser. Per segnare una partita aprila dall'icona sulla schermata Home: su iPad, Condividi → Aggiungi alla schermata Home.</p>`}
      <div class="actions">
        <a class="btn primary" href="#/nuova">Nuova partita</a>
        <a class="btn" href="#/continua">Continua una partita su questo dispositivo</a>
        <label class="btn">Importa partita<input id="import" type="file" accept=".json,.txt,application/json,text/plain" hidden /></label>
      </div>
      <h2>Partite su questo dispositivo</h2>
      ${
        list.length
          ? `<ul class="matches">${list
              .map(
                ({ match, label, over }) => `
            <li><a href="#/${over ? "report" : "partita"}/${encodeURIComponent(match.id)}">
              <span class="teams">${esc(match.home.name)} – ${esc(match.guest.name)}</span>
              <span class="score">${esc(label)}</span>
              <span class="when">${esc(when(match))}</span>
            </a><button class="btn remove" data-remove="${esc(match.id)}" aria-label="Elimina la partita ${esc(match.home.name)} – ${esc(match.guest.name)}">Elimina</button></li>`,
              )
              .join("")}</ul>`
          : `<p class="empty">Ancora nessuna partita.</p>`
      }
      <footer class="page-foot">Versione ${__APP_VERSION__} · <a href="#/diagnostica">Diagnostica</a></footer>
    </main>`;

  root.querySelectorAll<HTMLElement>("[data-remove]").forEach((button) =>
    button.addEventListener("click", async () => {
      const row = list.find((r) => r.match.id === button.dataset.remove)!;
      const sure = await confirmBox(
        "Eliminare la partita?",
        `${row.match.home.name} – ${row.match.guest.name}: punti e report spariscono da questo dispositivo e non si possono recuperare.`,
        "Elimina",
        "Tieni la partita",
      );
      if (!sure) return;
      const { linkStillOnline } = await removeMatch(row.match.id);
      if (linkStillOnline) toast("Partita eliminata. Senza internet il link resta online con l'ultimo punteggio.");
      await homeScreen(root);
    }),
  );

  root.querySelector<HTMLInputElement>("#import")!.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await importFile(file);
      await homeScreen(root);
    } catch (error) {
      toast(error instanceof MatchFileError ? error.message : "Non sono riuscito a leggere il file.");
    }
  });
}
