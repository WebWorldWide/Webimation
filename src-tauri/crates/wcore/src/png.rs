//! PNG encoding (straight alpha, 8-bit RGBA). Fast compression: export pipes raw frames to the
//! encoder, so PNG is only used for sequences and stills.

use crate::frame::Frame;

pub fn encode(f: &Frame) -> Vec<u8> {
  let mut out = Vec::with_capacity(f.w * f.h / 2);
  {
    let mut enc = png::Encoder::new(&mut out, f.w as u32, f.h as u32);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    enc.set_filter(png::FilterType::Sub);
    let mut w = enc.write_header().expect("png header");
    w.write_image_data(&f.px).expect("png data");
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn encodes_a_valid_png() {
    let mut f = Frame::new(4, 3); f.rect(1, 1, 2, 1, crate::frame::Rgba::BLUE);
    let bytes = encode(&f);
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    let dec = png::Decoder::new(&bytes[..]); let mut r = dec.read_info().unwrap(); let mut buf = vec![0; r.output_buffer_size()]; let info = r.next_frame(&mut buf).unwrap();
    assert_eq!((info.width, info.height), (4, 3)); assert_eq!(&buf[..f.px.len()], &f.px[..]);
  }
}
