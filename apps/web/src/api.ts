import { Run, Approval, Workspace, Project, ProjectFile } from '@aione/core';

function authHeaders(token: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// Unlike the fetch helpers above (which assume success and let a bad
// response surface as a JSON-parse error further down the call stack), the
// project-files helpers below are consumed by FileTree, which the ticket
// requires to show a real error state on fetch failure — so these check
// `res.ok` and throw with the server's own message where there is one.
async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && typeof body.error === 'string' ? body.error : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

export async function listProjectFiles(token: string, projectId: string): Promise<ProjectFile[]> {
  const res = await fetch(`/api/projects/${projectId}/files`, { headers: authHeaders(token) });
  return parseJsonOrThrow<ProjectFile[]>(res);
}

export async function createProjectFile(
  token: string,
  projectId: string,
  path: string,
  content?: string
): Promise<ProjectFile> {
  const res = await fetch(`/api/projects/${projectId}/files`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ path, content }),
  });
  return parseJsonOrThrow<ProjectFile>(res);
}

export async function moveProjectFile(
  token: string,
  projectId: string,
  fromPath: string,
  toPath: string
): Promise<ProjectFile> {
  const res = await fetch(`/api/projects/${projectId}/files/move`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ fromPath, toPath }),
  });
  return parseJsonOrThrow<ProjectFile>(res);
}

// Soft-delete per apps/api/src/handlers/files.ts: `confirm=true` is required
// by the API itself (CLAUDE.md rule #1), and the row is recoverable via
// POST /projects/:projectId/files/restore — FileTree's UI copy reflects
// that reversibility rather than implying a permanent delete.
export async function deleteProjectFile(
  token: string,
  projectId: string,
  path: string
): Promise<{ ok: boolean; id: string; path: string }> {
  const res = await fetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}&confirm=true`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return parseJsonOrThrow<{ ok: boolean; id: string; path: string }>(res);
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

export interface ProjectFileContent {
  id: string;
  projectId: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // response wasn't JSON — fall through to the generic message below.
  }
  return `${fallback} (${res.status})`;
}

export async function getFileContent(token: string, projectId: string, path: string): Promise<ProjectFileContent> {
  const res = await fetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to load ${path}`));
  }
  return res.json();
}

export async function saveFileContent(
  token: string,
  projectId: string,
  path: string,
  content: string
): Promise<ProjectFileContent> {
  const res = await fetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to save ${path}`));
  }
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
