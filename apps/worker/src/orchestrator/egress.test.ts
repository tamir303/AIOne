import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EgressDeniedError } from '@aione/utils';
import { resolveEgressPolicy, enforceEgress } from './egress.js';

test('default resolved policy denies an arbitrary host', () => {
  const policy = resolveEgressPolicy();
  assert.throws(() => enforceEgress(policy, 'attacker.example.com'), EgressDeniedError);
});

test('default resolved policy denies even without any extra allowlist entries passed', () => {
  const policy = resolveEgressPolicy([]);
  assert.throws(() => enforceEgress(policy, 'api.internal.example.com'), EgressDeniedError);
});

test('resolved policy still allows the pre-approved package registries', () => {
  const policy = resolveEgressPolicy();
  assert.doesNotThrow(() => enforceEgress(policy, 'registry.npmjs.org'));
});

test('resolveEgressPolicy honors explicit extra allowlist entries', () => {
  const policy = resolveEgressPolicy([{ host: 'api.example.com', reason: 'app dependency' }]);
  assert.doesNotThrow(() => enforceEgress(policy, 'api.example.com'));
  // Everything else is still denied - the extra entry is additive, not a mode switch.
  assert.throws(() => enforceEgress(policy, 'other.example.com'), EgressDeniedError);
});

test('EgressDeniedError carries the denied host for the caller/UI to display', () => {
  const policy = resolveEgressPolicy();
  try {
    enforceEgress(policy, 'blocked.example.com');
    assert.fail('expected enforceEgress to throw');
  } catch (error) {
    assert.ok(error instanceof EgressDeniedError);
    assert.match((error as Error).message, /blocked\.example\.com/);
  }
});
