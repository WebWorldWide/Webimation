//! Font catalogue and store. Fonts are loaded at runtime (native: from the app's resource folder;
//! wasm: pushed in by the host) so the engine binary stays small. Rasterised glyphs are cached per
//! thread so parallel export never contends.

use fontdue::{Font, FontSettings};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontGroup { Clean, Loud, Elegant, Retro, Hand, Code, Display }

#[derive(Clone, Debug, serde::Serialize)]
pub struct FontDef {
  pub id: &'static str,
  pub name: &'static str,
  pub file: &'static str,
  pub group: FontGroup,
  pub mono: bool,
  /// Size multiplier so cap heights roughly match Archivo at the same nominal size.
  pub z: f32,
}

macro_rules! f { ($id:literal, $name:literal, $g:ident, $mono:literal, $z:literal) => { FontDef { id: $id, name: $name, file: concat!($id, ".ttf"), group: FontGroup::$g, mono: $mono, z: $z } }; }

/// Every bundled font. The first five are the Quick screen's "Style" looks.
pub const FONTS: &[FontDef] = &[
  f!("archivo", "Archivo", Clean, false, 1.0),
  f!("archivo-black", "Archivo Black", Loud, false, 1.0),
  f!("instrument-serif", "Instrument Serif", Elegant, false, 1.08),
  f!("press-start", "Press Start 2P", Retro, true, 0.62),
  f!("permanent-marker", "Permanent Marker", Hand, false, 0.9),
  f!("anton", "Anton", Loud, false, 0.86),
  f!("bebas", "Bebas Neue", Loud, false, 1.12),
  f!("dm-serif", "DM Serif Display", Elegant, false, 0.94),
  f!("instrument-serif-italic", "Instrument Serif Italic", Elegant, false, 1.08),
  f!("caveat", "Caveat", Hand, false, 1.25),
  f!("vt323", "VT323", Retro, true, 1.3),
  f!("silkscreen", "Silkscreen", Retro, true, 0.8),
  f!("pixelify", "Pixelify Sans", Retro, false, 1.0),
  f!("jetbrains-mono", "JetBrains Mono", Code, true, 0.9),
  f!("ibm-plex-mono", "IBM Plex Mono", Code, true, 0.9),
  f!("fira-code", "Fira Code", Code, true, 0.9),
  f!("source-code-pro", "Source Code Pro", Code, true, 0.9),
  f!("red-hat-mono", "Red Hat Mono", Code, true, 0.9),
  f!("dm-mono", "DM Mono", Code, true, 0.9),
  f!("ubuntu-mono", "Ubuntu Mono", Code, true, 1.0),
  f!("chivo-mono", "Chivo Mono", Code, true, 0.9),
  f!("spline-sans-mono", "Spline Sans Mono", Code, true, 0.9),
  f!("azeret-mono", "Azeret Mono", Code, true, 0.9),
  f!("martian-mono", "Martian Mono", Code, true, 0.85),
  f!("sometype-mono", "Sometype Mono", Code, true, 0.9),
  f!("space-mono", "Space Mono", Code, true, 0.9),
  f!("courier-prime", "Courier Prime", Code, true, 0.95),
  f!("share-tech-mono", "Share Tech Mono", Code, true, 1.0),
  f!("anonymous-pro", "Anonymous Pro", Code, true, 0.95),
  f!("cutive-mono", "Cutive Mono", Code, true, 0.95),
  f!("b612-mono", "B612 Mono", Code, true, 0.9),
  f!("sixtyfour", "Sixtyfour", Display, true, 0.8),
  f!("doto", "Doto", Display, true, 0.95),
  f!("major-mono", "Major Mono Display", Display, true, 0.95),
  f!("syne-mono", "Syne Mono", Display, true, 0.95),
  f!("xanh-mono", "Xanh Mono", Display, true, 1.0),
];
pub fn font_def(id: &str) -> Option<&'static FontDef> { FONTS.iter().find(|f| f.id == id) }
/// Quick screen look → font id.
pub fn look_font(look: &str) -> &'static str {
  match look { "loud" => "archivo-black", "elegant" => "instrument-serif", "retro" => "press-start", "hand" => "permanent-marker", _ => "archivo" }
}

static STORE: RwLock<Option<HashMap<String, Arc<Font>>>> = RwLock::new(None);

/// Register a TTF/OTF by id. Replaces any earlier font with the same id.
pub fn load_font(id: &str, bytes: &[u8]) -> Result<(), String> {
  let font = Font::from_bytes(bytes.to_vec(), FontSettings { scale: 40.0, ..FontSettings::default() }).map_err(|e| e.to_string())?;
  let mut g = STORE.write().unwrap();
  g.get_or_insert_with(HashMap::new).insert(id.to_string(), Arc::new(font));
  GLYPH_CACHE.with(|c| c.borrow_mut().clear());
  Ok(())
}
pub fn font(id: &str) -> Option<Arc<Font>> { STORE.read().unwrap().as_ref()?.get(id).cloned() }
pub fn loaded_fonts() -> Vec<String> { STORE.read().unwrap().as_ref().map(|m| { let mut v: Vec<String> = m.keys().cloned().collect(); v.sort(); v }).unwrap_or_default() }
pub fn has_font(id: &str) -> bool { font(id).is_some() }

/// A rasterised glyph: coverage bitmap plus placement relative to the pen and baseline.
#[derive(Clone, Debug)]
pub struct Glyph { pub w: usize, pub h: usize, pub xmin: i32, pub ymin: i32, pub advance: f32, pub cov: Arc<Vec<u8>> }

thread_local! {
  static GLYPH_CACHE: RefCell<HashMap<(String, char, u32), Arc<Glyph>>> = RefCell::new(HashMap::new());
}

/// Rasterise (cached). Size is in pixels; sub-pixel sizes are rounded to 1/4 px steps.
pub fn glyph(font_id: &str, ch: char, px: f32) -> Option<Arc<Glyph>> {
  let q = (px * 4.0).round().max(1.0) as u32;
  let key = (font_id.to_string(), ch, q);
  if let Some(g) = GLYPH_CACHE.with(|c| c.borrow().get(&key).cloned()) { return Some(g); }
  let f = font(font_id)?;
  let (m, cov) = f.rasterize(ch, q as f32 / 4.0);
  let g = Arc::new(Glyph { w: m.width, h: m.height, xmin: m.xmin, ymin: m.ymin, advance: m.advance_width, cov: Arc::new(cov) });
  GLYPH_CACHE.with(|c| { let mut c = c.borrow_mut(); if c.len() > 20_000 { c.clear(); } c.insert(key, g.clone()); });
  Some(g)
}
/// Whether a font actually contains a character (not just its missing-glyph box).
pub fn has_glyph(font_id: &str, ch: char) -> bool { font(font_id).map(|f| f.lookup_glyph_index(ch) != 0).unwrap_or(false) }

/// Ascent and descent (positive numbers) in pixels at a size.
pub fn line_metrics(font_id: &str, px: f32) -> (f32, f32) {
  font(font_id).and_then(|f| f.horizontal_line_metrics(px)).map(|m| (m.ascent, -m.descent)).unwrap_or((px * 0.8, px * 0.2))
}
pub fn kern(font_id: &str, a: char, b: char, px: f32) -> f32 { font(font_id).and_then(|f| f.horizontal_kern(a, b, px)).unwrap_or(0.0) }

/// Load every bundled font from a directory (native). Missing files are skipped, not fatal.
pub fn load_dir(dir: &std::path::Path) -> usize {
  let mut n = 0;
  for d in FONTS { if let Ok(b) = std::fs::read(dir.join(d.file)) { if load_font(d.id, &b).is_ok() { n += 1; } } }
  n
}

#[cfg(test)]
pub fn load_test_fonts() {
  let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
  load_dir(&dir);
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn fonts_load_and_rasterise() {
    load_test_fonts();
    assert!(has_font("archivo") && has_font("jetbrains-mono") && has_font("press-start"));
    let g = glyph("archivo", 'A', 40.0).unwrap();
    assert!(g.w > 10 && g.h > 20 && g.advance > 15.0);
    assert!(g.cov.iter().any(|&c| c > 200));
    let (asc, desc) = line_metrics("archivo", 40.0);
    assert!(asc > 25.0 && desc > 5.0);
  }
}
