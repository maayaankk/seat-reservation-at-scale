export class Semaphore {
  private free: number;
  private waiters: Array<() => void> = [];

  constructor(private readonly size: number) {
    this.free = size;
  }

  get queued(): number {
    return this.waiters.length;
  }

  get inflight(): number {
    return this.size - this.free;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) {
      this.free--;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export const writeSemaphore = new Semaphore(30);
export const readSemaphore = new Semaphore(6);
export const opsSemaphore = new Semaphore(2);