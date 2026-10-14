# Webimation

Motion graphics for YouTube. Pin graphics to a transcript, pick how they move from hundreds of animations (or build your own), and render.

Webimation is a desktop app for **macOS, Windows and Linux**, built with [Tauri](https://tauri.app). The UI is the web code in `src/`; `src-tauri/` is the native shell.

## Run it

You need Node 20.19+ and Rust (stable). Linux also needs the WebKitGTK dev packages; see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run app          # desktop app with hot reload
npm run app:build    # installers for the platform you're on → src-tauri/target/release/bundle/
npm run dev          # same UI in a browser at http://localhost:5173
npm test
```

### Installers for every platform

`.github/workflows/desktop.yml` builds on macOS (universal), Windows and Linux on every push. The installers appear under the run's **Artifacts**: `.dmg`/`.app`, `.msi`/`.exe`, `.deb`/`.rpm`/`.AppImage`. Push a `v*` tag (for example `v0.1.0`) and it also drafts a GitHub release with all of them attached.

The builds aren't code-signed yet. The first time you open it, macOS needs **right-click → Open** and Windows SmartScreen needs **More info → Run anyway**. To sign, add the Apple and Windows certificates as repository secrets and pass them to `tauri-action`. See Tauri's signing guides for [macOS](https://tauri.app/distribute/sign/macos/) and [Windows](https://tauri.app/distribute/sign/windows/).

## The Studio

The Studio follows the *Plotline Studio* design, with light-mode chrome and blue highlights by default (switch to dark in the header). It has a timeline, transcript pinning, an inspector and a render queue. Click a word in the transcript to pin a graphic there. Drag clips to move them, and drag a clip's right edge to trim it. Shortcuts: Space play · ← → frame · ⇧ 1 s · `[` `]` graphic · Del remove · `M` motion library.

The inspector's **Reveal** control keeps the design's Wipe / Mask / Cut options. Below it, **Motion preset** opens the motion library and **Shuffle** picks a random preset.

## Motion library and Lab

There are **399 built-in presets** across 40 effect families, and every one has a live thumbnail. Click a preset to load it into the **Motion Lab**, or double-click to apply it to the selected graphic. In the Lab you can:

- set the enter and exit effects, plus each effect's own parameters
- pick the curve (quart-out, in-out, linear, or 4/8/16 hard steps)
- choose the stagger order and spread, cue gap, pace, exit length and exit stagger
- preview the result on a specimen or on the selected graphic, with scrubbing
- **Mint new**: roll a never-seen recipe from the whole effect space. Every seed gives a different animation, so the number of presets is effectively unlimited.
- save custom presets, and export or import them as `.webimation.json` files using native file dialogs

## Engine (`src/engine`)

Everything follows the design's motion rules. Every frame is a pure function of time, so graphics scrub, loop and render frame-exact. Enters are quart-out and exits are cubic-in. Reveals use hard edges: no fades, no springs, no drift.

| File | What it does |
|---|---|
| `effects.ts` | Effect families. Each one turns enter/exit progress into clip-paths, transforms or glyph swaps on a target. |
| `presets.ts` | Preset recipes, the minted library, signature set, custom store, seeded `mint()` and JSON `sanitize()`. |
| `templates.ts` | Graphic templates (6 from the design + 9 more) built from `R(start, dur, html)` reveal cues. |
| `stage.ts` | `createStage(host)` → `show(clip, localTime)`. Wires each cue to the clip's preset. |
| `target.ts` | Wrapper/inner element pair, plus masked char/word/line text splitting. |
| `geom.ts`, `easing.ts`, `rand.ts` | Rect-union polygons, curves, and deterministic ordering. |

**Adding an effect:** add an `EffectDef` to `effects.ts` with `params` options, and the library mints a preset for every combination automatically. Its `make(target, params, ctx)` returns `(k, x) => void`. Here `k` and `x` are linear enter and exit progress. The frame where `k = 1, x = 0` must leave the element untouched.

**Adding a graphic:** add a `Template` to `templates.ts`. Wrap each revealable element in `R(start, dur, html)`, and use `fx: 'wipe'` for thin decor like rules and accent bars. The other cue attributes (`data-c`, `data-draw`, `data-cut`, `data-seg`, …) are documented at the top of that file.
