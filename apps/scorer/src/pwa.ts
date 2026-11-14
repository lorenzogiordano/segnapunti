import { getValue, setValue } from "./db";
import { native } from "./native";

export const standalone = (): boolean =>
  Boolean(native) ||
  matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function offlineReady(): Promise<boolean> {
  if (native) return true; // the iPad app carries its files inside
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(registration?.active);
}

let activating = false;

export async function registerOffline(): Promise<void> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (activating) location.reload();
  });
  await navigator.serviceWorker.register("sw.js");
  if (navigator.storage?.persist) await setValue("persisted", await navigator.storage.persist());
}

/** The one update rule: a waiting version starts only from the home screen, with no match open. */
export async function activateUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update().catch(() => undefined);
  if (!registration?.waiting) return;
  activating = true;
  registration.waiting.postMessage("activate");
}

const counters = { rejected: 0, writes: 0, writeMs: 0, slowest: 0 };

export function noteRejectedTap(): void {
  counters.rejected += 1;
}

export function noteWrite(ms: number): void {
  counters.writes += 1;
  counters.writeMs += ms;
  counters.slowest = Math.max(counters.slowest, ms);
}

export async function diagnostics(): Promise<[string, string][]> {
  const estimate = await navigator.storage?.estimate?.();
  return [
    ["Versione", __APP_VERSION__],
    ["Aperta dalla schermata Home", standalone() ? "sì" : "no"],
    ["Pronta offline", (await offlineReady()) ? "sì" : "no"],
    ["Memoria persistente", String((await getValue<boolean>("persisted")) ?? "non chiesta")],
    ["Spazio usato", estimate?.usage ? `${Math.round(estimate.usage / 1024)} kB` : "sconosciuto"],
    ["Scritture in questa sessione", String(counters.writes)],
    ["Tempo medio di scrittura", counters.writes ? `${(counters.writeMs / counters.writes).toFixed(1)} ms` : "—"],
    ["Scrittura più lenta", counters.writes ? `${counters.slowest.toFixed(1)} ms` : "—"],
    ["Tocchi respinti", String(counters.rejected)],
    ["Schermo", `${innerWidth}×${innerHeight}`],
  ];
}
