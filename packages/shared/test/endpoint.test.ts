import { describe, it, expect, vi } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "../src/auth";
import {
  endpointSet,
  isDefinedEndpointId,
  observeEndpointCalls,
  signedIn,
  type Access,
  type EndpointCall,
  type JsonValue,
  type EndpointDef,
} from "../src/endpoint";
import { descriptionModule, routeFiles } from "../src/endpoint-gen";
import { toolsFrom } from "../src/endpoint-tools";

// The machinery every feature defines its endpoints with. What a feature
// relies on: that the access check runs before its code and can refuse, that a
// definition which hides an endpoint from agents has to say why, and that the
// route files and descriptions generated from definitions say what they said.

const def = (over: Partial<EndpointDef> = {}): EndpointDef => ({
  id: "notes_listNotes",
  method: "GET",
  path: "/notes",
  scope: "read",
  summary: "List notes",
  ...over,
});

const allow: Access<{ who: string }> = async () => ({ ok: true, ctx: { who: "ada" } });
const refuse: Access<{ who: string }> = async () => ({
  ok: false,
  response: Response.json({ error: "no" }, { status: 403 }),
});
const req = (headers: Record<string, string> = {}) => new Request("https://x.test/api/v1/notes", { headers });

describe("endpointSet", () => {
  it("runs the access check first, and hands the code what it answered", async () => {
    const notes = endpointSet<EndpointDef>("notes");
    const seen: string[] = [];
    const e = notes.define(def(), allow, async (_req, _params, ctx) => {
      seen.push(ctx.who);
      return new Response("ok");
    });
    expect([(await e.handle(req(), {})).status, seen]).toEqual([200, ["ada"]]);
  });

  it("a refused caller never reaches the code", async () => {
    const notes = endpointSet<EndpointDef>("notes");
    let ran = false;
    const e = notes.define(def(), refuse, async () => {
      ran = true;
      return new Response("ok");
    });
    expect([(await e.handle(req(), {})).status, ran]).toEqual([403, false]);
  });

  it("keeps ids to its feature, and unique", () => {
    const notes = endpointSet<EndpointDef>("notes");
    notes.define(def(), allow, async () => new Response("ok"));
    expect(() => notes.define(def(), allow, async () => new Response("ok"))).toThrow(/defined twice/);
    expect(() => notes.define(def({ id: "docs_listNotes" }), allow, async () => new Response("ok"))).toThrow(
      /must be notes_/
    );
  });

  it("hides an endpoint from agents only with a reason, and takes no reason otherwise", () => {
    const notes = endpointSet<EndpointDef>("notes");
    const run = async () => new Response("ok");
    expect(() => notes.define(def({ humanOnly: true }), allow, run)).toThrow(/must say why/);
    expect(() => notes.define(def({ why: "Transport for the editor, not an action." }), allow, run)).toThrow(
      /but is not/
    );
    const hidden = notes.define(
      def({ humanOnly: true, why: "Transport for the editor, not an action." }),
      allow,
      run
    );
    expect(toolsFrom(notes.defined().map((e) => e.def))).toEqual([]);
    expect(hidden.def.humanOnly).toBe(true);
  });

  it("an endpoint that checks itself has to say why", () => {
    const notes = endpointSet<EndpointDef>("notes");
    const run = async () => new Response("ok");
    expect(() => notes.selfChecked(def(), "because", run)).toThrow(/must say why/);
    expect(notes.selfChecked(def(), "The rule depends on which query parameter is given.", run).def.id).toBe(
      "notes_listNotes"
    );
  });

  it("routes by id with the path's parameters, and refuses an id nothing defines", async () => {
    const notes = endpointSet<EndpointDef>("notes");
    notes.define(def({ id: "notes_readNote", path: "/notes/:id" }), allow, async (_req, { id }) => new Response(id));
    const res = await notes.route("notes_readNote")(req(), { params: Promise.resolve({ id: "n1" }) });
    expect(await res.text()).toBe("n1");
    expect(() => notes.route("notes_nope")).toThrow(/No endpoint is defined/);
  });
});

describe("signedIn", () => {
  const caller: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };

  it("admits the caller the gate attached, and refuses a request with none", async () => {
    const ok = await signedIn(req({ [CALLER_HEADER]: serializeCaller(caller) }), {});
    expect(ok.ok && ok.ctx.ownerId).toBe("owner_1");
    const no = await signedIn(req(), {});
    expect(no.ok ? 200 : no.response.status).toBe(401);
  });
});

describe("what is generated from definitions", () => {
  const defs = [
    def({ id: "notes_deleteNote", method: "DELETE", path: "/notes/:id/parts/:partId" }),
    def({ id: "notes_readNote", method: "GET", path: "/notes/:id/parts/:partId" }),
    def(),
  ];

  it("writes one route file per path, one export per method, each naming its endpoint", () => {
    const files = routeFiles(defs, {
      header: "// GENERATED\n",
      routeName: "notesRoute",
      routeImport: (file) => `import { notesRoute } from "${"../".repeat(file.split("/").length)}handlers";`,
      runtime: "nodejs",
    });
    expect(files.map((f) => f.file)).toEqual(["notes/[id]/parts/[partId]/route.ts", "notes/route.ts"]);
    expect(files[0].source).toBe(
      "// GENERATED\n" +
        'import { notesRoute } from "../../../../../handlers";\n\n' +
        'export const runtime = "nodejs";\n\n' +
        'export const GET = notesRoute("notes_readNote");\n' +
        'export const DELETE = notesRoute("notes_deleteNote");\n'
    );
  });

  it("writes the descriptions as plain data that reads back as the definitions", () => {
    const text = descriptionModule(defs, {
      header: "// GENERATED\n",
      typeImport: 'import type { EndpointDef } from "./endpoint";',
      typeName: "EndpointDef",
      exportName: "NOTES",
    });
    const literal = text.slice(text.indexOf("= ") + 2, text.lastIndexOf(";"));
    expect(JSON.parse(literal)).toEqual(defs);
    expect(text).toContain("export const NOTES: readonly EndpointDef[] =");
  });
});

describe("observing endpoint calls", () => {
  const route = async (set: ReturnType<typeof endpointSet<EndpointDef>>, id: string, params: { [name: string]: string } = {}) =>
    set.route(id)(req(), { params: Promise.resolve(params) });

  it("tells the observer of every call: which endpoint, the status, the time", async () => {
    const seen: EndpointCall[] = [];
    observeEndpointCalls((call) => seen.push(call));
    const notes = endpointSet<EndpointDef>("observed");
    notes.define(def({ id: "observed_list" }), allow, async () => Response.json({ ok: true }));
    notes.define(def({ id: "observed_read", path: "/notes/:id" }), refuse, async () => Response.json({ ok: true }));
    await route(notes, "observed_list");
    await route(notes, "observed_read", { id: "n1" });
    observeEndpointCalls(null);
    expect(seen.map((c) => [c.def.id, c.status, c.params])).toEqual([
      ["observed_list", 200, {}],
      ["observed_read", 403, { id: "n1" }],
    ]);
    expect(seen.every((c) => c.durationMs >= 0)).toBe(true);
  });

  it("hands the observer empty params when the route was given none", async () => {
    const seen: EndpointCall[] = [];
    observeEndpointCalls((call) => seen.push(call));
    const notes = endpointSet<EndpointDef>("bare");
    notes.define(def({ id: "bare_list" }), allow, async () => Response.json({ ok: true }));
    // What the framework passes for a path with no dynamic segment.
    const none = Promise.resolve(undefined) as Promise<undefined> & Promise<{ [name: string]: string }>;
    await notes.route("bare_list")(req(), { params: none });
    observeEndpointCalls(null);
    expect(seen.map((c) => c.params)).toEqual([{}]);
  });

  it("reports a handler that throws as a 500, and still throws", async () => {
    const seen: EndpointCall[] = [];
    observeEndpointCalls((call) => seen.push(call));
    const notes = endpointSet<EndpointDef>("thrown");
    notes.define(def({ id: "thrown_boom" }), allow, async () => {
      throw new Error("boom");
    });
    await expect(route(notes, "thrown_boom")).rejects.toThrow("boom");
    observeEndpointCalls(null);
    expect(seen.map((c) => [c.def.id, c.status])).toEqual([["thrown_boom", 500]]);
  });

  it("answers the caller even when the observer throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    observeEndpointCalls(() => {
      throw new Error("observer down");
    });
    const notes = endpointSet<EndpointDef>("sturdy");
    notes.define(def({ id: "sturdy_list" }), allow, async () => Response.json({ ok: true }));
    const res = await route(notes, "sturdy_list");
    observeEndpointCalls(null);
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("tells nobody once the observer is removed", async () => {
    const seen: EndpointCall[] = [];
    observeEndpointCalls((call) => seen.push(call));
    observeEndpointCalls(null);
    const notes = endpointSet<EndpointDef>("quiet");
    notes.define(def({ id: "quiet_list" }), allow, async () => Response.json({ ok: true }));
    await route(notes, "quiet_list");
    expect(seen).toEqual([]);
  });

  it("knows the id of every endpoint that has been defined, in any set", () => {
    const a = endpointSet<EndpointDef>("alpha");
    a.define(def({ id: "alpha_list" }), allow, async () => Response.json({}));
    expect(isDefinedEndpointId("alpha_list")).toBe(true);
    expect(isDefinedEndpointId("alpha_missing")).toBe(false);
  });
});

describe("an observer reading what a call answered", () => {
  it("can read the answer while it is told, and the caller still gets the whole answer", async () => {
    const reads: Promise<JsonValue | null>[] = [];
    const stop = observeEndpointCalls((call) => {
      reads.push(call.readBody());
    });
    const set = endpointSet<EndpointDef>("answered");
    set.define(def({ id: "answered_make", method: "POST" }), allow, async () => Response.json({ doc: { id: "d1" } }, { status: 201 }));
    const res = await set.route("answered_make")(req(), { params: Promise.resolve({}) });
    stop();
    expect(await res.json()).toEqual({ doc: { id: "d1" } });
    expect(await reads[0]).toEqual({ doc: { id: "d1" } });
  });

  it("reads null for an answer that is not JSON", async () => {
    const reads: Promise<JsonValue | null>[] = [];
    const stop = observeEndpointCalls((call) => {
      reads.push(call.readBody());
    });
    const set = endpointSet<EndpointDef>("plain");
    set.define(def({ id: "plain_text" }), allow, async () => new Response("hello"));
    const res = await set.route("plain_text")(req(), { params: Promise.resolve({}) });
    stop();
    expect(await res.text()).toBe("hello");
    expect(await reads[0]).toBeNull();
  });
});
