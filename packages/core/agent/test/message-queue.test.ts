import { describe, it, expect } from "vitest";
import { MessageQueue } from "../src/providers/claude/runtime/messageQueue";

// This is the seam that makes a session outlive a turn, so the two orderings
// that actually happen in a chat both have to work: the CLI asking before the
// user has typed, and the user typing twice while a turn is still running.

const take = async <T>(it: AsyncIterator<T>, n: number): Promise<T[]> => {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const r = await it.next();
    if (r.done) break;
    out.push(r.value);
  }
  return out;
};

describe("asking before there is anything to give", () => {
  it("delivers the item the moment it is pushed", async () => {
    const q = new MessageQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push("hello");
    expect((await pending).value).toBe("hello");
  });

  it("answers several waiting asks in order", async () => {
    const q = new MessageQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const first = it.next();
    q.push("a");
    expect((await first).value).toBe("a");
    const second = it.next();
    q.push("b");
    expect((await second).value).toBe("b");
  });
});

describe("pushing before anyone asks", () => {
  it("buffers, and hands them over in order", async () => {
    const q = new MessageQueue<string>();
    q.push("one");
    q.push("two");
    expect(await take(q[Symbol.asyncIterator](), 2)).toEqual(["one", "two"]);
  });
});

describe("ending", () => {
  it("still delivers what was already pushed", async () => {
    const q = new MessageQueue<string>();
    q.push("last words");
    q.end();
    expect(await take(q[Symbol.asyncIterator](), 5)).toEqual(["last words"]);
  });

  it("releases a consumer that is waiting", async () => {
    const q = new MessageQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.end();
    expect((await pending).done).toBe(true);
  });

  it("ignores anything pushed afterwards", async () => {
    const q = new MessageQueue<string>();
    q.end();
    q.push("too late");
    expect(await take(q[Symbol.asyncIterator](), 5)).toEqual([]);
    expect(q.closed).toBe(true);
  });

  it("is safe to end twice", async () => {
    const q = new MessageQueue<string>();
    q.end();
    expect(() => q.end()).not.toThrow();
  });
});

describe("a whole conversation's worth", () => {
  it("hands everything back in the order it was pushed", async () => {
    const q = new MessageQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pushed: number[] = [];
    const seen: number[] = [];

    for (let i = 0; i < 20; i++) {
      const pending = it.next();
      q.push(i);
      pushed.push(i);
      seen.push((await pending).value as number);
      // A message sent while the turn is still running: it waits its turn
      // rather than jumping the queue or being dropped.
      if (i % 3 === 0) {
        q.push(100 + i);
        pushed.push(100 + i);
      }
    }
    q.end();
    seen.push(...(await take(it, 50)));

    expect(seen).toEqual(pushed);
  });
});
