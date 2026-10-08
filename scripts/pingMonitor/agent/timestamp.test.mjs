import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestampResult, combineResponses } from './timestamp.mjs';

test('counts overlapping responses once and adds timestamp-only targets', () => {
  const result = combineResponses(['a', 'b', 'c'], new Set(['a']), new Set(['a', 'b']), new Set(['b', 'c', 'outside']));
  assert.deepEqual(result, { alive: ['a', 'b', 'c'], timestampOnly: 1, method: 'icmp+tcp+timestamp' });
});
test('a failed helper preserves legacy counts and records the legacy method', () => {
  assert.deepEqual(combineResponses(['a'], new Set(), new Set(['a']), null),
    { alive: ['a'], timestampOnly: 0, method: 'icmp+tcp' });
});
test('a successful empty timestamp result differs from failure', () => {
  assert.equal(combineResponses(['a'], new Set(), new Set(), new Set()).method, 'icmp+tcp+timestamp');
});
test('rejects incomplete, malformed and out-of-range helper results', () => {
  const valid = { aliveIps: ['a'], targetCount: 2, sentCount: 3 };
  assert.deepEqual([...parseTimestampResult(JSON.stringify(valid), ['a', 'b'])], ['a']);
  for (const bad of [{...valid, targetCount: 1}, {...valid, aliveIps: ['outside']}, {...valid, sentCount: 0}, {...valid, sentCount: 5}]) {
    assert.throws(() => parseTimestampResult(JSON.stringify(bad), ['a', 'b']));
  }
  assert.throws(() => parseTimestampResult('bad json', ['a']));
});
