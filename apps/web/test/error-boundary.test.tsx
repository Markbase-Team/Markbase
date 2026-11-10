import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

// A boundary that renders but says nothing is the thing we already had. What
// these assert is that the two facts worth having — the message (development)
// and the digest (production, where Next redacts the message) — actually reach
// the page, and that there is a way out.

const noop = () => {};

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("app/error.tsx", () => {
  it("shows the message, which in development is the real one", () => {
    const html = render(
      <AppError error={new Error("supabaseKey is required.")} reset={noop} />
    );

    expect(html).toContain("supabaseKey is required.");
  });

  it("shows the digest, which in production is all there is", () => {
    const error = Object.assign(new Error("An error occurred"), { digest: "3641827293" });

    const html = render(<AppError error={error} reset={noop} />);

    expect(html).toContain("3641827293");
  });

  it("offers a way out rather than a dead end", () => {
    const html = render(<AppError error={new Error("boom")} reset={noop} />);

    expect(html).toContain("Try again");
    expect(html).toContain("Reload");
  });

  it("renders without a digest — most errors have none", () => {
    const html = render(<AppError error={new Error("boom")} reset={noop} />);

    expect(html).not.toContain("digest");
  });
});

describe("app/global-error.tsx", () => {
  it("brings its own html and body, because it replaces the root layout", () => {
    const html = render(<GlobalError error={new Error("layout died")} reset={noop} />);

    expect(html).toContain("<html");
    expect(html).toContain("<body");
  });

  it("still says what happened", () => {
    const html = render(<GlobalError error={new Error("layout died")} reset={noop} />);

    expect(html).toContain("layout died");
    expect(html).toContain("Try again");
  });
});
