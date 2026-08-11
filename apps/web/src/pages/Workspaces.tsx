import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Workspace, Project } from '@aione/core';
import { listWorkspaces, createWorkspace, listProjects, createProject } from '../api.js';

const primaryButtonStyle = {
  padding: '0.5rem 1rem',
  fontSize: '1rem',
  cursor: 'pointer',
  backgroundColor: '#0066cc',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
};

const inputStyle = {
  padding: '0.5rem',
  fontSize: '1rem',
  marginRight: '0.5rem',
};

const listItemStyle = {
  padding: '0.5rem',
  cursor: 'pointer',
  border: '1px solid #ddd',
  borderRadius: '4px',
  marginBottom: '0.5rem',
};

interface WorkspacesProps {
  onSelectProject: (projectId: string) => void;
}

export default function Workspaces({ onSelectProject }: WorkspacesProps) {
  const { getToken } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return;
      setWorkspaces(await listWorkspaces(token));
    })();
  }, [getToken]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setProjects(null);
      return;
    }
    (async () => {
      const token = await getToken();
      if (!token) return;
      setProjects(await listProjects(token, selectedWorkspaceId));
    })();
  }, [getToken, selectedWorkspaceId]);

  const handleCreateWorkspace = async () => {
    const token = await getToken();
    if (!token || !newWorkspaceName.trim()) return;
    const workspace = await createWorkspace(token, newWorkspaceName.trim());
    setWorkspaces((prev) => [...(prev ?? []), workspace]);
    setNewWorkspaceName('');
  };

  const handleCreateProject = async () => {
    const token = await getToken();
    if (!token || !selectedWorkspaceId || !newProjectName.trim()) return;
    const project = await createProject(token, selectedWorkspaceId, newProjectName.trim());
    setProjects((prev) => [...(prev ?? []), project]);
    setNewProjectName('');
  };

  if (workspaces === null) {
    return <div style={{ padding: '2rem' }}>Loading workspaces...</div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Workspaces</h2>
      {workspaces.length === 0 && <p>No workspaces yet — create your first one.</p>}
      {workspaces.map((workspace) => (
        <div
          key={workspace.id}
          style={{
            ...listItemStyle,
            backgroundColor: selectedWorkspaceId === workspace.id ? '#e6f0ff' : 'white',
          }}
          onClick={() => setSelectedWorkspaceId(workspace.id)}
        >
          {workspace.name}
        </div>
      ))}
      <div style={{ marginTop: '1rem' }}>
        <input
          style={inputStyle}
          placeholder="New workspace name"
          value={newWorkspaceName}
          onChange={(e) => setNewWorkspaceName(e.target.value)}
        />
        <button style={primaryButtonStyle} onClick={handleCreateWorkspace}>
          Create workspace
        </button>
      </div>

      {selectedWorkspaceId && (
        <div style={{ marginTop: '2rem' }}>
          <h3>Projects</h3>
          {projects === null && <p>Loading projects...</p>}
          {projects !== null && projects.length === 0 && <p>No projects yet — create your first one.</p>}
          {projects?.map((project) => (
            <div key={project.id} style={listItemStyle} onClick={() => onSelectProject(project.id)}>
              {project.name}
            </div>
          ))}
          <div style={{ marginTop: '1rem' }}>
            <input
              style={inputStyle}
              placeholder="New project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <button style={primaryButtonStyle} onClick={handleCreateProject}>
              Create project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
