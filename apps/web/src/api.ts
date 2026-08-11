import { Run, Approval, Workspace, Project } from '@aione/core';

function authHeaders(token: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function listWorkspaces(token: string): Promise<Workspace[]> {
  const res = await fetch('/api/workspaces', { headers: authHeaders(token) });
  return res.json();
}

export async function createWorkspace(token: string, name: string): Promise<Workspace> {
  const res = await fetch('/api/workspaces', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function listProjects(token: string, workspaceId: string): Promise<Project[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/projects`, { headers: authHeaders(token) });
  return res.json();
}

export async function createProject(token: string, workspaceId: string, name: string): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ workspaceId, name }),
  });
  return res.json();
}

export async function submitPrompt(token: string, projectId: string, prompt: string): Promise<Run> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ prompt, projectId }),
  });
  return res.json();
}

export async function approvePlan(runId: string): Promise<Approval> {
  const res = await fetch('/api/gate/plan-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, decision: 'approved' }),
  });
  return res.json();
}

export async function approveDiff(runId: string): Promise<Approval> {
  const res = await fetch('/api/gate/diff-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, decision: 'approved' }),
  });
  return res.json();
}

export function streamRun(runId: string, callback: (event: any) => void): () => void {
  const eventSource = new EventSource(`/api/events/${runId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      callback(data);
    } catch (e) {
      console.error('failed to parse SSE event', e);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
  };

  return () => eventSource.close();
}
