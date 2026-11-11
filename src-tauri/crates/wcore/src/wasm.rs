//! Plain C-ABI exports for the wasm32 build. No wasm-bindgen: the host allocates with `alloc`,
//! writes bytes, and calls in. Results are left in a static buffer the host reads back.

use crate::scene::Scene;
use std::cell::RefCell;

thread_local! {
  static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
  static FRAME: RefCell<Option<crate::frame::Frame>> = RefCell::new(None);
}

#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 { let mut v = Vec::<u8>::with_capacity(len); let p = v.as_mut_ptr(); std::mem::forget(v); p }
#[no_mangle]
pub unsafe extern "C" fn wasm_free(ptr: *mut u8, len: usize) { if !ptr.is_null() { drop(Vec::from_raw_parts(ptr, 0, len)); } }

/// Register a font. Returns 1 on success.
#[no_mangle]
pub unsafe extern "C" fn load_font(id: *const u8, id_len: usize, data: *const u8, len: usize) -> i32 {
  let id = std::str::from_utf8_unchecked(std::slice::from_raw_parts(id, id_len));
  let bytes = std::slice::from_raw_parts(data, len);
  crate::fonts::load_font(id, bytes).is_ok() as i32
}

/// Render scene JSON at time `t` into a `w × h` RGBA buffer. Returns a pointer to the pixels
/// (valid until the next render) or null if the JSON is bad.
#[no_mangle]
pub unsafe extern "C" fn render(json: *const u8, len: usize, t: f32, w: u32, h: u32) -> *const u8 {
  let s = std::str::from_utf8_unchecked(std::slice::from_raw_parts(json, len));
  let Ok(scene) = Scene::from_json(s) else { return std::ptr::null() };
  let f = crate::render::render(&scene, t, w as usize, h as usize);
  FRAME.with(|fr| { let mut fr = fr.borrow_mut(); *fr = Some(f); fr.as_ref().unwrap().px.as_ptr() })
}

/// Generic JSON query (catalogue, scene helpers). The reply is UTF-8 JSON in the output buffer.
#[no_mangle]
pub unsafe extern "C" fn query(json: *const u8, len: usize) -> *const u8 {
  let s = std::str::from_utf8_unchecked(std::slice::from_raw_parts(json, len));
  let reply = crate::api::query(s);
  OUT.with(|o| { let mut o = o.borrow_mut(); *o = reply.into_bytes(); o.as_ptr() })
}
#[no_mangle]
pub extern "C" fn out_len() -> usize { OUT.with(|o| o.borrow().len()) }

/// Render and PNG-encode one frame. Returns a pointer to the PNG bytes; length via `out_len`.
#[no_mangle]
pub unsafe extern "C" fn render_png(json: *const u8, len: usize, t: f32, w: u32, h: u32) -> *const u8 {
  let s = std::str::from_utf8_unchecked(std::slice::from_raw_parts(json, len));
  let Ok(scene) = Scene::from_json(s) else { return std::ptr::null() };
  let f = crate::render::render(&scene, t, w as usize, h as usize);
  let bytes = crate::png::encode(&f);
  OUT.with(|o| { let mut o = o.borrow_mut(); *o = bytes; o.as_ptr() })
}
