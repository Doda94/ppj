# PPJ Dizajn sustav (Notion-inspirirani UI)

Zajednički vizualni sustav za sve interaktivne PPJ simulacije. Dizajniran je za samostalne vanilla HTML/CSS/JS stranice bez vanjskih zahtjeva, build koraka ili web fontova, te za čisto ugrađivanje u Notion (`<iframe>`).

## Izvor i licenca

Dizajn tokeni i obrasci komponenti (svijetla i tamna paleta boja, fokus prsten, radijusi, stilovi gumba, unosa, tablica, kartica, tabova, oznaka i tooltipova) preuzeti su i prilagođeni iz **Notion Kita** (`@notion-kit/ui`, [steeeee0223/notion-kit](https://github.com/steeeee0223/notion-kit), [dokumentacija](https://notion-ui.vercel.app/docs/components/)):

- **Licenca izvora:** MIT License (Copyright © 2023 Julius Marminge)
- **Datoteke reference:** `design/notion-theme.css`, `tooling/tailwind/base.css`, `packages/ui/src/primitives/*`, `packages/code-block/src/*`, `packages/utils/src/constants.ts`.
- **Napomena o zaštitnim znakovima:** Ne koriste se Notionov logotip, ilustracije niti vlasnička grafička imovina. Sve boje prilagođene su za minimalni kontrast **WCAG AA (>= 4.5:1)** u obje teme.

## Uključivanje u stranicu

U `<head>` svake simulacije uključiti prije tijela stranice (sprječava bljesak pogrešne teme):

```html
<script src="../../assets/theme.js"></script>
<link rel="stylesheet" href="../../assets/style.css">
```

## Upravljanje temom i embed načinom (`assets/theme.js`)

| URL parametar | Učinak | Atribut na `<html>` |
|---|---|---|
| `?theme=light` | Prisiljava svijetlu temu bez obzira na OS | `data-theme="light"` |
| `?theme=dark` | Prisiljava tamnu temu bez obzira na OS | `data-theme="dark"` |
| *(bez `theme`)* | Prati `@media (prefers-color-scheme: dark)` | *(bez atributa)* |
| `?embed=1` (ili unutar `<iframe>`) | Kompaktno zaglavlje, skriveni `p.lead`/`.footer`, vidljiv `.popout`, bez vanjskih margina | `data-embed="1"` i `.in-embed` |

## Dizajn tokeni

### Tipografija
- `--sans`: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, ...`
- `--mono`: `SFMono-Regular, Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace`
- Tijelo teksta: `16px / 1.5`; `h1` (`clamp(26px, 3.6vw, 34px)`), `h2` (`19px`), `h3` (`15.5px`).

### Boje (svijetla / tamna)
- Pozadina i površine: `--bg` (`#ffffff` / `#191919`), `--panel` (`#ffffff` / `#202020`), `--bg-subtle` (`#f7f6f3` / `#202020`), `--bg-hover`, `--bg-input`
- Tekst: `--ink` (`#37352f` / `rgba(255,255,255,0.85)`), `--muted` (`#6b6a65` / `#9b9b9b`)
- Rubovi: `--line` (`rgba(55,53,47,0.16)` / `rgba(255,255,255,0.14)`), `--line-subtle`
- Akcent i fokus: `--accent`, `--accent-btn`, `--accent-hover`, `--focus-ring`
- 9 Notion boja oznaka: `--n-{gray,brown,orange,yellow,green,blue,purple,pink,red}` i `--n-*-bg`
- Semantički tokeni: `--ok`, `--warn`, `--err`, `--info` (s `-bg` i `-border` varijantama)
- Inline kod: `--code-ink` + `--code-bg`
- Isticanje (SVG i tablice): `--hl`, `--hl-ink`, `--hl-stroke`, `--chip`, `--chip-ink`

## Komponente i klase

- **Raspored:** `.wrap` (900 px), `.wrap.wide` (1120 px), `.panel`, `.row`, `.grid2`, `.grid3`, `.gwrap` / `.tblwrap` (vodoravni scroll unutar okvira), `.topbar`, `.popout`
- **Gumbi i alatne trake:** `.btn`, `.btn.sm`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.active`, `.toolbar` (`.sep`, `.spacer`), `.ctrl` (sticky traka)
- **Forme:** `input[type=text|search|number]`, `textarea`, `select`, `input[type=checkbox|radio|range]`, `label.check-label`
- **Callout:** `.callout` + `.info` / `.ok` / `.warn` / `.err` sa `.callout-icon` i `.callout-body`
- **Toggle:** `<details class="toggle">` (opcionalno `.boxed`) sa `<summary>` i `.toggle-body`
- **Oznake i statusi:** `.tag` / `.chip` (varijante boja: `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`, `ok`, `warn`, `err`, `info`, `hl`), `.badge` (`.ok`, `.err`, `.warn`, `.info`), `.verdict`
- **Tablice:** `table.t` (`.hl` na retku ili ćeliji)
- **Kod i tipke:** inline `<code>` (ili `.code-inline`), `<pre class="code">`, `<kbd>` / `.kbd`
- **Navigacija i napredak:** `.tabs` / `.tab`, `.stepper` / `.step` (`.done`, `.active`), `.progress` / `.progress-bar`, `[data-tooltip="..."]`
- **SVG automati:** `svg .node`, `.node.final`, `.node.active`, `.node.sel`, `.node.src`, `.ring`, `.nid`, `.edge`, `.edge.active`, `.arr`, `.arr.act`, `.lbl`, `.lbl.act`, `.acc`, `.cap`

## Pravila korištenja

1. Nikad ne stavljati tvrdo kodirane hex/rgb boje u simulacije — koristiti isključivo CSS varijable iz `assets/style.css`.
2. Široke SVG dijagrame i tablice uvijek omotati u `.gwrap` ili `.tblwrap` kako na 375 px i u 700 px iframeu ne bi nastao vodoravni scroll cijele stranice.
3. Koristiti `button` s jasnim tekstom i vidljivim `:focus-visible` fokus prstenom; izbjegavati uklanjanje `outline` bez zamjene za `--focus-ring`.
4. Galerija svih komponenti dostupna je na [styleguide/index.html](../styleguide/index.html).
