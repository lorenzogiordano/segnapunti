import { MISTO_E_BELLO, type Match, type SetScore, type StartState, type Team } from "@segnapunti/engine";
import { deviceId, listMatches, saveMatch } from "../db";
import { colorsTooClose, esc, toast } from "../util";

export const DEFAULT_HOME_COLOR = "#1e88e5";
export const DEFAULT_GUEST_COLOR = "#e53935";

const pick = (name: string, options: [string, string][], checked: string): string =>
  options
    .map(
      ([value, label]) =>
        `<label class="choice"><input type="radio" name="${name}" value="${value}" ${value === checked ? "checked" : ""} /><span>${esc(label)}</span></label>`,
    )
    .join("");

/** New match form; with `resume` it also asks for the score reached on the other device. */
export async function setupScreen(root: HTMLElement, resume: boolean): Promise<void> {
  const names = [...new Set((await listMatches()).flatMap((m) => [m.home.name, m.guest.name]))];

  root.innerHTML = `
    <main class="page">
      <header class="page-head"><h1>${resume ? "Continua una partita" : "Nuova partita"}</h1></header>
      ${resume ? `<p class="notice">Inserisci dove era arrivata la partita sull'altro dispositivo. I punti già fatti resteranno senza dettaglio nel report.</p>` : ""}
      <form id="setup" class="form">
        <datalist id="names">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
        <div class="team-row">
          <label>Squadra di casa<input name="home" list="names" required maxlength="30" value="Casa" /></label>
          <label class="color">Colore<input name="homeColor" type="color" value="${DEFAULT_HOME_COLOR}" /></label>
        </div>
        <div class="team-row">
          <label>Squadra ospite<input name="guest" list="names" required maxlength="30" value="Ospiti" /></label>
          <label class="color">Colore<input name="guestColor" type="color" value="${DEFAULT_GUEST_COLOR}" /></label>
        </div>
        <p id="close-colors" class="notice" hidden>I due colori sono troppo simili: chi segna rischia di sbagliare metà.</p>
        <fieldset><legend>Chi sta a sinistra sullo schermo?</legend>${pick("left", [["home", "Casa"], ["guest", "Ospiti"]], "home")}</fieldset>
        <fieldset><legend>Noi siamo</legend>${pick("us", [["home", "Casa"], ["guest", "Ospiti"], ["", "Nessuna delle due"]], "home")}</fieldset>
        <fieldset><legend>Il punteggio è</legend>${pick("scoring", [["official", "Quello ufficiale"], ["copy", "Una nostra copia"]], "official")}</fieldset>
        ${
          resume
            ? `<fieldset class="resume"><legend>Set già chiusi (casa – ospiti)</legend>
                ${[1, 2, 3, 4]
                  .map(
                    (n) => `<label>${n}° set <input name="s${n}h" type="number" min="0" max="99" inputmode="numeric" /> – <input name="s${n}g" type="number" min="0" max="99" inputmode="numeric" /></label>`,
                  )
                  .join("")}
              </fieldset>
              <fieldset class="resume"><legend>Set in corso (casa – ospiti)</legend>
                <label>Punteggio <input name="ch" type="number" min="0" max="99" value="0" inputmode="numeric" /> – <input name="cg" type="number" min="0" max="99" value="0" inputmode="numeric" /></label>
              </fieldset>`
            : ""
        }
        <div class="actions">
          <button class="btn primary" type="submit">${resume ? "Continua" : "Inizia"}</button>
          <a class="btn" href="#/">Annulla</a>
        </div>
      </form>
    </main>`;

  const form = root.querySelector<HTMLFormElement>("#setup")!;
  const value = (name: string): string => String(new FormData(form).get(name) ?? "");
  const number = (name: string): number => Number(value(name) || 0);

  // Our team is recognised by name, unless "Noi siamo" was chosen by hand.
  const OURS = /bande|bassotte/i;
  let usByHand = false;
  form.addEventListener("input", (e) => {
    root.querySelector<HTMLElement>("#close-colors")!.hidden = !colorsTooClose(value("homeColor"), value("guestColor"));
    if ((e.target as HTMLInputElement).name === "us") usByHand = true;
    if (usByHand) return;
    const ours = OURS.test(value("home")) ? "home" : OURS.test(value("guest")) ? "guest" : null;
    if (ours) form.querySelector<HTMLInputElement>(`input[name="us"][value="${ours}"]`)!.checked = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sets: SetScore[] = [];
    if (resume) {
      for (const n of [1, 2, 3, 4]) {
        if (value(`s${n}h`) === "" && value(`s${n}g`) === "") continue;
        const score = { home: number(`s${n}h`), guest: number(`s${n}g`) };
        if (score.home === score.guest) return toast(`Il ${n}° set non può finire in parità.`);
        sets.push(score);
      }
    }
    const start: StartState | null = resume ? { sets, home: number("ch"), guest: number("cg") } : null;
    const match: Match = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      home: { name: value("home").trim(), color: value("homeColor") },
      guest: { name: value("guest").trim(), color: value("guestColor") },
      us: (value("us") || null) as Team | null,
      scoring: value("scoring") as Match["scoring"],
      rules: MISTO_E_BELLO,
      left: value("left") as Team,
      start,
      setTimes: null,
      device: await deviceId(),
      appVersion: __APP_VERSION__,
    };
    await saveMatch(match);
    location.hash = `#/partita/${encodeURIComponent(match.id)}`;
  });
}
