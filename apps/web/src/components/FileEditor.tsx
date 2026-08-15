import { useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useAuth } from '@clerk/react';
import { getFileContent, saveFileContent } from '../api.js';

interface FileEditorProps {
  projectId: string;
  path: string;
}

type Status = 'loading' | 'ready' | 'error';

const primaryButtonStyle = {
  padding: '0.35rem 0.9rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  backgroundColor: '#0066cc',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
};

const disabledButtonStyle = {
  ...primaryButtonStyle,
  cursor: 'default',
  backgroundColor: '#99b8dd',
};

/**
 * Manual-editing surface for a single project file: loads content from
 * `GET /projects/:projectId/files/content` and writes it back via
 * `PUT /projects/:projectId/files/content` (apps/api/src/handlers/files.ts).
 *
 * Save is explicit (a button, plus Ctrl/Cmd+S) rather than autosave-on-
 * keystroke — see issue #38 and docs/roadmap.md's Phase 1 scope ("no AI
 * anywhere" / manual editing only), which calls out that unprompted network
 * writes on every keystroke would be surprising here.
 *
 * `path` is passed straight through to Monaco's `path` prop, which is what
 * lets Monaco infer syntax highlighting from the file extension without a
 * custom extension->language map (per the ticket, its built-in detection is
 * sufficient).
 *
 * Takes `projectId`/`path` as plain props rather than reading a selection
 * from the file tree (#37): #37 hadn't merged when this was built, and the
 * ticket explicitly allows building/testing against a path passed in
 * directly, with the file-tree hookup left as a follow-up.
 */
export default function FileEditor({ projectId, path }: FileEditorProps) {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = status === 'ready' && content !== savedContent;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLoadError(null);
    setSaveError(null);

    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const file = await getFileContent(token, projectId, path);
        if (cancelled) return;
        setContent(file.content);
        setSavedContent(file.content);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load file');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // `getToken` is intentionally omitted: @clerk/react doesn't guarantee a
    // stable identity for it across renders, and this effect should only
    // re-run when the file being edited changes (projectId/path), not on
    // every render. No react-hooks lint plugin is configured in this repo
    // (see .eslintrc.js), so there's nothing to suppress — same pattern as
    // apps/web/src/components/PlanStream.tsx.
  }, [projectId, path]);

  const handleSave = useCallback(async () => {
    if (status !== 'ready' || saving) return;
    const token = await getToken();
    if (!token) return;

    setSaving(true);
    setSaveError(null);
    try {
      const file = await saveFileContent(token, projectId, path, content);
      // Adopt the server's copy so a concurrent edit elsewhere (or
      // server-side normalization) doesn't leave the client silently out of
      // sync with what actually got persisted.
      setSavedContent(file.content);
      setContent(file.content);
    } catch (error) {
      // Deliberately does not touch `content` — a failed save must never
      // drop the user's edits, only report that they aren't persisted yet.
      setSaveError(error instanceof Error ? error.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }, [content, getToken, path, projectId, saving, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  if (status === 'loading') {
    return <div style={{ padding: '1rem' }}>Loading {path}…</div>;
  }

  if (status === 'error') {
    return (
      <div style={{ padding: '1rem', color: '#c00' }}>
        Failed to load {path}: {loadError}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid #ddd',
        }}
      >
        <strong>{path}</strong>
        {dirty && (
          <span data-testid="dirty-indicator" style={{ color: '#c60' }}>
            ● Unsaved changes
          </span>
        )}
        <button
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          style={!dirty || saving ? disabledButtonStyle : primaryButtonStyle}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && (
          <span data-testid="save-error" style={{ color: '#c00' }}>
            Save failed: {saveError}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          path={path}
          value={content}
          onChange={(value) => setContent(value ?? '')}
          options={{ minimap: { enabled: false }, automaticLayout: true }}
        />
      </div>
    </div>
  );
}
