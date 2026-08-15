import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { ProjectFile } from '@aione/core';
import { listProjectFiles, createProjectFile, moveProjectFile, deleteProjectFile } from '../api.js';

interface FileTreeProps {
  projectId: string;
  // Lifted-selection callback (per the ticket: "a callback prop or lifted
  // selection state, not a global store") — the Monaco ticket that follows
  // this one can pass a handler here to open the selected file, without
  // FileTree needing to know anything about an editor.
  onSelectFile?: (file: { id: string; path: string }) => void;
}

// A folder or file node in the tree built from the flat list the API
// returns. `path` is always the full project-relative path (e.g.
// "src/components/App.tsx"), which is what the create/move/delete API calls
// key off of.
interface TreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: TreeNode[];
  file?: ProjectFile;
}

// GET /projects/:projectId/files returns a flat list of live files (see
// apps/api/src/handlers/files.ts); this table is rows, not a filesystem, so
// there's no separate "folder" record — folders are implied by path
// segments and built up here, client-side.
function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = file.path.split('/');
    let level = root;
    let pathSoFar = '';

    segments.forEach((segment, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      let node = level.find((n) => n.name === segment && n.type === (isLeaf ? 'file' : 'folder'));
      if (!node) {
        node = {
          name: segment,
          path: pathSoFar,
          type: isLeaf ? 'file' : 'folder',
          children: [],
          file: isLeaf ? file : undefined,
        };
        level.push(node);
      }

      level = node.children;
    });
  }

  return root;
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.2rem 0.3rem',
  cursor: 'pointer',
};

const smallButtonStyle = {
  padding: '0.1rem 0.4rem',
  fontSize: '0.75rem',
  cursor: 'pointer',
};

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  selectedPath: string | null;
  onSelectFile: (file: ProjectFile) => void;
  renamingPath: string | null;
  renameValue: string;
  onStartRename: (path: string) => void;
  onRenameValueChange: (value: string) => void;
  onConfirmRename: (fromPath: string) => void;
  onCancelRename: () => void;
  confirmingDeletePath: string | null;
  onStartDelete: (path: string) => void;
  onConfirmDelete: (path: string) => void;
  onCancelDelete: () => void;
}

function TreeNodeView({
  node,
  depth,
  expanded,
  onToggleExpand,
  selectedPath,
  onSelectFile,
  renamingPath,
  renameValue,
  onStartRename,
  onRenameValueChange,
  onConfirmRename,
  onCancelRename,
  confirmingDeletePath,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: TreeNodeViewProps) {
  const indent = { paddingLeft: `${depth * 1.1}rem` };

  if (node.type === 'folder') {
    const isExpanded = expanded.has(node.path);
    return (
      <li>
        <div style={{ ...rowStyle, ...indent }} onClick={() => onToggleExpand(node.path)}>
          <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
          <span>{node.name}</span>
        </div>
        {isExpanded && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {node.children.map((child) => (
              <TreeNodeView
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onStartRename={onStartRename}
                onRenameValueChange={onRenameValueChange}
                onConfirmRename={onConfirmRename}
                onCancelRename={onCancelRename}
                confirmingDeletePath={confirmingDeletePath}
                onStartDelete={onStartDelete}
                onConfirmDelete={onConfirmDelete}
                onCancelDelete={onCancelDelete}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isRenaming = renamingPath === node.path;
  const isConfirmingDelete = confirmingDeletePath === node.path;

  return (
    <li>
      <div
        style={{
          ...rowStyle,
          ...indent,
          backgroundColor: selectedPath === node.path ? '#e6f0ff' : 'transparent',
        }}
      >
        <span aria-hidden="true">{'\u{1f4c4}'}</span>
        <span style={{ flex: 1 }} onClick={() => node.file && onSelectFile(node.file)}>
          {node.name}
        </span>

        {isRenaming ? (
          <>
            <input
              aria-label={`Rename ${node.path}`}
              value={renameValue}
              onChange={(e) => onRenameValueChange(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '0.1rem 0.3rem' }}
            />
            <button style={smallButtonStyle} onClick={() => onConfirmRename(node.path)}>
              Save
            </button>
            <button style={smallButtonStyle} onClick={onCancelRename}>
              Cancel
            </button>
          </>
        ) : isConfirmingDelete ? (
          <>
            <span style={{ fontSize: '0.75rem', color: '#666' }}>Remove (can be restored later)?</span>
            <button style={smallButtonStyle} onClick={() => onConfirmDelete(node.path)}>
              Yes, remove
            </button>
            <button style={smallButtonStyle} onClick={onCancelDelete}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button style={smallButtonStyle} onClick={() => onStartRename(node.path)}>
              Rename
            </button>
            <button style={smallButtonStyle} onClick={() => onStartDelete(node.path)}>
              Remove
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Hierarchical file-tree view for a project, backed by the project_files API
 * added in #32. Folders are derived client-side from file paths (there's no
 * separate folder row — see buildTree above); files are leaves with
 * rename/move and reversible-delete affordances wired to the same API.
 *
 * Selection is lifted via `onSelectFile` rather than a global store, so the
 * Monaco editor ticket that follows this one can consume it directly.
 */
export default function FileTree({ projectId, onSelectFile }: FileTreeProps) {
  const { getToken } = useAuth();
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [newFilePath, setNewFilePath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [confirmingDeletePath, setConfirmingDeletePath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(null);

    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const result = await listProjectFiles(token, projectId);
        if (!cancelled) {
          setFiles(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load files');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `getToken` is intentionally omitted: no react-hooks lint plugin is
    // configured in this repo (see PlanStream.tsx for the same pattern), and
    // depending on it here would re-run this effect on every render rather
    // than only when projectId/reloadToken change, since it's not a
    // memoized reference. Fetching only happens once per project (plus on
    // explicit refetch), matching Workspaces.tsx's equivalent effect.
  }, [projectId, reloadToken]);

  const tree = useMemo(() => buildTree(files ?? []), [files]);

  const refetch = () => setReloadToken((n) => n + 1);

  const handleToggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectFile = (file: ProjectFile) => {
    setSelectedPath(file.path);
    onSelectFile?.({ id: file.id, path: file.path });
  };

  const handleCreate = async () => {
    const path = newFilePath.trim();
    if (!path) return;
    setCreateError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const created = await createProjectFile(token, projectId, path);
      setFiles((prev) => [...(prev ?? []), created]);
      setNewFilePath('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create file');
    }
  };

  const handleStartRename = (path: string) => {
    setRenamingPath(path);
    setRenameValue(path);
    setRenameError(null);
  };

  const handleCancelRename = () => {
    setRenamingPath(null);
    setRenameValue('');
    setRenameError(null);
  };

  const handleConfirmRename = async (fromPath: string) => {
    const toPath = renameValue.trim();
    if (!toPath || toPath === fromPath) {
      handleCancelRename();
      return;
    }
    setRenameError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const moved = await moveProjectFile(token, projectId, fromPath, toPath);
      setFiles((prev) => (prev ?? []).map((f) => (f.path === fromPath ? moved : f)));
      if (selectedPath === fromPath) {
        setSelectedPath(moved.path);
      }
      handleCancelRename();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename file');
    }
  };

  const handleStartDelete = (path: string) => {
    setConfirmingDeletePath(path);
    setDeleteError(null);
  };

  const handleCancelDelete = () => {
    setConfirmingDeletePath(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async (path: string) => {
    setDeleteError(null);
    try {
      const token = await getToken();
      if (!token) return;
      await deleteProjectFile(token, projectId, path);
      setFiles((prev) => (prev ?? []).filter((f) => f.path !== path));
      if (selectedPath === path) {
        setSelectedPath(null);
      }
      setConfirmingDeletePath(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to remove file');
    }
  };

  if (error) {
    return (
      <div style={{ padding: '1rem' }}>
        <p style={{ color: '#cc0000' }}>Couldn&apos;t load files: {error}</p>
        <button style={smallButtonStyle} onClick={refetch}>
          Retry
        </button>
      </div>
    );
  }

  if (files === null) {
    return <div style={{ padding: '1rem' }}>Loading files...</div>;
  }

  return (
    <div style={{ padding: '1rem' }}>
      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.4rem' }}>
        <input
          placeholder="New file path (e.g. src/index.ts)"
          value={newFilePath}
          onChange={(e) => setNewFilePath(e.target.value)}
          style={{ flex: 1, padding: '0.3rem', fontSize: '0.85rem' }}
        />
        <button style={smallButtonStyle} onClick={handleCreate} disabled={!newFilePath.trim()}>
          Create file
        </button>
      </div>
      {createError && <p style={{ color: '#cc0000', fontSize: '0.8rem' }}>{createError}</p>}
      {renameError && <p style={{ color: '#cc0000', fontSize: '0.8rem' }}>{renameError}</p>}
      {deleteError && <p style={{ color: '#cc0000', fontSize: '0.8rem' }}>{deleteError}</p>}

      {files.length === 0 ? (
        <p>No files yet — create your first one.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tree.map((node) => (
            <TreeNodeView
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              onToggleExpand={handleToggleExpand}
              selectedPath={selectedPath}
              onSelectFile={handleSelectFile}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onStartRename={handleStartRename}
              onRenameValueChange={setRenameValue}
              onConfirmRename={handleConfirmRename}
              onCancelRename={handleCancelRename}
              confirmingDeletePath={confirmingDeletePath}
              onStartDelete={handleStartDelete}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
