import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import FileTree from './FileTree.js';
import * as api from '../api.js';

// This project's vitest.config.ts doesn't set `test.globals: true`, so
// @testing-library/react's automatic afterEach(cleanup) (which relies on a
// global `afterEach` being present) never registers — Workspaces.test.tsx
// gets away without this because it only renders once per file. This file
// renders several times, so cleanup has to be explicit or state updates
// from an earlier test's still-mounted component leak into the next one.
afterEach(() => {
  cleanup();
});

// `getToken` must be a stable function reference across renders here, the
// same way @clerk/react's real useAuth() memoizes it (useCallback, keyed on
// clerkStatus) — FileTree's fetch effect correctly depends on `getToken`
// (see FileTree.tsx), and a fresh closure per render would make this mock
// diverge from Clerk's real behavior and cause the effect to refire every
// render instead of only when projectId/reloadToken change.
vi.mock('@clerk/react', () => {
  const getToken = async () => 'test-token';
  return {
    useAuth: () => ({ getToken }),
  };
});

vi.mock('../api.js', () => ({
  listProjectFiles: vi.fn(),
  createProjectFile: vi.fn(),
  moveProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
}));

const file = (id: string, path: string) => ({
  id,
  path,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

describe('FileTree', () => {
  beforeEach(() => {
    vi.mocked(api.listProjectFiles).mockReset();
    vi.mocked(api.createProjectFile).mockReset();
    vi.mocked(api.moveProjectFile).mockReset();
    vi.mocked(api.deleteProjectFile).mockReset();
  });

  it('shows a loading state, then the empty state for a project with no files', async () => {
    vi.mocked(api.listProjectFiles).mockResolvedValue([]);

    render(<FileTree projectId="proj-1" />);

    expect(screen.getByText('Loading files...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No files yet — create your first one.')).toBeInTheDocument();
    });
  });

  it('shows an error state and allows retrying on fetch failure', async () => {
    vi.mocked(api.listProjectFiles).mockRejectedValueOnce(new Error('boom'));

    render(<FileTree projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load files: boom/)).toBeInTheDocument();
    });

    vi.mocked(api.listProjectFiles).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('No files yet — create your first one.')).toBeInTheDocument();
    });
  });

  it('renders a hierarchical tree, expands folders, and surfaces file selection via a callback', async () => {
    vi.mocked(api.listProjectFiles).mockResolvedValue([
      file('1', 'src/index.ts'),
      file('2', 'README.md'),
      file('3', 'src/components/App.tsx'),
    ]);
    const onSelectFile = vi.fn();

    render(<FileTree projectId="proj-1" onSelectFile={onSelectFile} />);

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    // Top-level: README.md (file) and src (folder) — the folder's contents
    // aren't in the document until expanded.
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('src'));

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument();
    });
    expect(screen.getByText('components')).toBeInTheDocument();
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('index.ts'));
    expect(onSelectFile).toHaveBeenCalledWith({ id: '1', path: 'src/index.ts' });
  });

  it('creates a file via the create form', async () => {
    vi.mocked(api.listProjectFiles).mockResolvedValue([]);
    vi.mocked(api.createProjectFile).mockResolvedValue(file('new-1', 'notes.md'));

    render(<FileTree projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('No files yet — create your first one.')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('New file path (e.g. src/index.ts)'), {
      target: { value: 'notes.md' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }));

    await waitFor(() => {
      expect(api.createProjectFile).toHaveBeenCalledWith('test-token', 'proj-1', 'notes.md');
    });
    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument();
    });
  });

  it('renames a file through the inline rename affordance', async () => {
    vi.mocked(api.listProjectFiles).mockResolvedValue([file('1', 'old.md')]);
    vi.mocked(api.moveProjectFile).mockResolvedValue(file('1', 'new.md'));

    render(<FileTree projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText('old.md')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Rename old.md');
    fireEvent.change(input, { target: { value: 'new.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.moveProjectFile).toHaveBeenCalledWith('test-token', 'proj-1', 'old.md', 'new.md');
    });
    await waitFor(() => expect(screen.getByText('new.md')).toBeInTheDocument());
  });

  it('deletes (soft) a file only after an explicit, reversible-worded confirmation step', async () => {
    vi.mocked(api.listProjectFiles).mockResolvedValue([file('1', 'gone.md')]);
    vi.mocked(api.deleteProjectFile).mockResolvedValue({ ok: true, id: '1', path: 'gone.md' });

    render(<FileTree projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText('gone.md')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.deleteProjectFile).not.toHaveBeenCalled();
    expect(screen.getByText(/can be restored later/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));

    await waitFor(() => {
      expect(api.deleteProjectFile).toHaveBeenCalledWith('test-token', 'proj-1', 'gone.md');
    });
    await waitFor(() => {
      expect(screen.getByText('No files yet — create your first one.')).toBeInTheDocument();
    });
  });
});
