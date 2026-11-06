/** App-owned terminals outlive the renderer consoles attached to them. */
export interface ManagedTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  snapshot(): Promise<string>;
  onData(listener: (data: string) => void): () => void;
  onExit(listener: (exitCode: number) => void): () => void;
  kill(): void;
}

class ManagedTerminalRegistry {
  private readonly terminals = new Map<string, ManagedTerminal>();

  register(id: string, terminal: ManagedTerminal): void {
    if (this.terminals.has(id)) throw new Error(`Terminal already registered: ${id}`);
    this.terminals.set(id, terminal);
  }

  get(id: string): ManagedTerminal | undefined {
    return this.terminals.get(id);
  }

  unregister(id: string): void {
    this.terminals.delete(id);
  }

  killAll(): void {
    for (const terminal of this.terminals.values()) terminal.kill();
    this.terminals.clear();
  }
}

export const managedTerminalRegistry = new ManagedTerminalRegistry();
