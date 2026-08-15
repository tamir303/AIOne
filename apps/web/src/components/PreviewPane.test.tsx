import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PreviewPane from './PreviewPane.js';
import type { Handle, SandboxLane } from '../lib/sandbox/types.js';

// Mocks the `SandboxLane` contract directly (apps/web/src/lib/sandbox/types.ts)
// rather than a real WebContainer, same pattern as webcontainerLane.test.ts's
// own fake transport — per the ticket, no real WebContainer boot is needed
// here, just a lane whose previewUrl() behaves per its documented contract
// (an independent promise per call, resolving to a URL or null).
function fakeLane(previewUrl: SandboxLane['previewUrl']): SandboxLane {
  return {
    start: vi.fn(),
    writeFiles: vi.fn(),
    exec: vi.fn(),
    previewUrl,
    dispose: vi.fn(),
  };
}

const handle: Handle = { id: 'webcontainers-0', kind: 'webcontainers' };

// A promise plus externally-callable resolve, so a test can assert the
// waiting state renders before the previewUrl() call settles.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('PreviewPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a waiting state before previewUrl resolves', async () => {
    const { promise } = deferred<URL | null>();
    const previewUrl = vi.fn().mockReturnValue(promise);
    const lane = fakeLane(previewUrl);

    render(<PreviewPane lane={lane} handle={handle} />);

    expect(screen.getByTestId('preview-waiting')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-frame')).not.toBeInTheDocument();
    expect(previewUrl).toHaveBeenCalledWith(handle);
  });

  it('renders the preview iframe once previewUrl resolves', async () => {
    const url = new URL('https://example-preview.webcontainer-api.io/');
    const previewUrl = vi.fn().mockResolvedValue(url);
    const lane = fakeLane(previewUrl);

    render(<PreviewPane lane={lane} handle={handle} />);

    const frame = await screen.findByTestId('preview-frame');
    expect(frame).toHaveAttribute('src', url.toString());
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-modals',
    );
    expect(screen.queryByTestId('preview-waiting')).not.toBeInTheDocument();
  });

  it('retries automatically after a null (timed-out) result instead of giving up', async () => {
    const url = new URL('https://retried-preview.webcontainer-api.io/');
    const previewUrl = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(url);
    const lane = fakeLane(previewUrl);

    render(<PreviewPane lane={lane} handle={handle} />);

    expect(screen.getByTestId('preview-waiting')).toBeInTheDocument();

    const frame = await screen.findByTestId('preview-frame');
    expect(frame).toHaveAttribute('src', url.toString());
    expect(previewUrl).toHaveBeenCalledTimes(2);
  });

  it('re-invokes previewUrl and refreshes the frame on a manual reload', async () => {
    const firstUrl = new URL('https://first-preview.webcontainer-api.io/');
    const secondUrl = new URL('https://second-preview.webcontainer-api.io/');
    const previewUrl = vi.fn().mockResolvedValueOnce(firstUrl).mockResolvedValueOnce(secondUrl);
    const lane = fakeLane(previewUrl);

    render(<PreviewPane lane={lane} handle={handle} />);

    const firstFrame = await screen.findByTestId('preview-frame');
    expect(firstFrame).toHaveAttribute('src', firstUrl.toString());

    fireEvent.click(screen.getByText('Reload preview'));

    // The pane goes back to waiting while the second previewUrl() call is
    // in flight, then re-renders the iframe against the new URL.
    await waitFor(() => {
      expect(previewUrl).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('preview-frame')).toHaveAttribute('src', secondUrl.toString());
    });
  });
});
