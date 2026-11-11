//! Dithering. Ordered (Bayer 2/4/8), blue noise, and error diffusion (Floyd–Steinberg, Atkinson,
//! one-row). Every function quantises a grey field to `levels` tiers and is deterministic.

use serde::{Deserialize, Serialize};
use crate::math::hash2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DitherKind { None, Bayer2, Bayer4, #[default] Bayer8, BlueNoise, FloydSteinberg, Atkinson, Row }

impl DitherKind {
  pub const ALL: [DitherKind; 8] = [DitherKind::None, DitherKind::Bayer2, DitherKind::Bayer4, DitherKind::Bayer8, DitherKind::BlueNoise, DitherKind::FloydSteinberg, DitherKind::Atkinson, DitherKind::Row];
  pub fn label(self) -> &'static str {
    match self { DitherKind::None => "None", DitherKind::Bayer2 => "Bayer 2×2", DitherKind::Bayer4 => "Bayer 4×4", DitherKind::Bayer8 => "Bayer 8×8", DitherKind::BlueNoise => "Blue noise", DitherKind::FloydSteinberg => "Floyd–Steinberg", DitherKind::Atkinson => "Atkinson", DitherKind::Row => "Row diffusion" }
  }
  pub fn is_ordered(self) -> bool { matches!(self, DitherKind::Bayer2 | DitherKind::Bayer4 | DitherKind::Bayer8 | DitherKind::BlueNoise) }
}

pub const BAYER2: [[u8; 2]; 2] = [[0, 2], [3, 1]];
pub const BAYER4: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
pub const BAYER8: [[u8; 8]; 8] = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];

/// Ordered threshold in [0, 1) for a cell. Bayer thresholds are centred so a flat 50% field gives an
/// exact checkerboard; blue noise is a 64×64 tile built once (void-and-cluster approximation via
/// a high-frequency hash mix, good enough that no low-frequency clumps show at pixel-art sizes).
#[inline]
pub fn threshold(kind: DitherKind, x: i32, y: i32, phase: u32) -> f32 {
  let (x, y) = (x.rem_euclid(1 << 16), y.rem_euclid(1 << 16));
  match kind {
    DitherKind::Bayer2 => (BAYER2[(y & 1) as usize][(x & 1) as usize] as f32 + 0.5) / 4.0,
    DitherKind::Bayer4 => (BAYER4[(y & 3) as usize][(x & 3) as usize] as f32 + 0.5) / 16.0,
    DitherKind::Bayer8 => (BAYER8[(y & 7) as usize][(x & 7) as usize] as f32 + 0.5) / 64.0,
    DitherKind::BlueNoise => blue_noise(x, y, phase),
    _ => 0.5,
  }
}

/// Blue-noise-like threshold. Interleaved gradient noise (Jorge Jimenez) has a strongly
/// high-pass spectrum, is tileable at any size and needs no table. `phase` animates it.
#[inline]
pub fn blue_noise(x: i32, y: i32, phase: u32) -> f32 {
  let (fx, fy) = (x as f32 + (phase % 64) as f32 * 5.588238, y as f32 + (phase % 64) as f32 * 1.0);
  let v = 52.982_918 * (0.067_110_56 * fx + 0.005_837_15 * fy).fract();
  let v = v - v.floor();
  // A pinch of hash breaks the residual diagonal structure without lowering the frequency.
  (v * 0.92 + hash2(x, y, 7 + phase) * 0.08).min(0.9999)
}

/// Quantise one value to `levels` tiers with an ordered threshold. Returns the tier index.
#[inline]
pub fn quantise_ordered(v: f32, levels: usize, kind: DitherKind, strength: f32, x: i32, y: i32, phase: u32) -> usize {
  let n = levels.max(2) as f32;
  let t = (threshold(kind, x, y, phase) - 0.5) * strength;
  (((v * (n - 1.0)) + t).round().max(0.0) as usize).min(levels - 1)
}

/// Quantise a whole field. `src` is grey in [0, 1], row-major `w × h`; the result is tier indices.
/// Error diffusion scans serpentine so the image has no directional comb. `strength` scales how
/// much error is carried (1 = classic).
pub fn quantise(src: &[f32], w: usize, h: usize, levels: usize, kind: DitherKind, strength: f32, phase: u32, out: &mut Vec<u8>) {
  out.clear();
  out.resize(w * h, 0);
  let n = levels.max(2);
  let step = 1.0 / (n - 1) as f32;
  match kind {
    DitherKind::None => for (i, &v) in src.iter().enumerate() { out[i] = ((v / step).round().max(0.0) as usize).min(n - 1) as u8; },
    k if k.is_ordered() => for y in 0..h { for x in 0..w { out[y * w + x] = quantise_ordered(src[y * w + x], n, k, strength, x as i32, y as i32, phase) as u8; } },
    DitherKind::FloydSteinberg | DitherKind::Atkinson | DitherKind::Row => {
      let mut buf: Vec<f32> = src.to_vec();
      for y in 0..h {
        let ltr = y % 2 == 0;
        for i in 0..w {
          let x = if ltr { i } else { w - 1 - i };
          let v = buf[y * w + x];
          let q = ((v / step).round().max(0.0) as usize).min(n - 1);
          out[y * w + x] = q as u8;
          let err = (v - q as f32 * step) * strength;
          let dir: i64 = if ltr { 1 } else { -1 };
          let mut spread = |dx: i64, dy: i64, k: f32| {
            let (nx, ny) = (x as i64 + dx * dir, y as i64 + dy);
            if nx >= 0 && (nx as usize) < w && (ny as usize) < h { buf[ny as usize * w + nx as usize] += err * k; }
          };
          match kind {
            DitherKind::FloydSteinberg => { spread(1, 0, 7.0 / 16.0); spread(-1, 1, 3.0 / 16.0); spread(0, 1, 5.0 / 16.0); spread(1, 1, 1.0 / 16.0); }
            DitherKind::Atkinson => { let k = 1.0 / 8.0; spread(1, 0, k); spread(2, 0, k); spread(-1, 1, k); spread(0, 1, k); spread(1, 1, k); spread(0, 2, k); }
            _ => { spread(1, 0, 1.0); }
          }
        }
      }
    }
    _ => unreachable!(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn bayer_half_is_a_checkerboard() {
    let src = vec![0.5f32; 64];
    let mut out = Vec::new();
    quantise(&src, 8, 8, 2, DitherKind::Bayer2, 1.0, 0, &mut out);
    for y in 0..8 { for x in 0..8 { assert_eq!(out[y * 8 + x], ((x + y) % 2 == 1) as u8, "{x},{y}"); } }
  }
  #[test]
  fn ordered_preserves_average_density() {
    for kind in [DitherKind::Bayer4, DitherKind::Bayer8, DitherKind::BlueNoise] {
      for grey in [0.1f32, 0.25, 0.5, 0.75, 0.9] {
        let src = vec![grey; 64 * 64];
        let mut out = Vec::new();
        quantise(&src, 64, 64, 2, kind, 1.0, 0, &mut out);
        let on = out.iter().filter(|&&v| v == 1).count() as f32 / 4096.0;
        assert!((on - grey).abs() < 0.04, "{kind:?} grey {grey} gave {on}");
      }
    }
  }
  #[test]
  fn error_diffusion_conserves_ink() {
    for kind in [DitherKind::FloydSteinberg, DitherKind::Atkinson, DitherKind::Row] {
      let src: Vec<f32> = (0..128 * 32).map(|i| (i % 128) as f32 / 127.0).collect();
      let mut out = Vec::new();
      quantise(&src, 128, 32, 2, kind, 1.0, 0, &mut out);
      let want: f32 = src.iter().sum::<f32>() / src.len() as f32;
      let got = out.iter().map(|&v| v as f32).sum::<f32>() / out.len() as f32;
      // Atkinson deliberately drops 1/4 of the error, so it runs lighter in the midtones.
      let tol = if kind == DitherKind::Atkinson { 0.12 } else { 0.03 };
      assert!((want - got).abs() < tol, "{kind:?}: want {want} got {got}");
    }
  }
  #[test]
  fn blue_noise_has_no_big_clumps() {
    let mut out = Vec::new();
    quantise(&vec![0.5; 64 * 64], 64, 64, 2, DitherKind::BlueNoise, 1.0, 0, &mut out);
    // No 4×4 block fully on or fully off at 50% grey.
    for by in 0..16 { for bx in 0..16 {
      let s: u32 = (0..4).flat_map(|y| (0..4).map(move |x| (x, y))).map(|(x, y)| out[(by * 4 + y) * 64 + bx * 4 + x] as u32).sum();
      assert!(s > 0 && s < 16, "block {bx},{by} = {s}");
    } }
  }
  #[test]
  fn extremes_are_exact() {
    let mut out = Vec::new();
    for kind in DitherKind::ALL {
      quantise(&vec![0.0; 256], 16, 16, 5, kind, 1.0, 3, &mut out);
      assert!(out.iter().all(|&v| v == 0), "{kind:?} zero");
      quantise(&vec![1.0; 256], 16, 16, 5, kind, 1.0, 3, &mut out);
      assert!(out.iter().all(|&v| v == 4), "{kind:?} one");
    }
  }
}
