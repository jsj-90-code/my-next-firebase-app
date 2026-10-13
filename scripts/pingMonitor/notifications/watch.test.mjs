import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingEvents, reportPrompt } from './watch.mjs';

test('only new completion/candidate events request a report', () => {
  const snapshot = { events: [{ id: 'candidate:a' }, { id: 'complete:b' }] };
  assert.deepEqual(pendingEvents(snapshot, ['candidate:a']), [{ id: 'complete:b' }]);
  assert.deepEqual(pendingEvents(snapshot, ['candidate:a', 'complete:b']), []);
  assert.deepEqual(pendingEvents({events: []}, []), []);
});
test('notification does not equate a connection candidate with utilization verification', () => {
  const prompt = reportPrompt([{ id: 'candidate:a', name: '매장' }]);
  assert.ok(prompt.includes('전체 가동률 검증 완료를 구분'));
  assert.ok(prompt.includes('중복 시작하거나 운영 데이터를 변경하지'));
  assert.ok(prompt.includes('candidate:a'));
});
