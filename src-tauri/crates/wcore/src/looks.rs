//! One-click presets: Glyph Lab "Looks" (a whole glyph style + field + screen in one go) and the
//! Animation Lab's starter scenes, every object already animated.

use crate::dither::DitherKind;
use crate::field::{Channel, FieldParams};
use crate::glyph::{GlyphStyle, Pick};
use crate::palette::palette;
use crate::pixel::{self, PixelFont};
use crate::scene::{Background, Dir, FxIn, FxOn, FxOut, Obj, ObjKind, Scene};
use crate::screen::Screen;
use crate::shapes::{ShapeKind, ShapeStyle};
use crate::text::{Align, TextStyle};
use crate::tone::Tone;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Look { pub id: &'static str, pub name: &'static str, pub style: GlyphStyle, pub field: FieldParams, pub screen: Screen }

fn gs(font: &str, cell: f32, chars: &str, pal: &str, dither: DitherKind) -> GlyphStyle {
  GlyphStyle { font: font.into(), cell, chars: chars.into(), palette: palette(pal).unwrap(), dither, ..Default::default() }
}
fn fp(ch: Channel, speed: f32, zoom: f32) -> FieldParams { FieldParams { channel: ch, speed, zoom, ..Default::default() } }

pub static LOOKS: std::sync::LazyLock<Vec<Look>> = std::sync::LazyLock::new(|| vec![
  Look { id: "horizon", name: "Horizon glow", style: GlyphStyle { tone: Tone { gamma: 1.2, ..Default::default() }, ..gs("jetbrains-mono", 11.0, " .:-=+*#%@", "horizon", DitherKind::None) }, field: fp(Channel::Horizon, 1.0, 1.0), screen: Screen { scanlines: 0.25, grain: 0.06, glow: 0.35, ..Default::default() } },
  Look { id: "matrix", name: "Matrix", style: GlyphStyle { pick: Pick::Random, flicker: 0.3, ..gs("share-tech-mono", 13.0, " ｱｲｳｴｵｶｷｸｹｺ01", "matrix", DitherKind::None) }, field: fp(Channel::Rain, 1.0, 1.0), screen: Screen { scanlines: 0.3, glow: 0.4, ..Default::default() } },
  Look { id: "newsprint", name: "Newsprint", style: GlyphStyle { fill_cells: true, ..gs("courier-prime", 10.0, " .:-=+*#%@", "newsprint", DitherKind::FloydSteinberg) }, field: fp(Channel::Bloom, 0.6, 1.0), screen: Screen { grain: 0.15, ..Default::default() } },
  Look { id: "gameboy", name: "Game Boy", style: GlyphStyle { fill_cells: true, ..gs("press-start", 16.0, " ░▒▓█", "gameboy", DitherKind::Bayer4) }, field: fp(Channel::Dunes, 0.7, 1.0), screen: Screen { scanlines: 0.15, scan_spacing: 4, ..Default::default() } },
  Look { id: "teletext", name: "Teletext", style: GlyphStyle { fill_cells: true, ..gs("vt323", 18.0, " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█", "teletext", DitherKind::Bayer2) }, field: fp(Channel::Plasma, 0.8, 1.2), screen: Screen { scanlines: 0.4, scan_spacing: 2, ..Default::default() } },
  Look { id: "braille", name: "Braille mist", style: gs("dm-mono", 9.0, " ⠁⠃⠇⠏⠟⠿⡿⣿", "braille", DitherKind::BlueNoise), field: fp(Channel::Clouds, 0.5, 1.0), screen: Screen::default() },
  Look { id: "signal", name: "Signal lost", style: GlyphStyle { flicker: 0.5, ..gs("ibm-plex-mono", 12.0, " .:-=+*#%@", "signal", DitherKind::Row) }, field: fp(Channel::Signal, 1.2, 1.0), screen: Screen { scanlines: 0.5, rgb_split: 3.0, grain: 0.2, phosphor: 0.3, ..Default::default() } },
  Look { id: "bigtype", name: "Big type", style: gs("sixtyfour", 26.0, " .#", "www", DitherKind::None), field: fp(Channel::Text, 1.0, 1.0), screen: Screen { glow: 0.3, ..Default::default() } },
  Look { id: "tunnel", name: "Tunnel", style: gs("fira-code", 12.0, " ░▒▓█", "orchid", DitherKind::Bayer8), field: fp(Channel::Tunnel, 1.0, 1.0), screen: Screen { vignette: 0.6, ..Default::default() } },
  Look { id: "www", name: "WWW sky", style: GlyphStyle { fill_cells: true, ..gs("silkscreen", 14.0, " ░▒▓█", "www", DitherKind::Atkinson) }, field: fp(Channel::Clouds, 0.4, 0.8), screen: Screen::default() },
]);
pub fn look(id: &str) -> Option<&'static Look> { LOOKS.iter().find(|l| l.id == id) }

/// Starter scenes for the Animation Lab.
pub const SCENES: &[(&str, &str, &str)] = &[
  ("channel-intro", "Channel intro", "Pixel title, clouds and a subscribe button"),
  ("subscribe", "Subscribe reminder", "A button, a cursor and a click"),
  ("chapter", "Chapter card", "A kicker and a big title"),
  ("lower-third", "Lower third", "Name and role at the bottom"),
  ("end-screen", "End screen", "Two boxes and a thank-you"),
  ("ascii-drop", "ASCII drop", "A glyph field with a decoding title"),
  ("shorts-hook", "Shorts hook", "Vertical, big words, fast"),
];

fn ptext(id: &str, text: &str, px: f32, color: &str, x: f32, y: f32, start: f32, enter: &str, on: &str, exit: &str) -> Obj {
  Obj { id: id.into(), name: text.into(), kind: ObjKind::PixelText { text: text.into(), font: PixelFont::Five, px, color: color.into(), shadow: pixel::WWW_INK.into() }, x, y, start, enter: FxIn { id: enter.into(), dur: 0.6, ..Default::default() }, on: FxOn { id: on.into(), amp: 1.0, speed: 1.0 }, exit: FxOut { id: exit.into(), dur: 0.4, ..Default::default() }, ..Default::default() }
}
fn sprite(id: &str, name: &str, sp: pixel::Sprite, px: f32, x: f32, y: f32, start: f32, enter: &str, on: &str, exit: &str) -> Obj {
  Obj { id: id.into(), name: name.into(), kind: ObjKind::Sprite { sprite: sp, px, tint: String::new() }, x, y, start, enter: FxIn { id: enter.into(), dur: 0.5, ..Default::default() }, on: FxOn { id: on.into(), amp: 1.0, speed: 1.0 }, exit: FxOut { id: exit.into(), dur: 0.4, ..Default::default() }, ..Default::default() }
}
fn vtext(id: &str, text: &str, font: &str, size: f32, color: &str, x: f32, y: f32, start: f32, enter: &str, exit: &str) -> Obj {
  Obj { id: id.into(), name: text.into(), kind: ObjKind::Text { text: text.into(), style: TextStyle { font: font.into(), size, color: color.into(), ..Default::default() } }, x, y, start, enter: FxIn { id: enter.into(), dur: 0.5, ..Default::default() }, exit: FxOut { id: exit.into(), dur: 0.35, ..Default::default() }, ..Default::default() }
}

pub fn scene(id: &str) -> Option<Scene> {
  let mut s = Scene { name: SCENES.iter().find(|x| x.0 == id).map(|x| x.1).unwrap_or(id).into(), w: 1920, h: 1080, fps: 12, dur: 8.0, grid: 128, bg: Background { kind: "sky".into(), ..Default::default() }, ..Default::default() };
  match id {
    "channel-intro" => {
      s.dur = 8.2;
      let mut c1 = sprite("far", "Far cloud", pixel::cloud(0), 10.0, 120.0, 90.0, 0.0, "appear", "drift-across", "stay"); c1.on.speed = 0.5; c1.opacity = 0.8;
      let mut c2 = sprite("near", "Near cloud", pixel::cloud(2), 14.0, 1100.0, 720.0, 0.0, "appear", "drift-across", "stay"); c2.on.speed = 0.8;
      let mut t = ptext("title", "WEB WORLD WIDE", 18.0, "#FFFFFF", 212.0, 340.0, 0.3, "rain-in", "sway", "dither-out"); t.enter.dur = 0.9;
      let mut btn = Obj { id: "sub".into(), name: "Subscribe button".into(), kind: ObjKind::Text { text: "▶  Subscribe".into(), style: TextStyle { font: "archivo-black".into(), size: 44.0, color: "#FFFFFF".into(), plate: pixel::WWW_CHERRY.into(), pad_x: 30.0, pad_y: 16.0, shadow: pixel::WWW_INK.into(), shadow_dx: 6.0, shadow_dy: 6.0, ..Default::default() } }, x: 760.0, y: 600.0, start: 1.6, enter: FxIn { id: "drop-bounce".into(), dur: 0.7, ..Default::default() }, on: FxOn { id: "shadow-lift".into(), amp: 1.0, speed: 1.0 }, exit: FxOut { id: "shrink".into(), dur: 0.35, ..Default::default() }, ..Default::default() };
      btn.order = 4;
      let sp = sprite("spark", "Sparkle", pixel::sparkle(), 10.0, 1360.0, 300.0, 1.9, "pop", "pulse", "shrink");
      for (i, mut o) in [c1, c2, t, btn, sp].into_iter().enumerate() { o.order = i as u32; s.objects.push(o); }
    }
    "subscribe" => {
      s.dur = 5.0; s.bg = Background { kind: "clear".into(), ..Default::default() };
      let mut btn = vtext("btn", "▶  Subscribe", "archivo-black", 56.0, "#FFFFFF", 700.0, 480.0, 0.0, "pop", "shrink");
      if let ObjKind::Text { style, .. } = &mut btn.kind { style.plate = "#E8433A".into(); style.pad_x = 36.0; style.pad_y = 20.0; }
      btn.on = FxOn { id: "click".into(), amp: 1.0, speed: 1.0 };
      let mut cur = sprite("cur", "Cursor", pixel::cursor(), 7.0, 980.0, 560.0, 0.8, "slide", "click", "disappear"); cur.enter.dir = Dir::Up;
      let bell = ptext("bell", "NEW EVERY THURSDAY", 6.0, "#FFFFFF", 760.0, 600.0, 1.4, "typewriter", "none", "wipe");
      for (i, mut o) in [btn, cur, bell].into_iter().enumerate() { o.order = i as u32; s.objects.push(o); }
    }
    "chapter" => {
      s.dur = 5.0; s.fps = 30; s.bg = Background { kind: "solid".into(), color: "#0B0B0C".into(), ..Default::default() };
      let mut k = vtext("kicker", "CHAPTER ONE", "archivo", 28.0, "#FFFFFF", 200.0, 420.0, 0.0, "wipe", "wipe");
      if let ObjKind::Text { style, .. } = &mut k.kind { style.plate = "#FF8A1F".into(); style.pad_x = 16.0; style.pad_y = 8.0; style.tracking = 0.14; style.color = "#0B0B0C".into(); }
      let t = vtext("title", "The first 48 hours", "instrument-serif", 150.0, "#FFFFFF", 200.0, 480.0, 0.25, "letter-cascade", "rise-out");
      for (i, mut o) in [k, t].into_iter().enumerate() { o.order = i as u32; s.objects.push(o); }
    }
    "lower-third" => {
      s.dur = 5.0; s.fps = 30; s.bg = Background { kind: "clear".into(), ..Default::default() };
      let mut card = Obj { id: "card".into(), name: "Name tag".into(), kind: ObjKind::Card { template: "nametag".into(), fields: Default::default(), look: "clean".into(), colors: "blue".into() }, x: 160.0, y: 840.0, ..Default::default() };
      card.enter = FxIn { id: "wipe".into(), dur: 0.5, ..Default::default() };
      s.objects.push(card);
    }
    "end-screen" => {
      s.dur = 10.0;
      let thanks = ptext("thanks", "THANKS FOR WATCHING", 12.0, "#FFFFFF", 276.0, 110.0, 0.0, "blocky-wipe", "sway", "stay");
      let mut a = Obj { id: "boxa".into(), name: "Video box".into(), kind: ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Rect, fill: "#0E2960".into(), stroke: "#FFFFFF".into(), stroke_w: 6.0, pixel: 8.0, ..Default::default() }, w: 640.0, h: 360.0 }, x: 240.0, y: 330.0, start: 0.6, enter: FxIn { id: "pop".into(), dur: 0.5, ..Default::default() }, exit: FxOut { id: "stay".into(), ..Default::default() }, ..Default::default() };
      a.on = FxOn { id: "hover".into(), amp: 1.0, speed: 0.7 };
      let mut b = a.clone(); b.id = "boxb".into(); b.x = 1040.0; b.start = 0.9; b.on.speed = 0.9;
      let sub = sprite("sub", "Subscribe", pixel::play_screen(), 9.0, 880.0, 780.0, 1.5, "drop-bounce", "bob", "stay");
      let cl = sprite("cloud", "Cloud", pixel::cloud(1), 12.0, -200.0, 60.0, 0.0, "appear", "drift-across", "stay");
      for (i, mut o) in [cl, thanks, a, b, sub].into_iter().enumerate() { o.order = i as u32; s.objects.push(o); }
    }
    "ascii-drop" => {
      s.dur = 6.0; s.fps = 30; s.bg = Background { kind: "solid".into(), color: "#07070C".into(), ..Default::default() };
      let l = look("horizon").unwrap();
      let field = Obj { id: "field".into(), name: "Horizon field".into(), kind: ObjKind::Field { w: 1920.0, h: 1080.0, style: l.style.clone(), field: l.field.clone(), source: String::new() }, enter: FxIn { id: "dither-in".into(), dur: 0.8, ..Default::default() }, exit: FxOut { id: "dither-out".into(), dur: 0.6, ..Default::default() }, ..Default::default() };
      let mut t = vtext("title", "SIGNAL", "archivo-black", 220.0, "#FFFFFF", 0.0, 380.0, 0.6, "decode", "glyph-scatter");
      if let ObjKind::Text { style, .. } = &mut t.kind { style.align = Align::Center; style.tracking = 0.08; }
      t.x = 560.0; t.enter.dur = 1.2; t.order = 1;
      s.screen = l.screen.clone();
      s.objects.push(field); s.objects.push(t);
    }
    "shorts-hook" => {
      s.w = 1080; s.h = 1920; s.dur = 4.0; s.fps = 30;
      let a = ptext("l1", "STOP", 30.0, "#FFFFFF", 195.0, 560.0, 0.0, "stamp", "wiggle", "blocky-wipe");
      let b = ptext("l2", "SCROLLING", 16.0, "#F5C542", 112.0, 800.0, 0.4, "slide", "none", "blocky-wipe");
      let mut c = ptext("l3", "WATCH THIS", 14.0, "#FFFFFF", 128.0, 1000.0, 0.9, "typewriter", "blink", "blocky-wipe"); c.enter.dur = 0.8;
      let arrow = sprite("arrow", "Arrow", pixel::arrow_right(), 12.0, 480.0, 1200.0, 1.4, "pop", "bob", "shrink");
      for (i, mut o) in [a, b, c, arrow].into_iter().enumerate() { o.order = i as u32; o.enter.dir = Dir::Right; s.objects.push(o); }
    }
    _ => return None,
  }
  Some(s)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn starter_scenes_stay_inside_the_frame() {
    for (id, _, _) in SCENES {
      let sc = scene(id).unwrap();
      for (oid, b) in crate::render::bounds(&sc) {
        let o = sc.find(&oid).unwrap();
        if o.on.id == "drift-across" { continue; }
        assert!(b[0] >= -1.0 && b[2] <= sc.w as f32 + 1.0 && b[3] <= sc.h as f32 + 1.0, "{id}/{oid} out of frame: {b:?}");
      }
    }
  }
  #[test]
  fn looks_and_scenes_exist_and_render() {
    assert!(LOOKS.len() >= 10);
    for (id, _, _) in SCENES { let sc = scene(id).unwrap(); assert!(!sc.objects.is_empty(), "{id}"); let f = crate::render::render(&sc, sc.dur * 0.5, 192, 108); assert!(f.coverage() > 0.0, "{id} renders nothing"); }
  }
}
