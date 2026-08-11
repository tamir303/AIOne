import { useState } from 'react';
import { Run } from '@aione/core';
import PlanReview from './pages/PlanReview';
import DiffReview from './pages/DiffReview';

function App() {
  const [run, setRun] = useState<Run | null>(null);

  if (!run) {
    return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
        <h1>AIOne - Vertical Slice</h1>
        <button
          onClick={() =>
            setRun({
              id: 'stub-run-1' as any,
              sessionId: 'stub-session-1' as any,
              agent: 'orchestrator',
              status: 'planning',
              approvals: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            })
          }
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
      return <PlanReview run={run} onApprove={() => setRun({ ...run, status: 'awaiting_approval' })} />;
    }

    return <DiffReview run={run} onApprove={() => setRun({ ...run, status: 'done' })} />;
  }

  return <div>Run completed!</div>;
}

export default App;
