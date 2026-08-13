import { useState } from 'react';
import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react';
import { submitPrompt } from './api.js';
import { useRun } from './hooks/useRun.js';
import PlanReview from './pages/PlanReview.js';
import DiffReview from './pages/DiffReview.js';
import Workspaces from './pages/Workspaces.js';

const headerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '1rem 2rem',
};

const primaryButtonStyle = {
  padding: '0.5rem 1rem',
  fontSize: '1rem',
  cursor: 'pointer',
  backgroundColor: '#0066cc',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
};

interface ProjectRunProps {
  projectId: string;
}

function ProjectRun({ projectId }: ProjectRunProps) {
  const { getToken } = useAuth();
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRun(runId);

  const handleStart = async () => {
    const token = await getToken();
    if (!token) return;
    const created = await submitPrompt(token, projectId, 'demo prompt');
    setRunId(created.id);
  };

  if (!runId || !run) {
    return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
        <h1>AIOne - Vertical Slice</h1>
        <button onClick={handleStart} style={primaryButtonStyle}>
          Start Demo Run
        </button>
      </div>
    );
  }

  if (run.status === 'rejected') {
    return <div>Run rejected at a review gate.</div>;
  }

  if (run.status === 'planning' || !run.plan) {
    return <div>Loading plan...</div>;
  }

  if (run.status === 'awaiting_approval' && !run.diff) {
    return <PlanReview run={run} onApprove={() => {}} />;
  }

  // 'executing' means the plan was approved and the diff is being
  // generated for the next gate — see apps/worker/src/run-loop.ts.
  if (run.status === 'executing') {
    return <div>Generating diff...</div>;
  }

  if (run.status === 'awaiting_approval' && run.diff) {
    return <DiffReview run={run} onApprove={() => {}} />;
  }

  return <div>Run completed!</div>;
}

function SignedInApp() {
  const [projectId, setProjectId] = useState<string | null>(null);

  if (!projectId) {
    return <Workspaces onSelectProject={setProjectId} />;
  }

  return <ProjectRun projectId={projectId} />;
}

function App() {
  return (
    <>
      <header style={headerStyle}>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button style={{ ...primaryButtonStyle, padding: '0.4rem 0.9rem', fontSize: '0.9rem' }}>
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button style={{ ...primaryButtonStyle, padding: '0.4rem 0.9rem', fontSize: '0.9rem' }}>
              Sign up
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>
      <Show when="signed-out">
        <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
          <h1>AIOne</h1>
          <p>Sign in to start a run.</p>
        </div>
      </Show>
      <Show when="signed-in">
        <SignedInApp />
      </Show>
    </>
  );
}

export default App;
