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
  plan?: Plan;
  diff?: Diff;
  status: 'planning' | 'awaiting_approval' | 'executing' | 'done' | 'failed';
  approvals: Approval[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Approval {
  id: ApprovalId;
  runId: RunId;
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
