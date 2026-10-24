import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectEdition, readingContext } from '../src/data.mjs';

const corpus = JSON.parse(
  await readFile(new URL('./fixtures/editorial.json', import.meta.url), 'utf8'),
);
for (const scenario of corpus.cases) {
  test('editorial: ' + scenario.name, () => {
    const before = structuredClone(scenario.items);
    const edition = selectEdition(scenario.items, Date.parse(corpus.now));
    for (const section of ['news', 'tools'])
      assert.deepEqual(
        edition[section].map((i) => i.id),
        scenario[section],
      );
    assert.deepEqual(scenario.items, before);
  });
}
test('reader guidance never substitutes invented capabilities for the source summary', () => {
  for (const item of corpus.cases.flatMap((c) => c.items)) {
    const before = structuredClone(item);
    const context = readingContext(item);
    assert.equal(context.length, 2);
    assert.ok(context.every((value) => typeof value === 'string' && value.length));
    assert.deepEqual(item, before);
  }
});
