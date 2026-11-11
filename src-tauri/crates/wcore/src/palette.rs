//! Colour palettes and editable colour bands. A band palette maps a grey value to a colour by its
//! position: each band starts `at` a grey level and holds until the next.

use serde::{Deserialize, Serialize};
use crate::frame::Rgba;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Band { pub color: String, pub at: f32 }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Palette {
  pub id: String,
  pub name: String,
  pub bands: Vec<Band>,
  /// Blend between bands (smooth gradient) instead of hard steps.
  pub smooth: bool,
}
impl Default for Palette { fn default() -> Self { palette("horizon").unwrap() } }

impl Palette {
  pub fn colors(&self) -> Vec<(Rgba, f32)> {
    let mut v: Vec<(Rgba, f32)> = self.bands.iter().map(|b| (Rgba::hex(&b.color), b.at)).collect();
    v.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    if v.is_empty() { v.push((Rgba::WHITE, 0.0)); }
    v
  }
  /// Colour for a grey level in [0, 1].
  pub fn at(&self, v: f32) -> Rgba {
    let cs = self.colors();
    let mut i = 0;
    while i + 1 < cs.len() && v >= cs[i + 1].1 { i += 1; }
    if !self.smooth || i + 1 >= cs.len() { return cs[i].0; }
    let (a, b) = (cs[i], cs[i + 1]);
    let t = if b.1 > a.1 { (v - a.1) / (b.1 - a.1) } else { 0.0 };
    a.0.mix(b.0, t)
  }
  pub fn darkest(&self) -> Rgba { self.colors()[0].0 }
}

fn mk(id: &str, name: &str, bands: &[(&str, f32)], smooth: bool) -> Palette {
  Palette { id: id.into(), name: name.into(), bands: bands.iter().map(|(c, a)| Band { color: c.to_string(), at: *a }).collect(), smooth }
}

/// The 12 built-in palettes from the Glyph Lab's Colour tab.
pub fn palettes() -> Vec<Palette> {
  vec![
    mk("horizon", "Horizon", &[("#07070C", 0.0), ("#3C2A6E", 0.18), ("#6B4FD6", 0.38), ("#38B6FF", 0.62), ("#E6F3FF", 0.88)], true),
    mk("www", "Web World Wide", &[("#0E2960", 0.0), ("#1450C8", 0.3), ("#1E68F0", 0.55), ("#A8C8F0", 0.8), ("#FFFFFF", 0.95)], false),
    mk("matrix", "Matrix", &[("#000000", 0.0), ("#003B00", 0.25), ("#008F11", 0.5), ("#00FF41", 0.8), ("#CCFFD5", 0.96)], false),
    mk("newsprint", "Newsprint", &[("#F3EFE6", 0.0), ("#0B0B0C", 0.5)], false),
    mk("gameboy", "Game Boy", &[("#0F380F", 0.0), ("#306230", 0.3), ("#8BAC0F", 0.6), ("#9BBC0F", 0.85)], false),
    mk("teletext", "Teletext", &[("#000000", 0.0), ("#0000FF", 0.2), ("#FF0000", 0.4), ("#FFFF00", 0.6), ("#00FFFF", 0.8), ("#FFFFFF", 0.95)], false),
    mk("braille", "Braille mist", &[("#0B0B0C", 0.0), ("#5F6670", 0.4), ("#C9CED5", 0.7), ("#FFFFFF", 0.9)], true),
    mk("signal", "Signal lost", &[("#120A0A", 0.0), ("#8A1C1C", 0.3), ("#FF8A1F", 0.6), ("#FFE8C2", 0.9)], true),
    mk("ember", "Ember", &[("#1A0A00", 0.0), ("#7A2A00", 0.3), ("#E8433A", 0.55), ("#FF8A1F", 0.75), ("#FFF2C8", 0.95)], true),
    mk("glacier", "Glacier", &[("#061629", 0.0), ("#0E3A6E", 0.3), ("#2C8FD6", 0.55), ("#9ADCF7", 0.8), ("#FFFFFF", 0.95)], true),
    mk("orchid", "Orchid", &[("#12061A", 0.0), ("#4A1A6A", 0.3), ("#B04CC4", 0.55), ("#F58AD0", 0.8), ("#FFF0FA", 0.95)], true),
    mk("mono", "Mono", &[("#000000", 0.0), ("#FFFFFF", 0.5)], true),
  ]
}
pub fn palette(id: &str) -> Option<Palette> { palettes().into_iter().find(|p| p.id == id) }

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn bands_step_and_blend() {
    let p = palette("newsprint").unwrap();
    assert_eq!(p.at(0.1), Rgba::hex("#F3EFE6")); assert_eq!(p.at(0.9), Rgba::hex("#0B0B0C"));
    let m = palette("mono").unwrap();
    let mid = m.at(0.25); assert!(mid.0 > 100 && mid.0 < 160, "{mid:?}");
    assert_eq!(m.at(0.0), Rgba::BLACK); assert_eq!(m.at(1.0), Rgba::WHITE);
  }
  #[test]
  fn every_palette_parses() { for p in palettes() { assert!(p.bands.len() >= 2); for b in &p.bands { assert!(!Rgba::hex(&b.color).is_clear(), "{}", p.id); } } }
}
