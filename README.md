# CutYard PRO

Kaplistor, skivoptimering, borrschema och beslagslistor för skåp, lådor och shaker-dörrar.
Allt körs i webbläsaren och fungerar offline när sidan har laddats en gång.

## Funktioner

- **Enkelt att börja** – "Lägg till" visar färdiga val (bänkskåp, väggskåp, högskåp, garderob, bokhylla, lådor, shaker-dörr, fria delar). Formulären visar bara det viktigaste; resten finns under "Fler inställningar", som visar hur många värden som ändrats från standard. Offerten visas när man valt "Jag tar betalt för jobbet" i Inställningar.
- **Fria delar** – skriv in fria delar med antal, mått, tjocklek, skivtyp, kantlist per kant och ådring per del, eller klistra in rader direkt från Excel, Numbers eller en CSV-fil.
- **Verkstadsläge** – sågordning med ett snitt i taget, stora siffror och markering av snittet på skivan. Var man är sparas, så man kan fortsätta senare.
- **Virke på längden** – shaker-ramar och fria delar kan sågas ur brädor. Brädorna optimeras på längden med sågspalt och kapning i ändarna, med egen längd och meterpris per dimension.
- **Skåptyper** – bänk-, vägg- och högskåp med standardmått, sockel, mellanväggar och garderobsstång. "Hela projektet" i 3D-vyn visar alla skåp tillsammans som en vägg.
- **Hyllhål och spår** – hyllhålsrader enligt 32-mm-systemet och bakstycke i spår, med mått under Borrning och på utskriften.
- **Export till DXF och SVG** – alla skärscheman i en fil i skala 1:1, för CNC och CAD.
- **Offert** – material, kantlist och beslag med egna inköpspriser, arbetstid, påslag och moms. Offerten skrivs ut som PDF med dina företagsuppgifter och sparas med projektet.
- **Delningslänk** – hela projektet komprimeras in i länken, så inget konto eller någon server behövs. Offerten följer bara med om man väljer det.
- **Beställ kapning** – en färdig beställning till en bygghandel eller kapservice, med skivor, mått, ådring och kantlist per kant. Skickas som e-post eller skrivs ut.
- **Skivtyp** – ett frivilligt namn (t.ex. "Björkplywood") skiljer skivor med samma tjocklek åt.
- **Projekt med flera objekt** – skåp, fristående lådor och shaker-dörrar optimeras tillsammans på samma skivor.
- **Skåp med fronter** – dörrar (släta eller shaker) med spel och gångjärnsborrschema, eller lådfronter med färdigräknade lådlådor.
- **Förinställda lådskenor** – kullagerskenor, Blum MOVENTO, Blum TANDEM, Hettich Actro 5D eller eget spel. Måtten är riktvärden; kontrollera mot tillverkarens monteringsanvisning.
- **Giljotinoptimering** – alla snitt går rakt igenom skivan, med sågspalt och kantputs. Flera sorteringar och delningsregler provas och den billigaste layouten väljs.
- **Fria tjocklekar och spillager** – alla tjocklekar skrivs in direkt i formuläret. Delar med samma tjocklek optimeras på samma skivor; skivformat och pris ställs in under Inställningar och kan ändras per tjocklek, t.ex. 2800 × 2070 för en viss skiva. Spillbitar sparas och används före nya skivor.
- **Utskrift/PDF** – kaplista, beslag, borrschema, skärscheman med delnummer och etiketter med QR-kod.
- **Profiler för shaker-dörrar** – ramprofiler (rak, kontraprofil, ogee, rundad, fas) och fyllningar (platt eller upphöjd) med tvärsnittsskiss och vilka fräsar som ger profilen.
- **Beslagslista med länkar** – Blum- och Hettich-beslag länkar till tillverkarens produktsida. Köplänkar via Prisjakt, Google Shopping eller en egen länkmall (t.ex. med affiliate-parameter).
- **Ångra** – objekt tas bort direkt med ✕ i projektlistan och kan ångras från notisen eller med Ctrl/Cmd+Z. Samma gäller spillager, nytt och öppnat projekt.
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
| `src/listEditor.js` | Redigeraren för fria delar. |
| `src/workshop.js` | Verkstadsläget. |
| `src/export.js` | Export av skärscheman till DXF och SVG. |
| `src/share.js` | Delningslänk: projektet komprimerat i adressens #-del. |
| `sw.js` | Service worker för offline. Höj `VERSION` när filer ändras. |
| `tests/core.test.js` | Enhetstester, bl.a. att varje skärschema går att såga med giljotinsnitt. |
