import { native } from "./native";

let lock: WakeLockSentinel | null = null;
let state = "non provato";

export async function keepScreenOn(): Promise<void> {
  if (native) {
    state = "attivo (app per iPad)"; // the app keeps the screen on for as long as it is open
    return;
  }
  if (!("wakeLock" in navigator)) {
    state = "non disponibile: imposta il blocco automatico su Mai";
    return;
  }
  try {
    lock = await navigator.wakeLock.request("screen");
    state = "attivo";
    lock.addEventListener("release", () => {
      lock = null;
    });
  } catch {
    state = "rifiutato: imposta il blocco automatico su Mai";
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !lock && state === "attivo") void keepScreenOn();
});

export const screenOnState = (): string => state;
