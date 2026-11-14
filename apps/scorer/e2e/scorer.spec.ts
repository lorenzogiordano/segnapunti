import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("../../../packages/engine/test/fixtures/partita-2026-11-02.json", import.meta.url));

const half = (page: Page, team: "home" | "guest") => page.locator(`[data-team=${team}]`);
const points = (page: Page, team: "home" | "guest") => half(page, team).locator(".pts");

async function newMatch(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByRole("link", { name: "Nuova partita" }).click();
  await page.getByRole("button", { name: "Inizia" }).click();
  await expect(points(page, "home")).toHaveText("0");
}

/** Taps past the lock, whose clock is fake so a whole match takes seconds. */
async function tap(page: Page, team: "home" | "guest", times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await half(page, team).click({ position: { x: 200, y: 300 } });
    await page.clock.fastForward(2100);
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
});

test("un set si chiude da solo e la scheda resta fino al primo punto", async ({ page }) => {
  await newMatch(page);
  await tap(page, "home", 25);
  await expect(page.locator(".card")).toContainText("1° SET FINITO");
  await expect(page.locator(".card")).toContainText("Casa 25–0");
  await expect(points(page, "home")).toHaveText("0");
  await expect(half(page, "home").locator(".sets b")).toHaveText("1");
  await tap(page, "guest");
  await expect(page.locator(".card")).toHaveCount(0);
  await expect(half(page, "guest").locator(".serve")).toBeVisible();
});

test("un secondo tocco entro il blocco non dà un altro punto", async ({ page }) => {
  await newMatch(page);
  await half(page, "home").click({ position: { x: 200, y: 300 } });
  await expect(points(page, "home")).toHaveText("1");
  await half(page, "home").click({ position: { x: 200, y: 300 } });
  await half(page, "guest").click({ position: { x: 200, y: 300 } });
  await expect(page.locator("#hint")).toHaveText("Bloccato: tocco ignorato");
  await expect(points(page, "home")).toHaveText("1");
  await expect(points(page, "guest")).toHaveText("0");
  await page.clock.fastForward(2100);
  await tap(page, "guest");
  await expect(points(page, "guest")).toHaveText("1");
});

test("due dita e i tocchi sui bordi non danno punti", async ({ page }) => {
  await newMatch(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-team="home"]')!;
    const fire = (type: string, pointerId: number, clientX: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, clientX, clientY: 300 }));
    fire("pointerdown", 1, 200);
    fire("pointerdown", 2, 300);
    fire("pointerup", 1, 200);
    fire("pointerup", 2, 300);
    fire("pointerdown", 3, 10);
    fire("pointerup", 3, 10);
    fire("pointerdown", 4, 200);
    fire("pointerup", 4, 260);
  });
  await page.clock.fastForward(2100);
  await expect(points(page, "home")).toHaveText("0");
});

test("Annulla riapre un set chiuso per errore e il punto corretto si dà subito", async ({ page }) => {
  await newMatch(page);
  await tap(page, "guest", 23);
  await tap(page, "home", 25);
  await expect(page.locator(".card")).toContainText("1° SET FINITO");
  const undo = page.locator("#undo");
  await expect(undo).toContainText("riapre il 1° set sul 24–23");
  await undo.click();
  await expect(points(page, "home")).toHaveText("24");
  await expect(page.locator(".card")).toHaveCount(0);
  await half(page, "guest").click({ position: { x: 200, y: 300 } });
  await expect(points(page, "guest")).toHaveText("24");
});

test("i time-out si consumano, il terzo è spento, si riprende a mano", async ({ page }) => {
  await newMatch(page);
  const button = page.getByRole("button", { name: /Time-out/ }).first();
  await button.click();
  await expect(page.locator("#countdown")).toHaveText("30 s");
  await page.clock.fastForward(5000);
  await expect(page.locator("#countdown")).toHaveText("25 s");
  await page.getByRole("button", { name: /Si riprende/ }).click();
  await button.click();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("button", { name: /Time-out/ }).first()).toBeDisabled();
});

test("lo scambio dei lati non tocca i punti", async ({ page }) => {
  await newMatch(page);
  await tap(page, "home", 2);
  await expect(page.locator(".half.left")).toHaveAttribute("data-team", "home");
  await page.getByRole("button", { name: "⇄ Lati" }).click();
  await expect(page.locator(".half.left")).toHaveAttribute("data-team", "guest");
  await expect(points(page, "home")).toHaveText("2");
});

test("dopo una ricarica a metà set si torna allo stesso punto", async ({ page }) => {
  await newMatch(page);
  await tap(page, "home", 3);
  await tap(page, "guest", 2);
  const began = Date.now();
  await page.reload();
  await expect(points(page, "home")).toHaveText("3");
  await expect(points(page, "guest")).toHaveText("2");
  expect(Date.now() - began).toBeLessThan(2000);
  await page.goto("./");
  await expect(points(page, "home")).toHaveText("3");
});

test("a fine partita le metà sono spente, il report si apre e riaprire chiede una pressione lunga", async ({ page }) => {
  await newMatch(page);
  await tap(page, "home", 75);
  await expect(page.locator(".card")).toContainText("PARTITA FINITA");
  await expect(half(page, "home")).toBeDisabled();
  await expect(page.locator("#undo")).toContainText("tieni premuto 2 s");
  await page.locator("#undo").click();
  await expect(page.locator(".card")).toContainText("PARTITA FINITA");
  await page.getByRole("link", { name: "Report" }).click();
  await expect(page.locator(".rset-head")).toHaveCount(3);
  await expect(page.locator(".rhead h1")).toContainText("3 – 0");
});

test("la partita della vecchia app si importa una volta sola", async ({ page }) => {
  await page.goto("./");
  await page.locator("#import").setInputFiles(FIXTURE);
  await expect(page.locator(".matches li")).toHaveCount(1);
  await expect(page.locator(".matches .score")).toHaveText("3–2");
  await page.locator("#import").setInputFiles(FIXTURE);
  await expect(page.locator(".toast")).toContainText("già presente: 0 eventi nuovi");
  await expect(page.locator(".matches li")).toHaveCount(1);
  await page.locator(".matches a").click();
  await expect(page.locator(".rset-head")).toHaveCount(5);
  await expect(page.locator(".rset").nth(3)).toContainText("time-out Ospite");
});

test("una partita continua su un altro dispositivo dal punteggio dichiarato", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: "Continua una partita" }).click();
  await page.fill("input[name=s1h]", "25");
  await page.fill("input[name=s1g]", "21");
  await page.fill("input[name=ch]", "18");
  await page.fill("input[name=cg]", "15");
  await page.getByRole("button", { name: "Continua" }).click();
  await expect(points(page, "home")).toHaveText("18");
  await expect(half(page, "home").locator(".sets b")).toHaveText("1");
  await tap(page, "home", 7);
  await expect(page.locator(".card")).toContainText("2° SET FINITO");
  await expect(half(page, "home").locator(".sets b")).toHaveText("2");
});

test("il link in diretta manda i punti senza mai fermare il gioco", async ({ page, browserName }) => {
  // WebKit does not route CORS preflights through the mock; the real service was tested on both.
  test.skip(browserName === "webkit", "simulazione di rete solo su Chromium");
  const sent: { score: { home: number } }[] = [];
  let online = true;
  await page.route("**/partite/**", async (route) => {
    if (!online) return route.abort();
    if (route.request().method() === "PUT") sent.push(route.request().postDataJSON());
    await route.fulfill({
      json: { ok: true },
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  });
  await newMatch(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Crea il link per seguire" }).click();
  await expect(page.locator(".livelink")).toHaveAttribute("href", /\/s\/[A-Za-z0-9_-]{22}$/);
  await expect(page.locator(".livelink")).toContainText("/s/");
  await page.getByRole("button", { name: "Salva e torna al gioco" }).click();
  await tap(page, "home", 2);
  await expect(page.locator("#live-status")).toHaveText(" · in diretta");
  await expect.poll(() => sent.at(-1)?.score.home).toBe(2);
  expect(JSON.stringify(sent.at(-1))).not.toContain("key");

  online = false;
  await tap(page, "home", 1);
  await expect(points(page, "home")).toHaveText("3");
  await expect(page.locator("#live-status")).toHaveText(" · diretta in attesa di rete");
  online = true;
  await page.clock.fastForward(16_000);
  await expect(page.locator("#live-status")).toHaveText(" · in diretta");
  await expect.poll(() => sent.at(-1)?.score.home).toBe(3);
});

test("una partita si elimina solo dopo la conferma", async ({ page }) => {
  await newMatch(page);
  await tap(page, "home", 2);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Elimina la partita" }).click();
  await page.getByRole("button", { name: "Tieni la partita" }).click();
  await expect(points(page, "home")).toHaveText("2");
  await page.getByRole("link", { name: "Torna alle partite" }).click();
  await expect(page.locator(".matches li")).toHaveCount(1);

  await page.getByRole("button", { name: /Elimina la partita/ }).click();
  await page.getByRole("button", { name: "Tieni la partita" }).click();
  await expect(page.locator(".matches li")).toHaveCount(1);
  await page.getByRole("button", { name: /Elimina la partita/ }).click();
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.locator(".matches li")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".empty")).toBeVisible();
});

test("eliminare dal tabellone riporta alla schermata iniziale e non riapre la partita", async ({ page }) => {
  await newMatch(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Elimina la partita" }).click();
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.locator(".empty")).toBeVisible();
  await page.goto("./");
  await expect(page.locator(".empty")).toBeVisible();
});

test("riconosce la nostra squadra dal nome, a meno che non si scelga a mano", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: "Nuova partita" }).click();
  const us = (value: string) => page.locator(`input[name="us"][value="${value}"]`);
  await page.fill("input[name=home]", "Squadra di casa");
  await page.fill("input[name=guest]", "Le Bande Bassotte");
  await expect(us("guest")).toBeChecked();
  await page.fill("input[name=home]", "Bassotte Volley");
  await page.fill("input[name=guest]", "Altri");
  await expect(us("home")).toBeChecked();
  await page.locator(".choice", { hasText: "Nessuna delle due" }).click();
  await page.fill("input[name=guest]", "Le Bande");
  await expect(us("")).toBeChecked();
});

test("un file estraneo viene rifiutato", async ({ page }) => {
  await page.goto("./");
  await page.locator("#import").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.locator(".toast")).toHaveText("Questo non è un file di partita.");
});

test.describe("senza internet", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "il service worker si prova su Chromium");

  test("una partita intera si segna offline e sopravvive alla ricarica", async ({ page, context }) => {
    await page.goto("./");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator(".status.ok")).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("link", { name: "Nuova partita" }).click();
    await page.getByRole("button", { name: "Inizia" }).click();
    await tap(page, "guest", 40);
    await page.reload();
    await expect(points(page, "guest")).toHaveText("15");
    await tap(page, "guest", 35);
    await expect(page.locator(".card")).toContainText("PARTITA FINITA");
    await expect(page.locator(".card")).toContainText("Ospiti 3–0");
  });
});
