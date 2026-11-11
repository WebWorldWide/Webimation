//! The document: a scene is a list of objects on a design canvas, each with an entrance, a
//! while-on-screen motion and an exit. Serialised as JSON and shared with the UI verbatim.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use crate::field::FieldParams;
use crate::frame::Blend;
use crate::glyph::GlyphStyle;
use crate::math::Ease;
use crate::pixel::{PixelFont, Sprite};
use crate::screen::Screen;
use crate::shapes::ShapeStyle;
use crate::text::TextStyle;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Dir { Left, #[default] Right, Up, Down }
impl Dir { pub fn vec(self) -> (f32, f32) { match self { Dir::Left => (-1.0, 0.0), Dir::Right => (1.0, 0.0), Dir::Up => (0.0, -1.0), Dir::Down => (0.0, 1.0) } } }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Size { Small, #[default] Medium, Big }
impl Size { pub fn k(self) -> f32 { match self { Size::Small => 0.5, Size::Medium => 1.0, Size::Big => 2.0 } } }

/// Entrance ("Comes in").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FxIn { pub id: String, pub dur: f32, pub dir: Dir, pub size: Size, pub ease: Ease, pub delay: f32 }
impl Default for FxIn { fn default() -> Self { FxIn { id: "wipe".into(), dur: 0.5, dir: Dir::Right, size: Size::Medium, ease: Ease::QuartOut, delay: 0.0 } } }

/// While on screen.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FxOn { pub id: String, pub amp: f32, pub speed: f32 }
impl Default for FxOn { fn default() -> Self { FxOn { id: "none".into(), amp: 1.0, speed: 1.0 } } }

/// Exit ("Goes out").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FxOut { pub id: String, pub dur: f32, pub dir: Dir, pub size: Size, pub ease: Ease }
impl Default for FxOut { fn default() -> Self { FxOut { id: "wipe".into(), dur: 0.35, dir: Dir::Right, size: Size::Medium, ease: Ease::CubicIn } } }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ObjKind {
  /// Text in the built-in pixel font, `px` design pixels per cell.
  PixelText { #[serde(default)] text: String, #[serde(default)] font: PixelFont, #[serde(default)] px: f32, #[serde(default)] color: String, #[serde(default)] shadow: String },
  /// Text in a bundled vector font.
  Text { #[serde(default)] text: String, #[serde(default)] style: TextStyle },
  Sprite { #[serde(default)] sprite: Sprite, #[serde(default)] px: f32, #[serde(default)] tint: String },
  /// Pasted ASCII art: every character is a cell.
  Ascii { #[serde(default)] text: String, #[serde(default)] cell: f32, #[serde(default)] font: String, #[serde(default)] color: String },
  /// Pixel-font text drawn in characters (`on` for lit cells).
  AsciiBanner { #[serde(default)] text: String, #[serde(default)] cell: f32, #[serde(default)] font: String, #[serde(default)] on: String, #[serde(default)] color: String },
  /// A glyph field (Glyph Lab output) covering `w × h` design pixels.
  Field { #[serde(default)] w: f32, #[serde(default)] h: f32, #[serde(default)] style: GlyphStyle, #[serde(default)] field: FieldParams, #[serde(default)] source: String },
  Shape { #[serde(default)] style: ShapeStyle, #[serde(default)] w: f32, #[serde(default)] h: f32 },
  /// A Quick-mode card expanded by `cards.rs` into primitives.
  Card { #[serde(default)] template: String, #[serde(default)] fields: BTreeMap<String, String>, #[serde(default)] look: String, #[serde(default)] colors: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Obj {
  pub id: String,
  pub name: String,
  pub kind: ObjKind,
  pub x: f32,
  pub y: f32,
  pub scale: f32,
  /// Degrees.
  pub rot: f32,
  pub opacity: f32,
  pub start: f32,
  /// Seconds on screen; 0 = until the scene ends.
  pub dur: f32,
  pub order: u32,
  pub enter: FxIn,
  pub on: FxOn,
  pub exit: FxOut,
  pub blend: Blend,
  pub hidden: bool,
  /// Render pixel/ascii objects as characters instead of pixels.
  pub as_ascii: bool,
  pub ascii_font: String,
  pub ascii_chars: String,
  /// How the start is decided in the Lab's order panel: "start" (at the beginning), "with"
  /// (with previous) or "after" (after previous). The UI resolves these into `start`.
  pub cue: String,
  /// Extra wait after the cue, seconds.
  pub gap: f32,
  /// Opacity automation: [scene time, value 0..1] pairs, linear between points. Empty = none.
  pub opacity_keys: Vec<[f32; 2]>,
  pub locked: bool,
}
impl Obj {
  /// Automated opacity at scene time `t` (1 when there are no keys).
  pub fn automation(&self, t: f32) -> f32 {
    let k = &self.opacity_keys;
    if k.is_empty() { return 1.0; }
    if t <= k[0][0] { return k[0][1].clamp(0.0, 1.0); }
    for w in k.windows(2) { if t <= w[1][0] { let span = (w[1][0] - w[0][0]).max(1e-6); return (w[0][1] + (w[1][1] - w[0][1]) * (t - w[0][0]) / span).clamp(0.0, 1.0); } }
    k[k.len() - 1][1].clamp(0.0, 1.0)
  }
}
impl Default for Obj {
  fn default() -> Self {
    Obj { id: "o".into(), name: "Object".into(), kind: ObjKind::PixelText { text: "HELLO".into(), font: PixelFont::Five, px: 12.0, color: "#FFFFFF".into(), shadow: "#0E2960".into() }, x: 0.0, y: 0.0, scale: 1.0, rot: 0.0, opacity: 1.0, start: 0.0, dur: 0.0, order: 0, enter: FxIn::default(), on: FxOn::default(), exit: FxOut::default(), blend: Blend::Normal, hidden: false, as_ascii: false, ascii_font: "jetbrains-mono".into(), ascii_chars: " .:-=+*#%@".into(), cue: "manual".into(), gap: 0.0, opacity_keys: Vec::new(), locked: false }
  }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Background {
  /// clear | solid | sky | paper | checker
  pub kind: String,
  pub color: String,
  pub color2: String,
}
impl Default for Background { fn default() -> Self { Background { kind: "clear".into(), color: "#1E68F0".into(), color2: "#1450C8".into() } } }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Scene {
  pub name: String,
  pub w: u32,
  pub h: u32,
  /// Motion feel: 30 smooth, 12 or 6 for a pixel look. Time is quantised to this.
  pub fps: u32,
  pub dur: f32,
  pub seed: u32,
  /// Pixel grid columns (64 chunky, 128 classic, 256 fine). Objects snap to `w / grid`.
  pub grid: u32,
  pub bg: Background,
  pub objects: Vec<Obj>,
  pub screen: Screen,
  /// Optional camera: the design-space rectangle [x, y, w, h] shown in the output (thumbnails
  /// frame their content with it). None = the whole canvas.
  pub view: Option<[f32; 4]>,
}
impl Default for Scene {
  fn default() -> Self { Scene { name: "Untitled".into(), w: 1920, h: 1080, fps: 30, dur: 5.0, seed: 1, grid: 128, bg: Background::default(), objects: Vec::new(), screen: Screen::default(), view: None } }
}

impl Scene {
  pub fn cell(&self) -> f32 { self.w as f32 / self.grid.max(8) as f32 }
  pub fn aspect(&self) -> f32 { self.w as f32 / self.h.max(1) as f32 }
  pub fn frames(&self, fps: u32) -> u32 { (self.dur * fps as f32).round().max(1.0) as u32 }
  pub fn from_json(s: &str) -> Result<Scene, String> { serde_json::from_str(s).map_err(|e| e.to_string()) }
  pub fn to_json(&self) -> String { serde_json::to_string(self).unwrap() }
  /// End time of an object.
  pub fn end_of(&self, o: &Obj) -> f32 { if o.dur <= 0.0 { self.dur } else { (o.start + o.dur).min(self.dur) } }
  /// Snap a design coordinate to the pixel grid.
  pub fn snap(&self, v: f32) -> f32 { let c = self.cell(); (v / c).round() * c }
  pub fn find(&self, id: &str) -> Option<&Obj> { self.objects.iter().find(|o| o.id == id) }
  pub fn find_mut(&mut self, id: &str) -> Option<&mut Obj> { self.objects.iter_mut().find(|o| o.id == id) }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn automation_interpolates() {
    let o = Obj { opacity_keys: vec![[1.0, 0.0], [2.0, 1.0]], ..Default::default() };
    assert_eq!(o.automation(0.0), 0.0); assert!((o.automation(1.5) - 0.5).abs() < 1e-6); assert_eq!(o.automation(9.0), 1.0);
    assert_eq!(Obj::default().automation(3.0), 1.0);
  }
  #[test]
  fn scene_round_trips_through_json() {
    let mut s = Scene::default();
    s.objects.push(Obj { id: "a".into(), kind: ObjKind::Shape { style: ShapeStyle::default(), w: 100.0, h: 50.0 }, ..Default::default() });
    let j = s.to_json();
    let back = Scene::from_json(&j).unwrap();
    assert_eq!(s, back);
    assert!(j.contains("\"type\":\"shape\""));
    // Unknown and missing fields are tolerated.
    let s2 = Scene::from_json(r#"{"w":1080,"h":1920,"objects":[{"id":"x","kind":{"type":"text","text":"Hi"}}]}"#).unwrap();
    assert_eq!(s2.objects.len(), 1); assert_eq!(s2.fps, 30);
  }
}
