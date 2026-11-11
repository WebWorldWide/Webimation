//! Pixel art: a built-in 5×7 pixel font, sprites (flipbooks on a small grid), and the Web World
//! Wide starter sprites (pixel clouds, heart, play screen, sparkle, coin, button).

use serde::{Deserialize, Serialize};
use crate::frame::{Frame, Rgba};

/// Built-in bitmap fonts. `Five` is 5×7 (the Lab's pixel text); `Three` is 3×5 for tiny labels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PixelFont { #[default] Five, Three }

impl PixelFont {
  pub fn size(self) -> (usize, usize) { match self { PixelFont::Five => (5, 7), PixelFont::Three => (3, 5) } }
  /// Rows of bits, MSB = leftmost column (5 bits for Five, 3 bits for Three). Lowercase maps to uppercase.
  pub fn glyph(self, ch: char) -> Option<Vec<u8>> {
    let ch = ch.to_ascii_uppercase();
    match self { PixelFont::Five => five(ch).map(|r| r.to_vec()), PixelFont::Three => three(ch).map(|r| r.to_vec()) }
  }
  /// Width in cells of a string (1-cell gap between letters).
  pub fn measure(self, s: &str) -> (usize, usize) {
    let (gw, gh) = self.size();
    let lines: Vec<&str> = s.lines().collect();
    let w = lines.iter().map(|l| l.chars().count() * (gw + 1)).max().unwrap_or(0).saturating_sub(1);
    (w, lines.len().max(1) * (gh + 1) - 1)
  }
  /// Draw text into a cell-resolution frame (1 px per cell). Unknown characters leave a gap.
  pub fn render(self, s: &str, colour: Rgba, shadow: Option<Rgba>) -> Frame {
    let (gw, gh) = self.size();
    let (w, h) = self.measure(s);
    let pad = if shadow.is_some() { 1 } else { 0 };
    let mut f = Frame::new((w + pad).max(1), (h + pad).max(1));
    for (li, line) in s.lines().enumerate() {
      for (ci, ch) in line.chars().enumerate() {
        if let Some(rows) = self.glyph(ch) {
          for (r, bits) in rows.iter().enumerate() { for c in 0..gw { if bits & (1 << (gw - 1 - c)) != 0 {
            let (x, y) = ((ci * (gw + 1) + c) as i32, (li * (gh + 1) + r) as i32);
            if let Some(sc) = shadow { f.plot(x + 1, y + 1, sc); }
          } } }
        }
      }
    }
    for (li, line) in s.lines().enumerate() {
      for (ci, ch) in line.chars().enumerate() {
        if let Some(rows) = self.glyph(ch) {
          for (r, bits) in rows.iter().enumerate() { for c in 0..gw { if bits & (1 << (gw - 1 - c)) != 0 {
            f.set(ci * (gw + 1) + c, li * (gh + 1) + r, colour);
          } } }
        }
      }
    }
    f
  }
}

#[rustfmt::skip]
fn five(c: char) -> Option<[u8; 7]> {
  Some(match c {
    ' ' => [0,0,0,0,0,0,0],
    'A' => [0x0E,0x11,0x11,0x1F,0x11,0x11,0x11], 'B' => [0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E], 'C' => [0x0E,0x11,0x10,0x10,0x10,0x11,0x0E],
    'D' => [0x1E,0x11,0x11,0x11,0x11,0x11,0x1E], 'E' => [0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F], 'F' => [0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
    'G' => [0x0E,0x11,0x10,0x17,0x11,0x11,0x0F], 'H' => [0x11,0x11,0x11,0x1F,0x11,0x11,0x11], 'I' => [0x0E,0x04,0x04,0x04,0x04,0x04,0x0E],
    'J' => [0x07,0x02,0x02,0x02,0x02,0x12,0x0C], 'K' => [0x11,0x12,0x14,0x18,0x14,0x12,0x11], 'L' => [0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
    'M' => [0x11,0x1B,0x15,0x15,0x11,0x11,0x11], 'N' => [0x11,0x19,0x15,0x13,0x11,0x11,0x11], 'O' => [0x0E,0x11,0x11,0x11,0x11,0x11,0x0E],
    'P' => [0x1E,0x11,0x11,0x1E,0x10,0x10,0x10], 'Q' => [0x0E,0x11,0x11,0x11,0x15,0x12,0x0D], 'R' => [0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
    'S' => [0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E], 'T' => [0x1F,0x04,0x04,0x04,0x04,0x04,0x04], 'U' => [0x11,0x11,0x11,0x11,0x11,0x11,0x0E],
    'V' => [0x11,0x11,0x11,0x11,0x11,0x0A,0x04], 'W' => [0x11,0x11,0x11,0x15,0x15,0x1B,0x11], 'X' => [0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
    'Y' => [0x11,0x11,0x0A,0x04,0x04,0x04,0x04], 'Z' => [0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
    '0' => [0x0E,0x11,0x13,0x15,0x19,0x11,0x0E], '1' => [0x04,0x0C,0x04,0x04,0x04,0x04,0x0E], '2' => [0x0E,0x11,0x01,0x02,0x04,0x08,0x1F],
    '3' => [0x1F,0x02,0x04,0x02,0x01,0x11,0x0E], '4' => [0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], '5' => [0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
    '6' => [0x06,0x08,0x10,0x1E,0x11,0x11,0x0E], '7' => [0x1F,0x01,0x02,0x04,0x08,0x08,0x08], '8' => [0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E],
    '9' => [0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
    '.' => [0,0,0,0,0,0x0C,0x0C], ',' => [0,0,0,0,0x0C,0x04,0x08], '!' => [0x04,0x04,0x04,0x04,0x04,0,0x04], '?' => [0x0E,0x11,0x01,0x02,0x04,0,0x04],
    ':' => [0,0x0C,0x0C,0,0x0C,0x0C,0], ';' => [0,0x0C,0x0C,0,0x0C,0x04,0x08], '\'' => [0x04,0x04,0x08,0,0,0,0], '"' => [0x0A,0x0A,0x0A,0,0,0,0],
    '-' => [0,0,0,0x1F,0,0,0], '+' => [0,0x04,0x04,0x1F,0x04,0x04,0], '=' => [0,0,0x1F,0,0x1F,0,0], '/' => [0x01,0x01,0x02,0x04,0x08,0x10,0x10],
    '\\' => [0x10,0x10,0x08,0x04,0x02,0x01,0x01], '(' => [0x02,0x04,0x08,0x08,0x08,0x04,0x02], ')' => [0x08,0x04,0x02,0x02,0x02,0x04,0x08],
    '<' => [0x02,0x04,0x08,0x10,0x08,0x04,0x02], '>' => [0x08,0x04,0x02,0x01,0x02,0x04,0x08], '@' => [0x0E,0x11,0x17,0x15,0x17,0x10,0x0E],
    '#' => [0x0A,0x0A,0x1F,0x0A,0x1F,0x0A,0x0A], '%' => [0x18,0x19,0x02,0x04,0x08,0x13,0x03], '&' => [0x0C,0x12,0x14,0x08,0x15,0x12,0x0D],
    '*' => [0,0x04,0x15,0x0E,0x15,0x04,0], '_' => [0,0,0,0,0,0,0x1F], '^' => [0x04,0x0A,0x11,0,0,0,0], '$' => [0x04,0x0F,0x14,0x0E,0x05,0x1E,0x04],
    '[' => [0x0E,0x08,0x08,0x08,0x08,0x08,0x0E], ']' => [0x0E,0x02,0x02,0x02,0x02,0x02,0x0E], '|' => [0x04,0x04,0x04,0x04,0x04,0x04,0x04],
    '~' => [0,0,0x08,0x15,0x02,0,0], '`' => [0x08,0x04,0,0,0,0,0], '{' => [0x02,0x04,0x04,0x08,0x04,0x04,0x02], '}' => [0x08,0x04,0x04,0x02,0x04,0x04,0x08],
    '→' => [0,0x04,0x02,0x1F,0x02,0x04,0], '←' => [0,0x04,0x08,0x1F,0x08,0x04,0], '♥' => [0,0x0A,0x1F,0x1F,0x0E,0x04,0], '★' => [0x04,0x04,0x1F,0x0E,0x0E,0x1B,0],
    '▶' => [0x10,0x18,0x1C,0x1E,0x1C,0x18,0x10], '●' => [0,0x0E,0x1F,0x1F,0x1F,0x0E,0], '■' => [0x1F,0x1F,0x1F,0x1F,0x1F,0x1F,0x1F],
    _ => return None,
  })
}
#[rustfmt::skip]
fn three(c: char) -> Option<[u8; 5]> {
  Some(match c {
    ' ' => [0,0,0,0,0],
    'A' => [0b010,0b101,0b111,0b101,0b101], 'B' => [0b110,0b101,0b110,0b101,0b110], 'C' => [0b011,0b100,0b100,0b100,0b011], 'D' => [0b110,0b101,0b101,0b101,0b110],
    'E' => [0b111,0b100,0b110,0b100,0b111], 'F' => [0b111,0b100,0b110,0b100,0b100], 'G' => [0b011,0b100,0b101,0b101,0b011], 'H' => [0b101,0b101,0b111,0b101,0b101],
    'I' => [0b111,0b010,0b010,0b010,0b111], 'J' => [0b001,0b001,0b001,0b101,0b010], 'K' => [0b101,0b101,0b110,0b101,0b101], 'L' => [0b100,0b100,0b100,0b100,0b111],
    'M' => [0b101,0b111,0b111,0b101,0b101], 'N' => [0b110,0b101,0b101,0b101,0b101], 'O' => [0b010,0b101,0b101,0b101,0b010], 'P' => [0b110,0b101,0b110,0b100,0b100],
    'Q' => [0b010,0b101,0b101,0b110,0b011], 'R' => [0b110,0b101,0b110,0b101,0b101], 'S' => [0b011,0b100,0b010,0b001,0b110], 'T' => [0b111,0b010,0b010,0b010,0b010],
    'U' => [0b101,0b101,0b101,0b101,0b011], 'V' => [0b101,0b101,0b101,0b101,0b010], 'W' => [0b101,0b101,0b111,0b111,0b101], 'X' => [0b101,0b101,0b010,0b101,0b101],
    'Y' => [0b101,0b101,0b010,0b010,0b010], 'Z' => [0b111,0b001,0b010,0b100,0b111],
    '0' => [0b010,0b101,0b101,0b101,0b010], '1' => [0b010,0b110,0b010,0b010,0b111], '2' => [0b110,0b001,0b010,0b100,0b111], '3' => [0b110,0b001,0b010,0b001,0b110],
    '4' => [0b101,0b101,0b111,0b001,0b001], '5' => [0b111,0b100,0b110,0b001,0b110], '6' => [0b011,0b100,0b110,0b101,0b010], '7' => [0b111,0b001,0b010,0b010,0b010],
    '8' => [0b010,0b101,0b010,0b101,0b010], '9' => [0b010,0b101,0b011,0b001,0b110],
    '.' => [0,0,0,0,0b010], ':' => [0,0b010,0,0b010,0], '-' => [0,0,0b111,0,0], '!' => [0b010,0b010,0b010,0,0b010], '/' => [0b001,0b001,0b010,0b100,0b100],
    _ => return None,
  })
}

/// A sprite: one or more frames on a `w × h` grid of palette indices (0 = transparent).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Sprite {
  pub w: usize,
  pub h: usize,
  /// Each frame is `h` rows of `w` characters; '0' or '.' is clear, '1'..'9', 'A'..'Z' index the palette (1-based).
  pub frames: Vec<String>,
  pub palette: Vec<String>,
  /// Flipbook speed.
  pub fps: f32,
}
impl Default for Sprite { fn default() -> Self { Sprite { w: 1, h: 1, frames: vec!["1".into()], palette: vec!["#FFFFFF".into()], fps: 4.0 } } }

impl Sprite {
  pub fn from_rows(rows: &[&str], palette: &[&str], fps: f32) -> Sprite {
    Sprite { w: rows.iter().map(|r| r.chars().count()).max().unwrap_or(1), h: rows.len(), frames: vec![rows.join("\n")], palette: palette.iter().map(|s| s.to_string()).collect(), fps }
  }
  pub fn add_frame(&mut self, rows: &[&str]) { self.frames.push(rows.join("\n")); }
  pub fn frame_count(&self) -> usize { self.frames.len().max(1) }
  pub fn frame_at(&self, t: f32) -> usize { if self.frames.len() <= 1 || self.fps <= 0.0 { 0 } else { ((t * self.fps).floor().max(0.0) as usize) % self.frames.len() } }
  fn index(ch: char) -> usize { match ch { '0' | '.' | ' ' => 0, '1'..='9' => ch as usize - '0' as usize, 'A'..='Z' => ch as usize - 'A' as usize + 10, 'a'..='z' => ch as usize - 'a' as usize + 10, _ => 0 } }
  /// Rasterise one frame at 1 px per cell. `tint` replaces every colour (for "ink" mode).
  pub fn render(&self, frame: usize, tint: Option<Rgba>) -> Frame {
    let mut f = Frame::new(self.w.max(1), self.h.max(1));
    let data = &self.frames[frame.min(self.frames.len().saturating_sub(1))];
    let pal: Vec<Rgba> = self.palette.iter().map(|c| Rgba::hex(c)).collect();
    for (y, row) in data.lines().enumerate().take(self.h) {
      for (x, ch) in row.chars().enumerate().take(self.w) {
        let i = Self::index(ch);
        if i == 0 { continue; }
        let c = tint.unwrap_or_else(|| pal.get(i - 1).copied().unwrap_or(Rgba::WHITE));
        f.set(x, y, c);
      }
    }
    f
  }
  /// Set one cell in one frame (the Pixel Paint editor's primitive).
  pub fn put(&mut self, frame: usize, x: usize, y: usize, idx: usize) {
    if x >= self.w || y >= self.h || frame >= self.frames.len() { return; }
    let mut rows: Vec<Vec<char>> = self.frames[frame].lines().map(|l| { let mut v: Vec<char> = l.chars().collect(); v.resize(self.w, '0'); v }).collect();
    rows.resize(self.h, vec!['0'; self.w]);
    rows[y][x] = if idx == 0 { '0' } else if idx < 10 { (b'0' + idx as u8) as char } else { (b'A' + (idx - 10) as u8) as char };
    self.frames[frame] = rows.iter().map(|r| r.iter().collect::<String>()).collect::<Vec<_>>().join("\n");
  }
  /// ASCII rendering of a frame (for "Copy as text" and the ASCII preview).
  pub fn to_ascii(&self, frame: usize, ramp: &str) -> String {
    let f = self.render(frame, None);
    let chars: Vec<char> = ramp.chars().collect();
    let mut s = String::new();
    for y in 0..f.h { for x in 0..f.w { let p = f.get(x, y); let v = if p.3 == 0 { 0.0 } else { 0.25 + 0.75 * p.lum() }; let i = ((v * (chars.len() - 1) as f32).round() as usize).min(chars.len() - 1); s.push(chars[i]); } s.push('\n'); }
    s
  }
}

// ── Web World Wide starter sprites ────────────────────────────────────────────────────────────
pub const WWW_SKY: &str = "#1E68F0";
pub const WWW_SKY_DEEP: &str = "#1450C8";
pub const WWW_SKY_FAR: &str = "#A8C8F0";
pub const WWW_INK: &str = "#0E2960";
pub const WWW_CHERRY: &str = "#EC5A2B";
pub const WWW_SUN: &str = "#28B083";
pub const WWW_GOLD: &str = "#F5C542";

/// The four cloud bitmaps from the website's SkyBackdrop (1 = white, 2 = outline tint).
pub fn cloud(i: usize) -> Sprite {
  let shapes: [&[&str]; 4] = [
    &["0002220002220000022000", "0022112202211220222110", "0211111211111111111112", "2111111111111111111112", "2111111111111111111112", "0222222222222222222220"],
    &["00022200002200", "00211122022112", "02111111111112", "02111111111112", "02222222222220"],
    &["00022000022000022000022000", "02211220221122022112202112", "21111111111111111111111111", "02222222222222222222222220"],
    &["0002220000", "0022112200", "0211111120", "2111111112", "2111111112", "0211111120", "0022222200"],
  ];
  Sprite::from_rows(shapes[i % 4], &["#FFFFFF", WWW_SKY_FAR], 0.0)
}

/// Two-frame beating heart.
pub fn heart() -> Sprite {
  let mut s = Sprite::from_rows(&["01100110", "11111111", "11111111", "11111111", "01111110", "00111100", "00011000"], &[WWW_CHERRY, "#FF8A7A"], 2.0);
  s.add_frame(&["00000000", "01100110", "11111111", "11111111", "01111110", "00111100", "00011000"]);
  s
}
/// A CRT "play screen": blinking play button (two frames).
pub fn play_screen() -> Sprite {
  let on = ["1111111111111", "1222222222221", "1223222222221", "1223322222221", "1223332222221", "1223322222221", "1223222222221", "1222222222221", "1111111111111", "0000111110000", "0011111111100"];
  let off = ["1111111111111", "1222222222221", "1222222222221", "1222222222221", "1222222222221", "1222222222221", "1222222222221", "1222222222221", "1111111111111", "0000111110000", "0011111111100"];
  let mut s = Sprite::from_rows(&on, &[WWW_INK, WWW_SKY, "#FFFFFF"], 2.0); s.add_frame(&off); s
}
pub fn sparkle() -> Sprite {
  let mut s = Sprite::from_rows(&["0000100", "0001110", "0011111", "1111111", "0011111", "0001110", "0000100"], &[WWW_GOLD], 6.0);
  s.add_frame(&["0001000", "0001000", "0001000", "1111111", "0001000", "0001000", "0001000"]);
  s.add_frame(&["0000000", "0001000", "0011100", "0111110", "0011100", "0001000", "0000000"]);
  s
}
pub fn coin() -> Sprite {
  Sprite::from_rows(&["00111100", "01222210", "12233221", "12322221", "12322221", "12233221", "01222210", "00111100"], &["#B8860B", WWW_GOLD, "#FFF2B0"], 0.0)
}
/// A "Subscribe" button plate with a play triangle (text is drawn separately).
pub fn button(w: usize, h: usize) -> Sprite {
  let mut rows = Vec::new();
  for y in 0..h { let mut r = String::new(); for x in 0..w { r.push(if y == 0 || y == h - 1 || x == 0 || x == w - 1 { '2' } else { '1' }); } rows.push(r); }
  let rs: Vec<&str> = rows.iter().map(|s| s.as_str()).collect();
  Sprite::from_rows(&rs, &[WWW_CHERRY, "#B04708"], 0.0)
}
pub fn star() -> Sprite {
  Sprite::from_rows(&["000010000", "000111000", "111111111", "011111110", "001111100", "011111110", "011000110"], &[WWW_GOLD], 0.0)
}
pub fn arrow_right() -> Sprite {
  Sprite::from_rows(&["000001000", "000001100", "111111110", "111111111", "111111110", "000001100", "000001000"], &["#FFFFFF"], 0.0)
}
pub fn cursor() -> Sprite {
  Sprite::from_rows(&["1000000", "1100000", "1210000", "1221000", "1222100", "1221110", "1012100", "0001210", "0000100"], &[WWW_INK, "#FFFFFF"], 0.0)
}
/// Starter sprites by id.
pub fn starter(id: &str) -> Option<Sprite> {
  Some(match id { "cloud" => cloud(0), "cloud2" => cloud(1), "cloud3" => cloud(2), "cloud4" => cloud(3), "heart" => heart(), "play" => play_screen(), "sparkle" => sparkle(), "coin" => coin(), "star" => star(), "arrow" => arrow_right(), "cursor" => cursor(), "button" => button(16, 7), _ => return None })
}
pub const STARTERS: &[(&str, &str, &str)] = &[("cloud", "Pixel cloud", "From Web World Wide"), ("cloud2", "Small cloud", "From Web World Wide"), ("cloud3", "Long cloud", "From Web World Wide"), ("cloud4", "Puffy cloud", "From Web World Wide"), ("heart", "Beating heart", "2 frames"), ("play", "Play screen", "2 frames · blinks"), ("sparkle", "Sparkle", "3 frames · good with Pulse"), ("coin", "Coin", "Try 3D spin"), ("star", "Star", "Try Pulse"), ("arrow", "Arrow", "Points right"), ("cursor", "Cursor", "Try Click"), ("button", "Button", "Plate for a label")];

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn pixel_font_renders_every_printable() {
    for c in 32u8..127 { assert!(PixelFont::Five.glyph(c as char).is_some(), "missing {:?}", c as char); }
    let f = PixelFont::Five.render("WEB", Rgba::WHITE, Some(Rgba::INK));
    assert_eq!((f.w, f.h), (18, 8));
    assert_eq!(f.get(0, 0), Rgba::WHITE); assert_eq!(f.get(5, 7), Rgba::INK); assert_eq!(f.get(17, 7).3, 0);
  }
  #[test]
  fn sprites_round_trip() {
    let mut s = heart();
    assert_eq!(s.frame_at(0.0), 0); assert_eq!(s.frame_at(0.6), 1);
    let f = s.render(0, None); assert_eq!(f.get(1, 0), Rgba::hex(WWW_CHERRY)); assert_eq!(f.get(0, 0).3, 0);
    s.put(0, 0, 0, 2); assert_eq!(s.render(0, None).get(0, 0), Rgba::hex("#FF8A7A"));
    let a = s.to_ascii(0, " .#"); assert!(a.starts_with("#") || a.starts_with(".") );
    for (id, _, _) in STARTERS { assert!(starter(id).is_some(), "{id}"); }
  }
}
