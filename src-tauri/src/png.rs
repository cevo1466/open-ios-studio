//! PNG header reader for the icon check: signature + IHDR only (33 bytes), no decoding.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PngHeader {
    pub width: u32,
    pub height: u32,
    /// 0 grey, 2 RGB, 3 indexed, 4 grey+alpha, 6 RGBA.
    pub color_type: u8,
}

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// Parses the PNG signature and the IHDR chunk (the first 33 bytes). The CRC is not checked.
pub fn parse_png_header(bytes: &[u8]) -> Result<PngHeader, String> {
    if bytes.len() < 29 || bytes[..8] != SIGNATURE {
        return Err("not a PNG file".to_owned());
    }
    if &bytes[12..16] != b"IHDR" {
        return Err("PNG without a leading IHDR chunk".to_owned());
    }
    let be = |i: usize| u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    Ok(PngHeader {
        width: be(16),
        height: be(20),
        color_type: bytes[25],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32, color_type: u8) -> Vec<u8> {
        let mut b = vec![
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
        ];
        b.extend(width.to_be_bytes());
        b.extend(height.to_be_bytes());
        b.extend([8u8, color_type, 0, 0, 0]);
        b.extend([0u8, 0, 0, 0]); // CRC (not checked)
        b
    }

    #[test]
    fn png_header_parses_ihdr() {
        let h = parse_png_header(&png(1024, 1024, 2)).expect("header");
        assert_eq!((h.width, h.height, h.color_type), (1024, 1024, 2));
        let h = parse_png_header(&png(512, 256, 6)).expect("header");
        assert_eq!((h.width, h.height, h.color_type), (512, 256, 6));
    }

    #[test]
    fn png_header_rejects_non_png() {
        assert!(parse_png_header(b"GIF89a").is_err());
        assert!(parse_png_header(&[0x89, b'P']).is_err());
        let mut not_ihdr = png(1, 1, 2);
        not_ihdr[12..16].copy_from_slice(b"IDAT");
        assert!(parse_png_header(&not_ihdr).is_err());
    }
}
