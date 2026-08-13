import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultEgressPolicy,
  isHostAllowed,
  withAllowlistEntry,
} from './egress-policy.js';

test('default policy denies an arbitrary host', () => {
  const policy = createDefaultEgressPolicy();
  assert.equal(isHostAllowed(policy, 'evil.example.com'), false);
});

test('default policy denies even a well-known non-registry host', () => {
  const policy = createDefaultEgressPolicy();
  assert.equal(isHostAllowed(policy, 'api.github.com'), false);
});

test('default policy allows the pre-approved package registries', () => {
  const policy = createDefaultEgressPolicy();
  assert.equal(isHostAllowed(policy, 'registry.npmjs.org'), true);
  assert.equal(isHostAllowed(policy, 'pypi.org'), true);
});

test('host matching is case-insensitive', () => {
  const policy = createDefaultEgressPolicy();
  assert.equal(isHostAllowed(policy, 'Registry.NPMJS.org'), true);
});

test('withAllowlistEntry adds a named exception without mutating the original policy', () => {
  const base = createDefaultEgressPolicy();
  const extended = withAllowlistEntry(base, {
    host: 'api.example.com',
    reason: 'app depends on it',
  });

  assert.equal(isHostAllowed(base, 'api.example.com'), false, 'original policy must be unchanged');
  assert.equal(isHostAllowed(extended, 'api.example.com'), true);
});

test('an empty/unlisted host never matches by accident', () => {
  const policy = createDefaultEgressPolicy();
  assert.equal(isHostAllowed(policy, ''), false);
});
