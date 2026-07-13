use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn intersects(left: Rect, right: Rect) -> bool {
    let left_right = i64::from(left.x) + i64::from(left.width);
    let left_bottom = i64::from(left.y) + i64::from(left.height);
    let right_right = i64::from(right.x) + i64::from(right.width);
    let right_bottom = i64::from(right.y) + i64::from(right.height);
    i64::from(left.x) < right_right
        && left_right > i64::from(right.x)
        && i64::from(left.y) < right_bottom
        && left_bottom > i64::from(right.y)
}

fn constrain(window: Rect, monitors: &[Rect], primary: Option<usize>, min_size: (u32, u32)) -> Option<Rect> {
    if monitors.is_empty() {
        return None;
    }
    let intersecting = monitors.iter().position(|monitor| intersects(window, *monitor));
    let monitor = monitors[intersecting.or(primary).unwrap_or(0).min(monitors.len() - 1)];
    let width = window.width.clamp(min_size.0.min(monitor.width), monitor.width);
    let height = window.height.clamp(min_size.1.min(monitor.height), monitor.height);
    let (x, y) = if intersecting.is_some() {
        (
            window.x.clamp(monitor.x, monitor.x.saturating_add_unsigned(monitor.width - width)),
            window.y.clamp(monitor.y, monitor.y.saturating_add_unsigned(monitor.height - height)),
        )
    } else {
        (
            monitor.x.saturating_add_unsigned((monitor.width - width) / 2),
            monitor.y.saturating_add_unsigned((monitor.height - height) / 2),
        )
    };
    Some(Rect { x, y, width, height })
}

pub fn ensure_visible(window: &WebviewWindow) -> tauri::Result<()> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let monitors = window
        .available_monitors()?
        .into_iter()
        .map(|monitor| Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect::<Vec<_>>();
    let primary_position = window.primary_monitor()?.map(|monitor| *monitor.position());
    let primary = primary_position
        .and_then(|position| monitors.iter().position(|monitor| monitor.x == position.x && monitor.y == position.y));
    let scale = window.scale_factor()?;
    let min_size = ((900.0 * scale).round() as u32, (600.0 * scale).round() as u32);
    let Some(safe) = constrain(
        Rect { x: position.x, y: position.y, width: size.width, height: size.height },
        &monitors,
        primary,
        min_size,
    ) else {
        return Ok(());
    };

    if safe.width != size.width || safe.height != size.height {
        window.set_size(PhysicalSize::new(safe.width, safe.height))?;
    }
    if safe.x != position.x || safe.y != position.y {
        window.set_position(PhysicalPosition::new(safe.x, safe.y))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{constrain, Rect};

    #[test]
    fn centers_offscreen_window_on_primary_monitor() {
        let monitors =
            [Rect { x: 0, y: 0, width: 1920, height: 1080 }, Rect { x: -1280, y: 0, width: 1280, height: 1024 }];
        let result =
            constrain(Rect { x: 2500, y: 100, width: 1280, height: 800 }, &monitors, Some(0), (900, 600)).unwrap();
        assert_eq!(result, Rect { x: 320, y: 140, width: 1280, height: 800 });
    }

    #[test]
    fn preserves_window_on_negative_coordinate_monitor() {
        let monitors = [Rect { x: -1920, y: -200, width: 1920, height: 1080 }];
        let result =
            constrain(Rect { x: -1800, y: -100, width: 1000, height: 700 }, &monitors, Some(0), (900, 600)).unwrap();
        assert_eq!(result, Rect { x: -1800, y: -100, width: 1000, height: 700 });
    }

    #[test]
    fn clamps_oversized_and_partially_visible_window() {
        let monitors = [Rect { x: 0, y: 0, width: 1366, height: 768 }];
        let result =
            constrain(Rect { x: 1300, y: 700, width: 3000, height: 2000 }, &monitors, Some(0), (900, 600)).unwrap();
        assert_eq!(result, Rect { x: 0, y: 0, width: 1366, height: 768 });
    }

    #[test]
    fn uses_entire_small_monitor_instead_of_impossible_minimum() {
        let monitors = [Rect { x: 0, y: 0, width: 800, height: 500 }];
        let result = constrain(Rect { x: 20, y: 20, width: 400, height: 300 }, &monitors, Some(0), (900, 600)).unwrap();
        assert_eq!(result, Rect { x: 0, y: 0, width: 800, height: 500 });
    }

    #[test]
    fn applies_scaled_minimum_size_for_high_dpi_monitor() {
        let monitors = [Rect { x: 0, y: 0, width: 2560, height: 1600 }];
        let result =
            constrain(Rect { x: 100, y: 100, width: 1000, height: 700 }, &monitors, Some(0), (1800, 1200)).unwrap();
        assert_eq!(result, Rect { x: 100, y: 100, width: 1800, height: 1200 });
    }
}
