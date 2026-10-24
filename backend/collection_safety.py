"""Shared D1 leases and upstream cooldowns; no schema changes or process-local locks."""
import time
import uuid
from urllib.parse import urlsplit

from db import db_all, db_run, get_meta

LOCK_TTL_MS = 30 * 60 * 1000
COLLECTION_TIMEOUT_SECONDS = 14 * 60
MANUAL_INTERVAL_MS = 15 * 60 * 1000
UPSTREAM_COOLDOWN_MS = 24 * 60 * 60 * 1000


def clock_ms():
    return int(time.time() * 1000)


def retry_seconds(until):
    return max(1, (until - clock_ms() + 999) // 1000)


async def window_end(env, key):
    raw = await get_meta(env, key, '0')
    return int(raw.split(':', 1)[0])


async def claim_window(env, key, duration_ms):
    now = clock_ms()
    value = str(now + duration_ms) + ':' + uuid.uuid4().hex
    # One atomic statement: concurrent Worker isolates cannot both win.
    rows = await db_all(
        env,
        'INSERT INTO meta (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value '
        'WHERE CAST(meta.value AS INTEGER) <= ? RETURNING value',
        (key, value, now),
    )
    return value if rows else None


async def release_window(env, key, value):
    # An expired owner must never delete a newer owner's lease.
    await db_run(env, 'DELETE FROM meta WHERE key = ? AND value = ?', (key, value))


def upstream_key(url):
    # Share cooldown across all feeds/endpoints on the same upstream host.
    return 'upstream_cooldown:' + (urlsplit(url).hostname or '')


async def check_upstream(env, url):
    until = await window_end(env, upstream_key(url))
    return until if until > clock_ms() else None


async def cool_upstream(env, url, delay_ms, status):
    until = clock_ms() + max(UPSTREAM_COOLDOWN_MS, delay_ms)
    value = str(until) + ':' + str(status)
    await db_run(
        env,
        'INSERT INTO meta (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value '
        'WHERE CAST(excluded.value AS INTEGER) > CAST(meta.value AS INTEGER)',
        (upstream_key(url), value),
    )
    print('collection alert:', urlsplit(url).hostname, 'HTTP', status, 'paused until', until)
    return until
