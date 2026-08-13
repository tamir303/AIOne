export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type RunId = string & { readonly __brand: 'RunId' };
export type ApprovalId = string & { readonly __brand: 'ApprovalId' };

export type TrustTier = 'cautious' | 'balanced' | 'autonomous';

export interface Workspace {
  id: WorkspaceId;
  userId: string;
  name: string;
  createdAt: Date;
}

export interface Project {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  trustTier: TrustTier;
  createdAt: Date;
}

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  createdAt: Date;
}

export interface Plan {
  steps: Array<{ role: string; description: string }>;
  rationale: string;
}

export interface Diff {
  files: Array<{ path: string; added: number; removed: number }>;
  summary: string;
}

export interface Run {
  id: RunId;
  sessionId: SessionId;
  agent: 'orchestrator' | 'frontend' | 'backend' | 'devops' | 'fullstack';
  // The user's original prompt, persisted at Run-creation time so
  // planFromPrompt() has the real input to generate a plan from rather than
  // a hardcoded stub — see apps/worker/src/orchestrator/index.ts.
  prompt: string;
  plan?: Plan;
  diff?: Diff;
  status: 'planning' | 'awaiting_approval' | 'executing' | 'done' | 'failed' | 'rejected';
  approvals: Approval[];
  createdAt: Date;
  updatedAt: Date;
}

// The review checkpoint a decision belongs to. 'plan-review' and
// 'diff-review' are the two gates the vertical slice's Run loop pauses at;
// future gates (e.g. a push or deploy review) extend this rather than reuse
// one of these two.
export type ReviewGate = 'plan-review' | 'diff-review';

export interface Approval {
  id: ApprovalId;
  runId: RunId;
  gate: ReviewGate;
  actionClass: string;
  actionSummary: string;
  decision: 'approved' | 'rejected';
  tier: TrustTier;
  reason?: string;
  decidedAt: Date;
}

export interface Deployment {
  id: string;
  runId: RunId;
  environment: 'preview' | 'staging' | 'production';
  status: 'pending' | 'in_progress' | 'success' | 'failed';
  createdAt: Date;
}
