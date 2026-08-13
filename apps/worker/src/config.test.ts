import { describe, it, expect } from 'vitest';
import {
  getIdleTimeout,
  getCostQuota,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_COST_QUOTA_TOKENS,
} from './config.js';

describe('config', () => {
  describe('getIdleTimeout', () => {
    it('falls back to the default when the field is absent (undefined)', () => {
      expect(getIdleTimeout(undefined)).toBe(DEFAULT_IDLE_TIMEOUT_MINUTES);
    });

    it('respects an explicit null as "no timeout" rather than falling back to the default', () => {
      expect(getIdleTimeout(null)).toBeNull();
    });

    it('passes an explicit override through unchanged', () => {
      expect(getIdleTimeout(15)).toBe(15);
    });
  });

  describe('getCostQuota', () => {
    it('falls back to the default when the field is absent (undefined)', () => {
      const expected =
        DEFAULT_COST_QUOTA_TOKENS === null ? null : BigInt(DEFAULT_COST_QUOTA_TOKENS);
      expect(getCostQuota(undefined)).toBe(expected);
    });

    it('respects an explicit null as "unlimited" rather than falling back to the default', () => {
      expect(getCostQuota(null)).toBeNull();
    });

    it('passes an explicit override through unchanged', () => {
      const quota = BigInt(5000);
      expect(getCostQuota(quota)).toBe(quota);
    });
  });
});
