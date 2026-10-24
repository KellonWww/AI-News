"""Cycle-wrap digest: daily snapshot → editor's note → email.

Fires once per 18-source cycle wrap (≈ Beijing 08:05). Each step is
independently guarded: a broken snapshot must not cost the email, and a
broken email must never look like a collection failure.
"""
import json
from datetime import datetime, timezone

import ai as ai_module
from db import db_all, db_first, db_run, set_meta
from util import now_iso
from editorial import select_edition

BEIJING_MS = 8 * 3600000


def _beijing(now_ms):
    return datetime.fromtimestamp((now_ms + BEIJING_MS) / 1000, tz=timezone.utc)


async def _edition(env, now_ms):
    # Reuse the public contract so frontend, archive and AI note agree on eligibility.
    from api import load_all_items

    return select_edition(await load_all_items(env), now_ms)


def _headline(item):
    return {key: item[key] for key in ('title', 'url', 'sourceName')}


async def write_daily_snapshot(env, now_ms):
    """Upsert today's front page into daily_snapshots (idempotent per day)."""
    date = _beijing(now_ms).strftime('%Y-%m-%d')
    total = await db_first(env, 'SELECT COUNT(*) AS n FROM items')
    source_rows = await db_all(env, 'SELECT status FROM sources')
    edition = await _edition(env, now_ms)
    payload = json.dumps(
        {
            'date': date,
            'selectionVersion': 1,
            'generatedAt': now_iso(now_ms),
            'stats': {
                'items': total['n'] if total else 0,
                'okSources': sum(1 for row in source_rows if row['status'] == 'ok'),
                'totalSources': len(source_rows),
            },
            'lead': [_headline(item) for item in edition['news']],
            'trending': [_headline(item) for item in edition['tools']],
        },
        ensure_ascii=False,
        separators=(',', ':'),
    )
    await db_run(
        env,
        'INSERT INTO daily_snapshots (date, generated_at, payload) VALUES (?, ?, ?) '
        'ON CONFLICT(date) DO UPDATE SET generated_at = excluded.generated_at, '
        'payload = excluded.payload',
        (date, now_iso(now_ms), payload),
    )
    return {'ok': True, 'date': date}


async def generate_editor_note(env, now_ms):
    """Draft + store today's note. Clears stale notes so yesterday's edition
    never ships under today's masthead."""
    date = _beijing(now_ms).strftime('%Y-%m-%d')
    edition = await _edition(env, now_ms)
    titles = [('【社区内容，未核实】' if any(tag in item.get('tags', []) for tag in ('社区讨论', '社区文章')) else '') + item['title']
              for item in edition['news']]
    text = await ai_module.editor_note(env, titles)
    if text:
        await set_meta(env, 'editor_note', json.dumps(
            {'date': date, 'text': text}, ensure_ascii=False, separators=(',', ':')
        ))
        return {'ok': True, 'date': date}
    await set_meta(env, 'editor_note', '')
    return {'ok': False, 'skipped': True}


async def run_digest(env, now_ms):
    status = {}
    try:
        status['snapshot'] = await write_daily_snapshot(env, now_ms)
    except Exception as error:  # noqa: BLE001 — snapshot is best-effort
        print('daily snapshot failed:', error)
        status['snapshot'] = {'ok': False, 'error': str(error)[:200]}

    try:
        status['editorNote'] = await generate_editor_note(env, now_ms)
    except Exception as error:  # noqa: BLE001 — note is best-effort
        print('editor note failed:', error)
        try:
            await set_meta(env, 'editor_note', '')
        except Exception:  # noqa: BLE001 — even cleanup is best-effort
            pass
        status['editorNote'] = {'ok': False, 'error': str(error)[:200]}

    # Mail last, so this edition already carries the fresh note + snapshot.
    try:
        from notify import send_daily_report  # lazy: tests monkeypatch notify.send_daily_report

        status['mail'] = await send_daily_report(env, now_ms)
    except Exception as error:  # noqa: BLE001 — email problems ≠ collection problems
        print('daily report failed:', error)
        status['mail'] = {'ok': False, 'error': str(error)[:200]}
    return status
