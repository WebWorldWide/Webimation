# Webimation

<p align="center"><img src="assets/logo/lockup-light.svg" alt="Webimation" width="420"></p>

**Motion graphics for video creators, ready to drop into any editor.**

## What it's for

Most motion graphics tools are built for motion designers: timelines, keyframes, expressions, a steep learning curve. Most template packs are the opposite: fixed, hard to restyle, and locked to one editor.

Webimation sits between the two. The goal is that someone making videos can:

1. **Pick** from a big library of finished graphics, shapes, stick-figure scenes and animations, each one already well made.
2. **Change** the words, colours, fonts and motion until it fits their video, without learning animation.
3. **Export** it as a real transparent video file (or a ready-placed timeline) that works in **Premiere Pro, DaVinci Resolve, Final Cut Pro, CapCut** and anything else that can layer video.

Three principles drive the design:

- **Editor-agnostic output.** Nothing is tied to one editor. You get ProRes 4444, WebM, PNG sequences and FCPXML / Premiere XML timelines.
- **Exact, repeatable frames.** Every graphic is a pure function of time, so scrubbing, looping and export always agree, and 4K is rendered as vector at the output size, never upscaled.
- **Calm, precise tools.** A light interface with one highlight colour, hard-edged motion with no mush, and a 90s pixel-art identity.

Webimation is a desktop app for **macOS, Windows and Linux**, built with [Tauri](https://tauri.app). The engine is native Rust (`src-tauri/crates/wcore`); the UI is React (`src/app`).

**New to Webimation? Start with the [user guide](docs/USER_GUIDE.md).** It walks through everything from installing to dropping your export into a video editor.

## Run it

You need Node 20.19+ and Rust (stable) with the WebAssembly target (`rustup target add wasm32-unknown-unknown`). Linux also needs the WebKitGTK dev packages; see the [Tauri prerequisites](https://tauri.app/start/prerequisites/). Video export uses **ffmpeg** if it's installed (`brew install ffmpeg` · `winget install ffmpeg` · `sudo apt install ffmpeg`); PNG sequences work without it.

```sh
npm install
npm run app          # desktop app with hot reload
npm run app:build    # installers for the platform you're on → src-tauri/target/release/bundle/
npm run dev          # same UI in a browser at http://localhost:5173
npm run engine       # rebuild the WebAssembly engine (dev and build do this for you)
npm test             # front-end and engine tests
npm run icons        # regenerate every app icon from assets/logo/build.py
```

### Installers for every platform

`.github/workflows/desktop.yml` builds on macOS (universal), Windows and Linux on every push. The installers appear under the run's **Artifacts**: `.dmg`/`.app`, `.msi`/`.exe`, `.deb`/`.rpm`/`.AppImage`. Push a `v*` tag (for example `v0.1.0`) and it also drafts a GitHub release with all of them attached.

The builds aren't code-signed yet. The first time you open it, macOS needs **right-click → Open** and Windows SmartScreen needs **More info → Run anyway**. To sign, add the Apple and Windows certificates as repository secrets and pass them to `tauri-action`. See Tauri's signing guides for [macOS](https://tauri.app/distribute/sign/macos/) and [Windows](https://tauri.app/distribute/sign/windows/).

## How it's built

Every frame is rendered by **wcore**, a native Rust engine in `src-tauri/crates/wcore`. The same code runs in two places:

- **In the desktop app's export**, compiled natively and run on every CPU core. Raw frames are piped straight into ffmpeg, with no PNG round-trip and no webview in the loop.
- **In the UI's live previews**, compiled to WebAssembly and run in a pool of web workers, so scrubbing never blocks the interface.

A frame is a pure function of time: `render(scene, t, width, height)`. Previews, scrubbing and export always agree, and 4K is drawn at 4K, never upscaled. The UI (`src/app`, React) only edits a JSON scene and shows the engine's pictures.

Rendering speed at 1080p on an M-series Mac, all cores:

| Scene | Frames per second |
|---|---|
| Lower third | ~6,800 |
| Channel intro (pixel art, clouds, title) | ~1,100 |
| ASCII drop (full-frame glyph field, glow, scanlines) | ~100 |

`cargo run --release --example bench` in `src-tauri/crates/wcore` reproduces these.

## Three ways in

**Quick** is for anyone. **Pick** an animation, **Make it yours** (words, colour set, one of five type looks, Wipe/Slide/Pop/Type-on at Calm/Normal/Snappy, a 9-spot grid, a length), then **Drop it in**: pick your editor and Webimation picks the file type. Finished clips drag straight from the app onto your editor's timeline. "Export like last time" makes the next one a single click.

**Animation Lab** works like PowerPoint's Animations tab, and **Pixel Paint** works like MS Paint for sprites.

- **Animation Lab:** click anything on the slide, then choose how it *comes in*, what it does *while on screen*, and how it *goes out*. Objects snap to a pixel grid (Chunky 64, Classic 128 or Fine 256) and move in whole grid pixels at 30, 12 or 6 fps. Seven starter scenes arrive fully animated. **✦ Animate everything** and **Restyle everything** do the rest in one click. 16:9, 9:16 Shorts and square formats show YouTube's safe zones.
- **Pixel Paint:** a grid editor with pencil, line, box, circle, fill, eraser and picker, plus mirror modes, an 8-pixel guide grid, flipbook frames with onion skin and keyboard drawing. A live "Make it move" preview shows your sprite bobbing, spinning or drifting across a Web World Wide sky, as pixels or as ASCII.

**Studio** is the pro editor, in six workspaces:

- **Edit:** layers, a viewer with handles and snap guides, an inspector with keyframes, and a multi-track timeline with markers, mute/solo, trimming and automation lanes.
- **Draw:** 20 editable vector shapes. Drag one out, style it (outline, solid, hard shadow, pixel, glyph), then **Make it move**.
- **Library:** every animation by shelf, with mood and property filters, live previews, seeded variations and *Apply to selection*.
- **Glyph Lab:** an ASCII workstation in the style of omp.sh, with 14 looping channels including your own text and logo. The Glyphs tab offers 26 monospace fonts, 13 character sets, sort-by-measured-ink and brightness/random/message picking. The Tone tab has levels with a live histogram and eight dithers: Bayer 2/4/8, blue noise, Floyd–Steinberg, Atkinson and row diffusion. The Colour tab has 12 palettes and editable colour bands. The Field tab handles zoom, rotate, warp and playback. The Screen tab adds scanlines, grain, glow, RGB split and phosphor. Looks can be saved, and any frame copies as text.
- **Mix:** every layer is a channel strip with effect slots, a blend mode, a fader and a live coverage meter. Automation modes are Off, Read, Touch, Latch and Write. Press play and ride a fader to record keyframes.
- **Bounce:** export the selection, each layer, the whole timeline, an in-to-out range, or a **timeline for your editor**. That last option writes every clip plus an FCPXML (Resolve, Final Cut) and an XML (Premiere), each clip placed at its time. It supports handles, file-name patterns and a queue you can drag finished clips out of.

## What's in the library

The library is generated from the engine's catalogue, so every item is a real animation the engine renders. There are 422 today:

- **20 finished cards:** name tag, lower third, arrow, circle it, callout, big number, percent, checklist, steps, subscribe, like & comment, chapter, title, countdown, quote, location, breaking bar, versus, pixel title and ASCII title.
- **65 effects:** 24 entrances, 21 while-on-screen motions and 20 exits. Cell effects such as type on, rain in, scan in, dither in/out, decode, melt, glyph scatter, shimmer, wave rows and row glitch work cell by cell on pixel art and ASCII.
- **The Web World Wide pixel set:** the four cloud bitmaps and the bob, float, sway, wiggle, pulse, glow pulse, blink, shadow lift, 3D spin and cloud drift timings, taken from the website's `home.css`, `sky.css` and `SkyBackdrop`.
- **Glyph and dither fields, transitions in four directions on three plates, shapes, and background loops.**

## Export formats

| Your editor | You get | Transparent |
|---|---|---|
| Premiere Pro, DaVinci Resolve, Final Cut Pro, After Effects | ProRes 4444 `.mov` (or HEVC with alpha on a Mac, for smaller files) | yes |
| CapCut | WebM VP9 | yes |
| Something else | PNG sequence | yes |
| Quick previews | MP4 H.264 | no |

Video formats need ffmpeg (`brew install ffmpeg` · `winget install ffmpeg` · `sudo apt install ffmpeg`). PNG sequences don't. The browser build exports PNG sequences as a `.zip`.

## Code map

| Path | What it is |
|---|---|
| `src-tauri/crates/wcore/src/render.rs` | Composes a scene at time t: rasterise each object, run cell effects, apply transforms, composite, post. |
| `anim.rs` | The effect catalogue and how each entrance, motion and exit is evaluated. |
| `glyph.rs`, `dither.rs`, `tone.rs`, `palette.rs`, `field.rs`, `screen.rs` | The ASCII pipeline: channels → tone → dither → characters → colour → CRT. |
| `text.rs`, `fonts.rs`, `pixel.rs`, `shapes.rs` | Native text layout with 36 bundled OFL fonts, built-in pixel fonts and sprites, and vector shapes. |
| `cards.rs`, `looks.rs` | Quick cards, one-click glyph looks and starter scenes. |
| `src-tauri/src/bounce.rs` | Native export: parallel render → ffmpeg, progress events, cancel, drag icons. |
| `src/app` | The React UI: `screens/` (Quick, Lab, Paint, Studio tabs), `engine.ts` (wasm worker pool), `library.ts`, `layout.ts`, `bounce.ts`. |

**Adding an effect:** add an `FxDef` to `EFFECTS` in `anim.rs`, then handle its id in `enter_xf`, `on_xf`, `exit_xf` or `cell_pass`. The test suite checks that every entrance is hidden before its cue and untouched once it lands. It also checks that every exit leaves nothing behind. The library and every effect picker pick it up automatically.

## Tests

```sh
npm test                 # front-end tests + every engine test
npm run test:engine      # engine and native export tests (encodes real ProRes/WebM/MP4/HEVC if ffmpeg is installed)
```

The engine tests cover a lot of ground:

- Frames are pure functions of time, and field channels loop seamlessly.
- Dithers keep average density and error diffusion conserves ink.
- Every cell effect is empty at 0 and complete at 1, and every card expands.
- Starter scenes stay inside the frame, and missing symbols fall back to pixel glyphs.
- Exported files decode with the right codec and alpha.

## Logo

`assets/logo/build.py` draws the pixel-art mark: a chunky 90s CRT monitor with a play button on a blue tile, on an exact 64×64 grid. `npm run icons` regenerates every app icon.
