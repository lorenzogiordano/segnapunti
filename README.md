# Segnapunti pallavolo

Web app per segnare le partite di pallavolo su un tablet, anche senza internet.

*   `packages/engine`: regole, rilettura del registro, statistiche, formato del file della partita.
*   `apps/scorer`: il segnapunti, installabile sulla schermata Home.

## Installare sul tablet

1.  Apri l'indirizzo dell'app con internet: https://lorenzogiordano.github.io/segnapunti/
2.  iPad: Safari → Condividi → Aggiungi alla schermata Home. Android: Chrome → menu → Installa app.
3.  Apri l'app dall'icona. In alto deve comparire "Pronta per l'uso senza internet".

Da quel momento funziona senza rete. Va aperta sempre dall'icona: Safari e schermata Home possono avere memorie separate.

## Sviluppo

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
```
