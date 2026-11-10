import { describe, it, expect } from "vitest";
import { canOpenBrowser } from "../src/can-open-browser";

// Can this machine put a browser in front of a person?
//
// It matters because signing in waits on a loopback redirect. On a laptop the
// browser opens and comes back. Over SSH, `open`/`xdg-open` fails silently —
// the CLI's openBrowser catches and ignores it, "the URL is printed as a
// fallback" — and the printed URL is useless too: opening it on YOUR computer
// redirects to a localhost on THAT computer, where nothing is listening. The
// sign-in then waits until a 30-minute backstop expires.
//
// So this is the check that turns an invisible half-hour hang into an
// instruction. Getting it wrong in either direction is a real cost: a false
// "no" strands someone sitting at a desktop, a false "yes" hangs a server.

describe("canOpenBrowser", () => {
  it("says yes on a mac with nothing unusual set", () => {
    expect(canOpenBrowser({ platform: "darwin", env: {} })).toBe(true);
  });

  it("says yes on windows", () => {
    expect(canOpenBrowser({ platform: "win32", env: {} })).toBe(true);
  });

  it("says no over ssh, whichever variable the server sets", () => {
    expect(
      canOpenBrowser({ platform: "darwin", env: { SSH_CONNECTION: "10.0.0.1 22" } })
    ).toBe(false);
    expect(canOpenBrowser({ platform: "linux", env: { SSH_TTY: "/dev/pts/0" } })).toBe(
      false
    );
  });

  it("says no on linux with no display server", () => {
    expect(canOpenBrowser({ platform: "linux", env: {} })).toBe(false);
  });

  it("says yes on linux running a desktop, X11 or wayland", () => {
    expect(canOpenBrowser({ platform: "linux", env: { DISPLAY: ":0" } })).toBe(true);
    expect(
      canOpenBrowser({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } })
    ).toBe(true);
  });

  it("believes an explicit override either way", () => {
    // An answer the machine cannot work out for itself: a forwarded display, a
    // container with a tunnel, someone who knows better than this heuristic.
    expect(
      canOpenBrowser({ platform: "linux", env: { MARKBASE_BROWSER: "1" } })
    ).toBe(true);
    expect(
      canOpenBrowser({ platform: "darwin", env: { MARKBASE_BROWSER: "0" } })
    ).toBe(false);
  });

  it("lets ssh with a forwarded display through, since that one does work", () => {
    expect(
      canOpenBrowser({
        platform: "linux",
        env: { SSH_CONNECTION: "10.0.0.1 22", DISPLAY: "localhost:10.0" },
      })
    ).toBe(true);
  });
});
