import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Workspaces from './Workspaces.js';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('../api.js', () => ({
  listWorkspaces: vi.fn().mockResolvedValue([]),
  createWorkspace: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

describe('Workspaces', () => {
  it('renders its empty state once the (empty) workspace list has loaded', async () => {
    render(<Workspaces onSelectProject={() => {}} />);

    // Before the async listWorkspaces() call resolves, the component shows
    // its loading state rather than the empty state.
    expect(screen.getByText('Loading workspaces...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet — create your first one.')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('New workspace name')).toBeInTheDocument();
    // No workspace has been selected, so the Projects section shouldn't render.
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });
});
