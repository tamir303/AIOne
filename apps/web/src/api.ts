import { Run, Approval } from '@aione/core';

export async function submitPrompt(prompt: string): Promise<Run> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
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
