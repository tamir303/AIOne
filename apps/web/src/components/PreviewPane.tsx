import { useEffect, useState } from 'react';
import type { Handle, SandboxLane } from '../lib/sandbox/types.js';

interface PreviewPaneProps {
  lane: SandboxLane;
  handle: Handle;
}

const barStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #ddd',
};

const smallButtonStyle = {
  padding: '0.2rem 0.6rem',
  fontSize: '0.8rem',
  cursor: 'pointer',
};

/**
 * Live preview pane for a running `SandboxLane` (docs/sandbox-execution.md,
 * "Preview URLs"; issue #43). Standalone — not wired into App.tsx's routing
 * yet, per the ticket.
 *
 * `previewUrl()` (webcontainerLane.ts) resolves a single `URL` once the
 * WebContainer fires `server-ready`, or resolves `null` after a 60s budget
 * with no `server-ready` event. A `null` result is treated as "not ready
 * yet", not "gave up" — install/dev-server startup can legitimately take
 * longer than 60s, and re-invoking `previewUrl()` is safe (it's an
 * independent promise every call, per webcontainerLane.ts's own docstring),
 * so this component automatically re-invokes it and keeps showing the
 * waiting state rather than surfacing a dead end. A "Reload preview" button
 * is offered regardless of state: while waiting it's a manual nudge to
 * retry sooner, and once loaded it re-resolves `previewUrl()` and remounts
 * the iframe (keyed on the attempt counter) so a same-URL reload still
 * forces a fresh page load instead of being a no-op src assignment.
 */
export default function PreviewPane({ lane, handle }: PreviewPaneProps) {
  const [url, setUrl] = useState<URL | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);

    (async () => {
      const resolved = await lane.previewUrl(handle);
      if (cancelled) return;
      if (resolved) {
        setUrl(resolved);
      } else {
        // Timed out with no server-ready event yet — retry rather than
        // giving up permanently (see docstring above).
        setAttempt((n) => n + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lane, handle, attempt]);

  const handleReload = () => {
    setAttempt((n) => n + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={barStyle}>
        <span style={{ flex: 1, fontSize: '0.85rem', color: url ? '#333' : '#666' }}>
          {url ? url.toString() : 'Waiting for dev server…'}
        </span>
        <button style={smallButtonStyle} onClick={handleReload}>
          Reload preview
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {url ? (
          <iframe
            key={attempt}
            data-testid="preview-frame"
            title="App preview"
            src={url.toString()}
            // Scripts/forms/popups/modals are needed for a typical dev app
            // to function at all; allow-same-origin is needed for
            // WebContainers preview content itself to work (service
            // workers, relative-URL module fetches, etc.) within its own
            // distinct preview origin. This content is same-origin to the
            // tab per docs/sandbox-execution.md's "Preview URLs" section
            // (no E2B-style token-proxy needed here), but it's still
            // arbitrary user/agent-generated app code, so no
            // allow-top-navigation and no allow-pointer-lock beyond what's
            // listed.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <div data-testid="preview-waiting" style={{ padding: '1rem', color: '#666' }}>
            Waiting for dev server…
          </div>
        )}
      </div>
    </div>
  );
}
