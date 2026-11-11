//! Screen (CRT) post effects: scanlines, grain, glow, RGB split and phosphor trails. All are pure
//! per-frame operations; phosphor takes the previous frame explicitly so export stays deterministic.

use serde::{Deserialize, Serialize};
use crate::frame::{Frame, Rgba};
use crate::math::hash3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Screen {
  /// 0..1 darkening of every `scan_spacing`-th row.
  pub scanlines: f32,
  pub scan_spacing: u32,
  pub grain: f32,
  pub glow: f32,
  /// Horizontal channel offset in pixels (on a 1920 frame).
  pub rgb_split: f32,
  /// 0..1 how much of the previous frame lingers.
  pub phosphor: f32,
  pub vignette: f32,
}
impl Default for Screen { fn default() -> Self { Screen { scanlines: 0.0, scan_spacing: 3, grain: 0.0, glow: 0.0, rgb_split: 0.0, phosphor: 0.0, vignette: 0.0 } } }

impl Screen {
  pub fn is_identity(&self) -> bool { self.scanlines <= 0.0 && self.grain <= 0.0 && self.glow <= 0.0 && self.rgb_split <= 0.0 && self.phosphor <= 0.0 && self.vignette <= 0.0 }

  /// Apply to a frame in place. `t` seeds the grain so it moves; `prev` is the frame before (for phosphor).
  pub fn apply(&self, f: &mut Frame, t: f32, prev: Option<&Frame>) {
    if let (Some(p), true) = (prev, self.phosphor > 0.0) { if p.w == f.w && p.h == f.h { phosphor(f, p, self.phosphor); } }
    if self.glow > 0.0 { glow(f, self.glow); }
    if self.rgb_split > 0.0 { rgb_split(f, (self.rgb_split * f.w as f32 / 1920.0).round().max(1.0) as i32); }
    if self.scanlines <= 0.0 && self.grain <= 0.0 && self.vignette <= 0.0 { return; }
    let frame_no = (t * 60.0) as i32;
    let (w, h) = (f.w, f.h);
    let sp = self.scan_spacing.max(2) as usize;
    let (cx, cy) = (w as f32 / 2.0, h as f32 / 2.0);
    let rmax = (cx * cx + cy * cy).sqrt();
    for y in 0..h {
      let scan = if self.scanlines > 0.0 && y % sp == sp - 1 { 1.0 - self.scanlines * 0.85 } else { 1.0 };
      for x in 0..w {
        let i = (y * w + x) * 4;
        if f.px[i + 3] == 0 { continue; }
        let mut k = scan;
        if self.vignette > 0.0 { let d = (((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt() / rmax).powi(2); k *= 1.0 - self.vignette * d; }
        let g = if self.grain > 0.0 { (hash3(x as i32, y as i32, frame_no, 77) - 0.5) * self.grain * 90.0 } else { 0.0 };
        for c in 0..3 { f.px[i + c] = (f.px[i + c] as f32 * k + g).round().clamp(0.0, 255.0) as u8; }
      }
    }
  }
}

/// Keep a decayed copy of the previous frame under the new one (max of the two, scaled).
fn phosphor(f: &mut Frame, prev: &Frame, amount: f32) {
  for i in 0..f.w * f.h {
    let pa = prev.px[i * 4 + 3] as f32 * amount;
    if pa < 1.0 { continue; }
    let p = Rgba(prev.px[i * 4], prev.px[i * 4 + 1], prev.px[i * 4 + 2], pa as u8);
    let (x, y) = (i % f.w, i / f.w);
    let cur = f.get(x, y);
    if cur.3 == 0 { f.set(x, y, p); } else {
      let a = cur.3 as f32 / 255.0;
      let mix = |c: u8, pc: u8| (c as f32 * a + pc as f32 * (1.0 - a) * amount).max(c as f32).min(255.0) as u8;
      f.set(x, y, Rgba(mix(cur.0, p.0), mix(cur.1, p.1), mix(cur.2, p.2), cur.3.max(p.3)));
    }
  }
}

/// Bloom: blur the premultiplied frame at reduced resolution (glow is soft, so a quarter-size
/// buffer looks identical), two box passes for a near-Gaussian falloff, then add it back with
/// bilinear upsampling. Transparent areas pick up glow alpha, so it survives in alpha exports.
pub fn glow(f: &mut Frame, amount: f32) {
  let (w, h) = (f.w, f.h);
  let d = (w / 480).max(1);
  let (sw, sh) = ((w + d - 1) / d, (h + d - 1) / d);
  let mut small = vec![0f32; sw * sh * 4];
  for sy in 0..sh { for sx in 0..sw {
    let mut acc = [0f32; 4]; let mut n = 0.0;
    for y in sy * d..((sy + 1) * d).min(h) { for x in sx * d..((sx + 1) * d).min(w) {
      let i = (y * w + x) * 4; let a = f.px[i + 3] as f32 / 255.0;
      acc[0] += f.px[i] as f32 * a; acc[1] += f.px[i + 1] as f32 * a; acc[2] += f.px[i + 2] as f32 * a; acc[3] += f.px[i + 3] as f32; n += 1.0;
    } }
    let o = (sy * sw + sx) * 4; for c in 0..4 { small[o + c] = acc[c] / n; }
  } }
  let r = (((amount * 10.0) * w as f32 / 1920.0 / d as f32).round() as usize).clamp(1, 32);
  let mut tmp = vec![0f32; small.len()];
  for _ in 0..2 { box_h(&small, &mut tmp, sw, sh, r); box_v(&tmp, &mut small, sw, sh, r); }
  let k = amount.min(1.5);
  let inv = 1.0 / d as f32;
  let cols: Vec<(usize, usize, f32)> = (0..w).map(|x| { let fx = ((x as f32 + 0.5) * inv - 0.5).max(0.0); let x0 = (fx as usize).min(sw - 1); (x0, (x0 + 1).min(sw - 1), fx - x0 as f32) }).collect();
  let mut row = vec![0f32; sw * 4];
  for y in 0..h {
    let fy = ((y as f32 + 0.5) * inv - 0.5).max(0.0); let y0 = (fy as usize).min(sh - 1); let y1 = (y0 + 1).min(sh - 1); let ty = fy - y0 as f32;
    let (ra, rb) = (&small[y0 * sw * 4..(y0 + 1) * sw * 4], &small[y1 * sw * 4..(y1 + 1) * sw * 4]);
    for i in 0..sw * 4 { row[i] = ra[i] + (rb[i] - ra[i]) * ty; }
    let line = &mut f.px[y * w * 4..(y + 1) * w * 4];
    for (x, &(x0, x1, tx)) in cols.iter().enumerate() {
      let (p0, p1) = (x0 * 4, x1 * 4);
      let ga = (row[p0 + 3] + (row[p1 + 3] - row[p0 + 3]) * tx) * (k / 255.0);
      if ga <= 0.002 { continue; }
      let i = x * 4;
      let a = line[i + 3] as f32 * (1.0 / 255.0);
      let out_a = (a + ga * (1.0 - a)).min(1.0);
      let gain = k * (1.0 - a * 0.5);
      let inv_a = 1.0 / out_a.max(1e-4);
      let lim = 255.0 * out_a;
      for c in 0..3 {
        let g = row[p0 + c] + (row[p1 + c] - row[p0 + c]) * tx;
        line[i + c] = ((line[i + c] as f32 * a + g * gain).min(lim) * inv_a).min(255.0) as u8;
      }
      line[i + 3] = (out_a * 255.0) as u8;
    }
  }
}

fn box_h(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
  for y in 0..h {
    let row = y * w * 4;
    let mut s = [0f32; 4];
    for x in 0..=r.min(w - 1) { for c in 0..4 { s[c] += src[row + x * 4 + c]; } }
    for x in 0..w {
      let n = (x.min(r) + (w - 1 - x).min(r) + 1) as f32;
      for c in 0..4 { dst[row + x * 4 + c] = s[c] / n; }
      if x + r + 1 < w { for c in 0..4 { s[c] += src[row + (x + r + 1) * 4 + c]; } }
      if x >= r { for c in 0..4 { s[c] -= src[row + (x - r) * 4 + c]; } }
    }
  }
}
fn box_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
  for x in 0..w {
    let mut s = [0f32; 4];
    for y in 0..=r.min(h - 1) { for c in 0..4 { s[c] += src[(y * w + x) * 4 + c]; } }
    for y in 0..h {
      let n = (y.min(r) + (h - 1 - y).min(r) + 1) as f32;
      for c in 0..4 { dst[(y * w + x) * 4 + c] = s[c] / n; }
      if y + r + 1 < h { for c in 0..4 { s[c] += src[((y + r + 1) * w + x) * 4 + c]; } }
      if y >= r { for c in 0..4 { s[c] -= src[((y - r) * w + x) * 4 + c]; } }
    }
  }
}

/// Shift the red channel left and the blue channel right by `px`.
pub fn rgb_split(f: &mut Frame, px: i32) {
  let src = f.clone();
  let (w, h) = (f.w as i32, f.h as i32);
  for y in 0..h { for x in 0..w {
    let rx = (x + px).clamp(0, w - 1); let bx = (x - px).clamp(0, w - 1);
    let r = src.get(rx as usize, y as usize); let b = src.get(bx as usize, y as usize); let g = src.get(x as usize, y as usize);
    let a = g.3.max(r.3).max(b.3);
    if a == 0 { continue; }
    f.set(x as usize, y as usize, Rgba(r.0, g.1, b.2, a));
  } }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn identity_leaves_frame_alone() {
    let mut f = Frame::filled(8, 8, Rgba::BLUE); let before = f.px.clone();
    Screen::default().apply(&mut f, 0.5, None); assert_eq!(before, f.px);
  }
  #[test]
  fn scanlines_darken_only_some_rows() {
    let mut f = Frame::filled(4, 6, Rgba::WHITE);
    Screen { scanlines: 1.0, scan_spacing: 3, ..Default::default() }.apply(&mut f, 0.0, None);
    assert_eq!(f.get(0, 0), Rgba::WHITE); assert!(f.get(0, 2).0 < 60); assert_eq!(f.get(0, 3), Rgba::WHITE);
  }
  #[test]
  fn glow_spreads_light_into_transparent_neighbours() {
    let mut f = Frame::new(32, 32); f.rect(14, 14, 4, 4, Rgba::WHITE);
    glow(&mut f, 0.8);
    assert!(f.get(12, 16).3 > 0 && f.get(0, 0).3 == 0);
  }
  #[test]
  fn transparent_pixels_stay_transparent() {
    let mut f = Frame::new(8, 8); f.rect(2, 2, 2, 2, Rgba::WHITE);
    Screen { grain: 1.0, scanlines: 1.0, vignette: 1.0, ..Default::default() }.apply(&mut f, 1.0, None);
    assert_eq!(f.get(0, 0).3, 0);
  }
}
