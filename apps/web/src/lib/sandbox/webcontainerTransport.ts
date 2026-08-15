/**
 * The minimal slice of the `@webcontainer/api` surface `WebContainerLane`
 * depends on, hand-rolled as a structural interface rather than imported
 * from the SDK. This mirrors
 * packages/core/src/providers/anthropic/transport.ts's pattern: depending on
 * a narrow structural type (not the SDK's own class type) keeps the vendor
 * SDK import confined to webcontainerLane.ts (the only file that imports
 * `@webcontainer/api`), and lets tests inject a stub transport instead of
 * booting a real WebContainer — which needs a real browser
 * (`SharedArrayBuffer` + cross-origin isolation) that vitest's default
 * jsdom environment doesn't provide.
 *
 * A real `WebContainer` instance (from `@webcontainer/api`) satisfies
 * `WebContainerInstanceTransport` structurally; see `createWebContainerLane`
 * in webcontainerLane.ts.
 */

/** Structural equivalent of `@webcontainer/api`'s `FileNode`. */
export interface WebContainerFileNode {
  file: { contents: string };
}

/** Structural equivalent of `@webcontainer/api`'s `DirectoryNode`. */
export interface WebContainerDirectoryNode {
  directory: WebContainerFileTree;
}

/** Structural equivalent of `@webcontainer/api`'s `FileSystemTree`. */
export interface WebContainerFileTree {
  [name: string]: WebContainerFileNode | WebContainerDirectoryNode;
}

/**
 * Structural equivalent of `@webcontainer/api`'s `WebContainerProcess`. Every
 * spawned process — whether used for a batch `exec()` or an interactive
 * shell (issue #42) — carries this full PTY-backed shape (`input`/`resize`
 * included); `exec()` just doesn't happen to read `input` or call
 * `resize()`, the same way it discards `WebContainerProcess.input` by never
 * touching it.
 */
export interface WebContainerProcessTransport {
  /** Resolves with the process's exit code once it terminates. */
  exit: Promise<number>;
  /** Input stream for the attached pseudoterminal, matching `WebContainerProcess.input`. */
  input: WritableStream<string>;
  /** Combined stdout+stderr stream, matching `WebContainerProcess.output`. */
  output: ReadableStream<string>;
  kill(): void;
  /** Resizes the attached pseudoterminal, matching `WebContainerProcess.resize`. */
  resize(dimensions: { cols: number; rows: number }): void;
}

export interface WebContainerSpawnOptions {
  cwd?: string;
}

export type WebContainerServerReadyListener = (port: number, url: string) => void;
export type WebContainerUnsubscribe = () => void;

/** Structural equivalent of `@webcontainer/api`'s `WebContainer` instance. */
export interface WebContainerInstanceTransport {
  mount(tree: WebContainerFileTree): Promise<void>;
  spawn(
    command: string,
    args?: string[],
    options?: WebContainerSpawnOptions,
  ): Promise<WebContainerProcessTransport>;
  on(event: 'server-ready', listener: WebContainerServerReadyListener): WebContainerUnsubscribe;
  teardown(): void;
}

/**
 * Boots a new WebContainer instance. Production implementation:
 * `WebContainer.boot` (see `createWebContainerLane` in webcontainerLane.ts).
 * Tests inject a stub instead.
 */
export type WebContainerBoot = () => Promise<WebContainerInstanceTransport>;
