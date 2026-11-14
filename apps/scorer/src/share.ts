import { exportMatch, fileName, replay, resultText, type Match, type MatchEvent } from "@segnapunti/engine";
import { native } from "./native";
import { toast } from "./util";

const cancelled = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

export async function shareResult(match: Match, events: MatchEvent[]): Promise<void> {
  const text = resultText(match, replay(match, events).state);
  if (native) return void (await native.postMessage({ action: "share", text }));
  try {
    if (navigator.share) return await navigator.share({ text });
  } catch (e) {
    if (cancelled(e)) return;
  }
  await navigator.clipboard?.writeText(text);
  toast(`Copiato: ${text}`);
}

/** Tells the truth about the copy: a failed one must not look like a success. */
export async function copyLink(url: string): Promise<void> {
  try {
    if (native) await native.postMessage({ action: "copy", text: url });
    else await navigator.clipboard.writeText(url);
    toast("Link copiato");
  } catch {
    toast("Non riesco a copiare: tieni premuto sul link qui sopra");
  }
}

export async function shareLink(text: string, url: string): Promise<void> {
  if (native) return void (await native.postMessage({ action: "share", text, url }));
  try {
    if (navigator.share) return await navigator.share({ text, url });
  } catch (e) {
    if (cancelled(e)) return;
  }
  await copyLink(url);
}

function download(file: File): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(`Salvato: ${file.name}`);
}

/** Android refuses to share .json files, so a plain text copy of the same content is the fallback. */
export async function exportFile(match: Match, events: MatchEvent[]): Promise<void> {
  const name = fileName(match, replay(match, events).state);
  const body = JSON.stringify(exportMatch(match, events));
  if (native) return void (await native.postMessage({ action: "shareFile", name: `${name}.json`, text: body }));
  const json = new File([body], `${name}.json`, { type: "application/json" });
  const text = new File([body], `${name}.partita.txt`, { type: "text/plain" });
  for (const file of [json, text]) {
    if (!navigator.canShare?.({ files: [file] })) continue;
    try {
      return await navigator.share({ files: [file] });
    } catch (e) {
      if (cancelled(e)) return;
    }
  }
  download(json);
}
