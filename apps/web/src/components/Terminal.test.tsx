import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import Terminal from './Terminal.js';
import type { Handle, InteractiveProcess, SandboxLane } from '../lib/sandbox/types.js';

// xterm.js renders into a real canvas/DOM stack (WebGL/2D canvas, a resize
// observer, requestAnimationFrame-driven rendering) that jsdom doesn't
// provide — same rationale as FileEditor.test.tsx mocking
// @monaco-editor/react. This fake captures onData/onResize listeners and
// records writes so the surrounding piping logic in Terminal itself (not
// xterm.js's own rendering internals) is what's under test.
interface FakeXTermInstance {
  cols: number;
  rows: number;
  written: string[];
  disposed: boolean;
  emitData(data: string): void;
  emitResize(size: { cols: number; rows: number }): void;
}

const instances: FakeXTermInstance[] = [];

vi.mock('@xterm/xterm', () => {
  class FakeTerminal implements FakeXTermInstance {
    cols = 80;
    rows = 24;
    written: string[] = [];
    disposed = false;
    private dataListener: ((data: string) => void) | null = null;
    private resizeListener: ((size: { cols: number; rows: number }) => void) | null = null;

    constructor() {
      instances.push(this);
    }

    open(): void {}

    onData(listener: (data: string) => void) {
      this.dataListener = listener;
      return { dispose: () => (this.dataListener = null) };
    }

    onResize(listener: (size: { cols: number; rows: number }) => void) {
      this.resizeListener = listener;
      return { dispose: () => (this.resizeListener = null) };
    }

    write(data: string): void {
      this.written.push(data);
    }

    writeln(data: string): void {
      this.written.push(`${data}\n`);
    }

    dispose(): void {
      this.disposed = true;
    }

    emitData(data: string): void {
      this.dataListener?.(data);
    }

    emitResize(size: { cols: number; rows: number }): void {
      this.resizeListener?.(size);
    }
  }

  return { Terminal: FakeTerminal };
});

const handle: Handle = { id: 'webcontainers-0', kind: 'webcontainers' };

function fakeInteractiveProcess(overrides: {
  chunks?: string[];
  closeOutput?: boolean;
} = {}) {
  const chunks = overrides.chunks ?? [];
  const closeOutput = overrides.closeOutput ?? false;
  const write = vi.fn();
  const resize = vi.fn();
  const kill = vi.fn();
  const output = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (closeOutput) controller.close();
    },
  });

  const process: InteractiveProcess = {
    output,
    write,
    resize,
    exit: new Promise<number>(() => {}),
    kill,
  };

  return { process, write, resize, kill };
}

function fakeLane(process: InteractiveProcess): { lane: SandboxLane; spawnInteractive: ReturnType<typeof vi.fn> } {
  const spawnInteractive = vi.fn(async () => process);
  const lane: SandboxLane = {
    start: vi.fn(),
    writeFiles: vi.fn(),
    exec: vi.fn(),
    spawnInteractive,
    previewUrl: vi.fn(),
    dispose: vi.fn(),
  };
  return { lane, spawnInteractive };
}

describe('Terminal', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('spawns an interactive shell against the given lane and handle', async () => {
    const { process } = fakeInteractiveProcess();
    const { lane, spawnInteractive } = fakeLane(process);

    render(<Terminal lane={lane} handle={handle} />);

    await waitFor(() => {
      expect(spawnInteractive).toHaveBeenCalledWith(handle, { cmd: 'jsh' });
    });
  });

  it('spawns the shell command passed via props instead of the jsh default', async () => {
    const { process } = fakeInteractiveProcess();
    const { lane, spawnInteractive } = fakeLane(process);

    render(<Terminal lane={lane} handle={handle} shellCommand={{ cmd: 'bash' }} />);

    await waitFor(() => {
      expect(spawnInteractive).toHaveBeenCalledWith(handle, { cmd: 'bash' });
    });
  });

  it('forwards xterm.js keystrokes to the interactive process', async () => {
    const { process, write } = fakeInteractiveProcess();
    const { lane } = fakeLane(process);

    render(<Terminal lane={lane} handle={handle} />);

    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0]!.emitData('ls -la\n');

    expect(write).toHaveBeenCalledWith('ls -la\n');
  });

  it('forwards xterm.js resize events to the interactive process', async () => {
    const { process, resize } = fakeInteractiveProcess();
    const { lane } = fakeLane(process);

    render(<Terminal lane={lane} handle={handle} />);

    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0]!.emitResize({ cols: 120, rows: 50 });

    expect(resize).toHaveBeenCalledWith({ cols: 120, rows: 50 });
  });

  it('resizes the freshly-spawned process to the terminal size once spawned', async () => {
    const { process, resize } = fakeInteractiveProcess();
    const { lane } = fakeLane(process);

    render(<Terminal lane={lane} handle={handle} />);

    await waitFor(() => expect(resize).toHaveBeenCalledWith({ cols: 80, rows: 24 }));
  });

  it('renders process output chunks into the terminal', async () => {
    const { process } = fakeInteractiveProcess({ chunks: ['hello ', 'world'], closeOutput: true });
    const { lane } = fakeLane(process);

    render(<Terminal lane={lane} handle={handle} />);

    await waitFor(() => {
      expect(instances[0]?.written).toEqual(['hello ', 'world']);
    });
  });

  it('kills the process and disposes xterm.js on unmount', async () => {
    const { process, kill } = fakeInteractiveProcess();
    const { lane } = fakeLane(process);

    const { unmount } = render(<Terminal lane={lane} handle={handle} />);
    await waitFor(() => expect(instances).toHaveLength(1));

    unmount();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(instances[0]!.disposed).toBe(true);
  });

  it('writes an error message into the terminal when spawnInteractive rejects', async () => {
    const spawnInteractive = vi.fn(async () => {
      throw new Error('no live WebContainer');
    });
    const lane: SandboxLane = {
      start: vi.fn(),
      writeFiles: vi.fn(),
      exec: vi.fn(),
      spawnInteractive,
      previewUrl: vi.fn(),
      dispose: vi.fn(),
    };

    render(<Terminal lane={lane} handle={handle} />);

    await waitFor(() => {
      expect(instances[0]?.written.join('')).toContain('no live WebContainer');
    });
  });
});
