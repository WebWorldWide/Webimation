//! Quick-mode cards: finished graphics (name tag, big number, subscribe …) expressed as a few
//! primitives, so every effect, colour set and font look applies to them like anything else.

use std::collections::BTreeMap;
use crate::fonts::look_font;
use crate::frame::Rgba;
use crate::scene::{Dir, FxIn, FxOn, FxOut, Obj, ObjKind, Size};
use crate::shapes::{ShapeKind, ShapeStyle};
use crate::text::{Align, TextStyle};
use crate::math::Ease;

#[derive(Clone, Debug, serde::Serialize)]
pub struct CardDef { pub id: &'static str, pub name: &'static str, pub blurb: &'static str, pub category: &'static str, pub fields: &'static [(&'static str, &'static str, &'static str)], pub dur: f32 }

pub const CARDS: &[CardDef] = &[
  CardDef { id: "nametag", name: "Name tag", blurb: "Who's talking, and what they do", category: "Name tags", fields: &[("name", "Name", "Ada Lovelace"), ("under", "Underneath", "Founder · Analytical Engines")], dur: 5.0 },
  CardDef { id: "lowerthird", name: "Lower third", blurb: "Name and role on a bar", category: "Name tags", fields: &[("name", "Name", "Ada Lovelace"), ("under", "Role", "Host · Web World Wide")], dur: 5.0 },
  CardDef { id: "arrow", name: "Arrow", blurb: "Point at anything on screen", category: "Arrows & callouts", fields: &[("label", "Label (optional)", "")], dur: 3.0 },
  CardDef { id: "circleit", name: "Circle it", blurb: "A hand-drawn ring that draws itself", category: "Arrows & callouts", fields: &[("label", "Words inside", "Watch this part")], dur: 3.5 },
  CardDef { id: "callout", name: "Callout", blurb: "A speech bubble with a note", category: "Arrows & callouts", fields: &[("text", "Note", "This is the trick")], dur: 4.0 },
  CardDef { id: "bignumber", name: "Big number", blurb: "One stat, impossible to miss", category: "Numbers", fields: &[("num", "Number", "2.4M"), ("caption", "Caption", "views in the first 48 hours")], dur: 5.0 },
  CardDef { id: "percent", name: "Percent", blurb: "A share, with a bar that fills", category: "Numbers", fields: &[("num", "Percent", "72%"), ("caption", "Caption", "watched to the end")], dur: 5.0 },
  CardDef { id: "checklist", name: "Checklist", blurb: "Ticks off one line at a time", category: "Lists", fields: &[("a", "Item 1", "Write the script"), ("b", "Item 2", "Record it"), ("c", "Item 3", "Edit and post")], dur: 6.0 },
  CardDef { id: "steps", name: "Steps", blurb: "Numbered steps, one after another", category: "Lists", fields: &[("a", "Step 1", "Hook"), ("b", "Step 2", "Retain"), ("c", "Step 3", "Recommend")], dur: 6.0 },
  CardDef { id: "subscribe", name: "Subscribe", blurb: "A button that gets clicked", category: "Subscribe & social", fields: &[("cta", "Button", "Subscribe"), ("handle", "Handle", "@web_world_wide")], dur: 4.5 },
  CardDef { id: "like", name: "Like & comment", blurb: "Three little asks", category: "Subscribe & social", fields: &[("a", "First", "Like"), ("b", "Second", "Comment"), ("c", "Third", "Subscribe")], dur: 5.0 },
  CardDef { id: "chapter", name: "Chapter title", blurb: "Start a new section", category: "Titles", fields: &[("kicker", "Small line", "Chapter one"), ("title", "Title", "The first 48 hours")], dur: 4.5 },
  CardDef { id: "title", name: "Title card", blurb: "A big opening title", category: "Titles", fields: &[("kicker", "Small line", "Web World Wide · Ep. 001"), ("title", "Title", "Where the hours go")], dur: 5.0 },
  CardDef { id: "countdown", name: "Countdown", blurb: "3, 2, 1 with hard cuts", category: "Numbers", fields: &[("from", "Count from", "3"), ("label", "Label", "Starting in")], dur: 4.0 },
  CardDef { id: "quote", name: "Quote", blurb: "Words worth pausing on", category: "Titles", fields: &[("quote", "Quote", "Start before you feel ready."), ("who", "Who said it", "Your name here")], dur: 6.0 },
  CardDef { id: "location", name: "Location", blurb: "Drop a pin, name the place", category: "Arrows & callouts", fields: &[("place", "Place", "Lisbon"), ("sub", "Underneath", "Portugal")], dur: 4.0 },
  CardDef { id: "breaking", name: "Breaking bar", blurb: "A news-style bar across the bottom", category: "Titles", fields: &[("tag", "Tag", "Breaking"), ("head", "Headline", "Shorts now count toward watch hours")], dur: 6.0 },
  CardDef { id: "versus", name: "Versus", blurb: "Two things side by side", category: "Numbers", fields: &[("la", "Left", "Shorts"), ("lv", "Left value", "61%"), ("ra", "Right", "Long-form"), ("rv", "Right value", "39%")], dur: 6.0 },
  CardDef { id: "pixeltitle", name: "Pixel title", blurb: "Chunky pixel letters with a hard shadow", category: "Titles", fields: &[("title", "Title", "WEB WORLD WIDE"), ("sub", "Underneath", "NEW EVERY THURSDAY")], dur: 5.0 },
  CardDef { id: "asciititle", name: "ASCII title", blurb: "Your words made of characters", category: "Titles", fields: &[("title", "Title", "SIGNAL")], dur: 5.0 },
];
pub fn card(id: &str) -> Option<&'static CardDef> { CARDS.iter().find(|c| c.id == id) }

/// A colour set: plate, text on plate, accent and ink. The six sets from the Make-it-yours screen.
pub struct ColorSet { pub id: &'static str, pub plate: &'static str, pub on_plate: &'static str, pub accent: &'static str, pub ink: &'static str, pub paper: &'static str }
pub const COLOR_SETS: &[ColorSet] = &[
  ColorSet { id: "blue", plate: "#1E68F0", on_plate: "#FFFFFF", accent: "#0B0B0C", ink: "#0B0B0C", paper: "#FFFFFF" },
  ColorSet { id: "ink", plate: "#0B0B0C", on_plate: "#FFFFFF", accent: "#F5C542", ink: "#0B0B0C", paper: "#FFFFFF" },
  ColorSet { id: "paper", plate: "#FFFFFF", on_plate: "#0B0B0C", accent: "#1E68F0", ink: "#0B0B0C", paper: "#FFFFFF" },
  ColorSet { id: "red", plate: "#E8433A", on_plate: "#FFFFFF", accent: "#0B0B0C", ink: "#0B0B0C", paper: "#FFFFFF" },
  ColorSet { id: "green", plate: "#17924D", on_plate: "#FFFFFF", accent: "#0B0B0C", ink: "#0B0B0C", paper: "#FFFFFF" },
  ColorSet { id: "purple", plate: "#8B5CF6", on_plate: "#FFFFFF", accent: "#F5C542", ink: "#0B0B0C", paper: "#FFFFFF" },
  ColorSet { id: "www", plate: "#1E68F0", on_plate: "#FFFFFF", accent: "#EC5A2B", ink: "#0E2960", paper: "#FFFFFF" },
];
pub fn color_set(id: &str) -> &'static ColorSet { COLOR_SETS.iter().find(|c| c.id == id).unwrap_or(&COLOR_SETS[0]) }

fn text(font: &str, size: f32, color: &str) -> TextStyle { TextStyle { font: font.into(), size, color: color.into(), ..Default::default() } }
fn plate(mut t: TextStyle, bg: &str, px: f32, py: f32) -> TextStyle { t.plate = bg.into(); t.pad_x = px; t.pad_y = py; t }
fn obj(id: &str, name: &str, kind: ObjKind, x: f32, y: f32, start: f32, enter: &str, exit: &str) -> Obj {
  Obj { id: id.into(), name: name.into(), kind, x, y, start, enter: FxIn { id: enter.into(), ..Default::default() }, exit: FxOut { id: exit.into(), ..Default::default() }, ..Default::default() }
}
fn get<'a>(f: &'a BTreeMap<String, String>, def: &'static CardDef, key: &str) -> String {
  f.get(key).cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| def.fields.iter().find(|x| x.0 == key).map(|x| x.2.to_string()).unwrap_or_default())
}

/// Expand a card into primitives. Positions are relative to the card's own origin (0, 0); the
/// renderer offsets them by the card object's x/y. `enter`/`exit` override each primitive's effect.
pub fn expand(template: &str, fields: &BTreeMap<String, String>, look: &str, colors: &str, host: &Obj) -> Vec<Obj> {
  let Some(def) = card(template) else { return Vec::new() };
  let cs = color_set(colors);
  let font = look_font(look);
  let loud = look_font("loud");
  let g = |k: &str| get(fields, def, k);
  let mut out: Vec<Obj> = Vec::new();
  let en = host.enter.id.as_str(); let ex = host.exit.id.as_str();
  match template {
    "nametag" => {
      out.push(obj("name", "Name", ObjKind::Text { text: g("name"), style: plate(text(font, 64.0, cs.on_plate), cs.plate, 28.0, 14.0) }, 0.0, 0.0, 0.0, en, ex));
      out.push(obj("under", "Underneath", ObjKind::Text { text: g("under"), style: plate(TextStyle { uppercase: true, tracking: 0.12, ..text(font, 24.0, "#FFFFFF") }, cs.accent, 20.0, 10.0) }, 0.0, 96.0, 0.25, en, ex));
    }
    "lowerthird" => {
      out.push(obj("bar", "Bar", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Rect, fill: cs.plate.into(), ..Default::default() }, w: 14.0, h: 118.0 }, 0.0, 0.0, 0.0, "wipe", ex));
      out.push(obj("name", "Name", ObjKind::Text { text: g("name"), style: plate(text(font, 56.0, "#FFFFFF"), "#0B0B0C", 22.0, 10.0) }, 14.0, 0.0, 0.12, en, ex));
      out.push(obj("under", "Role", ObjKind::Text { text: g("under"), style: plate(TextStyle { uppercase: true, tracking: 0.12, ..text(font, 22.0, cs.ink) }, "#FFFFFF", 22.0, 9.0) }, 14.0, 82.0, 0.3, en, ex));
    }
    "arrow" => {
      out.push(obj("arrow", "Arrow", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Arrow, fill: "#FF8A1F".into(), ..Default::default() }, w: 320.0, h: 90.0 }, 0.0, 0.0, 0.0, "draw-on", ex));
      let l = g("label"); if !l.is_empty() { out.push(obj("label", "Label", ObjKind::Text { text: l, style: plate(text(font, 32.0, cs.on_plate), cs.plate, 16.0, 8.0) }, 0.0, 110.0, 0.4, en, ex)); }
    }
    "circleit" => {
      out.push(obj("label", "Words", ObjKind::Text { text: g("label"), style: text(loud, 56.0, cs.ink) }, 40.0, 30.0, 0.0, "appear", ex));
      out.push(obj("ring", "Ring", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::CircleIt, fill: String::new(), stroke: "#E8433A".into(), stroke_w: 7.0, ..Default::default() }, w: 520.0, h: 150.0 }, 0.0, 0.0, 0.2, "draw-on", ex));
    }
    "callout" => {
      out.push(obj("bubble", "Bubble", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Bubble, fill: cs.plate.into(), param: 0.2, ..Default::default() }, w: 460.0, h: 150.0 }, 0.0, 0.0, 0.0, "pop", ex));
      out.push(obj("text", "Note", ObjKind::Text { text: g("text"), style: text(font, 38.0, cs.on_plate) }, 28.0, 36.0, 0.15, "typewriter", ex));
    }
    "bignumber" => {
      out.push(obj("num", "Number", ObjKind::Text { text: g("num"), style: text(loud, 200.0, cs.plate) }, 0.0, 0.0, 0.0, "rise", ex));
      out.push(obj("cap", "Caption", ObjKind::Text { text: g("caption"), style: text(look_font("elegant"), 44.0, cs.ink) }, 6.0, 220.0, 0.3, en, ex));
    }
    "percent" => {
      let v: f32 = g("num").trim_end_matches('%').parse::<f32>().unwrap_or(50.0) / 100.0;
      out.push(obj("num", "Percent", ObjKind::Text { text: g("num"), style: text(loud, 160.0, cs.plate) }, 0.0, 0.0, 0.0, "rise", ex));
      out.push(obj("bar", "Bar", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Progress, fill: cs.plate.into(), param: v, ..Default::default() }, w: 600.0, h: 22.0 }, 0.0, 190.0, 0.2, "draw-on", ex));
      out.push(obj("track", "Track", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Rect, fill: "#D9DDE3".into(), ..Default::default() }, w: 600.0, h: 22.0 }, 0.0, 190.0, 0.1, "appear", ex));
      out.push(obj("cap", "Caption", ObjKind::Text { text: g("caption"), style: text(font, 36.0, cs.ink) }, 0.0, 232.0, 0.4, en, ex));
      out.swap(1, 2);
    }
    "checklist" | "steps" | "like" => {
      for (i, k) in ["a", "b", "c"].iter().enumerate() {
        let y = i as f32 * 86.0; let s = 0.0 + i as f32 * 0.55;
        if template == "checklist" {
          out.push(obj(&format!("box{i}"), "Box", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Rect, fill: cs.plate.into(), ..Default::default() }, w: 48.0, h: 48.0 }, 0.0, y + 6.0, s, "pop", ex));
          out.push(obj(&format!("tick{i}"), "Tick", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Check, fill: cs.on_plate.into(), ..Default::default() }, w: 28.0, h: 22.0 }, 10.0, y + 19.0, s + 0.25, "draw-on", ex));
        } else if template == "steps" {
          out.push(obj(&format!("n{i}"), "Number", ObjKind::Text { text: format!("{}", i + 1), style: plate(text(loud, 34.0, cs.on_plate), cs.plate, 16.0, 6.0) }, 0.0, y, s, "pop", ex));
        } else {
          let icons = ["♥", "●", "▶"];
          out.push(obj(&format!("i{i}"), "Icon", ObjKind::PixelText { text: icons[i].into(), font: crate::pixel::PixelFont::Five, px: 8.0, color: cs.plate.into(), shadow: String::new() }, 0.0, y + 8.0, s, "pop", ex));
        }
        out.push(obj(&format!("t{i}"), "Item", ObjKind::Text { text: g(k), style: text(font, 48.0, cs.ink) }, 76.0, y, s + 0.1, en, ex));
      }
    }
    "subscribe" => {
      out.push(obj("btn", "Button", ObjKind::Text { text: format!("▶  {}", g("cta")), style: plate(text(loud, 44.0, "#FFFFFF"), "#E8433A", 34.0, 18.0) }, 0.0, 0.0, 0.0, "pop", ex));
      out.push(obj("handle", "Handle", ObjKind::Text { text: g("handle"), style: text(font, 30.0, cs.ink) }, 4.0, 100.0, 0.3, en, ex));
      let mut cur = obj("cursor", "Cursor", ObjKind::Sprite { sprite: crate::pixel::cursor(), px: 6.0, tint: String::new() }, 220.0, 60.0, 0.9, "slide", "disappear");
      cur.enter.dir = Dir::Up; cur.enter.dur = 0.5; cur.on = FxOn { id: "click".into(), amp: 1.0, speed: 1.0 };
      out.push(cur);
    }
    "chapter" | "title" => {
      let big = if template == "title" { 128.0 } else { 96.0 };
      out.push(obj("kicker", "Small line", ObjKind::Text { text: g("kicker"), style: plate(TextStyle { uppercase: true, tracking: 0.14, ..text(font, 24.0, cs.on_plate) }, cs.plate, 14.0, 8.0) }, 0.0, 0.0, 0.0, en, ex));
      out.push(obj("title", "Title", ObjKind::Text { text: g("title"), style: text(if look == "clean" { look_font("elegant") } else { font }, big, cs.ink) }, 0.0, 60.0, 0.2, en, ex));
    }
    "countdown" => {
      let from: i32 = g("from").parse().unwrap_or(3).clamp(1, 9);
      out.push(obj("label", "Label", ObjKind::Text { text: g("label"), style: TextStyle { uppercase: true, tracking: 0.14, ..text(font, 28.0, cs.ink) } }, 0.0, 0.0, 0.0, en, "stay"));
      for i in 0..from {
        let mut n = obj(&format!("n{i}"), "Number", ObjKind::Text { text: format!("{}", from - i), style: plate(text(loud, 180.0, cs.on_plate), cs.plate, 60.0, 20.0) }, 0.0, 50.0, i as f32, "stamp", "disappear");
        n.dur = 1.0; n.exit.dur = 0.0; out.push(n);
      }
    }
    "quote" => {
      out.push(obj("mark", "Mark", ObjKind::Text { text: "“".into(), style: text(look_font("elegant"), 140.0, cs.plate) }, 0.0, -30.0, 0.0, "appear", ex));
      out.push(obj("quote", "Quote", ObjKind::Text { text: g("quote"), style: text(look_font("elegant"), 72.0, cs.ink) }, 70.0, 20.0, 0.1, "typewriter", ex));
      out.push(obj("who", "Who", ObjKind::Text { text: g("who"), style: TextStyle { uppercase: true, tracking: 0.16, ..text(font, 22.0, cs.ink) } }, 74.0, 120.0, 0.8, en, ex));
    }
    "location" => {
      out.push(obj("pin", "Pin", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Pin, fill: "#E8433A".into(), stroke: String::new(), stroke_w: 0.0, ..Default::default() }, w: 56.0, h: 84.0 }, 0.0, 0.0, 0.0, "drop-bounce", ex));
      out.push(obj("place", "Place", ObjKind::Text { text: g("place"), style: plate(text(loud, 44.0, cs.ink), cs.paper, 20.0, 8.0) }, 76.0, 0.0, 0.3, en, ex));
      out.push(obj("sub", "Underneath", ObjKind::Text { text: g("sub"), style: plate(TextStyle { uppercase: true, tracking: 0.14, ..text(font, 20.0, cs.ink) }, cs.paper, 20.0, 6.0) }, 76.0, 68.0, 0.45, en, ex));
    }
    "breaking" => {
      out.push(obj("bar", "Bar", ObjKind::Shape { style: ShapeStyle { kind: ShapeKind::Rect, fill: cs.paper.into(), ..Default::default() }, w: 1728.0, h: 92.0 }, 0.0, 0.0, 0.0, "wipe", ex));
      out.push(obj("tag", "Tag", ObjKind::Text { text: g("tag"), style: plate(TextStyle { uppercase: true, tracking: 0.14, ..text(loud, 30.0, "#FFFFFF") }, "#E8433A", 24.0, 26.0) }, 0.0, 0.0, 0.15, "wipe", ex));
      out.push(obj("head", "Headline", ObjKind::Text { text: g("head"), style: text(font, 44.0, cs.ink) }, 240.0, 20.0, 0.35, "typewriter", ex));
    }
    "versus" => {
      out.push(obj("lv", "Left value", ObjKind::Text { text: g("lv"), style: text(loud, 150.0, cs.plate) }, 0.0, 0.0, 0.0, "rise", ex));
      out.push(obj("la", "Left", ObjKind::Text { text: g("la"), style: text(font, 40.0, cs.ink) }, 4.0, 170.0, 0.2, en, ex));
      out.push(obj("vs", "vs", ObjKind::Text { text: "vs".into(), style: text(look_font("elegant"), 60.0, cs.ink) }, 440.0, 60.0, 0.4, "pop", ex));
      out.push(obj("rv", "Right value", ObjKind::Text { text: g("rv"), style: text(loud, 150.0, "#8B5CF6") }, 560.0, 0.0, 0.5, "rise", ex));
      out.push(obj("ra", "Right", ObjKind::Text { text: g("ra"), style: text(font, 40.0, cs.ink) }, 564.0, 170.0, 0.7, en, ex));
    }
    "pixeltitle" => {
      let mut t = obj("title", "Title", ObjKind::PixelText { text: g("title"), font: crate::pixel::PixelFont::Five, px: 14.0, color: "#FFFFFF".into(), shadow: "#0E2960".into() }, 0.0, 0.0, 0.0, "blocky-wipe", ex);
      t.on = FxOn { id: "sway".into(), amp: 1.0, speed: 1.0 }; out.push(t);
      out.push(obj("sub", "Underneath", ObjKind::PixelText { text: g("sub"), font: crate::pixel::PixelFont::Five, px: 7.0, color: "#F5C542".into(), shadow: "#0E2960".into() }, 2.0, 130.0, 0.4, "typewriter", ex));
    }
    "asciititle" => {
      out.push(obj("title", "Title", ObjKind::AsciiBanner { text: g("title"), cell: 14.0, font: "jetbrains-mono".into(), on: "#".into(), color: "#22D37F".into() }, 0.0, 0.0, 0.0, "decode", "glyph-scatter"));
    }
    _ => {}
  }
  // Inherit timing and sizing from the host card.
  for o in out.iter_mut() {
    o.enter.ease = host.enter.ease; o.enter.size = host.enter.size; o.exit.ease = host.exit.ease;
    if host.enter.dur > 0.0 { o.enter.dur = host.enter.dur; }
    if o.enter.id == en { o.enter.dir = host.enter.dir; }
    o.exit.dir = host.exit.dir;
    if o.exit.id != "disappear" && o.exit.id != "stay" { o.exit.dur = host.exit.dur; }
  }
  let _ = Size::Medium; let _ = Ease::Linear; let _ = Align::Left; let _ = Rgba::CLEAR;
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn every_card_expands() {
    for c in CARDS {
      let host = Obj { kind: ObjKind::Card { template: c.id.into(), fields: BTreeMap::new(), look: "clean".into(), colors: "blue".into() }, ..Default::default() };
      let parts = expand(c.id, &BTreeMap::new(), "clean", "blue", &host);
      assert!(!parts.is_empty(), "{} produced nothing", c.id);
      let ids: std::collections::HashSet<_> = parts.iter().map(|p| p.id.clone()).collect();
      assert_eq!(ids.len(), parts.len(), "{} duplicate ids", c.id);
    }
    assert_eq!(color_set("nope").id, "blue");
  }
}
