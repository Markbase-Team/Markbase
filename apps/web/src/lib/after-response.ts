import { after } from "next/server";

/**
 * Run after the response has gone, so the work is never something a caller
 * waits for. Outside a request (a test, a script) there is no response to
 * wait behind, and it runs at once.
 */
export function afterResponse(work: () => Promise<unknown>): void {
  try {
    after(async () => {
      await work();
    });
  } catch {
    void work();
  }
}
