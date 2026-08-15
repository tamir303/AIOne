import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebContainerLane } from './webcontainerLane.js';
import { ExecFailedError, LaneTimeoutError, LaneUnavailableError } from './types.js';
import type {
  WebContainerFileTree,
  WebContainerInstanceTransport,
  WebContainerServerReadyListener,
  WebContainerSpawnOptions,
} from './webcontainerTransport.js';

// WebContainers needs a real browser (SharedArrayBuffer + cross-origin
// isolation) that vitest's jsdom environment doesn't provide, so a real
// `WebContainer.boot()` is never exercised here — per the ticket, these
// tests cover the adapter's own logic, error paths, and FileMap/Command
// shape handling against an injected fake transport instead. See
// webcontainerTransport.ts for why the fake only needs to satisfy the
// narrow structural interface, not the real SDK's class type.

function fakeProcess(overrides: {
  exit?: Promise<number>;
  chunks?: string[];
  closeOutput?: boolean;
} = {}) {
  const chunks = overrides.chunks ?? [];
  const closeOutput = overrides.closeOutput ?? true;
  const kill = vi.fn();
  const output = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (closeOutput) controller.close();
    },
  });

  return {
    process: {
      exit: overrides.exit ?? Promise.resolve(0),
      output,
      kill,
    },
    kill,
  };
}

interface FakeTransport {
  instance: WebContainerInstanceTransport;
  mount: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof vi.fn>;
  teardown: ReturnType<typeof vi.fn>;
  emitServerReady: (port: number, url: string) => void;
  serverReadyUnsubscribe: ReturnType<typeof vi.fn>;
}

function fakeTransport(): FakeTransport {
  let listener: WebContainerServerReadyListener | null = null;
  const serverReadyUnsubscribe = vi.fn();
  const mount = vi.fn(async (_tree: WebContainerFileTree) => undefined);
  const spawn = vi.fn(
    async (_cmd: string, _args?: string[], _options?: WebContainerSpawnOptions) =>
      fakeProcess().process,
  );
  const teardown = vi.fn();

  const instance: WebContainerInstanceTransport = {
    mount,
    spawn,
    on: (_event, l) => {
      listener = l;
      return serverReadyUnsubscribe;
    },
    teardown,
  };

  return {
    instance,
    mount,
    spawn,
    teardown,
    serverReadyUnsubscribe,
    emitServerReady: (port, url) => listener?.(port, url),
  };
}

describe('WebContainerLane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start', () => {
    it('rejects a non-webcontainers LaneSpec without booting anything', async () => {
      const boot = vi.fn();
      const lane = new WebContainerLane(boot);

      await expect(lane.start({ kind: 'e2b' })).rejects.toThrow(LaneUnavailableError);
      expect(boot).not.toHaveBeenCalled();
    });

    it('boots and returns a handle for a webcontainers LaneSpec', async () => {
      const { instance } = fakeTransport();
      const boot = vi.fn(async () => instance);
      const lane = new WebContainerLane(boot);

      const handle = await lane.start({ kind: 'webcontainers' });

      expect(boot).toHaveBeenCalledTimes(1);
      expect(handle.kind).toBe('webcontainers');
      expect(typeof handle.id).toBe('string');
    });

    it('wraps a boot() failure in LaneUnavailableError', async () => {
      const boot = vi.fn(async () => {
        throw new Error('no SharedArrayBuffer');
      });
      const lane = new WebContainerLane(boot);

      await expect(lane.start({ kind: 'webcontainers' })).rejects.toThrow(LaneUnavailableError);
    });

    it('refuses a second concurrent start() before the first handle is disposed', async () => {
      const { instance } = fakeTransport();
      const boot = vi.fn(async () => instance);
      const lane = new WebContainerLane(boot);

      await lane.start({ kind: 'webcontainers' });

      await expect(lane.start({ kind: 'webcontainers' })).rejects.toThrow(LaneUnavailableError);
      expect(boot).toHaveBeenCalledTimes(1);
    });

    it('allows starting again once the previous handle has been disposed', async () => {
      const { instance } = fakeTransport();
      const boot = vi.fn(async () => instance);
      const lane = new WebContainerLane(boot);

      const first = await lane.start({ kind: 'webcontainers' });
      await lane.dispose(first);
      const second = await lane.start({ kind: 'webcontainers' });

      expect(boot).toHaveBeenCalledTimes(2);
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('writeFiles', () => {
    it('converts a flat FileMap into a nested tree, inferring directories from path segments', async () => {
      const { instance, mount } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      await lane.writeFiles(handle, {
        'package.json': '{"name":"fixture"}',
        'src/index.ts': 'console.log(1);',
        'src/lib/util.ts': 'export {};',
      });

      expect(mount).toHaveBeenCalledTimes(1);
      const tree = mount.mock.calls[0][0] as WebContainerFileTree;
      expect(tree['package.json']).toEqual({ file: { contents: '{"name":"fixture"}' } });

      const src = tree['src'];
      if (!src || !('directory' in src)) throw new Error('expected src to be a directory node');
      expect(src.directory['index.ts']).toEqual({ file: { contents: 'console.log(1);' } });

      const lib = src.directory['lib'];
      if (!lib || !('directory' in lib)) throw new Error('expected src/lib to be a directory node');
      expect(lib.directory['util.ts']).toEqual({ file: { contents: 'export {};' } });
    });

    it('throws ExecFailedError when mount() rejects', async () => {
      const { instance, mount } = fakeTransport();
      mount.mockRejectedValueOnce(new Error('disk full'));
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      await expect(lane.writeFiles(handle, { 'a.txt': 'x' })).rejects.toThrow(ExecFailedError);
    });

    it('throws LaneUnavailableError for a handle from a lane that was never started', async () => {
      const lane = new WebContainerLane(vi.fn());

      await expect(
        lane.writeFiles({ id: 'nope', kind: 'webcontainers' }, {}),
      ).rejects.toThrow(LaneUnavailableError);
    });

    it('throws LaneUnavailableError once the handle has been disposed', async () => {
      const { instance } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });
      await lane.dispose(handle);

      await expect(lane.writeFiles(handle, {})).rejects.toThrow(LaneUnavailableError);
    });
  });

  describe('exec', () => {
    it('spawns the command with its args and cwd, and collects stdout with the exit code', async () => {
      const { instance, spawn } = fakeTransport();
      const { process } = fakeProcess({ exit: Promise.resolve(0), chunks: ['hello ', 'world'] });
      spawn.mockResolvedValueOnce(process);
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      const result = await lane.exec(handle, { cmd: 'npm', args: ['install'], cwd: '/app' });

      expect(spawn).toHaveBeenCalledWith('npm', ['install'], { cwd: '/app' });
      expect(result).toEqual({ exitCode: 0, stdout: 'hello world', stderr: '' });
    });

    it('defaults args to an empty array when the Command omits them', async () => {
      const { instance, spawn } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      await lane.exec(handle, { cmd: 'node' });

      expect(spawn).toHaveBeenCalledWith('node', [], { cwd: undefined });
    });

    it('surfaces a non-zero exit code without throwing', async () => {
      const { instance, spawn } = fakeTransport();
      const { process } = fakeProcess({ exit: Promise.resolve(1) });
      spawn.mockResolvedValueOnce(process);
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      const result = await lane.exec(handle, { cmd: 'npm', args: ['test'] });

      expect(result.exitCode).toBe(1);
    });

    it('throws ExecFailedError when spawn() rejects', async () => {
      const { instance, spawn } = fakeTransport();
      spawn.mockRejectedValueOnce(new Error('command not found'));
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      await expect(lane.exec(handle, { cmd: 'doesnotexist' })).rejects.toThrow(ExecFailedError);
    });

    it('throws LaneTimeoutError and kills the process if it never exits', async () => {
      const { instance, spawn } = fakeTransport();
      const { process, kill } = fakeProcess({ exit: new Promise<number>(() => {}) });
      spawn.mockResolvedValueOnce(process);
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      const execPromise = lane.exec(handle, { cmd: 'sleep', args: ['999999'] });
      const assertion = expect(execPromise).rejects.toThrow(LaneTimeoutError);
      await vi.runAllTimersAsync();
      await assertion;

      expect(kill).toHaveBeenCalledTimes(1);
    });

    it('throws LaneUnavailableError for an unknown handle', async () => {
      const lane = new WebContainerLane(vi.fn());

      await expect(
        lane.exec({ id: 'nope', kind: 'webcontainers' }, { cmd: 'ls' }),
      ).rejects.toThrow(LaneUnavailableError);
    });
  });

  describe('previewUrl', () => {
    it('resolves the URL once server-ready fires', async () => {
      const { instance, emitServerReady, serverReadyUnsubscribe } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      const previewPromise = lane.previewUrl(handle);
      emitServerReady(3000, 'https://fixture.local-credentialless.webcontainer-api.io');

      const url = await previewPromise;
      expect(url).toBeInstanceOf(URL);
      expect(url?.href).toBe('https://fixture.local-credentialless.webcontainer-api.io/');
      expect(serverReadyUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('resolves null and unsubscribes if no server ever becomes ready', async () => {
      const { instance, serverReadyUnsubscribe } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      const previewPromise = lane.previewUrl(handle);
      await vi.runAllTimersAsync();

      expect(await previewPromise).toBeNull();
      expect(serverReadyUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('throws LaneUnavailableError for an unknown handle', async () => {
      const lane = new WebContainerLane(vi.fn());

      await expect(lane.previewUrl({ id: 'nope', kind: 'webcontainers' })).rejects.toThrow(
        LaneUnavailableError,
      );
    });
  });

  describe('dispose', () => {
    it('tears the container down and frees the lane for a new start()', async () => {
      const { instance, teardown } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      await lane.dispose(handle);

      expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: a second dispose() of the same handle is a no-op', async () => {
      const { instance, teardown } = fakeTransport();
      const lane = new WebContainerLane(async () => instance);
      const handle = await lane.start({ kind: 'webcontainers' });

      await lane.dispose(handle);
      await lane.dispose(handle);

      expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for a handle from a lane that was never started', async () => {
      const lane = new WebContainerLane(vi.fn());

      await expect(
        lane.dispose({ id: 'never-started', kind: 'webcontainers' }),
      ).resolves.toBeUndefined();
    });
  });
});
