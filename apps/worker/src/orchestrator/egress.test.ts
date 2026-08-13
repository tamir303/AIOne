import { describe, it, expect } from 'vitest';
import { EgressDeniedError } from '@aione/utils';
import { resolveEgressPolicy, enforceEgress } from './egress.js';

describe('enforceEgress', () => {
  it('denies an arbitrary host by default', () => {
    const policy = resolveEgressPolicy();
    expect(() => enforceEgress(policy, 'attacker.example.com')).toThrow(EgressDeniedError);
  });

  it('denies even without any extra allowlist entries passed', () => {
    const policy = resolveEgressPolicy([]);
    expect(() => enforceEgress(policy, 'api.internal.example.com')).toThrow(EgressDeniedError);
  });

  it('still allows the pre-approved package registries', () => {
    const policy = resolveEgressPolicy();
    expect(() => enforceEgress(policy, 'registry.npmjs.org')).not.toThrow();
  });

  it('honors explicit extra allowlist entries', () => {
    const policy = resolveEgressPolicy([{ host: 'api.example.com', reason: 'app dependency' }]);
    expect(() => enforceEgress(policy, 'api.example.com')).not.toThrow();
    // Everything else is still denied - the extra entry is additive, not a mode switch.
    expect(() => enforceEgress(policy, 'other.example.com')).toThrow(EgressDeniedError);
  });

  it('EgressDeniedError carries the denied host for the caller/UI to display', () => {
    const policy = resolveEgressPolicy();
    expect(() => enforceEgress(policy, 'blocked.example.com')).toThrow(/blocked\.example\.com/);
  });
});
