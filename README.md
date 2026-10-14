# willamesyano.github.io

Personal website of Willames Yano, published with GitHub Pages at <https://willamesyano.github.io>.

The career section is an interactive 3D timeline built with [Three.js](https://threejs.org/). Selecting a phase shows its activities and technologies. The site is available in English and Brazilian Portuguese.

## Editing the content

All text lives in `assets/data/content.json`:

- `profile`: name, headline, summary, email and social links. Text wrapped in `**double asterisks**` renders in bold.
- `phases`: one entry per career phase, in chronological order. `short` is the label shown in the 3D scene, `start` and `end` use `YYYY-MM`, and `end: null` marks the current position. `kind: "break"` marks a career break, drawn as a small translucent block, and `photos` adds a gallery to the phase.
- `education`, `certifications` and `languages`: the background section. A certification has a `name` and, optionally, an `issuer` with a `date` in `YYYY-MM`.
- `ui`: interface strings.

Translatable fields hold one value per language: `{ "en": "...", "pt-BR": "..." }`.

## Running locally

The page loads its content with `fetch`, so it needs an HTTP server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Add `?lang=pt-BR` or `?lang=en` to force a language.

## Structure

```
index.html
assets/
  css/site.css
  js/main.js             content rendering, language switch, phase selection
  js/career-scene.js     Three.js scene
  data/content.json
  img/favicon.svg
  vendor/three/          Three.js r170 (MIT)
```

There is no build step. Every file is served as is.
