//! Native text layout and rasterisation with the bundled fonts. Lines are laid out with kerning,
//! tracking and alignment, then drawn into a transparent frame sized to the text.

use serde::{Deserialize, Serialize};
use crate::fonts;
use crate::frame::{Frame, Rgba};
use crate::glyph::blit_cov;
use crate::pixel::PixelFont;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Align { #[default] Left, Center, Right }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TextStyle {
  pub font: String,
  /// Pixel size on the design canvas.
  pub size: f32,
  /// Extra tracking in em.
  pub tracking: f32,
  pub line_height: f32,
  pub align: Align,
  pub uppercase: bool,
  pub color: String,
  /// Hard offset shadow (Web World Wide style). Empty = none.
  pub shadow: String,
  pub shadow_dx: f32,
  pub shadow_dy: f32,
  /// Plate behind the text (empty = none) and its padding.
  pub plate: String,
  pub pad_x: f32,
  pub pad_y: f32,
}
impl Default for TextStyle {
  fn default() -> Self { TextStyle { font: "archivo".into(), size: 72.0, tracking: 0.0, line_height: 1.1, align: Align::Left, uppercase: false, color: "#FFFFFF".into(), shadow: String::new(), shadow_dx: 4.0, shadow_dy: 4.0, plate: String::new(), pad_x: 0.0, pad_y: 0.0 } }
}

#[derive(Clone, Debug)]
pub struct Placed { pub ch: char, pub x: f32, pub baseline: f32, pub line: usize, pub word: usize }

#[derive(Clone, Debug)]
pub struct Layout { pub glyphs: Vec<Placed>, pub w: f32, pub h: f32, pub px: f32, pub lines: usize, pub ascent: f32 }

/// Lay out multi-line text. Returns glyph positions relative to the text box's top-left.
pub fn layout(text: &str, st: &TextStyle) -> Layout {
  let z = fonts::font_def(&st.font).map(|d| d.z).unwrap_or(1.0);
  let px = (st.size * z).max(1.0);
  let text = if st.uppercase { text.to_uppercase() } else { text.to_string() };
  let lines: Vec<&str> = text.lines().collect();
  let lines = if lines.is_empty() { vec![""] } else { lines };
  let (asc, desc) = fonts::line_metrics(&st.font, px);
  let lh = px * st.line_height.max(0.5);
  let has_font = fonts::has_font(&st.font);
  let mut widths = Vec::new();
  let mut rows: Vec<Vec<(char, f32, usize)>> = Vec::new();
  for line in &lines {
    let mut x = 0.0; let mut row = Vec::new(); let mut prev: Option<char> = None; let mut word = 0;
    for ch in line.chars() {
      if ch == ' ' { word += 1; }
      if let Some(p) = prev { x += fonts::kern(&st.font, p, ch, px); }
      row.push((ch, x, word));
      let adv = if has_font && (ch == ' ' || fonts::has_glyph(&st.font, ch)) { fonts::glyph(&st.font, ch, px).map(|g| g.advance).unwrap_or(px * 0.5) } else { px * 0.75 };
      x += adv + st.tracking * px;
      prev = Some(ch);
    }
    widths.push((x - st.tracking * px).max(0.0)); rows.push(row);
  }
  let w = widths.iter().cloned().fold(0.0, f32::max);
  let h = asc + desc + lh * (lines.len() as f32 - 1.0);
  let mut glyphs = Vec::new();
  for (li, row) in rows.into_iter().enumerate() {
    let off = match st.align { Align::Left => 0.0, Align::Center => (w - widths[li]) / 2.0, Align::Right => w - widths[li] };
    let baseline = asc + li as f32 * lh;
    for (ch, x, word) in row { glyphs.push(Placed { ch, x: x + off, baseline, line: li, word }); }
  }
  Layout { glyphs, w, h, px, lines: lines.len(), ascent: asc }
}

/// Rasterise text into a new frame. `visible(i, glyph)` lets effects hide or recolour individual
/// glyphs (returns alpha 0..1 and a pixel offset). Returns the frame and the layout.
pub fn render_text(text: &str, st: &TextStyle, visible: &dyn Fn(usize, &Placed) -> (f32, f32, f32)) -> (Frame, Layout) {
  let lay = layout(text, st);
  let (padx, pady) = (st.pad_x.max(0.0), st.pad_y.max(0.0));
  let sh = !st.shadow.is_empty();
  let (sdx, sdy) = if sh { (st.shadow_dx.max(0.0), st.shadow_dy.max(0.0)) } else { (0.0, 0.0) };
  let (pw, ph) = ((lay.w + padx * 2.0).ceil().max(1.0), (lay.h + pady * 2.0).ceil().max(1.0));
  let (sdx, sdy) = (sdx.round(), sdy.round());
  let w = (pw + sdx) as usize;
  let h = (ph + sdy) as usize;
  let mut f = Frame::new(w, h);
  if !st.plate.is_empty() {
    let pc = Rgba::hex(&st.plate);
    if sh { f.rect(sdx as i32, sdy as i32, pw as i32, ph as i32, Rgba::hex(&st.shadow)); }
    f.rect(0, 0, pw as i32, ph as i32, pc);
  }
  let colour = Rgba::hex(&st.color);
  let has_font = fonts::has_font(&st.font);
  let draw = |f: &mut Frame, dx: f32, dy: f32, c: Rgba| {
    for (i, g) in lay.glyphs.iter().enumerate() {
      let (a, ox, oy) = visible(i, g);
      if a <= 0.0 || g.ch == ' ' { continue; }
      let c = if a < 1.0 { c.with_alpha(a) } else { c };
      let (x, y) = (g.x + padx + dx + ox, g.baseline + pady + dy + oy);
      if has_font && fonts::has_glyph(&st.font, g.ch) {
        if let Some(gl) = fonts::glyph(&st.font, g.ch, lay.px) {
          blit_cov(f, &gl.cov, gl.w, gl.h, (x + gl.xmin as f32).round() as i32, (y - gl.ymin as f32 - gl.h as f32).round() as i32, c);
        }
      } else if let Some(rows) = PixelFont::Five.glyph(g.ch) {
        // Symbols the font lacks (▶ ♥ ★ …) come from the built-in pixel font at cap height.
        let s = (lay.px * 0.7 / 7.0).max(1.0);
        for (r, bits) in rows.iter().enumerate() { for col in 0..5 { if bits & (1 << (4 - col)) != 0 { f.rect((x + col as f32 * s).round() as i32, (y - 7.0 * s + r as f32 * s).round() as i32, s.ceil() as i32, s.ceil() as i32, c); } } }
      }
    }
  };
  if sh && st.plate.is_empty() { draw(&mut f, sdx, sdy, Rgba::hex(&st.shadow)); }
  draw(&mut f, 0.0, 0.0, colour);
  (f, lay)
}

pub fn all_visible(_: usize, _: &Placed) -> (f32, f32, f32) { (1.0, 0.0, 0.0) }

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn layout_measures_and_aligns() {
    fonts::load_test_fonts();
    let st = TextStyle { size: 40.0, align: Align::Center, ..Default::default() };
    let l = layout("Hello\nHi", &st);
    assert_eq!(l.lines, 2); assert!(l.w > 60.0 && l.h > 70.0);
    let hi = l.glyphs.iter().find(|g| g.line == 1).unwrap();
    assert!(hi.x > 10.0, "second line should be centred, x = {}", hi.x);
  }
  #[test]
  fn missing_symbols_fall_back_to_pixels() {
    fonts::load_test_fonts();
    assert!(!fonts::has_glyph("archivo-black", '▶') && fonts::has_glyph("archivo-black", 'A'));
    let st = TextStyle { font: "archivo-black".into(), size: 40.0, ..Default::default() };
    let (f, _) = render_text("▶", &st, &all_visible);
    assert!(f.coverage() > 0.1, "{}", f.coverage());
  }
  #[test]
  fn text_renders_with_plate_and_shadow() {
    fonts::load_test_fonts();
    let st = TextStyle { size: 48.0, plate: "#1E68F0".into(), shadow: "#0B0B0C".into(), pad_x: 10.0, pad_y: 6.0, ..Default::default() };
    let (f, _) = render_text("Ada", &st, &all_visible);
    assert_eq!(f.get(0, 0), Rgba::BLUE);
    assert_eq!(f.get(f.w - 1, f.h - 1), Rgba::INK);
    assert!(f.px.chunks_exact(4).any(|p| p[0] > 200 && p[1] > 200 && p[2] > 200 && p[3] > 200), "white glyph pixels");
  }
}
