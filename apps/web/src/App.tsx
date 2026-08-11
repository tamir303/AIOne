import { useState } from 'react';
import { submitPrompt } from './api.js';
import { useRun } from './hooks/useRun.js';
import PlanReview from './pages/PlanReview.js';
import DiffReview from './pages/DiffReview.js';

function App() {
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
        <button
          onClick={handleStart}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            cursor: 'pointer',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
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

export default App;
