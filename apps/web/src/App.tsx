import { useState } from 'react';
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react';
import { submitPrompt } from './api.js';
import { useRun } from './hooks/useRun.js';
import PlanReview from './pages/PlanReview.js';
import DiffReview from './pages/DiffReview.js';

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

function SignedInApp() {
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRun(runId);

  const handleStart = async () => {
    const created = await submitPrompt('demo prompt');
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

  if (run.status === 'planning' || run.status === 'awaiting_approval') {
    if (!run.plan) {
      return <div>Loading plan...</div>;
    }

    if (!run.diff) {
      return <PlanReview run={run} onApprove={() => {}} />;
    }

    return <DiffReview run={run} onApprove={() => {}} />;
  }

  return <div>Run completed!</div>;
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
