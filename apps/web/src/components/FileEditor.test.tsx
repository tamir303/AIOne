import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FileEditor from './FileEditor.js';
import { getFileContent, saveFileContent } from '../api.js';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('../api.js', () => ({
  getFileContent: vi.fn(),
  saveFileContent: vi.fn(),
}));

// @monaco-editor/react ships a real DOM/canvas-backed editor that isn't
// meaningful to exercise under jsdom (no layout engine, no workers) — same
// rationale as mocking ../api.js in Workspaces.test.tsx: stand in a plain
// textarea that round-trips `value`/`onChange`/`path` so the surrounding
// load/edit/save/dirty-state logic in FileEditor itself is what's under
// test, not Monaco's internals.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, path }: { value: string; onChange: (v: string) => void; path: string }) => (
    <textarea
      aria-label={`editor:${path}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const mockGetFileContent = vi.mocked(getFileContent);
const mockSaveFileContent = vi.mocked(saveFileContent);

const baseFile = {
  id: 'file-1',
  projectId: 'project-1',
  path: 'src/index.ts',
  content: 'console.log("hi");',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('FileEditor', () => {
  beforeEach(() => {
    mockGetFileContent.mockReset();
    mockSaveFileContent.mockReset();
  });

  it('loads content and renders it once fetched', async () => {
    mockGetFileContent.mockResolvedValue(baseFile);

    render(<FileEditor projectId="project-1" path="src/index.ts" />);

    expect(screen.getByText('Loading src/index.ts…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText('editor:src/index.ts')).toHaveValue(baseFile.content);
    });

    expect(mockGetFileContent).toHaveBeenCalledWith('test-token', 'project-1', 'src/index.ts');
    // No unsaved edits yet, so no dirty indicator and the Save button is disabled.
    expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('shows a dirty-state indicator once the content diverges from what was loaded', async () => {
    mockGetFileContent.mockResolvedValue(baseFile);

    render(<FileEditor projectId="project-1" path="src/index.ts" />);

    const editor = await screen.findByLabelText('editor:src/index.ts');
    fireEvent.change(editor, { target: { value: 'console.log("edited");' } });

    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeEnabled();
  });

  it('saves edits via the PUT endpoint and clears the dirty indicator on success', async () => {
    mockGetFileContent.mockResolvedValue(baseFile);
    mockSaveFileContent.mockResolvedValue({ ...baseFile, content: 'console.log("edited");' });

    render(<FileEditor projectId="project-1" path="src/index.ts" />);

    const editor = await screen.findByLabelText('editor:src/index.ts');
    fireEvent.change(editor, { target: { value: 'console.log("edited");' } });
    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockSaveFileContent).toHaveBeenCalledWith(
        'test-token',
        'project-1',
        'src/index.ts',
        'console.log("edited");'
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });
  });

  it('saves via Ctrl+S as well as the Save button', async () => {
    mockGetFileContent.mockResolvedValue(baseFile);
    mockSaveFileContent.mockResolvedValue({ ...baseFile, content: 'console.log("edited");' });

    render(<FileEditor projectId="project-1" path="src/index.ts" />);

    const editor = await screen.findByLabelText('editor:src/index.ts');
    fireEvent.change(editor, { target: { value: 'console.log("edited");' } });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(mockSaveFileContent).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the edit and shows an error when saving fails, instead of dropping it', async () => {
    mockGetFileContent.mockResolvedValue(baseFile);
    mockSaveFileContent.mockRejectedValue(new Error('Failed to save src/index.ts (500)'));

    render(<FileEditor projectId="project-1" path="src/index.ts" />);

    const editor = await screen.findByLabelText('editor:src/index.ts');
    fireEvent.change(editor, { target: { value: 'console.log("edited");' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByTestId('save-error')).toHaveTextContent('Failed to save src/index.ts (500)');
    });

    // The edit itself is still present and still marked dirty — a failed
    // save must not silently discard it.
    expect(screen.getByLabelText('editor:src/index.ts')).toHaveValue('console.log("edited");');
    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
  });
});
