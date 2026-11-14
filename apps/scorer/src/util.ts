export const esc = (text: unknown): string =>
  String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White whenever it stays readable at scoreboard size (3:1), black on light team colours. */
export function textOn(color: string): string {
  return 1.05 / (luminance(color) + 0.05) >= 3 ? "#ffffff" : "#0b0b0b";
}

export function colorsTooClose(a: string, b: string): boolean {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.hypot(ar - br, ag - bg, ab - bb) < 90;
}

export const dateIt = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(ms);

export const timeIt = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone }).format(ms);

/** Asks in the page, so it looks and works the same in a browser and in the installed app. */
export function confirmBox(title: string, text: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "sheet";
    el.innerHTML = `
      <div class="sheet-box" role="alertdialog" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <div class="card-actions">
          <button class="btn" data-answer="no">${esc(no)}</button>
          <button class="btn danger" data-answer="yes">${esc(yes)}</button>
        </div>
      </div>`;
    el.addEventListener("click", (e) => {
      const answer = (e.target as HTMLElement).closest<HTMLElement>("[data-answer]")?.dataset.answer;
      if (!answer) return;
      el.remove();
      resolve(answer === "yes");
    });
    document.body.append(el);
  });
}

export function toast(text: string): void {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}
