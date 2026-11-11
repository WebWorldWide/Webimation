//! The animation catalogue: entrances, while-on-screen motions and exits, and how each one is
//! evaluated. Transform effects return an `Xf`; cell effects rewrite a raster cell by cell.
//! Everything is a pure function of (progress, time, seed).

use serde::Serialize;
use crate::dither::{threshold, DitherKind};
use crate::frame::{Frame, Rgba};
use crate::math::{clamp01, hash2, hash3, Ease};
use crate::scene::{Dir, FxIn, FxOn, FxOut};
use std::f32::consts::TAU;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Slot { In, On, Out }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Family { Clean, Pixel, Glyph, Fun, Shape, Text }

#[derive(Clone, Debug, Serialize)]
pub struct FxDef { pub id: &'static str, pub name: &'static str, pub slot: Slot, pub family: Family, pub blurb: &'static str, pub cell: bool, pub has_dir: bool }

macro_rules! fx { ($id:literal, $name:literal, $slot:ident, $fam:ident, $blurb:literal, $cell:literal, $dir:literal) => { FxDef { id: $id, name: $name, slot: Slot::$slot, family: Family::$fam, blurb: $blurb, cell: $cell, has_dir: $dir } }; }

pub const EFFECTS: &[FxDef] = &[
  // Comes in
  fx!("none", "None", In, Clean, "Already there", false, false),
  fx!("appear", "Appear", In, Clean, "Cuts in on one frame", false, false),
  fx!("fade", "Fade", In, Clean, "Fades up", false, false),
  fx!("wipe", "Wipe", In, Clean, "Revealed by a hard edge", true, true),
  fx!("slide", "Slide in", In, Clean, "Slides into place", false, true),
  fx!("pop", "Pop", In, Clean, "Scales up with a small overshoot", false, false),
  fx!("rise", "Rise", In, Clean, "Rises into place", false, false),
  fx!("zoom", "Zoom in", In, Fun, "Zooms down from big", false, false),
  fx!("stamp", "Stamp", In, Fun, "Slams down at a slight angle", false, false),
  fx!("drop-bounce", "Drop & bounce", In, Pixel, "Falls in and bounces", false, false),
  fx!("blocky-wipe", "Blocky wipe", In, Pixel, "Wipes in chunky dithered blocks", true, true),
  fx!("typewriter", "Typewriter", In, Pixel, "One letter at a time", true, false),
  fx!("flicker-on", "Flicker on", In, Pixel, "Flickers like an old screen", false, false),
  fx!("spin3d-in", "3D spin in", In, Pixel, "Spins in like a coin", false, false),
  fx!("letter-cascade", "Letter cascade", In, Text, "Letters rise one after another", true, false),
  fx!("decode", "Decode", In, Glyph, "Scrambled symbols settle into words", true, false),
  fx!("type-on", "Type on", In, Glyph, "Cells appear in reading order", true, false),
  fx!("dither-in", "Dither in", In, Glyph, "Fills in through 25, 50, 75% patterns", true, false),
  fx!("rain-in", "Rain in", In, Glyph, "Columns rain down into place", true, false),
  fx!("scan-in", "Scan in", In, Glyph, "A bright line sweeps it on", true, false),
  fx!("blinds", "Blinds", In, Clean, "Horizontal bands open", true, false),
  fx!("pixelate-in", "Pixelate in", In, Pixel, "Resolves from big pixels", true, false),
  fx!("glitch-in", "Glitch in", In, Glyph, "Rows tear, then settle", true, false),
  fx!("swoop", "Swoop", In, Fun, "Curves in from the corner", false, true),
  fx!("draw-on", "Draw on", In, Shape, "The outline draws itself on", false, false),
  // While on
  fx!("none", "Still", On, Clean, "Holds still", false, false),
  fx!("bob", "Bob", On, Pixel, "A slow up and down", false, false),
  fx!("float", "Float around", On, Pixel, "Drifts in a small loop", false, false),
  fx!("sway", "Sway", On, Pixel, "A gentle lift and settle", false, false),
  fx!("wiggle", "Wiggle", On, Fun, "A tilt and a nudge", false, false),
  fx!("pulse", "Pulse", On, Fun, "Grows and shrinks", false, false),
  fx!("glow-pulse", "Glow pulse", On, Pixel, "Breathes brighter", true, false),
  fx!("blink", "Blink", On, Pixel, "On, off, on", false, false),
  fx!("shadow-lift", "Shadow lift", On, Pixel, "Lifts off its shadow", false, false),
  fx!("drift-across", "Drift across", On, Pixel, "Crosses the screen and wraps", false, true),
  fx!("spin3d", "3D spin", On, Pixel, "Turns like a coin", false, false),
  fx!("shimmer", "Shimmer", On, Glyph, "Cells twinkle", true, false),
  fx!("wave-rows", "Wave rows", On, Glyph, "Rows ripple sideways", true, false),
  fx!("row-glitch", "Row glitch", On, Glyph, "Rows tear now and then", true, false),
  fx!("colour-cycle", "Colour cycle", On, Glyph, "Hue rolls through the rainbow", true, false),
  fx!("sparkle", "Sparkle", On, Pixel, "Cells flash white", true, false),
  fx!("breathe", "Breathe", On, Clean, "A tiny slow scale", false, false),
  fx!("jitter", "Jitter", On, Fun, "Hand-held shake on hard frames", false, false),
  fx!("rotate", "Rotate", On, Fun, "Turns round and round", false, false),
  fx!("hover", "Hover", On, Clean, "Floats a few pixels", false, false),
  fx!("click", "Click", On, Fun, "Presses down every couple of seconds", false, false),
  // Goes out
  fx!("stay", "Stay till end", Out, Clean, "Stays until the clip ends", false, false),
  fx!("disappear", "Disappear", Out, Clean, "Cuts off", false, false),
  fx!("fade", "Fade out", Out, Clean, "Fades away", false, false),
  fx!("wipe", "Wipe off", Out, Clean, "A hard edge takes it away", true, true),
  fx!("slide", "Slide out", Out, Clean, "Slides off", false, true),
  fx!("shrink", "Shrink", Out, Clean, "Shrinks to nothing", false, false),
  fx!("pop-out", "Pop out", Out, Fun, "A quick pull then gone", false, false),
  fx!("drop", "Drop", Out, Fun, "Falls off the bottom", false, false),
  fx!("rise-out", "Rise out", Out, Clean, "Lifts away", false, false),
  fx!("blocky-wipe", "Blocky wipe", Out, Pixel, "Chunky dithered wipe off", true, true),
  fx!("spin3d-out", "3D spin out", Out, Pixel, "Spins away", false, false),
  fx!("dither-out", "Dither out", Out, Glyph, "Thins out through patterns", true, false),
  fx!("type-off", "Type off", Out, Glyph, "Cells vanish in reading order", true, false),
  fx!("decode-out", "Decode out", Out, Glyph, "Scrambles then clears", true, false),
  fx!("glyph-scatter", "Glyph scatter", Out, Glyph, "Cells fly apart", true, false),
  fx!("melt", "Melt", Out, Glyph, "Columns drip away", true, false),
  fx!("glitch-out", "Glitch out", Out, Glyph, "Tears apart", true, false),
  fx!("pixelate-out", "Pixelate out", Out, Pixel, "Breaks into big pixels", true, false),
  fx!("blinds", "Blinds", Out, Clean, "Bands close over it", true, false),
];
pub fn effect(slot: Slot, id: &str) -> Option<&'static FxDef> { EFFECTS.iter().find(|e| e.slot == slot && e.id == id) }
pub fn is_cell(slot: Slot, id: &str) -> bool { effect(slot, id).map(|e| e.cell).unwrap_or(false) }

/// A transform applied when a raster is blitted: translation (output px), scale, rotation, opacity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Xf { pub dx: f32, pub dy: f32, pub sx: f32, pub sy: f32, pub rot: f32, pub opacity: f32, pub visible: bool }
impl Xf {
  pub const ID: Xf = Xf { dx: 0.0, dy: 0.0, sx: 1.0, sy: 1.0, rot: 0.0, opacity: 1.0, visible: true };
  pub fn then(self, o: Xf) -> Xf { Xf { dx: self.dx + o.dx, dy: self.dy + o.dy, sx: self.sx * o.sx, sy: self.sy * o.sy, rot: self.rot + o.rot, opacity: self.opacity * o.opacity, visible: self.visible && o.visible } }
}

/// Entrance transform at linear progress `k`. `amp` is the travel distance in output pixels.
pub fn enter_xf(fx: &FxIn, k: f32, amp: f32, seed: u32) -> Xf {
  let e = fx.ease.apply(k);
  let (vx, vy) = fx.dir.vec();
  let s = fx.size.k();
  if k <= 0.0 { return Xf { visible: false, ..Xf::ID }; }
  match fx.id.as_str() {
    "fade" => Xf { opacity: e, ..Xf::ID },
    "slide" => Xf { dx: -vx * amp * s * (1.0 - e), dy: -vy * amp * s * (1.0 - e), ..Xf::ID },
    "pop" => { let b = Ease::BackOut.apply(k); Xf { sx: b.max(0.01), sy: b.max(0.01), ..Xf::ID } }
    "rise" => Xf { dy: 40.0 * s * (1.0 - e), opacity: clamp01(k * 3.0), ..Xf::ID },
    "zoom" => Xf { sx: 1.0 + 0.6 * s * (1.0 - e), sy: 1.0 + 0.6 * s * (1.0 - e), opacity: clamp01(k * 2.5), ..Xf::ID },
    "stamp" => { let c = Ease::CubicIn.apply(k); Xf { sx: 1.0 + 1.2 * s * (1.0 - c), sy: 1.0 + 1.2 * s * (1.0 - c), rot: -6.0 * (1.0 - c), ..Xf::ID } }
    "drop-bounce" => { let b = Ease::BounceOut.apply(k); Xf { dy: -amp * 1.4 * s * (1.0 - b), ..Xf::ID } }
    "flicker-on" => { let f = (k * 24.0) as i32; let on = k > 0.85 || hash2(f, 0, seed) < k.powf(0.6); Xf { visible: on, ..Xf::ID } }
    "spin3d-in" => { let a = (1.0 - e) * TAU * 0.25 * (1.0 + s); let c = a.cos(); Xf { sx: c.abs().max(0.02), opacity: if c < 0.0 { 0.85 } else { 1.0 }, ..Xf::ID } }
    "swoop" => { let r = 1.0 - e; Xf { dx: -vx * amp * 1.5 * s * r + (if vx == 0.0 { amp * 0.6 * r } else { 0.0 }), dy: -vy * amp * 1.5 * s * r + (if vy == 0.0 { amp * 0.5 * r * r } else { 0.0 }), rot: -12.0 * r, ..Xf::ID } }
    _ => Xf::ID,
  }
}

/// While-on-screen transform at local time `t` (seconds since the object appeared).
/// `span` is the distance a drift wraps over (scene width + object width), in output px.
pub fn on_xf(fx: &FxOn, t: f32, px: f32, span: f32, obj_w: f32, seed: u32) -> Xf {
  let a = fx.amp; let sp = fx.speed.max(0.05);
  let cyc = |period: f32| (TAU * t * sp / period).cos();
  let ramp = |period: f32| 0.5 - 0.5 * cyc(period);
  match fx.id.as_str() {
    "bob" => Xf { dy: (-8.0 + 18.0 * ramp(5.4)) * a * px, ..Xf::ID },
    "float" => { let w = TAU * t * sp / 7.0; Xf { dx: (7.0 * w.sin()) * a * px, dy: (-8.5 - 8.5 * (2.0 * w).cos().max(-0.9)) * a * px * 0.9 + (-2.0 * (w * 0.5).sin()) * a * px, rot: 1.5 * (w * 2.0).sin() * a, ..Xf::ID } }
    "sway" => Xf { dy: -6.0 * ramp(9.0) * a * px, ..Xf::ID },
    "wiggle" => Xf { rot: -2.5 * ramp(5.0) * a, dy: -3.0 * ramp(5.0) * a * px, ..Xf::ID },
    "pulse" => { let k = 1.0 + 0.3 * a * ramp(1.8); Xf { sx: k, sy: k, ..Xf::ID } }
    "blink" => Xf { opacity: if (t * sp / 1.6).fract() < 0.5 { 1.0 } else { 0.25 }, ..Xf::ID },
    "shadow-lift" => Xf { dy: -6.0 * ramp(5.4) * a * px, ..Xf::ID },
    "drift-across" => { let v = 60.0 * sp * a * px; let d = (t * v).rem_euclid(span.max(1.0)); Xf { dx: d - obj_w, ..Xf::ID } }
    "spin3d" => { let c = (TAU * t * sp / 3.0).cos(); Xf { sx: c.abs().max(0.02), opacity: if c < 0.0 { 0.82 } else { 1.0 }, ..Xf::ID } }
    "breathe" => { let k = 1.0 + 0.04 * a * ramp(4.0); Xf { sx: k, sy: k, ..Xf::ID } }
    "jitter" => { let f = (t * 12.0 * sp) as i32; Xf { dx: (hash2(f, 1, seed) - 0.5) * 4.0 * a * px, dy: (hash2(f, 2, seed) - 0.5) * 4.0 * a * px, rot: (hash2(f, 3, seed) - 0.5) * 1.5 * a, ..Xf::ID } }
    "rotate" => Xf { rot: (t * sp / 4.0 * 360.0) % 360.0, ..Xf::ID },
    "hover" => { let w = TAU * t * sp / 3.0; let k = 1.0 + 0.02 * a * w.sin(); Xf { dy: -4.0 * a * px * w.sin(), sx: k, sy: k, ..Xf::ID } }
    "click" => { let u = (t * sp / 2.0).fract(); let k = if u > 0.2 && u < 0.45 { 0.86 } else { 1.0 }; Xf { sx: k, sy: k, dy: if k < 1.0 { 2.0 * px } else { 0.0 }, ..Xf::ID } }
    "glow-pulse" => Xf { opacity: 0.8 + 0.2 * ramp(1.8), ..Xf::ID },
    _ => Xf::ID,
  }
}

/// Exit transform at exit progress `x` (0 = not started, 1 = gone).
pub fn exit_xf(fx: &FxOut, x: f32, amp: f32, _seed: u32) -> Xf {
  if x >= 1.0 { return Xf { visible: false, ..Xf::ID }; }
  if x <= 0.0 { return Xf::ID; }
  let e = fx.ease.apply(x);
  let (vx, vy) = fx.dir.vec();
  let s = fx.size.k();
  match fx.id.as_str() {
    "fade" => Xf { opacity: 1.0 - e, ..Xf::ID },
    "slide" => Xf { dx: vx * amp * s * e, dy: vy * amp * s * e, ..Xf::ID },
    "shrink" => Xf { sx: (1.0 - e).max(0.01), sy: (1.0 - e).max(0.01), ..Xf::ID },
    "pop-out" => { let k = if x < 0.3 { 1.0 + 0.15 * s * (x / 0.3) } else { (1.15 * s.max(0.5)) * (1.0 - (x - 0.3) / 0.7) }; Xf { sx: k.max(0.01), sy: k.max(0.01), ..Xf::ID } }
    "drop" => Xf { dy: x * x * amp * 3.0 * s, rot: x * 8.0, ..Xf::ID },
    "rise-out" => Xf { dy: -40.0 * s * e, opacity: 1.0 - clamp01(x * 1.5), ..Xf::ID },
    "spin3d-out" => { let a = e * TAU * 0.25 * (1.0 + s); let c = a.cos(); Xf { sx: c.abs().max(0.02), opacity: if c < 0.0 { 0.85 } else { 1.0 }, ..Xf::ID } }
    _ => Xf::ID,
  }
}

/// Which cell effects need the per-cell pass, with progress conventions: for entrances `k` runs
/// 0 → 1 (fully there at 1); exits pass `k = 1 − x` so the same code can run backwards.
pub struct CellArgs { pub k: f32, pub dir: Dir, pub seed: u32, pub t: f32, pub amp: f32, pub exit: bool, pub cell: f32, pub unit: f32 }

/// Rewrite a raster cell by cell. `cell` is the cell size in output px (1 for smooth objects).
pub fn cell_pass(id: &str, src: &Frame, a: &CellArgs) -> Frame {
  let c = a.cell.max(1.0);
  let cols = (src.w as f32 / c).ceil() as usize; let rows = (src.h as f32 / c).ceil() as usize;
  let k = clamp01(a.k);
  let (vx, vy) = a.dir.vec();
  let mut out = Frame::new(src.w, src.h);
  let unit_cols = (a.unit / c).round().max(1.0) as usize;
  for cy in 0..rows {
    for cx in 0..cols {
      // Position along the wipe direction, 0..1.
      let (fx, fy) = ((cx as f32 + 0.5) / cols as f32, (cy as f32 + 0.5) / rows as f32);
      let along = if vx > 0.0 { fx } else if vx < 0.0 { 1.0 - fx } else if vy > 0.0 { fy } else { 1.0 - fy };
      let r = hash2(cx as i32, cy as i32, a.seed);
      let order = (cy * cols + cx) as f32 / (cols * rows).max(1) as f32;
      let (mut alpha, mut dx, mut dy, mut tint): (f32, f32, f32, Option<Rgba>) = (1.0, 0.0, 0.0, None);
      match id {
        "wipe" => alpha = if along <= k { 1.0 } else { 0.0 },
        "blocky-wipe" => { let band = 0.18; let v = (k * (1.0 + band) - along) / band; alpha = if v >= 1.0 { 1.0 } else if v <= 0.0 { 0.0 } else if threshold(DitherKind::Bayer4, cx as i32, cy as i32, 0) < v { 1.0 } else { 0.0 }; }
        "typewriter" => { let col_units = (cols + unit_cols - 1) / unit_cols; let shown = (k * col_units as f32 + 1e-4).floor() as usize; alpha = if cx / unit_cols < shown { 1.0 } else { 0.0 }; }
        "type-on" | "type-off" => alpha = if order < k { 1.0 } else { 0.0 },
        "dither-in" | "dither-out" => { let lv = (k * 4.0).floor() / 4.0; let lv = if k >= 1.0 { 1.0 } else { lv }; alpha = if threshold(DitherKind::Bayer4, cx as i32, cy as i32, 0) < lv + 1e-4 { 1.0 } else { 0.0 }; }
        "rain-in" => { let delay = hash2(cx as i32, 0, a.seed) * 0.45; let kc = clamp01((k - delay) / (1.0 - delay)); let head = (kc * (rows as f32 + 2.0)) as usize; alpha = if cy < head { 1.0 } else { 0.0 }; if cy + 1 == head && k < 1.0 { tint = Some(Rgba::WHITE); } }
        "scan-in" => { let line = k * (rows as f32 + 1.0); alpha = if (cy as f32) < line { 1.0 } else { 0.0 }; if k < 1.0 && (cy as f32) >= line - 1.0 && (cy as f32) < line { tint = Some(Rgba::WHITE); } }
        "blinds" => { let band = 8usize; let b = cy / band; let nb = (rows + band - 1) / band; let st = b as f32 / nb.max(1) as f32 * 0.4; let kb = clamp01((k - st) / 0.6); alpha = if ((cy % band) as f32) < kb * band as f32 { 1.0 } else { 0.0 }; }
        "glitch-in" | "glitch-out" => { let amt = 1.0 - k; let f = (a.t * 18.0) as i32; let row_r = hash3(cy as i32, f, 0, a.seed); if row_r < amt * 0.6 { dx = (hash3(cy as i32, f, 1, a.seed) - 0.5) * 40.0 * amt * c; } alpha = if k > 0.0 && (k > 0.6 || hash3(cx as i32, cy as i32, f, a.seed) < k + 0.3) { 1.0 } else { 0.0 }; }
        "decode" | "decode-out" => { alpha = if order < k || hash3(cx as i32, cy as i32, (a.t * 12.0) as i32, a.seed) < 0.5 { 1.0 } else { 0.0 }; if k >= 1.0 { alpha = 1.0; } }
        "letter-cascade" => { let n = cols / unit_cols.max(1) + 1; let i = cx / unit_cols.max(1); let st = i as f32 / n as f32 * 0.7; let kk = clamp01((k - st) / 0.3); alpha = kk; dy = (1.0 - Ease::QuartOut.apply(kk)) * 28.0 * c.max(1.0); }
        "glyph-scatter" => { let x = 1.0 - k; dx = (r - 0.5) * 2.0 * a.amp * x; dy = (hash2(cx as i32, cy as i32, a.seed ^ 9) - 0.7) * 1.4 * a.amp * x; alpha = 1.0 - x; }
        "melt" => { let x = 1.0 - k; let h = hash2(cx as i32, 0, a.seed); dy = x * x * (0.4 + 0.6 * h) * src.h as f32 * 0.5; alpha = 1.0 - x * x; }
        "shimmer" => { let f = (a.t * 8.0) as i32; alpha = 0.7 + 0.3 * hash3(cx as i32, cy as i32, f, a.seed); }
        "wave-rows" => dx = (a.t * 3.0 + cy as f32 * 0.5).sin() * a.amp * 1.5 * c,
        "row-glitch" => { let f = (a.t * 10.0) as i32; if hash3(cy as i32, f, 0, a.seed) < 0.06 { dx = (hash3(cy as i32, f, 1, a.seed) - 0.5) * a.amp * 6.0 * c; } }
        "colour-cycle" => tint = Some(hue(((a.t * 0.25) + fy * 0.2).fract())),
        "sparkle" => { let f = (a.t * 10.0) as i32; if hash3(cx as i32, cy as i32, f, a.seed) < 0.02 { tint = Some(Rgba::WHITE); } }
        "glow-pulse" => { let g = 0.5 - 0.5 * (TAU * a.t / 1.8).cos(); if g > 0.5 { tint = Some(Rgba::WHITE.with_alpha((g - 0.5) * 0.6)); } }
        "pixelate-in" | "pixelate-out" => { if k <= 0.0 { continue; } let block = ((1.0 - k) * 12.0).round().max(1.0) as usize; let (bx, by) = (cx / block * block, cy / block * block); let p = src.get(((bx as f32 + block as f32 / 2.0) * c).min(src.w as f32 - 1.0) as usize, ((by as f32 + block as f32 / 2.0) * c).min(src.h as f32 - 1.0) as usize); alpha = if p.3 > 0 { 1.0 } else { 0.0 }; if block > 1 { tint = Some(Rgba(p.0, p.1, p.2, 255)); } }
        _ => {}
      }
      if alpha <= 0.0 { continue; }
      // Copy the cell block, offset and tinted.
      let (x0, y0) = ((cx as f32 * c) as usize, (cy as f32 * c) as usize);
      let (x1, y1) = ((((cx + 1) as f32 * c) as usize).min(src.w), (((cy + 1) as f32 * c) as usize).min(src.h));
      for y in y0..y1 { for x in x0..x1 {
        let mut p = src.get(x, y); if p.3 == 0 { continue; }
        if let Some(tc) = tint { p = if tc.3 == 255 { Rgba(tc.0, tc.1, tc.2, p.3) } else { let m = p.mix(Rgba(tc.0, tc.1, tc.2, p.3), tc.3 as f32 / 255.0); Rgba(m.0, m.1, m.2, p.3) }; }
        if alpha < 1.0 { p = p.with_alpha(alpha); }
        out.plot(x as i32 + dx.round() as i32, y as i32 + dy.round() as i32, p);
      } }
    }
  }
  out
}

/// Extra room (output px) a cell effect needs around the raster, because it moves cells outside
/// the object's own box. Callers pad before `cell_pass` and shift the result back.
pub fn pad_for(id: &str, amp: f32, h: usize, cell: f32) -> usize {
  match id {
    "glyph-scatter" => (amp * 1.1).ceil() as usize,
    "melt" => h + 2,
    "glitch-in" | "glitch-out" => (22.0 * cell).ceil() as usize,
    "wave-rows" | "row-glitch" => (4.0 * cell).ceil() as usize,
    _ => 0,
  }
}

/// Copy `src` into a larger transparent frame with `p` pixels on every side.
pub fn pad(src: &Frame, p: usize) -> Frame {
  if p == 0 { return src.clone(); }
  let mut out = Frame::new(src.w + 2 * p, src.h + 2 * p);
  for y in 0..src.h { let (a, b) = ((y * src.w) * 4, ((y + 1) * src.w) * 4); let o = ((y + p) * out.w + p) * 4; out.px[o..o + (b - a)].copy_from_slice(&src.px[a..b]); }
  out
}

/// Rainbow colour for a hue in [0, 1).
pub fn hue(h: f32) -> Rgba {
  let h6 = h.fract() * 6.0; let i = h6.floor() as i32; let f = h6 - i as f32;
  let (r, g, b) = match i { 0 => (1.0, f, 0.0), 1 => (1.0 - f, 1.0, 0.0), 2 => (0.0, 1.0, f), 3 => (0.0, 1.0 - f, 1.0), 4 => (f, 0.0, 1.0), _ => (1.0, 0.0, 1.0 - f) };
  Rgba((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8, 255)
}

/// Text-level effects evaluated per glyph (index `i` of `n`): returns (alpha, dx, dy) or None when
/// the effect is not glyph-based.
pub fn glyph_fx(id: &str, i: usize, n: usize, k: f32, px: f32, exit: bool) -> Option<(f32, f32, f32)> {
  let n = n.max(1) as f32;
  let r = i as f32 / n;
  Some(match id {
    "typewriter" => { let shown = (k * n + 1e-4).floor(); if (i as f32) < shown { (1.0, 0.0, 0.0) } else { (0.0, 0.0, 0.0) } }
    "type-off" => { if r < k { (1.0, 0.0, 0.0) } else { (0.0, 0.0, 0.0) } }
    "letter-cascade" => { let st = r * 0.7; let kk = clamp01((k - st) / 0.3); (kk, 0.0, (1.0 - Ease::QuartOut.apply(kk)) * px * 0.4) }
    "decode" | "decode-out" => { if exit { if r < k { (1.0, 0.0, 0.0) } else { (0.0, 0.0, 0.0) } } else { (1.0, 0.0, 0.0) } }
    _ => return None,
  })
}
/// For decode: which glyphs are still scrambled at progress k (resolve left to right).
pub fn decode_char(ch: char, i: usize, n: usize, k: f32, t: f32, seed: u32) -> char {
  if ch == ' ' || ch == '\n' { return ch; }
  let r = i as f32 / n.max(1) as f32;
  if r < k { return ch; }
  const SET: &[u8] = b"#%&@$*+=-<>/\\|!?0123456789ABCDEFXYZ";
  SET[(hash3(i as i32, (t * 14.0) as i32, 0, seed) * SET.len() as f32) as usize % SET.len()] as char
}

#[cfg(test)]
mod tests {
  use super::*;
  fn square() -> Frame { let mut f = Frame::new(64, 32); f.rect(0, 0, 64, 32, Rgba::WHITE); f }
  #[test]
  fn every_cell_effect_is_empty_at_zero_and_full_at_one() {
    let src = square();
    for e in EFFECTS.iter().filter(|e| e.cell) {
      let args = |k: f32| CellArgs { k, dir: Dir::Right, seed: 3, t: 0.3, amp: if e.slot == Slot::On { 1.0 } else { 100.0 }, exit: e.slot == Slot::Out, cell: 4.0, unit: 8.0 };
      let p = pad_for(e.id, 100.0, src.h, 4.0); let src = pad(&src, p); let src = &src;
      let full = cell_pass(e.id, src, &args(1.0));
      let area = (64 * 32) as f32 / (src.w * src.h) as f32; let cov = |f: &Frame| f.coverage() / area;
      let cov_full = cov(&full);
      let floor = if e.slot == Slot::On { 0.85 } else { 0.95 };
      assert!(cov_full > floor, "{} ({:?}) at k=1 covers {cov_full}", e.id, e.slot);
      if e.slot != Slot::On && !matches!(e.id, "decode" | "decode-out" | "glitch-in" | "glitch-out") {
        let empty = cell_pass(e.id, src, &args(0.0));
        assert!(cov(&empty) < 0.05, "{} at k=0 covers {}", e.id, cov(&empty));
        if e.id.starts_with("pixelate") || e.id == "melt" { continue; }
        let half = cell_pass(e.id, src, &args(0.5));
        assert!(cov(&half) > 0.05 && cov(&half) < 0.99, "{} at k=0.5 covers {}", e.id, cov(&half));
      }
    }
  }
  #[test]
  fn transforms_settle_to_identity() {
    for e in EFFECTS.iter().filter(|e| e.slot == Slot::In && !e.cell) {
      let fx = FxIn { id: e.id.into(), ..Default::default() };
      let x = enter_xf(&fx, 1.0, 200.0, 1);
      assert!(x.visible && (x.dx.abs() + x.dy.abs()) < 1e-3 && (x.sx - 1.0).abs() < 1e-3 && (x.opacity - 1.0).abs() < 1e-3, "{}: {x:?}", e.id);
      assert!(!enter_xf(&fx, 0.0, 200.0, 1).visible, "{} should be hidden before its cue", e.id);
    }
    for e in EFFECTS.iter().filter(|e| e.slot == Slot::Out && !e.cell) {
      let fx = FxOut { id: e.id.into(), ..Default::default() };
      assert_eq!(exit_xf(&fx, 0.0, 200.0, 1), Xf::ID, "{}", e.id);
      assert!(!exit_xf(&fx, 1.0, 200.0, 1).visible, "{}", e.id);
    }
    let on = FxOn { id: "bob".into(), amp: 1.0, speed: 1.0 };
    assert!((on_xf(&on, 0.0, 1.0, 100.0, 10.0, 1).dy + 8.0).abs() < 1e-3);
  }
  #[test]
  fn typewriter_shows_whole_glyphs() {
    assert_eq!(glyph_fx("typewriter", 0, 4, 0.3, 10.0, false).unwrap().0, 1.0);
    assert_eq!(glyph_fx("typewriter", 2, 4, 0.3, 10.0, false).unwrap().0, 0.0);
    assert_eq!(decode_char('A', 0, 4, 0.5, 0.1, 1), 'A');
    assert_ne!(decode_char('A', 3, 4, 0.5, 0.1, 1), 'A');
  }
}
