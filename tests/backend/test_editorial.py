"""Shared editorial corpus must agree with the browser's deterministic selection."""
import copy
import json
from pathlib import Path

import pytest
from editorial import select_edition
from util import epoch_ms

CORPUS = json.loads((Path(__file__).parents[1] / 'fixtures' / 'editorial.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('scenario', CORPUS['cases'], ids=lambda c: c['name'])
def test_shared_editorial_policy(scenario):
    before = copy.deepcopy(scenario['items'])
    edition = select_edition(scenario['items'], epoch_ms(CORPUS['now']))
    for section in ('news', 'tools'):
        assert [item['id'] for item in edition[section]] == scenario[section]
    assert scenario['items'] == before
