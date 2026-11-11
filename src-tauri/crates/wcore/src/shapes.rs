//! Simple vector shapes rasterised with a scanline fill and a stroke, plus a draw-on progress for
//! the "Draw on" animation. Shapes are the Draw screen's editable primitives.

use serde::{Deserialize, Serialize};
use crate::frame::{Frame, Rgba};
use std::f32::consts::{PI, TAU};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShapeKind { #[default] Rect, Rounded, Ellipse, Triangle, Star, Line, Arrow, Elbow, Bubble, Pin, Check, Cross, Burst, Heart, Cloud, Underline, CircleIt, Progress, Bracket, Spotlight }

impl ShapeKind {
  pub const ALL: [ShapeKind; 20] = [ShapeKind::Rect, ShapeKind::Rounded, ShapeKind::Ellipse, ShapeKind::Triangle, ShapeKind::Star, ShapeKind::Line, ShapeKind::Arrow, ShapeKind::Elbow, ShapeKind::Bubble, ShapeKind::Pin, ShapeKind::Check, ShapeKind::Cross, ShapeKind::Burst, ShapeKind::Heart, ShapeKind::Cloud, ShapeKind::Underline, ShapeKind::CircleIt, ShapeKind::Progress, ShapeKind::Bracket, ShapeKind::Spotlight];
  pub fn label(self) -> &'static str {
    match self { ShapeKind::Rect => "Rectangle", ShapeKind::Rounded => "Rounded", ShapeKind::Ellipse => "Ellipse", ShapeKind::Triangle => "Triangle", ShapeKind::Star => "Star", ShapeKind::Line => "Line", ShapeKind::Arrow => "Arrow", ShapeKind::Elbow => "Elbow arrow", ShapeKind::Bubble => "Speech bubble", ShapeKind::Pin => "Pin", ShapeKind::Check => "Check", ShapeKind::Cross => "Cross", ShapeKind::Burst => "Burst", ShapeKind::Heart => "Heart", ShapeKind::Cloud => "Cloud", ShapeKind::Underline => "Underline", ShapeKind::CircleIt => "Circle it", ShapeKind::Progress => "Progress bar", ShapeKind::Bracket => "Bracket", ShapeKind::Spotlight => "Spotlight" }
  }
  /// Open shapes are strokes only (draw-on reveals along the path).
  pub fn is_open(self) -> bool { matches!(self, ShapeKind::Line | ShapeKind::Arrow | ShapeKind::Elbow | ShapeKind::Check | ShapeKind::Cross | ShapeKind::Underline | ShapeKind::CircleIt | ShapeKind::Bracket) }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ShapeStyle {
  pub kind: ShapeKind,
  pub fill: String,
  pub stroke: String,
  pub stroke_w: f32,
  /// Corner radius (Rounded), tail position (Bubble), points (Star/Burst), value (Progress) …
  pub param: f32,
  /// Pixel look: snap the outline to a coarse grid of `pixel` px.
  pub pixel: f32,
  /// Hard offset shadow (empty = none).
  pub shadow: String,
}
impl Default for ShapeStyle { fn default() -> Self { ShapeStyle { kind: ShapeKind::Rect, fill: "#1E68F0".into(), stroke: String::new(), stroke_w: 0.0, param: 0.0, pixel: 0.0, shadow: String::new() } } }

/// A path: polyline points in box space (0..w, 0..h). Closed shapes get filled.
pub fn path(kind: ShapeKind, w: f32, h: f32, p: f32) -> (Vec<(f32, f32)>, bool) {
  let n = 64;
  match kind {
    ShapeKind::Rect => (vec![(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)], true),
    ShapeKind::Rounded => { let r = if p > 0.0 { p } else { w.min(h) * 0.2 }.min(w / 2.0).min(h / 2.0); let mut v = Vec::new(); for (cx, cy, a0) in [(w - r, r, -PI / 2.0), (w - r, h - r, 0.0), (r, h - r, PI / 2.0), (r, r, PI)] { for i in 0..=8 { let a = a0 + i as f32 / 8.0 * PI / 2.0; v.push((cx + r * a.cos(), cy + r * a.sin())); } } (v, true) }
    ShapeKind::Ellipse | ShapeKind::Spotlight => ((0..n).map(|i| { let a = i as f32 / n as f32 * TAU; (w / 2.0 + w / 2.0 * a.cos(), h / 2.0 + h / 2.0 * a.sin()) }).collect(), true),
    ShapeKind::CircleIt => ((0..=n).map(|i| { let a = -PI * 0.6 + i as f32 / n as f32 * TAU * 1.08; let wob = 1.0 + 0.04 * (a * 3.0).sin(); (w / 2.0 + w / 2.0 * 0.96 * wob * a.cos(), h / 2.0 + h / 2.0 * 0.92 * wob * a.sin()) }).collect(), false),
    ShapeKind::Triangle => (vec![(w / 2.0, 0.0), (w, h), (0.0, h)], true),
    ShapeKind::Star | ShapeKind::Burst => { let k = if p >= 3.0 { p as usize } else if kind == ShapeKind::Star { 5 } else { 12 }; let inner = if kind == ShapeKind::Star { 0.45 } else { 0.72 }; ((0..k * 2).map(|i| { let a = -PI / 2.0 + i as f32 / (k * 2) as f32 * TAU; let r = if i % 2 == 0 { 1.0 } else { inner }; (w / 2.0 + w / 2.0 * r * a.cos(), h / 2.0 + h / 2.0 * r * a.sin()) }).collect(), true) }
    ShapeKind::Line | ShapeKind::Underline => (vec![(0.0, h / 2.0), (w, h / 2.0)], false),
    ShapeKind::Arrow => (vec![(0.0, h / 2.0), (w, h / 2.0)], false),
    ShapeKind::Elbow => (vec![(0.0, 0.0), (0.0, h), (w, h)], false),
    ShapeKind::Bubble => { let tail = if p > 0.0 { p } else { 0.25 }; let bh = h * 0.78; let r = (w.min(bh) * 0.12).max(2.0); let mut v = Vec::new(); for (cx, cy, a0) in [(w - r, r, -PI / 2.0), (w - r, bh - r, 0.0)] { for i in 0..=6 { let a = a0 + i as f32 / 6.0 * PI / 2.0; v.push((cx + r * a.cos(), cy + r * a.sin())); } } let tx = w * tail; v.push((tx + w * 0.12, bh)); v.push((tx, h)); v.push((tx + w * 0.02, bh)); for (cx, cy, a0) in [(r, bh - r, PI / 2.0), (r, r, PI)] { for i in 0..=6 { let a = a0 + i as f32 / 6.0 * PI / 2.0; v.push((cx + r * a.cos(), cy + r * a.sin())); } } (v, true) }
    ShapeKind::Pin => { let r = w / 2.0; let mut v = Vec::new(); for i in 0..=40 { let a = PI * 0.8 + i as f32 / 40.0 * PI * 1.4; v.push((w / 2.0 + r * a.cos(), r + r * a.sin())); } v.push((w / 2.0, h)); (v, true) }
    ShapeKind::Check => (vec![(0.0, h * 0.55), (w * 0.38, h), (w, 0.0)], false),
    ShapeKind::Cross => (vec![(0.0, 0.0), (w, h), (w / 2.0, h / 2.0), (w, 0.0), (0.0, h)], false),
    ShapeKind::Heart => ((0..n).map(|i| { let t = i as f32 / n as f32 * TAU; let x = 16.0 * t.sin().powi(3); let y = 13.0 * t.cos() - 5.0 * (2.0 * t).cos() - 2.0 * (3.0 * t).cos() - (4.0 * t).cos(); (w / 2.0 + x / 34.0 * w, h / 2.0 - y / 30.0 * h) }).collect(), true),
    ShapeKind::Cloud => { let mut v = Vec::new(); let lobes = [(0.22, 0.62, 0.22), (0.42, 0.42, 0.3), (0.66, 0.5, 0.26), (0.82, 0.68, 0.18)]; for (cx, cy, r) in lobes { for i in 0..16 { let a = PI + i as f32 / 16.0 * PI; v.push((cx * w + r * w * a.cos(), cy * h + r * h * 1.2 * a.sin())); } } v.push((w, h * 0.9)); v.push((0.0, h * 0.9)); (v, true) }
    ShapeKind::Progress => (vec![(0.0, 0.0), (w * p.clamp(0.0, 1.0).max(0.001), 0.0), (w * p.clamp(0.0, 1.0).max(0.001), h), (0.0, h)], true),
    ShapeKind::Bracket => (vec![(w, 0.0), (0.0, 0.0), (0.0, h), (w, h)], false),
  }
}

fn path_len(pts: &[(f32, f32)], closed: bool) -> f32 {
  let mut l = 0.0; for i in 1..pts.len() { l += dist(pts[i - 1], pts[i]); } if closed && pts.len() > 1 { l += dist(pts[pts.len() - 1], pts[0]); } l
}
fn dist(a: (f32, f32), b: (f32, f32)) -> f32 { ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt() }

/// Keep the first `k` (0..1) of a path's length.
pub fn partial(pts: &[(f32, f32)], closed: bool, k: f32) -> Vec<(f32, f32)> {
  if k >= 1.0 { let mut v = pts.to_vec(); if closed && !v.is_empty() { v.push(v[0]); } return v; }
  let total = path_len(pts, closed) * k.max(0.0);
  let mut out = vec![pts[0]]; let mut acc = 0.0;
  let n = if closed { pts.len() } else { pts.len() - 1 };
  for i in 0..n {
    let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
    let d = dist(a, b);
    if acc + d >= total { let t = if d > 0.0 { (total - acc) / d } else { 0.0 }; out.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)); return out; }
    acc += d; out.push(b);
  }
  out
}

/// Scanline fill of a polygon (even-odd) into `f` at offset.
pub fn fill_poly(f: &mut Frame, pts: &[(f32, f32)], ox: f32, oy: f32, c: Rgba, snap: f32) {
  if pts.len() < 3 || c.3 == 0 { return; }
  let q = |v: f32| if snap > 1.0 { (v / snap).round() * snap } else { v };
  let pts: Vec<(f32, f32)> = pts.iter().map(|&(x, y)| (q(x + ox), q(y + oy))).collect();
  let (y0, y1) = (pts.iter().map(|p| p.1).fold(f32::MAX, f32::min).floor().max(0.0) as i32, pts.iter().map(|p| p.1).fold(f32::MIN, f32::max).ceil().min(f.h as f32) as i32);
  let mut xs: Vec<f32> = Vec::new();
  for y in y0..y1 {
    let sy = y as f32 + 0.5; xs.clear();
    for i in 0..pts.len() {
      let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
      if (a.1 <= sy && b.1 > sy) || (b.1 <= sy && a.1 > sy) { xs.push(a.0 + (sy - a.1) / (b.1 - a.1) * (b.0 - a.0)); }
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    for pair in xs.chunks_exact(2) { let (xa, xb) = (pair[0].round() as i32, pair[1].round() as i32); f.rect(xa, y, xb - xa, 1, c); }
  }
}

/// Stroke a polyline with round-ish joins (a disc stamped along the path).
pub fn stroke_poly(f: &mut Frame, pts: &[(f32, f32)], ox: f32, oy: f32, width: f32, c: Rgba, snap: f32) {
  if pts.len() < 2 || c.3 == 0 || width <= 0.0 { return; }
  let r = width / 2.0;
  let q = |v: f32| if snap > 1.0 { (v / snap).round() * snap } else { v };
  let mut stamp = |x: f32, y: f32| {
    if snap > 1.0 { let s = snap as i32; let w = ((width / snap).round().max(1.0) as i32) * s; f.rect(q(x - r) as i32, q(y - r) as i32, w, w, c); return; }
    let (x0, y0, x1, y1) = ((x - r).floor() as i32, (y - r).floor() as i32, (x + r).ceil() as i32, (y + r).ceil() as i32);
    for py in y0..=y1 { for px in x0..=x1 { let d = ((px as f32 + 0.5 - x).powi(2) + (py as f32 + 0.5 - y).powi(2)).sqrt(); if d <= r { f.plot(px, py, c); } else if d < r + 0.7 && snap <= 1.0 { f.plot(px, py, c.with_alpha(r + 0.7 - d)); } } }
  };
  for i in 1..pts.len() {
    let (a, b) = (pts[i - 1], pts[i]);
    let d = dist(a, b); let steps = (d / (r * 0.5).max(1.0)).ceil().max(1.0) as usize;
    for s in 0..=steps { let t = s as f32 / steps as f32; stamp(a.0 + (b.0 - a.0) * t + ox, a.1 + (b.1 - a.1) * t + oy); }
  }
}

/// Transparent border `render_shape` leaves around the shape box (room for strokes and shadow).
pub fn shape_margin(st: &ShapeStyle) -> f32 { (st.stroke_w.max(2.0) + if st.shadow.is_empty() { 0.0 } else { 6.0 }).ceil() }

/// Draw a shape into a `w × h` frame. `k` is draw-on progress (1 = complete).
pub fn render_shape(st: &ShapeStyle, w: f32, h: f32, k: f32) -> Frame {
  let (pts, closed) = path(st.kind, w, h, st.param);
  let sh = !st.shadow.is_empty();
  let margin = shape_margin(st);
  let mut f = Frame::new((w + margin * 2.0).ceil() as usize, (h + margin * 2.0).ceil() as usize);
  let fill = Rgba::hex(&st.fill); let stroke = Rgba::hex(&st.stroke);
  let (ox, oy) = (margin, margin);
  let draw = |f: &mut Frame, dx: f32, dy: f32, fill: Rgba, stroke: Rgba| {
    if closed && !fill.is_clear() {
      if k >= 1.0 { fill_poly(f, &pts, ox + dx, oy + dy, fill, st.pixel); }
      else { // Draw-on for filled shapes: reveal with a wipe along the path's bounding box from the left.
        let mut c = f.clone(); c.clear(); fill_poly(&mut c, &pts, ox + dx, oy + dy, fill, st.pixel);
        let cut = ((w + margin * 2.0) * k) as i32; for y in 0..c.h { for x in cut.max(0) as usize..c.w { c.set(x, y, Rgba::CLEAR); } }
        f.composite(&c, 1.0, crate::frame::Blend::Normal);
      }
    }
    if st.stroke_w > 0.0 && !stroke.is_clear() {
      let p = partial(&pts, closed, k);
      stroke_poly(f, &p, ox + dx, oy + dy, st.stroke_w, stroke, st.pixel);
      if st.kind == ShapeKind::Arrow && k > 0.05 {
        // Arrow head lands when the line arrives.
        let tip = *p.last().unwrap(); let hw = (st.stroke_w * 3.0).max(h * 0.5);
        let head = [(tip.0, tip.1), (tip.0 - hw, tip.1 - hw * 0.6), (tip.0 - hw, tip.1 + hw * 0.6)];
        fill_poly(f, &head, ox + dx, oy + dy, stroke, st.pixel);
      }
      if st.kind == ShapeKind::Pin && k >= 1.0 { let r = w * 0.18; let mut hole = Vec::new(); for i in 0..24 { let a = i as f32 / 24.0 * TAU; hole.push((w / 2.0 + r * a.cos(), w / 2.0 + r * a.sin())); } fill_poly(f, &hole, ox + dx, oy + dy, Rgba::WHITE, st.pixel); }
    } else if st.kind == ShapeKind::Arrow && !fill.is_clear() {
      let p = partial(&pts, false, k); let sw = (h * 0.28).max(3.0);
      stroke_poly(f, &p, ox + dx, oy + dy, sw, fill, st.pixel);
      if k > 0.05 { let tip = *p.last().unwrap(); let hw = h * 0.5; fill_poly(f, &[(tip.0, tip.1), (tip.0 - hw, tip.1 - hw * 0.9), (tip.0 - hw, tip.1 + hw * 0.9)], ox + dx, oy + dy, fill, st.pixel); }
    } else if st.kind.is_open() && !fill.is_clear() {
      stroke_poly(f, &partial(&pts, closed, k), ox + dx, oy + dy, (h * 0.18).max(3.0), fill, st.pixel);
    }
  };
  if sh { let sc = Rgba::hex(&st.shadow); draw(&mut f, 5.0, 5.0, if fill.is_clear() { Rgba::CLEAR } else { sc }, if stroke.is_clear() { Rgba::CLEAR } else { sc }); }
  draw(&mut f, 0.0, 0.0, fill, stroke);
  f
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn every_shape_draws_and_draw_on_grows() {
    for kind in ShapeKind::ALL {
      let st = ShapeStyle { kind, fill: "#1E68F0".into(), stroke: "#FFFFFF".into(), stroke_w: 4.0, param: 0.6, ..Default::default() };
      let full = render_shape(&st, 120.0, 80.0, 1.0); let half = render_shape(&st, 120.0, 80.0, 0.4);
      assert!(full.coverage() > 0.02, "{kind:?} empty");
      assert!(half.coverage() <= full.coverage() + 1e-6, "{kind:?} draw-on");
      assert!(render_shape(&st, 120.0, 80.0, 0.0).coverage() < full.coverage());
    }
  }
  #[test]
  fn partial_path_keeps_length() {
    let pts = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)];
    let p = partial(&pts, false, 0.75); assert_eq!(p.len(), 3); assert!((p[2].1 - 5.0).abs() < 1e-4);
  }
}
