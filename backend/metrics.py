"""Shared reporting metrics for snapshots, charts, and email digests."""

from db import db_first

DAILY_WINDOW_MS = 24 * 60 * 60 * 1000


async def item_counts(env, now_ms):
    """Return trailing-24-hour activity and the current retained inventory."""
    row = await db_first(
        env,
        'SELECT COUNT(*) AS retained_items, '
        'SUM(CASE WHEN item_ts >= ? AND item_ts <= ? THEN 1 ELSE 0 END) AS daily_items '
        'FROM items',
        (now_ms - DAILY_WINDOW_MS, now_ms),
    )
    return {
        'dailyItems': int((row or {}).get('daily_items') or 0),
        'retainedItems': int((row or {}).get('retained_items') or 0),
    }


def snapshot_daily_items(stats):
    """Read the explicit daily count; legacy snapshots only contain inventory."""
    if not isinstance(stats, dict) or 'dailyItems' not in stats:
        return None
    try:
        return max(0, int(stats['dailyItems']))
    except (TypeError, ValueError):
        return None
