import "./styles.css";
import { getValue } from "./db";
import { flushLive } from "./live";
import { activateUpdate, diagnostics, registerOffline } from "./pwa";
import { boardScreen, leaveBoard } from "./screens/board";
import { homeScreen } from "./screens/home";
import { reportScreen } from "./screens/report";
import { setupScreen } from "./screens/setup";
import { esc } from "./util";

declare global {
  const __APP_VERSION__: string;
}

const root = document.querySelector<HTMLElement>("#app")!;

async function diagnosticScreen(): Promise<void> {
  const rows = await diagnostics();
  root.innerHTML = `
    <main class="page">
      <header class="page-head"><h1>Diagnostica</h1></header>
      <table class="rtable"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
      <div class="actions"><a class="btn" href="#/">Indietro</a></div>
    </main>`;
}

async function route(): Promise<void> {
  leaveBoard();
  document.title = "Segnapunti";
  const [, screen, id] = location.hash.split("/");
  document.body.dataset.screen = screen || "home";
  if (screen === "partita" && id) return boardScreen(root, decodeURIComponent(id));
  if (screen === "report" && id) return reportScreen(root, decodeURIComponent(id));
  if (screen === "nuova") return setupScreen(root, false);
  if (screen === "continua") return setupScreen(root, true);
  if (screen === "diagnostica") return diagnosticScreen();
  await homeScreen(root);
  void flushLive();
  await activateUpdate();
}

window.addEventListener("hashchange", () => void route());

async function boot(): Promise<void> {
  // Never awaited: a failure here must not stop the scoreboard from opening.
  registerOffline().catch(() => undefined);
  // Opened from the icon during a match: straight back to the board.
  const open = await getValue<string | null>("openMatch");
  if (!location.hash && open) location.hash = `#/partita/${encodeURIComponent(open)}`;
  else await route();
}

void boot();
