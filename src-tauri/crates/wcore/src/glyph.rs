//! ASCII / glyph fields: character sets, ink ordering, cell picking, and drawing a grid of
//! characters from a grey field. This is the omp.sh-style core of the Glyph Lab.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::dither::{quantise, DitherKind};
use crate::fonts;
use crate::frame::{Blend, Frame, Rgba};
use crate::math::{hash2, hash3};
use crate::palette::Palette;
use crate::tone::Tone;

/// Built-in character sets, ordered light → dark where that is meaningful.
pub const CHARSETS: &[(&str, &str, &str)] = &[
  ("classic", "Classic", " .:-=+*#%@"),
  ("dense70", "Dense 70", " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"),
  ("blocks", "Blocks", " ░▒▓█"),
  ("quadrants", "Quadrants", " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█"),
  ("braille", "Braille", " ⠁⠃⠇⠏⠟⠿⡿⣿"),
  ("dots", "Dots", " .·•●"),
  ("binary", "Binary", "01"),
  ("code", "Code", " .,:;i1tfLCG08@"),
  ("hex", "Hex", "0123456789ABCDEF"),
  ("boxlines", "Box lines", " ─│┼╬█"),
  ("slashes", "Slashes", " ./\\|X"),
  ("katakana", "Katakana", " ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ"),
  ("stars", "Stars", " .+*✦✶★"),
];
pub fn charset(id: &str) -> &'static str { CHARSETS.iter().find(|c| c.0 == id).map(|c| c.2).unwrap_or(CHARSETS[0].2) }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Pick { #[default] Brightness, Random, Message }

/// Everything about how a grid of glyphs is drawn (the Glyphs + Tone + Colour tabs).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GlyphStyle {
  pub font: String,
  /// Cell width in pixels on a 1920-wide frame. Scales with the output.
  pub cell: f32,
  pub cell_w: f32,
  pub cell_h: f32,
  /// Characters light → dark. A leading space means "transparent".
  pub chars: String,
  pub sort_by_ink: bool,
  pub reverse: bool,
  pub pick: Pick,
  pub message: String,
  /// Changes per second of random re-picking (0 = still).
  pub flicker: f32,
  pub tone: Tone,
  pub dither: DitherKind,
  pub dither_strength: f32,
  pub dither_animate: bool,
  pub palette: Palette,
  /// Draw the cell background in the palette's darkest colour (false = transparent gaps).
  pub fill_cells: bool,
  /// Glyph colour override (empty = from the palette).
  pub ink: String,
}
impl Default for GlyphStyle {
  fn default() -> Self {
    GlyphStyle { font: "jetbrains-mono".into(), cell: 12.0, cell_w: 1.0, cell_h: 1.0, chars: " .:-=+*#%@".into(), sort_by_ink: false, reverse: false, pick: Pick::Brightness, message: "WEBIMATION ".into(), flicker: 0.0, tone: Tone::default(), dither: DitherKind::None, dither_strength: 1.0, dither_animate: false, palette: Palette::default(), fill_cells: false, ink: String::new() }
  }
}

/// Measured ink (coverage sum) of a character in a font, for sorting sets.
pub fn ink_of(font: &str, ch: char) -> f32 {
  if ch == ' ' { return 0.0; }
  match fonts::glyph(font, ch, 24.0) { Some(g) => g.cov.iter().map(|&c| c as f32).sum::<f32>() / 255.0, None => builtin_ink(ch) }
}
fn builtin_ink(ch: char) -> f32 { crate::pixel::PixelFont::Five.glyph(ch).map(|g| g.iter().map(|r| r.count_ones() as f32).sum()).unwrap_or(10.0) }

impl GlyphStyle {
  /// The ordered ramp of characters after sorting and reversing.
  pub fn ramp(&self) -> Vec<char> {
    let mut v: Vec<char> = self.chars.chars().collect();
    if v.is_empty() { v = vec![' ', '#']; }
    if self.sort_by_ink { v.sort_by(|a, b| ink_of(&self.font, *a).partial_cmp(&ink_of(&self.font, *b)).unwrap()); v.dedup(); }
    if self.reverse { v.reverse(); }
    v
  }
  /// Cell size in pixels for an output width.
  pub fn cell_px(&self, w: usize) -> (f32, f32) {
    let base = (self.cell * (w as f32 / 1920.0)).max(2.0);
    (base * self.cell_w.max(0.3), base * self.cell_h.max(0.3) * self.aspect())
  }
  /// Measured advance/height ratio of the font so columns line up (fallback 0.6 like a typical mono).
  fn aspect(&self) -> f32 {
    match fonts::glyph(&self.font, 'M', 40.0) { Some(g) if g.advance > 0.0 => { let (a, d) = fonts::line_metrics(&self.font, 40.0); ((a + d) / g.advance).clamp(1.0, 2.6) } _ => 1.7 }
  }
  pub fn grid(&self, w: usize, h: usize) -> (usize, usize, f32, f32) {
    let (cw, ch) = self.cell_px(w);
    (((w as f32 / cw).ceil() as usize).max(1), ((h as f32 / ch).ceil() as usize).max(1), cw, ch)
  }
}

/// Draw a glyph field. `grey` is one brightness per cell (`cols × rows`, row-major, already in [0, 1],
/// before tone). `t` drives flicker and animated dither. Returns the drawn frame (transparent gaps).
pub fn draw_glyph_field(grey: &[f32], cols: usize, rows: usize, style: &GlyphStyle, w: usize, h: usize, t: f32, seed: u32, out: &mut Frame) {
  debug_assert!(grey.len() >= cols * rows);
  let (_, _, cw, chh) = style.grid(w, h);
  let ramp = style.ramp();
  let levels = ramp.len().max(2);
  // Tone first, then dither quantises to the ramp's tiers.
  let toned: Vec<f32> = grey.iter().map(|&v| style.tone.apply(v)).collect();
  let phase = if style.dither_animate { (t * 12.0) as u32 } else { 0 };
  let mut tiers = Vec::new();
  quantise(&toned, cols, rows, levels, style.dither, style.dither_strength, phase, &mut tiers);
  let ink_override = if style.ink.is_empty() { None } else { Some(Rgba::hex(&style.ink)) };
  let dark = style.palette.darkest();
  let flick = if style.flicker > 0.0 { (t * style.flicker.max(0.01) * 4.0) as u32 } else { 0 };
  let msg: Vec<char> = if style.message.is_empty() { vec!['W'] } else { style.message.chars().collect() };
  let font_ok = fonts::has_font(&style.font);
  let px = chh * 0.92;
  for y in 0..rows {
    for x in 0..cols {
      let i = y * cols + x;
      let v = toned[i];
      if style.tone.cut(v) { continue; }
      let tier = tiers[i] as usize;
      let ch = match style.pick {
        Pick::Brightness => ramp[tier.min(ramp.len() - 1)],
        Pick::Random => { if tier == 0 { ramp[0] } else { let n = ramp.len() - 1; ramp[1 + (hash3(x as i32, y as i32, flick as i32, seed) * n as f32) as usize % n] } }
        Pick::Message => { if tier == 0 { ' ' } else { msg[(i + flick as usize) % msg.len()] } }
      };
      // Flicker on brightness picks: a small share of cells jump a tier.
      let ch = if style.flicker > 0.0 && style.pick == Pick::Brightness && hash3(x as i32, y as i32, flick as i32, seed ^ 0x55) < style.flicker * 0.25 { ramp[(tier + 1).min(ramp.len() - 1)] } else { ch };
      let cx = x as f32 * cw; let cy = y as f32 * chh;
      let colour = ink_override.unwrap_or_else(|| style.palette.at(v));
      if style.fill_cells { out.rect(cx.round() as i32, cy.round() as i32, cw.ceil() as i32, chh.ceil() as i32, dark); }
      if ch == ' ' { continue; }
      draw_char(out, ch, &style.font, font_ok, cx, cy, cw, chh, px, colour);
    }
  }
}

/// Draw one character centred in a cell. Falls back to the built-in 5×7 pixel font when the
/// requested font is not loaded (the wasm host may still be fetching it).
pub fn draw_char(out: &mut Frame, ch: char, font: &str, font_ok: bool, cx: f32, cy: f32, cw: f32, chh: f32, px: f32, colour: Rgba) {
  if font_ok {
    if let Some(g) = fonts::glyph(font, ch, px) {
      let (asc, desc) = fonts::line_metrics(font, px);
      let baseline = cy + (chh + asc - desc) * 0.5;
      let gx = (cx + (cw - g.advance) * 0.5 + g.xmin as f32).round() as i32;
      let gy = (baseline - g.ymin as f32 - g.h as f32).round() as i32;
      blit_cov(out, &g.cov, g.w, g.h, gx, gy, colour);
      return;
    }
  }
  // Built-in pixel glyph, scaled to the cell.
  if let Some(rows) = crate::pixel::PixelFont::Five.glyph(ch) {
    let s = (cw / 6.0).min(chh / 8.0).max(1.0);
    let ox = cx + (cw - 5.0 * s) * 0.5; let oy = cy + (chh - 7.0 * s) * 0.5;
    for (r, bits) in rows.iter().enumerate() { for c in 0..5 { if bits & (1 << (4 - c)) != 0 { out.rect((ox + c as f32 * s).round() as i32, (oy + r as f32 * s).round() as i32, s.ceil() as i32, s.ceil() as i32, colour); } } }
  }
}

/// Blit a coverage bitmap as `colour` with its alpha scaled by coverage.
pub fn blit_cov(out: &mut Frame, cov: &[u8], w: usize, h: usize, x0: i32, y0: i32, colour: Rgba) {
  for y in 0..h {
    let py = y0 + y as i32; if py < 0 || py >= out.h as i32 { continue; }
    for x in 0..w {
      let px = x0 + x as i32; if px < 0 || px >= out.w as i32 { continue; }
      let c = cov[y * w + x]; if c == 0 { continue; }
      let a = (c as u32 * colour.3 as u32 / 255) as u8;
      out.blend_px(px as usize, py as usize, Rgba(colour.0, colour.1, colour.2, a), Blend::Normal);
    }
  }
}

/// Convert a frame to one grey value per cell (average luminance × alpha), for text/logo channels and
/// "switch to characters" on pixel art.
pub fn frame_to_cells(src: &Frame, cols: usize, rows: usize) -> Vec<f32> {
  let mut out = vec![0f32; cols * rows];
  let (cw, ch) = (src.w as f32 / cols as f32, src.h as f32 / rows as f32);
  for y in 0..rows { for x in 0..cols {
    let (x0, y0) = ((x as f32 * cw) as usize, (y as f32 * ch) as usize);
    let (x1, y1) = ((((x + 1) as f32 * cw) as usize).min(src.w).max(x0 + 1), ((((y + 1) as f32 * ch) as usize).min(src.h)).max(y0 + 1));
    let (mut sum, mut n) = (0.0, 0.0);
    for yy in y0..y1 { for xx in x0..x1 { let p = src.get(xx, yy); sum += p.lum() * p.3 as f32 / 255.0; n += 1.0; } }
    out[y * cols + x] = if n > 0.0 { sum / n } else { 0.0 };
  } }
  out
}

/// Hash-driven per-cell jitter, for effects that need "a different random number per cell per frame".
#[inline]
pub fn cell_rand(x: usize, y: usize, seed: u32) -> f32 { hash2(x as i32, y as i32, seed) }

pub type SharedFrame = Arc<Frame>;

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn ramp_sorts_by_measured_ink() {
    fonts::load_test_fonts();
    let s = GlyphStyle { chars: "@ .#".into(), sort_by_ink: true, ..Default::default() };
    let r = s.ramp();
    assert_eq!(r[0], ' '); assert_eq!(r[1], '.'); assert!(r[3] == '@' || r[3] == '#');
  }
  #[test]
  fn glyph_field_is_transparent_where_dark_and_drawn_where_bright() {
    fonts::load_test_fonts();
    let s = GlyphStyle { cell: 24.0, ..Default::default() };
    let (cols, rows, _, _) = s.grid(192, 108);
    let grey: Vec<f32> = (0..cols * rows).map(|i| if i % cols < cols / 2 { 0.0 } else { 1.0 }).collect();
    let mut f = Frame::new(192, 108);
    draw_glyph_field(&grey, cols, rows, &s, 192, 108, 0.0, 1, &mut f);
    assert_eq!(f.get(2, 2).3, 0);
    let right = (0..108).flat_map(|y| (120..192).map(move |x| (x, y))).filter(|&(x, y)| f.get(x, y).3 > 0).count();
    assert!(right > 200, "{right}");
  }
  #[test]
  fn builtin_fallback_draws_without_fonts() {
    let s = GlyphStyle { font: "not-a-font".into(), cell: 16.0, ..Default::default() };
    let (cols, rows, _, _) = s.grid(160, 90);
    let mut f = Frame::new(160, 90);
    draw_glyph_field(&vec![1.0; cols * rows], cols, rows, &s, 160, 90, 0.0, 1, &mut f);
    assert!(f.coverage() > 0.1);
  }
}
