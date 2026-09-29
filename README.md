# CutYard PRO

Kaplistor, skivoptimering, borrschema och beslagslistor för skåp, lådor och shaker-dörrar.
Allt körs i webbläsaren och fungerar offline när sidan har laddats en gång.

## Funktioner

- **Projekt med flera objekt** – skåp, fristående lådor och shaker-dörrar optimeras tillsammans på samma skivor.
- **Skåp med fronter** – dörrar (släta eller shaker) med spel och gångjärnsborrschema, eller lådfronter med färdigräknade lådlådor.
- **Förinställda lådskenor** – kullagerskenor, Blum MOVENTO, Blum TANDEM, Hettich Actro 5D eller eget spel. Måtten är riktvärden; kontrollera mot tillverkarens monteringsanvisning.
- **Giljotinoptimering** – alla snitt går rakt igenom skivan, med sågspalt och kantputs. Flera sorteringar och delningsregler provas och den billigaste layouten väljs.
- **Materialbibliotek och spillager** – egna material med pris, format och ådring. Spillbitar sparas och används före nya skivor.
- **Utskrift/PDF** – kaplista, beslag, borrschema, skärscheman med delnummer och etiketter med QR-kod.
- **Beslagslista med köplänkar** – Prisjakt, Google Shopping eller en egen länkmall (t.ex. med affiliate-parameter).
- **Export** – CSV med svenska decimaler och kopiering direkt till Excel. Projekt sparas som `.cutyard`-filer.
- **PWA** – kan installeras och fungerar offline. Inga CDN:er; typsnitt och bibliotek ligger lokalt.

## Utveckling

```bash
npm install
npm run build      # bygger assets/app.css och kopierar vendor-filer
npm test           # enhetstester för beräkningskärnan (node --test)
npm run serve      # http://localhost:8080
```

`npm run watch:css` bygger om CSS vid ändringar. De byggda filerna (`assets/app.css`, `vendor/`, `assets/fonts/`)
checkas in så att sidan kan publiceras som statiska filer utan byggsteg. CI kontrollerar att de är uppdaterade.

## Struktur

| Fil | Innehåll |
| --- | --- |
| `src/core.js` | All beräkning: byggare, lådskenor, gångjärn, gruppering, optimering, CSV. Inga DOM-beroenden. |
| `src/app.js` | Gränssnitt, formulär, projekt, material, export. |
| `src/viewer.js` | 3D-vyn (Three.js). |
| `src/draw.js` | Ritar skärscheman på canvas. |
| `src/print.js` | Utskriftsvy med QR-etiketter. |
| `sw.js` | Service worker för offline. Höj `VERSION` när filer ändras. |
| `tests/core.test.js` | Enhetstester, bl.a. att varje skärschema går att såga med giljotinsnitt. |
