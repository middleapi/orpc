/**
 * A per-key mutex for one process. Callers of one key run one at a time in
 * order, while other keys run independently.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#adapters | Cache Helpers - Adapters}
 */
export class MemoryLock {
  private readonly pending = new Map<string, Promise<unknown>>()

  /**
   * Runs `fn` once the key is free. `waited` is `true` when another caller
   * held it first.
   */
  async run<T>(key: string, fn: (waited: boolean) => Promise<T>): Promise<T> {
    const previous = this.pending.get(key)
    const run = () => fn(previous !== undefined)
    // A failed predecessor still hands the turn on.
    const current = previous === undefined ? run() : previous.then(run, run)

    this.pending.set(key, current)

    try {
      return await current
    }
    finally {
      if (this.pending.get(key) === current) {
        this.pending.delete(key)
      }
    }
  }
}
