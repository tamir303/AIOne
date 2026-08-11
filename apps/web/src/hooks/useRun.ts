import { useState, useEffect } from 'react';
import { Run } from '@aione/core';
import { streamRun } from '../api';

export function useRun(runId: string | null) {
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    if (!runId) return;

    const unsubscribe = streamRun(runId, (event) => {
      if (event.type === 'run') {
        setRun(event.run);
      }
    });

    return () => unsubscribe();
  }, [runId]);

  return run;
}
