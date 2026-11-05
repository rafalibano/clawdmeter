pub const MARGIN: f64 = 8.0;
const MENU_BAR_BAND: f64 = 64.0;
const EPSILON: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.width <= 0.0 || self.height <= 0.0
    }

    fn max_x(&self) -> f64 {
        self.x + self.width
    }

    fn max_y(&self) -> f64 {
        self.y + self.height
    }

    fn center(&self) -> Point {
        Point {
            x: self.x + self.width / 2.0,
            y: self.y + self.height / 2.0,
        }
    }

    fn contains(&self, point: Point) -> bool {
        point.x >= self.x && point.x < self.max_x() && point.y >= self.y && point.y < self.max_y()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    pub frame: Rect,
    pub visible_frame: Rect,
    pub scale: f64,
    pub aux_top_left: Option<Rect>,
    pub aux_top_right: Option<Rect>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub screen: usize,
    pub icon: Option<Rect>,
}

pub fn icon_rect_in_points(icon: PhysicalRect, scale: f64, primary_height: f64) -> Option<Rect> {
    if scale <= 0.0 || icon.width <= 0.0 || icon.height <= 0.0 {
        return None;
    }
    let height = icon.height / scale;
    Some(Rect::new(
        icon.x / scale,
        primary_height - icon.y / scale - height,
        icon.width / scale,
        height,
    ))
}

pub fn locate(
    icon: Option<PhysicalRect>,
    pointer: Option<Point>,
    primary_height: f64,
    screens: &[Screen],
    main: usize,
) -> Placement {
    let pointer_screen = pointer.and_then(|p| screens.iter().position(|s| s.frame.contains(p)));
    let candidates = pointer_screen
        .into_iter()
        .chain((0..screens.len()).filter(|i| Some(*i) != pointer_screen));
    if let Some(icon) = icon {
        for index in candidates {
            let screen = &screens[index];
            if let Some(rect) = icon_rect_in_points(icon, screen.scale, primary_height) {
                if screen.frame.contains(rect.center()) {
                    return Placement {
                        screen: index,
                        icon: Some(rect),
                    };
                }
            }
        }
    }
    Placement {
        screen: main.min(screens.len().saturating_sub(1)),
        icon: None,
    }
}

pub fn notch_span(screen: &Screen) -> Option<(f64, f64)> {
    let (left, right) = (screen.aux_top_left?, screen.aux_top_right?);
    if left.is_empty() || right.is_empty() {
        return None;
    }
    let frame = screen.frame;
    let screen_local = left.x < frame.x - EPSILON || right.max_x() > frame.max_x() + EPSILON;
    let offset = if screen_local { frame.x } else { 0.0 };
    let (start, end) = (left.max_x() + offset, right.x + offset);
    (end > start).then_some((start, end))
}

pub fn icon_is_hidden(icon: Rect, screen: &Screen) -> bool {
    let center = icon.center();
    icon.is_empty()
        || !screen.frame.contains(center)
        || center.y < screen.frame.max_y() - MENU_BAR_BAND
        || notch_span(screen).is_some_and(|(start, end)| icon.max_x() > start && icon.x < end)
}

pub fn popover_origin(icon: Option<Rect>, screen: &Screen, width: f64, height: f64) -> Point {
    let visible = screen.visible_frame;
    let min_x = visible.x + MARGIN;
    let max_x = (visible.max_x() - MARGIN - width).max(min_x);
    let anchor = icon.filter(|rect| !icon_is_hidden(*rect, screen));
    let top = anchor.map_or(visible.max_y(), |rect| rect.y.min(visible.max_y()));
    let x = anchor.map_or(max_x, |rect| {
        avoid_notch(
            rect.center().x - width / 2.0,
            width,
            min_x,
            max_x,
            notch_span(screen),
        )
    });
    let y = (top - height)
        .max(visible.y + MARGIN)
        .min(visible.max_y() - height);
    Point { x, y }
}

fn avoid_notch(
    centered: f64,
    width: f64,
    min_x: f64,
    max_x: f64,
    notch: Option<(f64, f64)>,
) -> f64 {
    let x = centered.clamp(min_x, max_x);
    let Some((start, end)) = notch else {
        return x;
    };
    if x + width <= start - MARGIN || x >= end + MARGIN {
        return x;
    }
    let right = end + MARGIN;
    if right <= max_x {
        return right;
    }
    let left = start - MARGIN - width;
    if left >= min_x {
        return left;
    }
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIDTH: f64 = 380.0;
    const HEIGHT: f64 = 520.0;

    fn notched_laptop() -> Screen {
        Screen {
            frame: Rect::new(0.0, 0.0, 1512.0, 982.0),
            visible_frame: Rect::new(0.0, 0.0, 1512.0, 945.0),
            scale: 2.0,
            aux_top_left: Some(Rect::new(0.0, 950.0, 664.0, 32.0)),
            aux_top_right: Some(Rect::new(848.0, 950.0, 664.0, 32.0)),
        }
    }

    fn external_display() -> Screen {
        Screen {
            frame: Rect::new(0.0, 0.0, 1920.0, 1080.0),
            visible_frame: Rect::new(0.0, 0.0, 1920.0, 1055.0),
            scale: 1.0,
            aux_top_left: None,
            aux_top_right: None,
        }
    }

    fn menu_bar_icon(screen: &Screen, x: f64) -> Rect {
        Rect::new(x, screen.visible_frame.max_y() + 1.0, 64.0, 24.0)
    }

    #[test]
    fn without_notch_the_popover_is_centered_below_the_icon() {
        let screen = external_display();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 1500.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(
            origin,
            Point {
                x: 1342.0,
                y: 535.0
            }
        );
    }

    #[test]
    fn icon_right_of_the_notch_keeps_the_popover_clear_of_it() {
        let screen = notched_laptop();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 860.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(origin, Point { x: 856.0, y: 425.0 });
    }

    #[test]
    fn icon_far_right_of_the_notch_stays_centered() {
        let screen = notched_laptop();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 1100.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(origin.x, 942.0);
    }

    #[test]
    fn popover_that_would_cross_the_notch_moves_right_of_it() {
        let screen = notched_laptop();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 560.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(origin.x, 856.0);
    }

    #[test]
    fn popover_moves_left_of_the_notch_when_the_right_side_has_no_room() {
        let screen = Screen {
            aux_top_left: Some(Rect::new(0.0, 950.0, 1100.0, 32.0)),
            aux_top_right: Some(Rect::new(1284.0, 950.0, 228.0, 32.0)),
            ..notched_laptop()
        };
        let origin = popover_origin(Some(menu_bar_icon(&screen, 1300.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(origin.x, 712.0);
    }

    #[test]
    fn icon_behind_the_notch_opens_right_aligned_below_the_menu_bar() {
        let screen = notched_laptop();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 700.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(
            origin,
            Point {
                x: 1124.0,
                y: 425.0
            }
        );
    }

    #[test]
    fn missing_empty_or_offscreen_icon_opens_right_aligned() {
        let screen = notched_laptop();
        let expected = Point {
            x: 1124.0,
            y: 425.0,
        };
        for icon in [
            None,
            Some(Rect::new(0.0, 0.0, 0.0, 0.0)),
            Some(Rect::new(-500.0, 958.0, 64.0, 24.0)),
            Some(Rect::new(1000.0, 400.0, 64.0, 24.0)),
        ] {
            assert_eq!(popover_origin(icon, &screen, WIDTH, HEIGHT), expected);
        }
    }

    #[test]
    fn popover_is_clamped_to_the_right_edge() {
        let screen = external_display();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 1880.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(origin.x, 1920.0 - MARGIN - WIDTH);
    }

    #[test]
    fn popover_is_clamped_to_the_left_edge() {
        let screen = external_display();
        let origin = popover_origin(Some(menu_bar_icon(&screen, 0.0)), &screen, WIDTH, HEIGHT);
        assert_eq!(origin.x, MARGIN);
    }

    #[test]
    fn popover_never_rises_above_the_visible_frame() {
        let screen = external_display();
        let tall = popover_origin(None, &screen, WIDTH, 2000.0);
        assert_eq!(tall.y, 1055.0 - 2000.0);
    }

    #[test]
    fn physical_tray_rect_converts_to_cocoa_points() {
        let icon = PhysicalRect {
            x: 2600.0,
            y: 0.0,
            width: 128.0,
            height: 48.0,
        };
        assert_eq!(
            icon_rect_in_points(icon, 2.0, 982.0),
            Some(Rect::new(1300.0, 958.0, 64.0, 24.0))
        );
        assert_eq!(icon_rect_in_points(icon, 0.0, 982.0), None);
    }

    #[test]
    fn notch_span_accepts_screen_local_auxiliary_areas() {
        let screen = Screen {
            frame: Rect::new(-1512.0, 200.0, 1512.0, 982.0),
            visible_frame: Rect::new(-1512.0, 200.0, 1512.0, 945.0),
            ..notched_laptop()
        };
        assert_eq!(notch_span(&screen), Some((-848.0, -664.0)));
        assert_eq!(notch_span(&notched_laptop()), Some((664.0, 848.0)));
        assert_eq!(notch_span(&external_display()), None);
    }

    fn side_by_side() -> [Screen; 2] {
        let secondary = Screen {
            frame: Rect::new(1512.0, -98.0, 1920.0, 1080.0),
            visible_frame: Rect::new(1512.0, -98.0, 1920.0, 1055.0),
            ..external_display()
        };
        [notched_laptop(), secondary]
    }

    #[test]
    fn icon_on_a_secondary_screen_without_notch_is_centered_there() {
        let screens = side_by_side();
        let icon = PhysicalRect {
            x: 3200.0,
            y: 0.0,
            width: 64.0,
            height: 24.0,
        };
        let placement = locate(Some(icon), None, 982.0, &screens, 0);
        assert_eq!(placement.screen, 1);
        let screen = &screens[placement.screen];
        let origin = popover_origin(placement.icon, screen, WIDTH, HEIGHT);
        assert_eq!(
            origin,
            Point {
                x: 3042.0,
                y: 437.0
            }
        );
    }

    #[test]
    fn pointer_disambiguates_screens_with_different_scales() {
        let screens = side_by_side();
        let icon = PhysicalRect {
            x: 2600.0,
            y: 0.0,
            width: 128.0,
            height: 48.0,
        };
        let on_laptop = locate(
            Some(icon),
            Some(Point {
                x: 1320.0,
                y: 970.0,
            }),
            982.0,
            &screens,
            1,
        );
        assert_eq!(on_laptop.screen, 0);
        assert_eq!(on_laptop.icon, Some(Rect::new(1300.0, 958.0, 64.0, 24.0)));
        let on_external = locate(
            Some(icon),
            Some(Point {
                x: 2650.0,
                y: 960.0,
            }),
            982.0,
            &screens,
            0,
        );
        assert_eq!(on_external.screen, 1);
        assert_eq!(
            on_external.icon,
            Some(Rect::new(2600.0, 934.0, 128.0, 48.0))
        );
    }

    #[test]
    fn shortcut_without_icon_falls_back_to_the_main_screen() {
        let screens = side_by_side();
        let placement = locate(None, Some(Point { x: 100.0, y: 100.0 }), 982.0, &screens, 1);
        assert_eq!(
            placement,
            Placement {
                screen: 1,
                icon: None
            }
        );
        let origin = popover_origin(placement.icon, &screens[1], WIDTH, HEIGHT);
        assert_eq!(
            origin,
            Point {
                x: 3044.0,
                y: 437.0
            }
        );
    }
}
