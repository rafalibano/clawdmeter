const SAMPLES: u32 = 4;
const TRACK_ALPHA: f32 = 0.35;
const OUTLINE_ALPHA: f32 = 0.6;

const GLYPH_COLS: u32 = 4;
const GLYPH_ROWS: u32 = 6;

const WIDE_HEIGHT: u32 = 18;
const WIDE_WIDTH: u32 = 58;
const ROW_HEIGHT: u32 = 9;
const BAR_X: u32 = 33;
const BAR_WIDTH: u32 = 24;
const BAR_HEIGHT: u32 = 5;
const LABEL_X: u32 = 21;
const STAR_ARM: f64 = 8.0;
const STAR_THICKNESS: f64 = 1.8;
const STAR_RAYS: u32 = 8;

const SQUARE_SIDE: u32 = 16;
const SQUARE_MARGIN: u32 = 1;
const SQUARE_BAR_HEIGHT: u32 = 6;
const SQUARE_GAP: u32 = 2;
const SQUARE_RADIUS: f64 = 2.0;

const DASH_ON: u32 = 3;
const DASH_PERIOD: u32 = 5;

const TEMPLATE_INK: [u8; 3] = [0, 0, 0];
const SQUARE_FILL: [u8; 3] = [59, 130, 246];
const SQUARE_EMPTY: [u8; 3] = [128, 128, 128];

const GLYPH_5: [&str; 6] = ["XXXX", "X...", "XXX.", "...X", "X..X", ".XX."];
const GLYPH_H: [&str; 6] = ["X...", "X...", "XXX.", "X..X", "X..X", "X..X"];
const GLYPH_7: [&str; 6] = ["XXXX", "...X", "..X.", ".X..", ".X..", ".X.."];
const GLYPH_D: [&str; 6] = ["...X", "...X", ".XXX", "X..X", "X..X", ".XXX"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageIcon {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl UsageIcon {
    pub fn alpha_at(&self, x: u32, y: u32) -> u8 {
        self.rgba[((y * self.width + x) * 4 + 3) as usize]
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn to_pixel(value: f64, max: u32) -> u32 {
    value.clamp(0.0, f64::from(max)) as u32
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn to_byte(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

pub fn normalize_percent(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 100.0))
}

struct Canvas {
    width: u32,
    height: u32,
    pixels: Vec<[f32; 4]>,
}

impl Canvas {
    fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            pixels: vec![[0.0; 4]; (width * height) as usize],
        }
    }

    fn paint(
        &mut self,
        bounds: (f64, f64, f64, f64),
        color: [u8; 3],
        alpha: f32,
        inside: impl Fn(f64, f64) -> bool,
    ) {
        let x0 = to_pixel(bounds.0.floor(), self.width);
        let y0 = to_pixel(bounds.1.floor(), self.height);
        let x1 = to_pixel(bounds.2.ceil(), self.width);
        let y1 = to_pixel(bounds.3.ceil(), self.height);
        let total = (SAMPLES * SAMPLES) as f32;
        let rgb = color.map(|c| f32::from(c) / 255.0);
        for y in y0..y1 {
            for x in x0..x1 {
                let mut hits = 0u32;
                for sy in 0..SAMPLES {
                    for sx in 0..SAMPLES {
                        let px = f64::from(x) + (f64::from(sx) + 0.5) / f64::from(SAMPLES);
                        let py = f64::from(y) + (f64::from(sy) + 0.5) / f64::from(SAMPLES);
                        if inside(px, py) {
                            hits += 1;
                        }
                    }
                }
                if hits == 0 {
                    continue;
                }
                let source = alpha * hits as f32 / total;
                let target = &mut self.pixels[(y * self.width + x) as usize];
                for channel in 0..3 {
                    target[channel] = rgb[channel] * source + target[channel] * (1.0 - source);
                }
                target[3] = source + target[3] * (1.0 - source);
            }
        }
    }

    fn finish(self) -> UsageIcon {
        let mut rgba = Vec::with_capacity(self.pixels.len() * 4);
        for [r, g, b, a] in &self.pixels {
            if *a <= 0.0 {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            for channel in [r, g, b] {
                rgba.push(to_byte(channel / a * 255.0));
            }
            rgba.push(to_byte(a * 255.0));
        }
        UsageIcon {
            width: self.width,
            height: self.height,
            rgba,
        }
    }
}

#[derive(Clone, Copy)]
struct Bar {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bar {
    fn bounds(&self) -> (f64, f64, f64, f64) {
        (self.x, self.y, self.x + self.width, self.y + self.height)
    }

    fn contains(&self, px: f64, py: f64, inset: f64, radius: f64) -> bool {
        let left = self.x + inset;
        let top = self.y + inset;
        let right = self.x + self.width - inset;
        let bottom = self.y + self.height - inset;
        if px < left || px > right || py < top || py > bottom {
            return false;
        }
        let radius = (radius - inset)
            .max(0.0)
            .min((right - left) / 2.0)
            .min((bottom - top) / 2.0);
        let cx = px.clamp(left + radius, right - radius);
        let cy = py.clamp(top + radius, bottom - radius);
        (px - cx).powi(2) + (py - cy).powi(2) <= radius * radius
    }
}

#[derive(Clone, Copy)]
struct Style {
    fill: [u8; 3],
    empty: [u8; 3],
    radius: f64,
    stroke: f64,
    dash_on: f64,
    dash_period: f64,
}

fn paint_bar(canvas: &mut Canvas, bar: Bar, percent: Option<f64>, style: &Style) {
    let Style {
        fill,
        empty,
        radius,
        stroke,
        dash_on,
        dash_period,
    } = *style;
    match normalize_percent(percent) {
        Some(value) => {
            canvas.paint(bar.bounds(), empty, TRACK_ALPHA, |x, y| {
                bar.contains(x, y, 0.0, radius)
            });
            let edge = bar.x + bar.width * value / 100.0;
            if value > 0.0 {
                canvas.paint(bar.bounds(), fill, 1.0, |x, y| {
                    x < edge && bar.contains(x, y, 0.0, radius)
                });
            }
        }
        None => {
            canvas.paint(bar.bounds(), empty, OUTLINE_ALPHA, |x, y| {
                bar.contains(x, y, 0.0, radius)
                    && !bar.contains(x, y, stroke, radius)
                    && (x - bar.x).rem_euclid(dash_period) < dash_on
            });
        }
    }
}

fn glyph_for(ch: char) -> &'static [&'static str; 6] {
    match ch {
        '5' => &GLYPH_5,
        'h' => &GLYPH_H,
        '7' => &GLYPH_7,
        _ => &GLYPH_D,
    }
}

fn paint_label(canvas: &mut Canvas, text: &str, x: u32, y: u32, cell: u32) {
    let mut cursor = x;
    for ch in text.chars() {
        for (row, line) in glyph_for(ch).iter().enumerate() {
            for (col, mark) in line.bytes().enumerate() {
                if mark != b'X' {
                    continue;
                }
                let left = (cursor + col as u32 * cell) as f64;
                let top = (y + row as u32 * cell) as f64;
                let right = left + cell as f64;
                let bottom = top + cell as f64;
                canvas.paint((left, top, right, bottom), TEMPLATE_INK, 1.0, |_, _| true);
            }
        }
        cursor += (GLYPH_COLS + 1) * cell;
    }
}

fn distance_to_segment(px: f64, py: f64, a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length_sq = dx * dx + dy * dy;
    let t = if length_sq == 0.0 {
        0.0
    } else {
        (((px - a.0) * dx + (py - a.1) * dy) / length_sq).clamp(0.0, 1.0)
    };
    ((px - (a.0 + t * dx)).powi(2) + (py - (a.1 + t * dy)).powi(2)).sqrt()
}

fn paint_asterisk(canvas: &mut Canvas, scale: f64) {
    let center = (
        WIDE_HEIGHT as f64 / 2.0 * scale,
        WIDE_HEIGHT as f64 / 2.0 * scale,
    );
    let arm = STAR_ARM * scale;
    let radius = STAR_THICKNESS * scale / 2.0;
    let rays: Vec<((f64, f64), (f64, f64))> = (0..STAR_RAYS / 2)
        .map(|index| {
            let angle = std::f64::consts::PI * index as f64 / (STAR_RAYS / 2) as f64;
            let (dx, dy) = (angle.cos() * arm, angle.sin() * arm);
            (
                (center.0 - dx, center.1 - dy),
                (center.0 + dx, center.1 + dy),
            )
        })
        .collect();
    let bounds = (
        center.0 - arm - radius,
        center.1 - arm - radius,
        center.0 + arm + radius,
        center.1 + arm + radius,
    );
    canvas.paint(bounds, TEMPLATE_INK, 1.0, |x, y| {
        rays.iter()
            .any(|(a, b)| distance_to_segment(x, y, *a, *b) <= radius)
    });
}

pub fn render_usage_icon(five_hour: Option<f64>, seven_day: Option<f64>, scale: u32) -> UsageIcon {
    let scale = scale.max(1);
    let s = scale as f64;
    let mut canvas = Canvas::new(WIDE_WIDTH * scale, WIDE_HEIGHT * scale);
    paint_asterisk(&mut canvas, s);
    let style = Style {
        fill: TEMPLATE_INK,
        empty: TEMPLATE_INK,
        radius: BAR_HEIGHT as f64 * s / 2.0,
        stroke: s,
        dash_on: DASH_ON as f64 * s,
        dash_period: DASH_PERIOD as f64 * s,
    };
    let rows = [("5h", five_hour), ("7d", seven_day)];
    for (index, (label, percent)) in rows.into_iter().enumerate() {
        let row_top = index as u32 * ROW_HEIGHT * scale;
        let glyph_top = row_top + (ROW_HEIGHT * scale - GLYPH_ROWS * scale) / 2;
        paint_label(&mut canvas, label, LABEL_X * scale, glyph_top, scale);
        let bar = Bar {
            x: (BAR_X * scale) as f64,
            y: (row_top + (ROW_HEIGHT * scale - BAR_HEIGHT * scale) / 2) as f64,
            width: (BAR_WIDTH * scale) as f64,
            height: (BAR_HEIGHT * scale) as f64,
        };
        paint_bar(&mut canvas, bar, percent, &style);
    }
    canvas.finish()
}

pub fn render_usage_icon_square(
    five_hour: Option<f64>,
    seven_day: Option<f64>,
    scale: u32,
) -> UsageIcon {
    let scale = scale.max(1);
    let s = scale as f64;
    let side = SQUARE_SIDE * scale;
    let mut canvas = Canvas::new(side, side);
    let style = Style {
        fill: SQUARE_FILL,
        empty: SQUARE_EMPTY,
        radius: SQUARE_RADIUS * s,
        stroke: s,
        dash_on: DASH_ON as f64 * s,
        dash_period: DASH_PERIOD as f64 * s,
    };
    for (index, percent) in [five_hour, seven_day].into_iter().enumerate() {
        let top = SQUARE_MARGIN + index as u32 * (SQUARE_BAR_HEIGHT + SQUARE_GAP);
        let bar = Bar {
            x: (SQUARE_MARGIN * scale) as f64,
            y: (top * scale) as f64,
            width: ((SQUARE_SIDE - 2 * SQUARE_MARGIN) * scale) as f64,
            height: (SQUARE_BAR_HEIGHT * scale) as f64,
        };
        paint_bar(&mut canvas, bar, percent, &style);
    }
    canvas.finish()
}

pub fn sanitize_tooltip(raw: &str) -> String {
    raw.chars().filter(|c| !c.is_control()).take(120).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCALE: u32 = 2;

    fn bar_rows(scale: u32) -> [u32; 2] {
        [0, 1].map(|index| index * ROW_HEIGHT * scale + ROW_HEIGHT * scale / 2)
    }

    fn column(icon: &UsageIcon, x: u32, y: u32) -> u8 {
        icon.alpha_at(x, y)
    }

    fn bar_x(fraction: f64, scale: u32) -> u32 {
        BAR_X * scale + (BAR_WIDTH as f64 * scale as f64 * fraction) as u32
    }

    #[test]
    fn wide_icon_has_dimensions_of_the_menu_bar_at_2x() {
        let icon = render_usage_icon(Some(24.0), Some(51.0), 2);
        assert_eq!((icon.width, icon.height), (116, 36));
        assert_eq!(icon.rgba.len(), 116 * 36 * 4);
        let single = render_usage_icon(Some(24.0), Some(51.0), 1);
        assert_eq!((single.width, single.height), (58, 18));
    }

    #[test]
    fn zero_percent_leaves_only_the_translucent_track() {
        let icon = render_usage_icon(Some(0.0), Some(0.0), SCALE);
        for y in bar_rows(SCALE) {
            for x in (bar_x(0.1, SCALE)..bar_x(0.9, SCALE)).step_by(2) {
                let alpha = column(&icon, x, y);
                assert!((85..=95).contains(&alpha), "x={x} y={y} alpha={alpha}");
            }
        }
    }

    #[test]
    fn fifty_percent_fills_left_half_opaque_and_right_half_translucent() {
        let icon = render_usage_icon(Some(50.0), Some(50.0), SCALE);
        for y in bar_rows(SCALE) {
            assert_eq!(column(&icon, bar_x(0.25, SCALE), y), 255);
            assert_eq!(column(&icon, bar_x(0.45, SCALE), y), 255);
            let empty = column(&icon, bar_x(0.75, SCALE), y);
            assert!((85..=95).contains(&empty), "alpha={empty}");
        }
    }

    #[test]
    fn hundred_percent_fills_the_whole_bar() {
        let icon = render_usage_icon(Some(100.0), Some(100.0), SCALE);
        for y in bar_rows(SCALE) {
            for x in (bar_x(0.15, SCALE)..bar_x(0.85, SCALE)).step_by(2) {
                assert_eq!(column(&icon, x, y), 255, "x={x}");
            }
        }
    }

    #[test]
    fn filled_width_grows_monotonically_with_the_percentage() {
        let opaque = |percent: f64| {
            let icon = render_usage_icon(Some(percent), None, SCALE);
            let y = bar_rows(SCALE)[0];
            (BAR_X * SCALE..icon.width)
                .filter(|x| column(&icon, *x, y) == 255)
                .count()
        };
        let (a, b, c) = (opaque(24.0), opaque(51.0), opaque(90.0));
        assert!(a < b && b < c, "{a} {b} {c}");
        let full = (BAR_WIDTH * SCALE) as usize;
        assert!(b.abs_diff(full * 51 / 100) <= 2, "{b}");
    }

    #[test]
    fn rows_are_independent() {
        let icon = render_usage_icon(Some(100.0), Some(0.0), SCALE);
        let [top, bottom] = bar_rows(SCALE);
        let x = bar_x(0.8, SCALE);
        assert_eq!(column(&icon, x, top), 255);
        assert!(column(&icon, x, bottom) < 100);
    }

    #[test]
    fn missing_data_draws_a_dashed_outline_without_fill() {
        let icon = render_usage_icon(None, None, SCALE);
        let y = bar_rows(SCALE)[0];
        let center_alpha = column(&icon, bar_x(0.5, SCALE), y);
        assert_eq!(center_alpha, 0);
        let top_edge = y - BAR_HEIGHT * SCALE / 2 + 1;
        let on_edge: Vec<u8> = (bar_x(0.1, SCALE)..bar_x(0.9, SCALE))
            .map(|x| column(&icon, x, top_edge))
            .collect();
        assert!(on_edge.iter().any(|alpha| *alpha >= 140), "sem traço");
        assert!(on_edge.contains(&0), "sem intervalo entre os traços");
        let zero = render_usage_icon(Some(0.0), Some(0.0), SCALE);
        assert_ne!(icon.rgba, zero.rgba);
    }

    #[test]
    fn out_of_range_and_non_finite_values_are_clamped() {
        assert_eq!(
            render_usage_icon(Some(250.0), Some(-30.0), SCALE),
            render_usage_icon(Some(100.0), Some(0.0), SCALE)
        );
        assert_eq!(
            render_usage_icon(Some(f64::NAN), Some(f64::INFINITY), SCALE),
            render_usage_icon(None, None, SCALE)
        );
        assert_eq!(normalize_percent(Some(120.0)), Some(100.0));
        assert_eq!(normalize_percent(Some(-1.0)), Some(0.0));
        assert_eq!(normalize_percent(None), None);
    }

    #[test]
    fn scale_zero_behaves_like_one() {
        assert_eq!(
            render_usage_icon(Some(10.0), None, 0),
            render_usage_icon(Some(10.0), None, 1)
        );
    }

    #[test]
    fn labels_and_asterisk_are_painted_opaque() {
        let icon = render_usage_icon(Some(0.0), Some(0.0), SCALE);
        let center = WIDE_HEIGHT * SCALE / 2;
        assert_eq!(column(&icon, center, center), 255);
        let label_pixels = (LABEL_X * SCALE..BAR_X * SCALE - 2)
            .flat_map(|x| (0..icon.height).map(move |y| (x, y)))
            .filter(|(x, y)| column(&icon, *x, *y) == 255)
            .count();
        assert!(label_pixels > 40, "{label_pixels}");
        let gutter = (WIDE_HEIGHT * SCALE + 1..LABEL_X * SCALE - 1)
            .flat_map(|x| (0..icon.height).map(move |y| (x, y)))
            .filter(|(x, y)| column(&icon, *x, *y) > 0)
            .count();
        assert_eq!(gutter, 0);
    }

    #[test]
    fn template_icon_is_monochrome_black_with_alpha_only() {
        let icon = render_usage_icon(Some(40.0), Some(80.0), SCALE);
        assert!(icon
            .rgba
            .chunks(4)
            .all(|px| px[3] == 0 || px[..3] == [0, 0, 0]));
    }

    #[test]
    fn square_icon_is_16px_at_1x_and_32px_at_2x() {
        let one = render_usage_icon_square(Some(24.0), Some(51.0), 1);
        let two = render_usage_icon_square(Some(24.0), Some(51.0), 2);
        assert_eq!((one.width, one.height), (16, 16));
        assert_eq!((two.width, two.height), (32, 32));
        assert_eq!(two.rgba.len(), 32 * 32 * 4);
    }

    #[test]
    fn square_icon_stacks_two_thick_bars_proportional_to_percent() {
        let icon = render_usage_icon_square(Some(25.0), Some(75.0), 2);
        let top_y = 8;
        let bottom_y = 24;
        let inner = (2 * SQUARE_MARGIN + 2..30).collect::<Vec<u32>>();
        let filled = |y: u32| {
            inner
                .iter()
                .filter(|x| column(&icon, **x, y) == 255)
                .count()
        };
        let (top, bottom) = (filled(top_y), filled(bottom_y));
        assert!(top < bottom);
        assert!(top.abs_diff(5) <= 1, "{top}");
        assert!(bottom.abs_diff(19) <= 1, "{bottom}");
        let gap_y = 16;
        assert!((0..32).all(|x| column(&icon, x, gap_y) == 0));
        let pixel = &icon.rgba[((top_y * 32 + 4) * 4) as usize..][..4];
        assert_eq!(pixel, [SQUARE_FILL[0], SQUARE_FILL[1], SQUARE_FILL[2], 255]);
    }

    #[test]
    fn square_icon_without_data_is_dashed_outline() {
        let none = render_usage_icon_square(None, None, 2);
        let zero = render_usage_icon_square(Some(0.0), Some(0.0), 2);
        assert_ne!(none.rgba, zero.rgba);
        assert_eq!(column(&none, 16, 8), 0);
        assert_eq!(
            render_usage_icon_square(Some(400.0), Some(-5.0), 2),
            render_usage_icon_square(Some(100.0), Some(0.0), 2)
        );
    }

    #[test]
    fn tooltip_is_stripped_of_control_chars_and_capped() {
        assert_eq!(sanitize_tooltip("5h: 24%\n7d: 51%"), "5h: 24%7d: 51%");
        assert_eq!(sanitize_tooltip(&"a".repeat(500)).chars().count(), 120);
        assert_eq!(sanitize_tooltip("reseta 14:09 · seg"), "reseta 14:09 · seg");
    }

    #[test]
    fn pixel_and_byte_conversions_clamp_before_casting() {
        assert_eq!(to_pixel(-5.0, 10), 0);
        assert_eq!(to_pixel(3.9, 10), 3);
        assert_eq!(to_pixel(1.0e12, 10), 10);
        assert_eq!(to_pixel(f64::NAN, 10), 0);
        assert_eq!(to_byte(-3.0), 0);
        assert_eq!(to_byte(127.6), 128);
        assert_eq!(to_byte(1.0e9), 255);
        assert_eq!(to_byte(f32::NAN), 0);
    }

    #[test]
    fn out_of_range_percentages_render_like_the_clamped_ones() {
        let wild = render_usage_icon(Some(1.0e9), Some(-50.0), 2);
        let clamped = render_usage_icon(Some(100.0), Some(0.0), 2);
        assert_eq!(wild.rgba, clamped.rgba);
    }
}
