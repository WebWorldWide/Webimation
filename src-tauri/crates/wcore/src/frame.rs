//! RGBA8 frame buffer with straight (non-premultiplied) alpha, which is what PNG and ProRes 4444
//! expect. Compositing converts to premultiplied internally so edges never fringe.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Rgba(pub u8, pub u8, pub u8, pub u8);

impl Rgba {
  pub const CLEAR: Rgba = Rgba(0, 0, 0, 0);
  pub const WHITE: Rgba = Rgba(255, 255, 255, 255);
  pub const BLACK: Rgba = Rgba(0, 0, 0, 255);
  pub const INK: Rgba = Rgba(0x0B, 0x0B, 0x0C, 255);
  pub const BLUE: Rgba = Rgba(0x1E, 0x68, 0xF0, 255);

  /// Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. Anything else is transparent.
  pub fn hex(s: &str) -> Rgba {
    let h = s.trim().trim_start_matches('#');
    let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0);
    match h.len() {
      3 => { let c = |i: usize| { let n = u8::from_str_radix(&h[i..i + 1], 16).unwrap_or(0); n * 17 }; Rgba(c(0), c(1), c(2), 255) }
      6 => Rgba(v(0), v(2), v(4), 255),
      8 => Rgba(v(0), v(2), v(4), v(6)),
      _ => Rgba::CLEAR,
    }
  }
  pub fn to_hex(self) -> String { format!("#{:02X}{:02X}{:02X}", self.0, self.1, self.2) }
  #[inline]
  pub fn with_alpha(self, a: f32) -> Rgba { Rgba(self.0, self.1, self.2, (self.3 as f32 * clamp(a)) as u8) }
  #[inline]
  pub fn lum(self) -> f32 { (0.2126 * self.0 as f32 + 0.7152 * self.1 as f32 + 0.0722 * self.2 as f32) / 255.0 }
  /// Ink or white, whichever reads better on this colour.
  pub fn ink_on(self) -> Rgba { if self.lum() > 0.45 { Rgba::INK } else { Rgba::WHITE } }
  #[inline]
  pub fn mix(self, o: Rgba, t: f32) -> Rgba {
    let t = clamp(t);
    let m = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
    Rgba(m(self.0, o.0), m(self.1, o.1), m(self.2, o.2), m(self.3, o.3))
  }
  pub fn is_clear(self) -> bool { self.3 == 0 }
}
#[inline]
fn clamp(x: f32) -> f32 { x.max(0.0).min(1.0) }

/// Blend modes for layers (the Mix screen's per-channel blend).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Blend { #[default] Normal, Screen, Multiply, Add, Difference }

#[derive(Clone, Debug)]
pub struct Frame {
  pub w: usize,
  pub h: usize,
  /// Straight-alpha RGBA, row-major, `w * h * 4` bytes.
  pub px: Vec<u8>,
}

impl Frame {
  pub fn new(w: usize, h: usize) -> Frame { Frame { w, h, px: vec![0; w * h * 4] } }
  pub fn filled(w: usize, h: usize, c: Rgba) -> Frame { let mut f = Frame::new(w, h); f.fill(c); f }
  pub fn fill(&mut self, c: Rgba) { for p in self.px.chunks_exact_mut(4) { p.copy_from_slice(&[c.0, c.1, c.2, c.3]); } }
  pub fn clear(&mut self) { self.px.fill(0); }
  #[inline]
  pub fn get(&self, x: usize, y: usize) -> Rgba {
    let i = (y * self.w + x) * 4;
    Rgba(self.px[i], self.px[i + 1], self.px[i + 2], self.px[i + 3])
  }
  #[inline]
  pub fn set(&mut self, x: usize, y: usize, c: Rgba) {
    let i = (y * self.w + x) * 4;
    self.px[i] = c.0; self.px[i + 1] = c.1; self.px[i + 2] = c.2; self.px[i + 3] = c.3;
  }
  /// Source-over with straight alpha in and out.
  #[inline]
  pub fn blend_px(&mut self, x: usize, y: usize, s: Rgba, blend: Blend) {
    if s.3 == 0 || x >= self.w || y >= self.h { return; }
    let i = (y * self.w + x) * 4;
    let d = Rgba(self.px[i], self.px[i + 1], self.px[i + 2], self.px[i + 3]);
    let out = over(d, s, blend);
    self.px[i] = out.0; self.px[i + 1] = out.1; self.px[i + 2] = out.2; self.px[i + 3] = out.3;
  }
  #[inline]
  pub fn plot(&mut self, x: i32, y: i32, c: Rgba) {
    if x < 0 || y < 0 || x as usize >= self.w || y as usize >= self.h { return; }
    self.blend_px(x as usize, y as usize, c, Blend::Normal);
  }
  /// Axis-aligned filled rectangle, clipped.
  pub fn rect(&mut self, x0: i32, y0: i32, w: i32, h: i32, c: Rgba) {
    if c.3 == 0 || w <= 0 || h <= 0 { return; }
    let (xa, ya) = (x0.max(0), y0.max(0));
    let (xb, yb) = ((x0 + w).min(self.w as i32), (y0 + h).min(self.h as i32));
    if c.3 == 255 {
      for y in ya..yb { for x in xa..xb { self.set(x as usize, y as usize, c); } }
    } else {
      for y in ya..yb { for x in xa..xb { self.blend_px(x as usize, y as usize, c, Blend::Normal); } }
    }
  }
  /// Draw `src` onto this frame with its top-left at (x, y), scaled by an integer or fractional factor
  /// with nearest-neighbour sampling (pixel art stays crisp), multiplied by `opacity`.
  pub fn blit_scaled(&mut self, src: &Frame, x: f32, y: f32, sx: f32, sy: f32, opacity: f32, blend: Blend) {
    if sx <= 0.0 || sy <= 0.0 || opacity <= 0.0 { return; }
    let (dw, dh) = ((src.w as f32 * sx).round() as i32, (src.h as f32 * sy).round() as i32);
    let (dx0, dy0) = (x.round() as i32, y.round() as i32);
    let (xa, ya) = (dx0.max(0), dy0.max(0));
    let (xb, yb) = ((dx0 + dw).min(self.w as i32), (dy0 + dh).min(self.h as i32));
    if xa >= xb || ya >= yb { return; }
    let (inv_x, inv_y) = (src.w as f32 / dw.max(1) as f32, src.h as f32 / dh.max(1) as f32);
    for dy in ya..yb {
      let sy_i = (((dy - dy0) as f32 + 0.5) * inv_y) as usize;
      let sy_i = sy_i.min(src.h - 1);
      for dx in xa..xb {
        let sx_i = ((((dx - dx0) as f32 + 0.5) * inv_x) as usize).min(src.w - 1);
        let c = src.get(sx_i, sy_i);
        if c.3 == 0 { continue; }
        self.blend_px(dx as usize, dy as usize, if opacity >= 1.0 { c } else { c.with_alpha(opacity) }, blend);
      }
    }
  }
  /// Draw `src` through a 2×3 affine transform (dest ← src), nearest sampled. Used for rotations,
  /// 3-D spin (x squash) and skew. `m` maps source pixel (u, v) to destination: x = a·u + c·v + e, y = b·u + d·v + f.
  pub fn blit_affine(&mut self, src: &Frame, m: [f32; 6], opacity: f32, blend: Blend) {
    let [a, b, c, d, e, f] = m;
    let det = a * d - b * c;
    if det.abs() < 1e-6 || opacity <= 0.0 { return; }
    // Bounding box of the transformed source.
    let corners = [(0.0, 0.0), (src.w as f32, 0.0), (0.0, src.h as f32), (src.w as f32, src.h as f32)];
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for (u, v) in corners { let x = a * u + c * v + e; let y = b * u + d * v + f; x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
    let (xa, ya) = ((x0.floor() as i32).max(0), (y0.floor() as i32).max(0));
    let (xb, yb) = ((x1.ceil() as i32).min(self.w as i32), (y1.ceil() as i32).min(self.h as i32));
    let (ia, ib, ic, id) = (d / det, -b / det, -c / det, a / det);
    for y in ya..yb {
      for x in xa..xb {
        let (px, py) = (x as f32 + 0.5 - e, y as f32 + 0.5 - f);
        let u = ia * px + ic * py; let v = ib * px + id * py;
        if u < 0.0 || v < 0.0 || u >= src.w as f32 || v >= src.h as f32 { continue; }
        let s = src.get(u as usize, v as usize);
        if s.3 == 0 { continue; }
        self.blend_px(x as usize, y as usize, if opacity >= 1.0 { s } else { s.with_alpha(opacity) }, blend);
      }
    }
  }
  /// Composite a whole same-size layer.
  pub fn composite(&mut self, layer: &Frame, opacity: f32, blend: Blend) {
    debug_assert!(layer.w == self.w && layer.h == self.h);
    for i in 0..self.w * self.h {
      let s = Rgba(layer.px[i * 4], layer.px[i * 4 + 1], layer.px[i * 4 + 2], layer.px[i * 4 + 3]);
      if s.3 == 0 { continue; }
      let (x, y) = (i % self.w, i / self.w);
      self.blend_px(x, y, if opacity >= 1.0 { s } else { s.with_alpha(opacity) }, blend);
    }
  }
  /// Fraction of pixels with any alpha (the Mix screen's "alpha coverage" meter).
  pub fn coverage(&self) -> f32 {
    let n = self.px.chunks_exact(4).filter(|p| p[3] > 0).count();
    n as f32 / (self.w * self.h).max(1) as f32
  }
  pub fn is_clear(&self) -> bool { self.px.chunks_exact(4).all(|p| p[3] == 0) }
  pub fn is_opaque(&self) -> bool { self.px.chunks_exact(4).all(|p| p[3] == 255) }
  /// Premultiplied copy (for pipelines that want it: VP9/HEVC encoders via ffmpeg accept straight).
  pub fn premultiplied(&self) -> Vec<u8> {
    let mut out = self.px.clone();
    for p in out.chunks_exact_mut(4) { let a = p[3] as u32; p[0] = ((p[0] as u32 * a + 127) / 255) as u8; p[1] = ((p[1] as u32 * a + 127) / 255) as u8; p[2] = ((p[2] as u32 * a + 127) / 255) as u8; }
    out
  }
}

/// Source-over of straight-alpha colours with an optional separable blend mode.
#[inline]
pub fn over(d: Rgba, s: Rgba, blend: Blend) -> Rgba {
  let sa = s.3 as f32 / 255.0;
  let da = d.3 as f32 / 255.0;
  if sa >= 1.0 && blend == Blend::Normal { return s; }
  let f = |sc: u8, dc: u8| -> f32 {
    let (sc, dc) = (sc as f32 / 255.0, dc as f32 / 255.0);
    let b = match blend {
      Blend::Normal => sc,
      Blend::Screen => 1.0 - (1.0 - sc) * (1.0 - dc),
      Blend::Multiply => sc * dc,
      Blend::Add => (sc + dc).min(1.0),
      Blend::Difference => (sc - dc).abs(),
    };
    // Blend only where the backdrop exists; elsewhere the source shows as itself.
    let sc = sc * (1.0 - da) + b * da;
    let oa = sa + da * (1.0 - sa);
    if oa <= 0.0 { 0.0 } else { (sc * sa + dc * da * (1.0 - sa)) / oa }
  };
  let oa = sa + da * (1.0 - sa);
  Rgba((f(s.0, d.0) * 255.0).round() as u8, (f(s.1, d.1) * 255.0).round() as u8, (f(s.2, d.2) * 255.0).round() as u8, (oa * 255.0).round() as u8)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn hex_parsing() {
    assert_eq!(Rgba::hex("#1E68F0"), Rgba(0x1E, 0x68, 0xF0, 255));
    assert_eq!(Rgba::hex("#fff"), Rgba::WHITE);
    assert_eq!(Rgba::hex("#00000080"), Rgba(0, 0, 0, 128));
    assert_eq!(Rgba::hex("nope"), Rgba::CLEAR);
    assert_eq!(Rgba::hex("#1E68F0").to_hex(), "#1E68F0");
  }
  #[test]
  fn over_is_exact_at_the_ends() {
    assert_eq!(over(Rgba::CLEAR, Rgba::BLUE, Blend::Normal), Rgba::BLUE);
    assert_eq!(over(Rgba::BLUE, Rgba::CLEAR, Blend::Normal), Rgba::BLUE);
    let half = over(Rgba::CLEAR, Rgba(255, 0, 0, 128), Blend::Normal);
    assert_eq!(half, Rgba(255, 0, 0, 128));
    let onwhite = over(Rgba::WHITE, Rgba(0, 0, 0, 128), Blend::Normal);
    assert!(onwhite.0 > 120 && onwhite.0 < 135 && onwhite.3 == 255);
  }
  #[test]
  fn blit_scaled_keeps_pixels_crisp() {
    let mut s = Frame::new(2, 1); s.set(0, 0, Rgba::BLUE); s.set(1, 0, Rgba::WHITE);
    let mut f = Frame::new(8, 4);
    f.blit_scaled(&s, 0.0, 0.0, 4.0, 4.0, 1.0, Blend::Normal);
    assert_eq!(f.get(3, 3), Rgba::BLUE); assert_eq!(f.get(4, 0), Rgba::WHITE);
    assert!(f.is_opaque());
  }
  #[test]
  fn affine_identity_matches_blit() {
    let mut s = Frame::new(3, 2); s.fill(Rgba::BLUE);
    let mut a = Frame::new(6, 6); a.blit_affine(&s, [1.0, 0.0, 0.0, 1.0, 1.0, 2.0], 1.0, Blend::Normal);
    let mut b = Frame::new(6, 6); b.blit_scaled(&s, 1.0, 2.0, 1.0, 1.0, 1.0, Blend::Normal);
    assert_eq!(a.px, b.px);
  }
}
