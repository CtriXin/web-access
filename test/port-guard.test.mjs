import assert from 'node:assert/strict';
import test from 'node:test';

import { pausedRequestFailCommand, portGuardPatterns } from '../scripts/port-guard.mjs';

test('paused probe is failed on the session carried at the message top level (flatten mode)', () => {
  // Shape of a real flattened CDP event: params has no sessionId.
  const msg = {
    method: 'Fetch.requestPaused',
    params: { requestId: 'interception-job-1.0', request: { url: 'http://127.0.0.1:9222/json/version' } },
    sessionId: 'SESSION-A',
  };
  assert.deepEqual(pausedRequestFailCommand(msg), {
    method: 'Fetch.failRequest',
    params: { requestId: 'interception-job-1.0', errorReason: 'ConnectionRefused' },
    sessionId: 'SESSION-A',
  });
});

test('a sessionId inside params is not trusted; top-level sessionId wins', () => {
  const msg = {
    method: 'Fetch.requestPaused',
    params: { requestId: 'r1', sessionId: 'WRONG' },
    sessionId: 'RIGHT',
  };
  assert.equal(pausedRequestFailCommand(msg).sessionId, 'RIGHT');
});

test('non-paused events and malformed paused events are ignored', () => {
  assert.equal(pausedRequestFailCommand(null), null);
  assert.equal(pausedRequestFailCommand({ method: 'Target.attachedToTarget', params: {} }), null);
  assert.equal(pausedRequestFailCommand({ method: 'Fetch.requestPaused', params: { requestId: 'r1' } }), null);
  assert.equal(pausedRequestFailCommand({ method: 'Fetch.requestPaused', params: {}, sessionId: 'S' }), null);
});

test('port guard only intercepts the browser debug port on loopback', () => {
  assert.deepEqual(portGuardPatterns(9555), [
    { urlPattern: 'http://127.0.0.1:9555/*', requestStage: 'Request' },
    { urlPattern: 'http://localhost:9555/*', requestStage: 'Request' },
  ]);
});
