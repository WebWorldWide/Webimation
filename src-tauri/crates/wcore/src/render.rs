//! Frame renderer: `render(scene, t, w, h)` composes every object at time `t` into a frame of
//! `w × h` pixels. The design canvas is scaled to the output, so 4K is never upscaled 1080p.

use crate::anim::{self, CellArgs, Slot};
use crate::cards;
use crate::field::Channel;
use crate::frame::{Blend, Frame, Rgba};
use crate::glyph::{self, draw_glyph_field, frame_to_cells, GlyphStyle};
use crate::math::progress;
use crate::pixel::PixelFont;
use crate::scene::{Obj, ObjKind, Scene};
use crate::shapes::render_shape;
use crate::text::{self, render_text, TextStyle};

/// Quantise time to the scene's motion feel (30 smooth, 12 / 6 pixel).
pub fn quantise_time(scene: &Scene, t: f32) -> f32 { let f = scene.fps.max(1) as f32; ((t * f + 1e-4).floor()) / f }

pub fn render(scene: &Scene, t: f32, w: usize, h: usize) -> Frame {
  let mut f = Frame::new(w.max(1), h.max(1));
  let tq = quantise_time(scene, t);
  draw_background(scene, &mut f);
  let prev = if scene.screen.phosphor > 0.0 && t > 0.0 { let mut p = Frame::new(f.w, f.h); render_objects(scene, quantise_time(scene, t - 1.0 / scene.fps.max(1) as f32), &mut p); Some(p) } else { None };
  render_objects(scene, tq, &mut f);
  if !scene.screen.is_identity() { scene.screen.apply(&mut f, tq, prev.as_ref()); }
  f
}

fn draw_background(scene: &Scene, f: &mut Frame) {
  match scene.bg.kind.as_str() {
    "solid" => f.fill(Rgba::hex(&scene.bg.color)),
    "paper" => f.fill(Rgba::hex("#F3EFE6")),
    "sky" => { let (a, b, c) = (Rgba::hex(&scene.bg.color2), Rgba::hex(&scene.bg.color), Rgba::hex("#2E7AF2")); for y in 0..f.h { let u = y as f32 / f.h.max(1) as f32; let col = if u < 0.38 { a.mix(b, u / 0.38) } else { b.mix(c, (u - 0.38) / 0.62) }; f.rect(0, y as i32, f.w as i32, 1, col); } }
    _ => {}
  }
}

fn render_objects(scene: &Scene, t: f32, f: &mut Frame) {
  let scale = f.w as f32 / scene.w.max(1) as f32;
  let mut objs: Vec<&Obj> = scene.objects.iter().filter(|o| !o.hidden).collect();
  objs.sort_by_key(|o| o.order);
  for o in objs { render_object(scene, o, t, scale, 0.0, 0.0, f); }
}

/// Timing of an object at scene time `t`: (local time, enter k, exit x) or None when off screen.
pub fn timing(scene: &Scene, o: &Obj, t: f32, parent_start: f32) -> Option<(f32, f32, f32)> {
  let start = parent_start + o.start;
  let end = if o.dur <= 0.0 { scene.dur } else { (start + o.dur).min(scene.dur) };
  if t < start || t >= end { return None; }
  let local = t - start;
  let k = progress(local, o.enter.delay, if o.enter.id == "none" { 0.0 } else { o.enter.dur });
  let stays = matches!(o.exit.id.as_str(), "stay" | "none");
  let x = if stays { 0.0 } else { let xd = o.exit.dur.max(0.0); let xs = (end - start) - xd; if xd <= 0.0 { if local >= xs { 1.0 } else { 0.0 } } else { progress(local, xs, xd) } };
  if o.enter.id == "none" { return Some((local, 1.0, x)); }
  Some((local, k, x))
}

fn render_object(scene: &Scene, o: &Obj, t: f32, scale: f32, ox: f32, oy: f32, f: &mut Frame) {
  if let ObjKind::Card { template, fields, look, colors } = &o.kind {
    // Cards are groups: time and position their parts relative to the card.
    let Some((_local, _k, _x)) = timing(scene, o, t, 0.0) else { return };
    let parts = cards::expand(template, fields, look, colors, o);
    let start = o.start;
    let card_end = if o.dur <= 0.0 { scene.dur } else { start + o.dur };
    for mut p in parts {
      // Parts that would outlive the card end with it (so the card's exit applies).
      if p.dur <= 0.0 { p.dur = (card_end - start - p.start).max(0.05); }
      p.order = o.order; p.blend = o.blend;
      let sub = Scene { dur: scene.dur, ..scene.clone_shallow() };
      render_part(&sub, &p, t, start, scale, ox + o.x, oy + o.y, o.scale, o.opacity, f);
    }
    return;
  }
  render_part(scene, o, t, 0.0, scale, ox, oy, 1.0, 1.0, f);
}

impl Scene {
  /// A copy without the object list (cards render their parts against the parent's settings).
  pub fn clone_shallow(&self) -> Scene { Scene { objects: Vec::new(), ..self.clone() } }
}

#[allow(clippy::too_many_arguments)]
fn render_part(scene: &Scene, o: &Obj, t: f32, parent_start: f32, scale: f32, ox: f32, oy: f32, pscale: f32, popacity: f32, f: &mut Frame) {
  let Some((local, k, x)) = timing(scene, o, t, parent_start) else { return };
  if k <= 0.0 && o.enter.id != "none" { return; }
  if x >= 1.0 { return; }
  let seed = scene.seed.wrapping_add(crate::math::hash_u32(o.id.bytes().fold(7u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32))));
  let s = scale * o.scale * pscale;
  // 1. Rasterise at output resolution.
  let Some((mut raster, cell, unit)) = rasterise(scene, o, s, k, x, local, seed) else { return };
  // 2. Cell passes: entrance, while-on, exit.
  let amp = 240.0 * scale;
  // Pad once for whichever active cell effects move cells outside the box, then shift back on blit.
  let mut padding = 0usize;
  if k < 1.0 && anim::is_cell(Slot::In, &o.enter.id) { padding = padding.max(anim::pad_for(&o.enter.id, amp, raster.h, cell)); }
  if o.on.id != "none" && anim::is_cell(Slot::On, &o.on.id) { padding = padding.max(anim::pad_for(&o.on.id, amp, raster.h, cell)); }
  if x > 0.0 && anim::is_cell(Slot::Out, &o.exit.id) { padding = padding.max(anim::pad_for(&o.exit.id, amp, raster.h, cell)); }
  if padding > 0 { raster = anim::pad(&raster, padding); }
  let padf = padding as f32;
  if k < 1.0 && anim::is_cell(Slot::In, &o.enter.id) && !text_handled(o, &o.enter.id) {
    raster = anim::cell_pass(&o.enter.id, &raster, &CellArgs { k, dir: o.enter.dir, seed, t: local, amp, exit: false, cell, unit });
  }
  if o.on.id != "none" && anim::is_cell(Slot::On, &o.on.id) {
    raster = anim::cell_pass(&o.on.id, &raster, &CellArgs { k: 1.0, dir: o.enter.dir, seed, t: local * o.on.speed.max(0.05), amp: o.on.amp, exit: false, cell, unit });
  }
  if x > 0.0 && anim::is_cell(Slot::Out, &o.exit.id) && !text_handled(o, &o.exit.id) {
    raster = anim::cell_pass(&o.exit.id, &raster, &CellArgs { k: 1.0 - o.exit.ease.apply(x), dir: o.exit.dir, seed, t: local, amp, exit: true, cell, unit });
  }
  // 3. Transforms.
  let span = f.w as f32 + raster.w as f32 - 2.0 * padf;
  let xf = anim::enter_xf(&o.enter, k, amp, seed).then(anim::on_xf(&o.on, local, scale, span, raster.w as f32 - 2.0 * padf, seed)).then(anim::exit_xf(&o.exit, x, amp, seed));
  if !xf.visible || xf.opacity <= 0.0 { return; }
  let opacity = xf.opacity * o.opacity * popacity;
  let px = (ox + o.x) * scale + xf.dx - padf; let py = (oy + o.y) * scale + xf.dy - padf;
  let rot = o.rot + xf.rot;
  if rot.abs() < 1e-3 && (xf.sx - 1.0).abs() < 1e-4 && (xf.sy - 1.0).abs() < 1e-4 {
    f.blit_scaled(&raster, px, py, 1.0, 1.0, opacity, o.blend);
  } else {
    // Scale and rotate about the raster's centre.
    let (cx, cy) = (raster.w as f32 / 2.0, raster.h as f32 / 2.0);
    let (sn, cs) = rot.to_radians().sin_cos();
    let (a, b, c, d) = (xf.sx * cs, xf.sx * sn, -xf.sy * sn, xf.sy * cs);
    let e = px + cx - (a * cx + c * cy); let ff = py + cy - (b * cx + d * cy);
    f.blit_affine(&raster, [a, b, c, d, e, ff], opacity, o.blend);
  }
}

/// Effects that text objects apply per glyph while rasterising (so the cell pass skips them).
fn text_handled(o: &Obj, fx: &str) -> bool { matches!(o.kind, ObjKind::Text { .. }) && matches!(fx, "typewriter" | "type-off" | "letter-cascade" | "decode" | "decode-out") }

/// Rasterise an object at scale `s`. Returns the frame, the cell size (output px) for cell effects,
/// and the "unit" (one letter's width) for typewriter-style effects.
fn rasterise(scene: &Scene, o: &Obj, s: f32, k: f32, x: f32, local: f32, seed: u32) -> Option<(Frame, f32, f32)> {
  match &o.kind {
    ObjKind::PixelText { text, font, px, color, shadow } => {
      let cellpx = (px * s).max(1.0);
      let sh = if shadow.is_empty() { None } else { Some(Rgba::hex(shadow)) };
      let small = font.render(text, Rgba::hex(color), sh);
      let (gw, _) = font.size();
      if o.as_ascii { return Some(ascii_of(&small, cellpx, o, scene, local, seed)); }
      let mut big = Frame::new((small.w as f32 * cellpx).round() as usize, (small.h as f32 * cellpx).round() as usize);
      big.blit_scaled(&small, 0.0, 0.0, cellpx, cellpx, 1.0, Blend::Normal);
      Some((big, cellpx, (gw + 1) as f32 * cellpx))
    }
    ObjKind::Sprite { sprite, px, tint } => {
      let cellpx = (px * s).max(1.0);
      let fr = sprite.frame_at(local);
      let small = sprite.render(fr, if tint.is_empty() { None } else { Some(Rgba::hex(tint)) });
      if o.as_ascii { return Some(ascii_of(&small, cellpx, o, scene, local, seed)); }
      let mut big = Frame::new((small.w as f32 * cellpx).round().max(1.0) as usize, (small.h as f32 * cellpx).round().max(1.0) as usize);
      big.blit_scaled(&small, 0.0, 0.0, cellpx, cellpx, 1.0, Blend::Normal);
      Some((big, cellpx, cellpx * 4.0))
    }
    ObjKind::Text { text: txt, style } => {
      let mut st = style.clone(); st.size *= s; st.pad_x *= s; st.pad_y *= s; st.shadow_dx *= s; st.shadow_dy *= s;
      let fx_in = o.enter.id.as_str(); let fx_out = o.exit.id.as_str();
      let n = txt.chars().filter(|c| *c != '\n').count().max(1);
      let decode_in = fx_in == "decode" && k < 1.0; let decode_out = fx_out == "decode-out" && x > 0.0;
      let shown: String = if decode_in || decode_out {
        let kk = if decode_out { 1.0 - x } else { k };
        txt.chars().enumerate().map(|(i, c)| anim::decode_char(c, i, n, kk, local, seed)).collect()
      } else { txt.clone() };
      let px = st.size;
      let vis = |i: usize, _g: &text::Placed| -> (f32, f32, f32) {
        let mut a = (1.0, 0.0, 0.0);
        if k < 1.0 { if let Some(v) = anim::glyph_fx(fx_in, i, n, k, px, false) { a = v; } }
        if x > 0.0 { if let Some(v) = anim::glyph_fx(fx_out, i, n, 1.0 - o.exit.ease.apply(x), px, true) { a = (a.0 * v.0, a.1 + v.1, a.2 + v.2); } }
        a
      };
      let (fr, lay) = render_text(&shown, &st, &vis);
      let _ = TextStyle::default();
      Some((fr, (8.0 * s).max(1.0), (lay.px * 0.55).max(2.0)))
    }
    ObjKind::Ascii { text: art, cell, font, color } => {
      let cellpx = (cell * s).max(2.0);
      let lines: Vec<&str> = art.lines().collect();
      let cols = lines.iter().map(|l| l.chars().count()).max().unwrap_or(1).max(1);
      let rows = lines.len().max(1);
      let (cw, ch) = (cellpx * 0.6, cellpx);
      let mut fr = Frame::new((cols as f32 * cw).ceil() as usize, (rows as f32 * ch).ceil() as usize);
      let font_ok = crate::fonts::has_font(font);
      let col = Rgba::hex(color);
      for (y, l) in lines.iter().enumerate() { for (xx, chh) in l.chars().enumerate() { if chh != ' ' { glyph::draw_char(&mut fr, chh, font, font_ok, xx as f32 * cw, y as f32 * ch, cw, ch, ch * 0.92, col); } } }
      Some((fr, cw, cw))
    }
    ObjKind::AsciiBanner { text: txt, cell, font, on, color } => {
      let cellpx = (cell * s).max(2.0);
      let small = PixelFont::Five.render(txt, Rgba::WHITE, None);
      let (cw, ch) = (cellpx * 0.6, cellpx);
      let mut fr = Frame::new((small.w as f32 * cw).ceil().max(1.0) as usize, (small.h as f32 * ch).ceil().max(1.0) as usize);
      let font_ok = crate::fonts::has_font(font);
      let col = Rgba::hex(color);
      let onc = on.chars().next().unwrap_or('#');
      for y in 0..small.h { for xx in 0..small.w { if small.get(xx, y).3 > 0 { glyph::draw_char(&mut fr, onc, font, font_ok, xx as f32 * cw, y as f32 * ch, cw, ch, ch * 0.92, col); } } }
      Some((fr, cw, cw * 6.0))
    }
    ObjKind::Field { w, h, style, field, source } => {
      let (fw, fh) = (((w * s).round() as usize).max(2), ((h * s).round() as usize).max(2));
      let (cols, rows, cw, _) = style.grid(fw, fh);
      let grey = field_cells(style, field, source, cols, rows, fw, fh, local, scene);
      let mut fr = Frame::new(fw, fh);
      draw_glyph_field(&grey, cols, rows, style, fw, fh, local, seed, &mut fr);
      Some((fr, cw, cw))
    }
    ObjKind::Shape { style, w, h } => {
      let mut st = style.clone(); st.stroke_w *= s; st.pixel *= s;
      let draw_k = if o.enter.id == "draw-on" { o.enter.ease.apply(k) } else { 1.0 };
      let fr = render_shape(&st, (w * s).max(1.0), (h * s).max(1.0), draw_k);
      Some((fr, (8.0 * s).max(1.0), (8.0 * s).max(1.0)))
    }
    ObjKind::Card { .. } => None,
  }
}

/// Grey per cell for a field object: a channel, or a text/logo mask run through the channel as a
/// modulation.
#[allow(clippy::too_many_arguments)]
fn field_cells(style: &GlyphStyle, field: &crate::field::FieldParams, source: &str, cols: usize, rows: usize, fw: usize, fh: usize, t: f32, scene: &Scene) -> Vec<f32> {
  let aspect = fw as f32 / fh.max(1) as f32;
  let mut grey = vec![0f32; cols * rows];
  match field.channel {
    Channel::Text | Channel::Logo => {
      // Render the source as a mask at cell resolution, then let the plasma breathe through it.
      let mask_frame = if field.channel == Channel::Text {
        let st = TextStyle { font: style.font.clone(), size: fh as f32 * 0.5 / (source.lines().count().max(1) as f32).sqrt(), color: "#FFFFFF".into(), align: text::Align::Center, ..Default::default() };
        let (f, _) = render_text(if source.is_empty() { "WEBIMATION" } else { source }, &st, &text::all_visible);
        let mut m = Frame::new(fw, fh); m.blit_scaled(&f, ((fw as f32 - f.w as f32) / 2.0).max(0.0), ((fh as f32 - f.h as f32) / 2.0).max(0.0), 1.0, 1.0, 1.0, Blend::Normal); m
      } else {
        let sp = crate::pixel::starter(if source.is_empty() { "play" } else { source }).unwrap_or_else(crate::pixel::play_screen);
        let f = sp.render(sp.frame_at(t), Some(Rgba::WHITE));
        let k = (fh as f32 * 0.7 / f.h as f32).max(1.0);
        let mut m = Frame::new(fw, fh); m.blit_scaled(&f, (fw as f32 - f.w as f32 * k) / 2.0, (fh as f32 - f.h as f32 * k) / 2.0, k, k, 1.0, Blend::Normal); m
      };
      let mask = frame_to_cells(&mask_frame, cols, rows);
      let plasma = crate::field::FieldParams { channel: Channel::Plasma, ..field.clone() };
      for y in 0..rows { for x in 0..cols { let i = y * cols + x; let m = mask[i]; grey[i] = if m > 0.05 { 0.55 + 0.45 * plasma.sample((x as f32 + 0.5) / cols as f32, (y as f32 + 0.5) / rows as f32, aspect, t) } else { 0.0 }; } }
    }
    _ => { for y in 0..rows { for x in 0..cols { grey[y * cols + x] = field.sample((x as f32 + 0.5) / cols as f32, (y as f32 + 0.5) / rows as f32, aspect, t); } } }
  }
  let _ = scene;
  grey
}

/// "Switch to characters": draw a small pixel raster as glyphs, one per pixel.
fn ascii_of(small: &Frame, cellpx: f32, o: &Obj, _scene: &Scene, t: f32, seed: u32) -> (Frame, f32, f32) {
  let st = GlyphStyle { font: o.ascii_font.clone(), chars: o.ascii_chars.clone(), cell: cellpx * 1920.0 / cellpx.max(1.0) / (1920.0 / cellpx), ..Default::default() };
  let (cw, ch) = (cellpx, cellpx * 1.0);
  let mut fr = Frame::new((small.w as f32 * cw).ceil().max(1.0) as usize, (small.h as f32 * ch).ceil().max(1.0) as usize);
  let ramp = st.ramp();
  let font_ok = crate::fonts::has_font(&st.font);
  for y in 0..small.h { for x in 0..small.w {
    let p = small.get(x, y); if p.3 == 0 { continue; }
    let v = 0.3 + 0.7 * p.lum();
    let idx = ((v * (ramp.len() - 1) as f32).round() as usize).min(ramp.len() - 1).max(1);
    let chh = ramp[idx];
    let _ = (t, seed);
    glyph::draw_char(&mut fr, chh, &st.font, font_ok, x as f32 * cw, y as f32 * ch, cw, ch, ch * 0.95, p);
  } }
  (fr, cw, cw * 6.0)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::scene::{FxIn, FxOn, FxOut};
  fn demo() -> Scene {
    let mut s = Scene { w: 640, h: 360, dur: 4.0, ..Default::default() };
    s.objects.push(Obj { id: "t".into(), x: 40.0, y: 40.0, kind: ObjKind::PixelText { text: "WEB".into(), font: PixelFont::Five, px: 10.0, color: "#FFFFFF".into(), shadow: "#0E2960".into() }, enter: FxIn { id: "blocky-wipe".into(), dur: 0.6, ..Default::default() }, on: FxOn { id: "bob".into(), amp: 1.0, speed: 1.0 }, exit: FxOut { id: "dither-out".into(), dur: 0.5, ..Default::default() }, ..Default::default() });
    s.objects.push(Obj { id: "s".into(), x: 300.0, y: 100.0, start: 0.5, kind: ObjKind::Shape { style: crate::shapes::ShapeStyle::default(), w: 120.0, h: 60.0 }, enter: FxIn { id: "pop".into(), dur: 0.4, ..Default::default() }, exit: FxOut { id: "shrink".into(), dur: 0.3, ..Default::default() }, ..Default::default() });
    s
  }
  #[test]
  fn frames_are_pure_functions_of_time() {
    let s = demo();
    let a = render(&s, 1.25, 320, 180); let b = render(&s, 1.25, 320, 180);
    assert_eq!(a.px, b.px);
    assert!(render(&s, 0.0, 320, 180).coverage() < render(&s, 1.0, 320, 180).coverage());
  }
  #[test]
  fn clear_before_cue_and_after_end() {
    let s = demo();
    assert!(render(&s, 3.999, 320, 180).coverage() < 0.001 || render(&s, 3.999, 320, 180).coverage() < render(&s, 2.0, 320, 180).coverage());
    let mut late = s.clone(); for o in late.objects.iter_mut() { o.start = 2.0; }
    assert!(render(&late, 1.0, 320, 180).is_clear());
  }
  #[test]
  fn output_size_scales_the_design() {
    let s = demo();
    let small = render(&s, 1.0, 320, 180); let big = render(&s, 1.0, 1280, 720);
    assert!((small.coverage() - big.coverage()).abs() < 0.03);
  }
  #[test]
  fn cards_and_fields_render() {
    crate::fonts::load_test_fonts();
    let mut s = Scene { w: 1920, h: 1080, dur: 5.0, ..Default::default() };
    for c in cards::CARDS { s.objects.push(Obj { id: c.id.into(), x: 200.0, y: 300.0, kind: ObjKind::Card { template: c.id.into(), fields: Default::default(), look: "loud".into(), colors: "www".into() }, ..Default::default() }); }
    s.objects.push(Obj { id: "f".into(), kind: ObjKind::Field { w: 1920.0, h: 1080.0, style: GlyphStyle::default(), field: Default::default(), source: String::new() }, order: 0, ..Default::default() });
    let f = render(&s, 2.0, 480, 270);
    assert!(f.coverage() > 0.2);
  }
  #[test]
  fn motion_feel_holds_frames() {
    let mut s = demo(); s.fps = 6;
    let a = render(&s, 1.00, 160, 90); let b = render(&s, 1.10, 160, 90); let c = render(&s, 1.20, 160, 90);
    assert_eq!(a.px, b.px); assert_ne!(a.px, c.px);
  }
}
