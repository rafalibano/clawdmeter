use std::fs;
use std::path::{Path, PathBuf};

use clawdmeter_lib::usage_icon::{render_usage_icon, render_usage_icon_square, UsageIcon};

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for byte in data {
        a = (a + *byte as u32) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    let mut crc_input = kind.to_vec();
    crc_input.extend_from_slice(body);
    out.extend_from_slice(&crc_input);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

fn encode_png(icon: &UsageIcon) -> Vec<u8> {
    let stride = icon.width as usize * 4;
    let mut raw = Vec::with_capacity((stride + 1) * icon.height as usize);
    for row in icon.rgba.chunks(stride) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(index + 1 == blocks.len()));
        zlib.extend_from_slice(&(block.len() as u16).to_le_bytes());
        zlib.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut header = Vec::new();
    header.extend_from_slice(&icon.width.to_be_bytes());
    header.extend_from_slice(&icon.height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &zlib);
    chunk(&mut png, b"IEND", &[]);
    png
}

fn composite(
    icon: &UsageIcon,
    background: [u8; 3],
    tint: Option<[u8; 3]>,
    zoom: u32,
    pad: u32,
) -> UsageIcon {
    let width = (icon.width + pad * 2) * zoom;
    let height = (icon.height + pad * 2) * zoom;
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let (sx, sy) = (x / zoom, y / zoom);
            let inside = sx >= pad && sy >= pad && sx < pad + icon.width && sy < pad + icon.height;
            let mut pixel = [
                background[0] as f32,
                background[1] as f32,
                background[2] as f32,
            ];
            if inside {
                let at = (((sy - pad) * icon.width + (sx - pad)) * 4) as usize;
                let source = &icon.rgba[at..at + 4];
                let alpha = source[3] as f32 / 255.0;
                let color = tint.unwrap_or([source[0], source[1], source[2]]);
                for channel in 0..3 {
                    pixel[channel] = color[channel] as f32 * alpha + pixel[channel] * (1.0 - alpha);
                }
            }
            rgba.extend_from_slice(&[pixel[0] as u8, pixel[1] as u8, pixel[2] as u8, 255]);
        }
    }
    UsageIcon {
        width,
        height,
        rgba,
    }
}

fn write(dir: &Path, name: &str, icon: &UsageIcon) {
    let path = dir.join(name);
    fs::write(&path, encode_png(icon)).expect("falha ao gravar o PNG");
    println!("{}", path.display());
}

fn main() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docs/tray-preview");
    fs::create_dir_all(&dir).expect("falha ao criar docs/tray-preview");

    const DARK_BAR: [u8; 3] = [38, 38, 40];
    const LIGHT_BAR: [u8; 3] = [236, 236, 238];
    const WHITE: [u8; 3] = [255, 255, 255];
    const BLACK: [u8; 3] = [0, 0, 0];

    let mac_cases: [(&str, Option<f64>, Option<f64>); 6] = [
        ("13-28", Some(13.0), Some(28.0)),
        ("24-51", Some(24.0), Some(51.0)),
        ("50-50", Some(50.0), Some(50.0)),
        ("100-60", Some(100.0), Some(60.0)),
        ("40-100", Some(40.0), Some(100.0)),
        ("sem-dado", None, None),
    ];
    for (name, five_hour, seven_day) in mac_cases {
        let icon = render_usage_icon(five_hour, seven_day, 2);
        if name == "24-51" {
            write(&dir, "macos-2x-24-51-template.png", &icon);
        }
        write(
            &dir,
            &format!("macos-2x-{name}-dark.png"),
            &composite(&icon, DARK_BAR, Some(WHITE), 4, 6),
        );
        write(
            &dir,
            &format!("macos-2x-{name}-light.png"),
            &composite(&icon, LIGHT_BAR, Some(BLACK), 4, 6),
        );
    }

    let win_cases: [(&str, Option<f64>, Option<f64>); 5] = [
        ("13-28", Some(13.0), Some(28.0)),
        ("50-50", Some(50.0), Some(50.0)),
        ("100-60", Some(100.0), Some(60.0)),
        ("40-100", Some(40.0), Some(100.0)),
        ("sem-dado", None, None),
    ];
    for (name, five_hour, seven_day) in win_cases {
        let icon = render_usage_icon_square(five_hour, seven_day, 2);
        write(
            &dir,
            &format!("windows-32-{name}-dark.png"),
            &composite(&icon, DARK_BAR, None, 8, 4),
        );
        write(
            &dir,
            &format!("windows-32-{name}-light.png"),
            &composite(&icon, LIGHT_BAR, None, 8, 4),
        );
    }

    let win_small = render_usage_icon_square(Some(13.0), Some(28.0), 1);
    write(
        &dir,
        "windows-16-13-28-dark.png",
        &composite(&win_small, DARK_BAR, None, 16, 2),
    );
}
