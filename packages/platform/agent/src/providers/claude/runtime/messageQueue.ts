/**
 * An async iterable you can push into.
 *
 * Streaming input mode wants the prompt as an `AsyncIterable<SDKUserMessage>` —
 * the CLI reads from it for as long as the session lives, which is what makes a
 * session outlast a single turn. Nothing in the standard library is both an
 * async iterable and something a caller can hand items to later, so this is it.
 *
 * The whole point is the gap between the two sides: the consumer usually asks
 * before there is anything to give (the CLI is waiting for the user to type),
 * and occasionally the producer runs ahead (two messages sent while a turn is
 * still going). Both are ordinary, so both are buffered rather than dropped.
 */
export class MessageQueue<T> implements AsyncIterable<T> {
  /** Pushed but not yet taken. */
  private readonly waiting: T[] = [];
  /** Asked for but not yet answered — the CLI, sitting idle. */
  private readonly askers: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  /** Hand an item to whoever is waiting, or hold it until someone asks. */
  push(item: T): void {
    if (this.ended) return;
    const asker = this.askers.shift();
    if (asker) asker({ value: item, done: false });
    else this.waiting.push(item);
  }

  /**
   * No more items are coming.
   *
   * Anything already pushed is still delivered first: ending is "that was the
   * last one", not "forget the ones you have".
   */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const asker of this.askers.splice(0)) asker({ value: undefined, done: true });
  }

  get closed(): boolean {
    return this.ended;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const buffered = this.waiting.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.ended) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.askers.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
