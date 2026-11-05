use crate::platform::{clamp_to_work_area, WorkArea};

pub const MARGIN: i32 = 8;
pub const CURSOR_GAP: i32 = 12;

fn inset(area: WorkArea, margin: i32) -> WorkArea {
    let shrink = |start: i32, end: i32| {
        if end - start > margin * 2 {
            (start + margin, end - margin)
        } else {
            (start, end)
        }
    };
    let (left, right) = shrink(area.left, area.right);
    let (top, bottom) = shrink(area.top, area.bottom);
    WorkArea {
        left,
        top,
        right,
        bottom,
    }
}

fn contains(area: WorkArea, x: i32, y: i32) -> bool {
    x >= area.left && x < area.right && y >= area.top && y < area.bottom
}

pub fn popover_position(
    cursor: Option<(i32, i32)>,
    area: WorkArea,
    width: i32,
    height: i32,
) -> (i32, i32) {
    let safe = inset(area, MARGIN);
    let Some((x, y)) = cursor.filter(|(x, y)| contains(area, *x, *y)) else {
        return clamp_to_work_area(safe.right - width, safe.top, width, height, safe);
    };
    let in_upper_half = y - area.top <= (area.bottom - area.top) / 2;
    let top = if in_upper_half {
        y + CURSOR_GAP
    } else {
        y - CURSOR_GAP - height
    };
    clamp_to_work_area(x - width / 2, top, width, height, safe)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIDTH: i32 = 380;
    const HEIGHT: i32 = 520;
    const SCREEN: WorkArea = WorkArea {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1050,
    };

    #[test]
    fn a_cursor_in_the_upper_half_opens_the_popover_below_it_centered() {
        assert_eq!(
            popover_position(Some((960, 100)), SCREEN, WIDTH, HEIGHT),
            (770, 112)
        );
    }

    #[test]
    fn a_cursor_in_the_lower_half_opens_the_popover_above_it() {
        assert_eq!(
            popover_position(Some((960, 1000)), SCREEN, WIDTH, HEIGHT),
            (770, 468)
        );
    }

    #[test]
    fn the_popover_never_leaves_the_work_area() {
        assert_eq!(
            popover_position(Some((1915, 5)), SCREEN, WIDTH, HEIGHT),
            (1532, 17)
        );
        assert_eq!(
            popover_position(Some((2, 1045)), SCREEN, WIDTH, HEIGHT),
            (8, 513)
        );
    }

    #[test]
    fn a_panel_on_the_edge_of_the_work_area_keeps_its_clearance() {
        let below_a_top_panel = WorkArea { top: 32, ..SCREEN };
        assert_eq!(
            popover_position(Some((1800, 40)), below_a_top_panel, WIDTH, HEIGHT),
            (1532, 52)
        );
        let beside_a_dock = WorkArea { left: 72, ..SCREEN };
        assert_eq!(
            popover_position(Some((80, 500)), beside_a_dock, WIDTH, HEIGHT),
            (80, 512)
        );
    }

    #[test]
    fn a_secondary_monitor_with_negative_coordinates_is_handled() {
        let left = WorkArea {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1050,
        };
        assert_eq!(
            popover_position(Some((-100, 600)), left, WIDTH, HEIGHT),
            (-388, 68)
        );
    }

    #[test]
    fn no_cursor_falls_back_to_the_top_right_corner() {
        assert_eq!(popover_position(None, SCREEN, WIDTH, HEIGHT), (1532, 8));
    }

    #[test]
    fn a_cursor_outside_the_work_area_falls_back_to_the_top_right_corner() {
        assert_eq!(
            popover_position(Some((3000, 200)), SCREEN, WIDTH, HEIGHT),
            (1532, 8)
        );
        assert_eq!(
            popover_position(Some((-5, 200)), SCREEN, WIDTH, HEIGHT),
            (1532, 8)
        );
    }

    #[test]
    fn a_work_area_smaller_than_the_popover_sticks_to_its_top_left_corner() {
        let tiny = WorkArea {
            left: 0,
            top: 0,
            right: 300,
            bottom: 400,
        };
        assert_eq!(
            popover_position(Some((100, 100)), tiny, WIDTH, HEIGHT),
            (8, 8)
        );
        assert_eq!(popover_position(None, tiny, WIDTH, HEIGHT), (8, 8));
    }
}
