import { Run } from '@aione/core';
import { approveDiff } from '../api';

interface DiffReviewProps {
  run: Run;
  onApprove: () => void;
}

export default function DiffReview({ run, onApprove }: DiffReviewProps) {
  const handleApprove = async () => {
    await approveDiff(run.id);
    onApprove();
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Diff Review</h2>
      {run.diff && (
        <div>
          <h3>Files Changed</h3>
          <ul>
            {run.diff.files.map((file, i) => (
              <li key={i}>
                <strong>{file.path}</strong> (+{file.added} -{file.removed})
              </li>
            ))}
          </ul>
          <p>
            <strong>Summary:</strong> {run.diff.summary}
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
        Approve Diff
      </button>
    </div>
  );
}
