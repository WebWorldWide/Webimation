//! Tone: levels, gamma, contrast, brightness and a transparency cutoff, plus a histogram for the
//! Glyph Lab's Tone tab. Applied to a grey field before dithering.

use serde::{Deserialize, Serialize};
use crate::math::clamp01;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Tone {
  /// Input levels: values at or below `black` become 0, at or above `white` become 1.
  pub black: f32,
  pub white: f32,
  pub gamma: f32,
  /// −1..1, pivoting around mid grey.
  pub contrast: f32,
  /// −1..1 added after contrast.
  pub brightness: f32,
  /// Cells darker than this go fully transparent (0 = never).
  pub cutoff: f32,
  pub invert: bool,
}
impl Default for Tone {
  fn default() -> Self { Tone { black: 0.0, white: 1.0, gamma: 1.0, contrast: 0.0, brightness: 0.0, cutoff: 0.0, invert: false } }
}
impl Tone {
  #[inline]
  pub fn apply(&self, v: f32) -> f32 {
    let span = (self.white - self.black).max(1e-4);
    let mut v = clamp01((v - self.black) / span);
    if self.gamma > 0.0 && (self.gamma - 1.0).abs() > 1e-4 { v = v.powf(1.0 / self.gamma); }
    if self.contrast != 0.0 {
      let k = if self.contrast > 0.0 { 1.0 + self.contrast * 3.0 } else { 1.0 + self.contrast * 0.9 };
      v = clamp01((v - 0.5) * k + 0.5);
    }
    if self.brightness != 0.0 { v = clamp01(v + self.brightness); }
    if self.invert { v = 1.0 - v; }
    v
  }
  /// Whether a value is below the transparency cutoff.
  #[inline]
  pub fn cut(&self, v: f32) -> bool { self.cutoff > 0.0 && v < self.cutoff }
  /// 32-bin histogram, normalised to the tallest bin.
  pub fn histogram(values: &[f32]) -> [f32; 32] {
    let mut bins = [0u32; 32];
    for &v in values { bins[((clamp01(v) * 31.999) as usize).min(31)] += 1; }
    let max = bins.iter().copied().max().unwrap_or(1).max(1) as f32;
    let mut out = [0f32; 32];
    for i in 0..32 { out[i] = bins[i] as f32 / max; }
    out
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn identity_by_default() { let t = Tone::default(); for v in [0.0, 0.25, 0.5, 1.0] { assert!((t.apply(v) - v).abs() < 1e-6); } }
  #[test]
  fn levels_and_invert() {
    let t = Tone { black: 0.2, white: 0.8, ..Default::default() };
    assert_eq!(t.apply(0.1), 0.0); assert_eq!(t.apply(0.9), 1.0); assert!((t.apply(0.5) - 0.5).abs() < 1e-5);
    let i = Tone { invert: true, ..Default::default() }; assert_eq!(i.apply(1.0), 0.0);
  }
  #[test]
  fn histogram_peaks() { let h = Tone::histogram(&[0.0, 0.0, 0.0, 1.0]); assert_eq!(h[0], 1.0); assert!(h[31] > 0.3); }
}
