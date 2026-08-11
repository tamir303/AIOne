import { TrustTier } from './types';
import { ActionClass } from './action-class';

export type GateDecision = 'auto' | 'confirm' | 'deny';

export const gatePolicy: Record<ActionClass, Record<TrustTier, GateDecision>> = {
  read: { cautious: 'auto', balanced: 'auto', autonomous: 'auto' },
  file_write: { cautious: 'confirm', balanced: 'auto', autonomous: 'auto' },
  terminal_read: { cautious: 'auto', balanced: 'auto', autonomous: 'auto' },
  terminal_mutating: { cautious: 'confirm', balanced: 'confirm', autonomous: 'auto' },
  git_local: { cautious: 'auto', balanced: 'auto', autonomous: 'auto' },
  push: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  merge: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  registry_push: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  deploy: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  destructive: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
};

export function getDecision(
  actionClass: ActionClass,
  tier: TrustTier,
): GateDecision {
  return gatePolicy[actionClass][tier];
}
