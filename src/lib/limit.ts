/** A counting semaphore: bounds how many async tasks run at once. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  }

  get inUse(): number {
    return this.active;
  }

  /** Try to take a slot without waiting. */
  tryAcquire(): boolean {
    if (this.active >= this.capacity) return false;
    this.active++;
    return true;
  }

  async acquire(): Promise<void> {
    if (this.tryAcquire()) return;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else this.active = Math.max(0, this.active - 1);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
