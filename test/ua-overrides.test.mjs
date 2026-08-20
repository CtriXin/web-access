import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOBILE_USER_AGENT,
  clearUaOverride,
  mobileUaOverride,
} from '../scripts/ua-overrides.mjs';

test('mobile UA override carries an iPhone UA and mobile client hints', () => {
  const override = mobileUaOverride('Chrome/150.0.7871.101');
  assert.equal(override.userAgent, MOBILE_USER_AGENT);
  assert.match(override.userAgent, /iPhone/);
  assert.match(override.userAgent, /Mobile/);
  assert.equal(override.platform, 'iPhone');
  assert.equal(override.userAgentMetadata.mobile, true);
  assert.equal(override.userAgentMetadata.platform, 'iOS');
  assert.deepEqual(override.userAgentMetadata.brands, [{ brand: 'Chromium', version: '150' }]);
  assert.deepEqual(override.userAgentMetadata.fullVersionList, [
    { brand: 'Chromium', version: '150.0.7871.101' },
  ]);
  assert.equal(override.userAgentMetadata.uaFullVersion, '150.0.7871.101');
});

test('mobile UA override tolerates a missing product without crashing', () => {
  for (const product of [null, undefined, '', 'weird']) {
    const override = mobileUaOverride(product);
    assert.equal(override.userAgent, MOBILE_USER_AGENT);
    assert.equal(override.userAgentMetadata.mobile, true);
    assert.deepEqual(override.userAgentMetadata.brands, []);
    assert.deepEqual(override.userAgentMetadata.fullVersionList, []);
  }
});

test('clearing the UA override restores the browser default UA', () => {
  assert.deepEqual(clearUaOverride(), { userAgent: '' });
});
