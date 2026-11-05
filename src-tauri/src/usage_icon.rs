const SAMPLES: u32 = 4;
const TRACK_ALPHA: f32 = 0.35;
const OUTLINE_ALPHA: f32 = 0.6;

const GLYPH_COLS: u32 = 4;
const GLYPH_ROWS: u32 = 6;

const WIDE_HEIGHT: u32 = 18;
const WIDE_WIDTH: u32 = 64;
const ROW_HEIGHT: u32 = 9;
const BAR_X: u32 = 39;
const BAR_WIDTH: u32 = 24;
const BAR_HEIGHT: u32 = 5;
const LABEL_X: u32 = 27;

const MASCOT_CELL: u32 = 2;
const MASCOT_COLS: u32 = 12;
const MASCOT_ROWS: u32 = 8;
const EYE_X_REACH: f64 = 0.9;
const EYE_X_STROKE: f64 = 0.4;
const SQUARE_EYE_X_REACH: f64 = 1.5;
const SQUARE_EYE_X_STROKE: f64 = 0.8;

const SQUARE_SIDE: u32 = 16;

const DASH_ON: u32 = 3;
const DASH_PERIOD: u32 = 5;

const TEMPLATE_INK: [u8; 3] = [0, 0, 0];
const SQUARE_FILL: [u8; 3] = [59, 130, 246];
const SQUARE_EMPTY: [u8; 3] = [128, 128, 128];

const MASCOT: [&str; MASCOT_ROWS as usize] = [
    "..XXXXXXXX..",
    "..XEXXXXEX..",
    "XXXXXXXXXXXX",
    "XXXXXXXXXXXX",
    "..XXXXXXXX..",
    "..XXXXXXXX..",
    "..X.X..X.X..",
    "..X.X..X.X..",
];

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

#[derive(Clone, Copy)]
struct Mascot {
    x: f64,
    y: f64,
    cell: f64,
    cross_reach: f64,
    cross_half_stroke: f64,
    cross_shift: f64,
}

impl Mascot {
    fn bounds(&self) -> (f64, f64, f64, f64) {
        (
            self.x,
            self.y,
            self.x + MASCOT_COLS as f64 * self.cell,
            self.y + MASCOT_ROWS as f64 * self.cell,
        )
    }

    fn mark_at(&self, px: f64, py: f64) -> Option<u8> {
        let col = ((px - self.x) / self.cell).floor();
        let row = ((py - self.y) / self.cell).floor();
        if col < 0.0 || row < 0.0 || col >= MASCOT_COLS as f64 || row >= MASCOT_ROWS as f64 {
            return None;
        }
        Some(MASCOT[row as usize].as_bytes()[col as usize])
    }

    fn eye_centers(&self) -> Vec<(f64, f64)> {
        let mut centers = Vec::new();
        for (row, line) in MASCOT.iter().enumerate() {
            for (col, mark) in line.bytes().enumerate() {
                if mark == b'E' {
                    centers.push((
                        self.x + (col as f64 + 0.5) * self.cell + self.cross_shift,
                        self.y + (row as f64 + 0.5) * self.cell + self.cross_shift,
                    ));
                }
            }
        }
        centers
    }

    fn in_eye_cross(&self, eyes: &[(f64, f64)], px: f64, py: f64) -> bool {
        let (reach, half_stroke) = (self.cross_reach, self.cross_half_stroke);
        eyes.iter().any(|(cx, cy)| {
            let (dx, dy) = (px - cx, py - cy);
            dx.abs() <= reach
                && dy.abs() <= reach
                && (dx - dy).abs().min((dx + dy).abs()) / std::f64::consts::SQRT_2 <= half_stroke
        })
    }
}

#[derive(Clone, Copy)]
struct MascotStyle {
    fill: [u8; 3],
    empty: [u8; 3],
    crossed_eyes: bool,
}

fn paint_mascot(canvas: &mut Canvas, mascot: Mascot, level: Option<f64>, style: &MascotStyle) {
    let eyes = mascot.eye_centers();
    let crossed = style.crossed_eyes;
    let solid = |x: f64, y: f64| match mascot.mark_at(x, y) {
        Some(b'X') => !(crossed && mascot.in_eye_cross(&eyes, x, y)),
        Some(b'E') => crossed && !mascot.in_eye_cross(&eyes, x, y),
        _ => false,
    };
    canvas.paint(mascot.bounds(), style.empty, TRACK_ALPHA, solid);
    if let Some(value) = normalize_percent(level).filter(|v| *v > 0.0) {
        let (_, top, _, bottom) = mascot.bounds();
        let edge = bottom - (bottom - top) * value / 100.0;
        canvas.paint(mascot.bounds(), style.fill, 1.0, |x, y| {
            y >= edge && solid(x, y)
        });
    }
}

fn is_exhausted(five_hour: Option<f64>, seven_day: Option<f64>) -> bool {
    [five_hour, seven_day]
        .into_iter()
        .any(|value| normalize_percent(value).is_some_and(|v| v >= 100.0))
}

pub fn render_usage_icon(five_hour: Option<f64>, seven_day: Option<f64>, scale: u32) -> UsageIcon {
    let scale = scale.max(1);
    let s = scale as f64;
    let mut canvas = Canvas::new(WIDE_WIDTH * scale, WIDE_HEIGHT * scale);
    let cell = (MASCOT_CELL * scale) as f64;
    let mascot = Mascot {
        x: 0.0,
        y: (WIDE_HEIGHT as f64 * s - MASCOT_ROWS as f64 * cell) / 2.0,
        cell,
        cross_reach: cell * EYE_X_REACH,
        cross_half_stroke: cell * EYE_X_STROKE / 2.0,
        cross_shift: 0.0,
    };
    let mascot_style = MascotStyle {
        fill: TEMPLATE_INK,
        empty: TEMPLATE_INK,
        crossed_eyes: is_exhausted(five_hour, seven_day),
    };
    paint_mascot(&mut canvas, mascot, seven_day, &mascot_style);
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
    let side = SQUARE_SIDE * scale;
    let mut canvas = Canvas::new(side, side);
    let cell = scale as f64;
    let mascot = Mascot {
        x: (side as f64 - MASCOT_COLS as f64 * cell) / 2.0,
        y: (side as f64 - MASCOT_ROWS as f64 * cell) / 2.0,
        cell,
        cross_reach: SQUARE_EYE_X_REACH * cell / 2.0,
        cross_half_stroke: SQUARE_EYE_X_STROKE * cell / 2.0,
        cross_shift: cell / 4.0,
    };
    let style = MascotStyle {
        fill: SQUARE_FILL,
        empty: SQUARE_EMPTY,
        crossed_eyes: is_exhausted(five_hour, seven_day),
    };
    paint_mascot(&mut canvas, mascot, seven_day, &style);
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
        assert_eq!((icon.width, icon.height), (128, 36));
        assert_eq!(icon.rgba.len(), 128 * 36 * 4);
        let single = render_usage_icon(Some(24.0), Some(51.0), 1);
        assert_eq!((single.width, single.height), (64, 18));
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
        assert!(on_edge.iter().any(|alpha| *alpha >= 140), "no stroke");
        assert!(on_edge.contains(&0), "no gap between the strokes");
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
    fn labels_are_painted_opaque_between_mascot_and_bars() {
        let icon = render_usage_icon(Some(0.0), Some(0.0), SCALE);
        let label_pixels = (LABEL_X * SCALE..BAR_X * SCALE - 2)
            .flat_map(|x| (0..icon.height).map(move |y| (x, y)))
            .filter(|(x, y)| column(&icon, *x, *y) == 255)
            .count();
        assert!(label_pixels > 40, "{label_pixels}");
        let mascot_end = MASCOT_COLS * MASCOT_CELL * SCALE;
        let gutter = (mascot_end..LABEL_X * SCALE)
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
    fn square_icon_fills_the_mascot_from_the_bottom_in_blue() {
        let icon = render_usage_icon_square(Some(10.0), Some(50.0), 2);
        let cell = 2;
        let (x0, y0) = (4, 8);
        let sample = |row: u32| {
            let at = (((y0 + row * cell + 1) * 32 + x0 + 4 * cell + 1) * 4) as usize;
            [
                icon.rgba[at],
                icon.rgba[at + 1],
                icon.rgba[at + 2],
                icon.rgba[at + 3],
            ]
        };
        assert_eq!(
            sample(7),
            [SQUARE_FILL[0], SQUARE_FILL[1], SQUARE_FILL[2], 255]
        );
        assert_eq!(
            sample(4),
            [SQUARE_FILL[0], SQUARE_FILL[1], SQUARE_FILL[2], 255]
        );
        let empty = sample(3);
        assert_eq!(empty[..3], SQUARE_EMPTY);
        assert!((85..=95).contains(&empty[3]), "{empty:?}");
        assert!((0..32).all(|x| column(&icon, x, 3) == 0 && column(&icon, x, 29) == 0));
    }

    #[test]
    fn square_icon_marks_exhaustion_and_missing_data_on_the_mascot() {
        let none = render_usage_icon_square(None, None, 2);
        let zero = render_usage_icon_square(Some(0.0), Some(0.0), 2);
        let spent = render_usage_icon_square(Some(100.0), Some(0.0), 2);
        assert_eq!(none.rgba, zero.rgba);
        assert_ne!(spent.rgba, zero.rgba);
        assert_eq!(
            render_usage_icon_square(Some(400.0), Some(-5.0), 2),
            render_usage_icon_square(Some(100.0), Some(0.0), 2)
        );
    }

    fn mascot_cell_center(icon: &UsageIcon, col: u32, row: u32) -> u8 {
        let cell = MASCOT_CELL * SCALE;
        let top = (icon.height - MASCOT_ROWS * cell) / 2;
        column(icon, col * cell + cell / 2, top + row * cell + cell / 2)
    }

    fn eye_cell(which: usize) -> (u32, u32) {
        let mut eyes = Vec::new();
        for (row, line) in MASCOT.iter().enumerate() {
            for (col, mark) in line.bytes().enumerate() {
                if mark == b'E' {
                    eyes.push((col as u32, row as u32));
                }
            }
        }
        eyes[which]
    }

    fn eye_hole_pixels(icon: &UsageIcon, which: usize) -> Vec<(u32, u32)> {
        let cell = MASCOT_CELL * SCALE;
        let top = (icon.height - MASCOT_ROWS * cell) / 2;
        let (col, row) = eye_cell(which);
        let (x0, y0) = (col * cell, top + row * cell);
        let margin = cell;
        let mut holes = Vec::new();
        for y in y0 - margin..y0 + cell + margin {
            for x in x0 - margin..x0 + cell + margin {
                if column(icon, x, y) == 0 {
                    holes.push((x + margin - x0, y + margin - y0));
                }
            }
        }
        holes
    }

    #[test]
    fn mascot_grid_matches_the_reference_silhouette() {
        assert_eq!(MASCOT.len() as u32, MASCOT_ROWS);
        assert!(MASCOT.iter().all(|line| line.len() as u32 == MASCOT_COLS));
        let eyes = MASCOT
            .iter()
            .flat_map(|line| line.bytes())
            .filter(|m| *m == b'E');
        assert_eq!(eyes.count(), 2);
        assert_eq!(MASCOT[2], MASCOT[3]);
        assert_eq!(MASCOT[6], MASCOT[7]);
        assert_eq!(MASCOT[2], "XXXXXXXXXXXX");
        assert_eq!(MASCOT[6].matches('X').count(), 4);
    }

    #[test]
    fn mascot_body_fills_from_the_bottom_in_proportion_to_the_weekly_percent() {
        for percent in [0.0, 25.0, 50.0, 75.0, 100.0] {
            let icon = render_usage_icon(Some(10.0), Some(percent), SCALE);
            for row in 0..MASCOT_ROWS {
                let alpha = mascot_cell_center(&icon, 4, row);
                let filled = f64::from(row) >= f64::from(MASCOT_ROWS) * (1.0 - percent / 100.0);
                if filled {
                    assert_eq!(alpha, 255, "percent={percent} row={row}");
                } else {
                    assert!(
                        (85..=95).contains(&alpha),
                        "percent={percent} row={row} alpha={alpha}"
                    );
                }
            }
        }
    }

    #[test]
    fn mascot_fill_covers_arms_and_legs_at_the_same_height() {
        let half = render_usage_icon(Some(10.0), Some(50.0), SCALE);
        for (col, row) in [(0, 2), (0, 3), (11, 3)] {
            assert!((85..=95).contains(&mascot_cell_center(&half, col, row)));
        }
        for (col, row) in [(2, 6), (9, 7), (4, 4)] {
            assert_eq!(mascot_cell_center(&half, col, row), 255);
        }
        assert_eq!(mascot_cell_center(&half, 3, 7), 0);
        let most = render_usage_icon(Some(10.0), Some(75.0), SCALE);
        assert_eq!(mascot_cell_center(&most, 0, 2), 255);
        assert_eq!(mascot_cell_center(&most, 11, 3), 255);
        assert!((85..=95).contains(&mascot_cell_center(&most, 4, 1)));
    }

    #[test]
    fn mascot_ignores_the_five_hour_value_until_it_runs_out() {
        let width = MASCOT_COLS * MASCOT_CELL * SCALE;
        let mascot_only = |icon: &UsageIcon| -> Vec<u8> {
            (0..icon.height)
                .flat_map(|y| (0..width).map(move |x| (x, y)))
                .map(|(x, y)| column(icon, x, y))
                .collect()
        };
        let low = mascot_only(&render_usage_icon(Some(5.0), Some(50.0), SCALE));
        let high = mascot_only(&render_usage_icon(Some(99.0), Some(50.0), SCALE));
        assert_eq!(low, high);
    }

    #[test]
    fn mascot_without_data_is_fully_translucent_with_plain_eyes() {
        let icon = render_usage_icon(None, None, SCALE);
        for (col, row) in [(4, 0), (0, 2), (11, 3), (2, 6), (9, 7), (6, 4)] {
            let alpha = mascot_cell_center(&icon, col, row);
            assert!((85..=95).contains(&alpha), "{col},{row} alpha={alpha}");
        }
        assert_eq!(
            eye_hole_pixels(&icon, 0).len() as u32,
            MASCOT_CELL * MASCOT_CELL * SCALE * SCALE
        );
    }

    #[test]
    fn mascot_eyes_are_square_holes_below_the_limit() {
        for percents in [
            (Some(99.0), Some(99.0)),
            (Some(0.0), None),
            (None, Some(70.0)),
        ] {
            let icon = render_usage_icon(percents.0, percents.1, SCALE);
            for which in 0..2 {
                let cell = MASCOT_CELL * SCALE;
                let holes = eye_hole_pixels(&icon, which);
                assert_eq!(holes.len() as u32, cell * cell, "{percents:?}");
                assert!(holes
                    .iter()
                    .all(|(x, y)| (cell..2 * cell).contains(x) && (cell..2 * cell).contains(y)));
            }
        }
    }

    #[test]
    fn mascot_eyes_become_crosses_when_the_five_hour_limit_runs_out() {
        let icon = render_usage_icon(Some(100.0), Some(10.0), SCALE);
        assert_cross_eyes(&icon);
    }

    #[test]
    fn mascot_eyes_become_crosses_when_the_weekly_limit_runs_out() {
        let icon = render_usage_icon(Some(40.0), Some(100.0), SCALE);
        assert_cross_eyes(&icon);
        assert_cross_eyes(&render_usage_icon(Some(250.0), None, SCALE));
    }

    fn assert_cross_eyes(icon: &UsageIcon) {
        let cell = MASCOT_CELL * SCALE;
        let margin = cell;
        let span = 2 * margin + cell - 1;
        for which in 0..2 {
            let holes = eye_hole_pixels(icon, which);
            assert!(holes.len() as u32 > cell && (holes.len() as u32) < 3 * cell * cell / 2);
            assert!(
                holes.contains(&(margin - 1, margin - 1)),
                "the X crosses the eye corners"
            );
            assert!(holes.contains(&(margin + 1, margin + 1)));
            assert!(holes.contains(&(margin + 2, margin + 2)));
            assert!(
                !holes.contains(&(margin + 1, margin)),
                "meio da borda superior e corpo"
            );
            assert!(!holes.contains(&(margin + 2, margin)));
            assert!(holes
                .iter()
                .all(|(x, y)| holes.contains(&(span - x, *y)) && holes.contains(&(*x, span - y))));
        }
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
