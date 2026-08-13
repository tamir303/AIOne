import { useEffect, useRef } from 'react';
import { useCompletion } from '@ai-sdk/react';

interface PlanStreamProps {
  runId: string;
  token: string;
}

/**
 * Shows the plan being generated incrementally, using `@ai-sdk/react`'s
 * `useCompletion` against `/api/runs/:runId/plan-stream` (see
 * apps/api/src/handlers/runs.ts) — real Vercel AI SDK client/server
 * streaming, per CLAUDE.md's "Vercel AI SDK for streaming" convention and
 * issue #3, rather than a bespoke SSE event the UI has to parse itself.
 *
 * `streamProtocol: 'text'` matches the server's `createTextStreamResponse`:
 * the response body is a raw text stream, and `completion` accumulates it
 * chunk by chunk. The definitive `Plan` (rendered by PlanReview once the
 * Run leaves 'planning') always comes from `run.plan`, not from this
 * component — this is a progress display only.
 */
export default function PlanStream({ runId, token }: PlanStreamProps) {
  const { completion, complete, isLoading } = useCompletion({
    api: `/api/runs/${runId}/plan-stream`,
    streamProtocol: 'text',
    headers: { Authorization: `Bearer ${token}` },
  });

  // Fires once per runId. The submitted "prompt" argument is ignored by the
  // server (the real prompt already lives on the Run row) — this call only
  // exists to open the request useCompletion expects.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (startedFor.current === runId) {
      return;
    }
    startedFor.current = runId;
    void complete('');
    // `complete` is intentionally omitted from the deps array: it's not
    // memoized by useCompletion, and re-running this effect on every
    // re-render (rather than only when runId changes) would re-open the
    // stream. No react-hooks lint plugin is configured in this repo (see
    // .eslintrc.js) to auto-suppress this, hence the manual comment.
  }, [runId]);

  if (!completion && !isLoading) {
    return null;
  }

  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        color: '#666',
        background: '#f5f5f5',
        padding: '0.75rem',
        borderRadius: '4px',
        maxHeight: '240px',
        overflowY: 'auto',
      }}
    >
      {completion || 'Generating plan…'}
    </pre>
  );
}
