import { Run } from '@aione/core';
import { approvePlan } from '../api.js';

interface PlanReviewProps {
  run: Run;
  onApprove: () => void;
}

export default function PlanReview({ run, onApprove }: PlanReviewProps) {
  const handleApprove = async () => {
    await approvePlan(run.id);
    onApprove();
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Plan Review</h2>
      {run.plan && (
        <div>
          <h3>Steps</h3>
          <ul>
            {run.plan.steps.map((step, i) => (
              <li key={i}>
                <strong>[{step.role}]</strong> {step.description}
              </li>
            ))}
          </ul>
          <p>
            <strong>Rationale:</strong> {run.plan.rationale}
          </p>
        </div>
      )}
      <button
        onClick={handleApprove}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          cursor: 'pointer',
          backgroundColor: '#00cc00',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
        }}
      >
        Approve Plan
      </button>
    </div>
  );
}
