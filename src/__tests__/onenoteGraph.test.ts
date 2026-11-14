/**
 * Plan W10.E49: OneNote through Microsoft Graph, behind OAuth (PKCE).
 *
 * The Graph responses below are SYNTHETIC: hand-written in the shapes the
 * Microsoft Graph v1.0 reference documents for sections, sectionGroups,
 * pages, page content and resources (ids, names and HTML are made up).
 * They are served by a stand-in transport (`fakeGraph`), and the real
 * client code runs against it end to end. A live sign-in against a real
 * account is owed to the owner (see the PR).
 *
 * The PKCE check uses RFC 7636's own test vector (Appendix B).
 */
import { describe, expect, it } from "vitest";
import {
  GRAPH,
  GraphClient,
  GraphError,
  OneNoteAuthError,
  authorizeUrl,
  base64Url,
  codeChallenge,
  convertOneNoteGraph,
  createPkce,
  exchangeCode,
  isGraphUrl,
  listSections,
  prepareOneNoteHtml,
  readRedirect,
  refreshTokens,
} from "../storage/import/onenoteGraph";

const cfg = { clientId: "00000000-1111-2222-3333-444444444444", redirectUri: "https://lumen-md.vercel.app/oauth/onenote" };

describe("PKCE (RFC 7636)", () => {
  it("S256 of the RFC's verifier is the RFC's challenge (Appendix B)", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("the RFC's octets encode to its verifier (base64url, no padding)", () => {
    const octets = Uint8Array.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
    expect(base64Url(octets)).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  });

  it("a fresh verifier is 43 characters of the unreserved set, with a state", async () => {
    const p = await createPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(p.challenge).toBe(await codeChallenge(p.verifier));
  });
});

describe("sign-in", () => {
  it("the authorize URL asks for Notes.Read only (plus offline_access), with S256", () => {
    const u = new URL(authorizeUrl(cfg, { challenge: "CH", state: "ST" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: cfg.clientId,
      response_type: "code",
      redirect_uri: cfg.redirectUri,
      response_mode: "query",
      scope: "Notes.Read offline_access",
      state: "ST",
      code_challenge: "CH",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });

  it("the redirect: a code only when state matches; an error is thrown with its code", () => {
    expect(readRedirect(`${cfg.redirectUri}?code=abc&state=ST`, "ST")).toBe("abc");
    expect(() => readRedirect(`${cfg.redirectUri}?code=abc&state=XX`, "ST")).toThrow(OneNoteAuthError);
    expect(() => readRedirect(`${cfg.redirectUri}?code=abc&state=`, "")).toThrow(/state/);
    try {
      readRedirect(`${cfg.redirectUri}?error=access_denied&error_description=The+user+declined`, "ST");
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(OneNoteAuthError);
      expect((e as OneNoteAuthError).code).toBe("access_denied");
      expect((e as Error).message).toBe("The user declined");
    }
  });

  it("exchanges the code with the verifier and no secret; refreshes; maps a token error", async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      calls.push({ url, body });
      if (body.get("refresh_token") === "bad") return new Response(JSON.stringify({ error: "invalid_grant", error_description: "AADSTS70000: expired" }), { status: 400 });
      return new Response(JSON.stringify({ token_type: "Bearer", scope: "Notes.Read", expires_in: 3600, access_token: "AT", refresh_token: "RT" }));
    }) as unknown as typeof fetch;
    const t = await exchangeCode(cfg, "CODE", "VERIFIER", fetcher, () => 1_000_000);
    expect(t).toEqual({ accessToken: "AT", refreshToken: "RT", expiresAt: 1_000_000 + 3540 * 1000 });
    expect(calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(Object.fromEntries(calls[0].body)).toEqual({ client_id: cfg.clientId, scope: "Notes.Read offline_access", grant_type: "authorization_code", code: "CODE", redirect_uri: cfg.redirectUri, code_verifier: "VERIFIER" });
    expect(calls[0].body.has("client_secret")).toBe(false);
    expect((await refreshTokens(cfg, "RT", fetcher)).accessToken).toBe("AT");
    await expect(refreshTokens(cfg, "bad", fetcher)).rejects.toMatchObject({ code: "invalid_grant", message: "AADSTS70000: expired" });
  });
});

// ── A stand-in Graph transport serving SYNTHETIC, documented-shape responses ──

const NB = (id: string, displayName: string) => ({ id, displayName, self: `${GRAPH}/me/onenote/notebooks/${id}` });
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1);
const PDF = new TextEncoder().encode("%PDF-1.4 synthetic");

function fakeGraph(overrides: Record<string, (req: Request) => Response> = {}) {
  const seen: { url: string; auth: string | null }[] = [];
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
  const routes: Record<string, (req: Request) => Response> = {
    "/me/onenote/sectionGroups?$expand=parentNotebook,parentSectionGroup&$select=id,displayName": () =>
      json({
        "@odata.context": `${GRAPH}/$metadata#users('me')/onenote/sectionGroups`,
        value: [
          { id: "1-SG-A", displayName: "Courses", parentNotebook: NB("1-NB-WORK", "Work"), parentSectionGroup: null },
          { id: "1-SG-B", displayName: "2026", parentNotebook: NB("1-NB-WORK", "Work"), parentSectionGroup: { id: "1-SG-A", displayName: "Courses" } },
        ],
      }),
    "/me/onenote/sections?$expand=parentNotebook,parentSectionGroup&$select=id,displayName": () =>
      json({
        value: [
          { id: "1-S-QUICK", displayName: "Quick Notes", parentNotebook: NB("1-NB-PERSONAL", "אישי"), parentSectionGroup: null },
          { id: "1-S-ALGO", displayName: "Algorithms", parentNotebook: NB("1-NB-WORK", "Work"), parentSectionGroup: { id: "1-SG-B", displayName: "2026" } },
        ],
        "@odata.nextLink": `${GRAPH}/me/onenote/sections?$skiptoken=PAGE2`,
      }),
    "/me/onenote/sections?$skiptoken=PAGE2": () => json({ value: [{ id: "1-S-EMPTY", displayName: "Empty", parentNotebook: NB("1-NB-WORK", "Work"), parentSectionGroup: null }] }),
    "/me/onenote/sections/1-S-QUICK/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,order&$top=100": () =>
      json({
        value: [
          { id: "1-P-2", title: "רשימת קניות", createdDateTime: "2026-10-02T08:00:00Z", lastModifiedDateTime: "2026-10-03T09:30:00Z", level: 0, order: 1 },
          { id: "1-P-1", title: "Meeting", createdDateTime: "2026-10-01T08:00:00Z", lastModifiedDateTime: "2026-10-01T10:00:00Z", level: 0, order: 0 },
          { id: "1-P-3", title: "Meeting", createdDateTime: "2026-10-04T08:00:00Z", lastModifiedDateTime: "2026-10-04T08:00:00Z", level: 1, order: 2 },
        ],
      }),
    "/me/onenote/sections/1-S-ALGO/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,order&$top=100": () => json({ value: [{ id: "1-P-BROKEN", title: "Broken page", level: 0, order: 0 }] }),
    "/me/onenote/sections/1-S-EMPTY/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,order&$top=100": () => json({ value: [] }),
    "/me/onenote/pages/1-P-1/content": () =>
      new Response(
        `<html><head><title>Meeting</title><meta name="created" content="2026-10-01T08:00:00.0000000" /></head><body data-absolute-enabled="true" style="font-family:Calibri">
<div id="div:1" data-id="_default" style="position:absolute;left:48px;top:115px;width:624px">
<p>Agenda for <b>Monday</b></p>
<ul><li>Budget</li><li>Hiring</li></ul>
<p data-tag="to-do:completed">Send notes</p>
<img alt="Whiteboard" width="320" height="240" src="${GRAPH}/me/onenote/resources/1-R-IMG/$value" data-src-type="image/png" data-fullres-src="${GRAPH}/me/onenote/resources/1-R-IMGFULL/$value" data-fullres-src-type="image/png" />
<object data-attachment="minutes.pdf" type="application/pdf" data="${GRAPH}/me/onenote/resources/1-R-PDF/$value"></object>
<img alt="tracker" src="https://tracker.example.com/pixel.png" />
</div></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      ),
    "/me/onenote/pages/1-P-2/content": () => new Response(`<html><head><title>רשימת קניות</title></head><body><div><p>חלב ולחם</p></div></body></html>`),
    "/me/onenote/pages/1-P-3/content": () => new Response(`<html><head><title>Meeting</title></head><body><div><p>Follow-up</p></div></body></html>`),
    "/me/onenote/pages/1-P-BROKEN/content": () => new Response(JSON.stringify({ error: { code: "20102", message: "The requested resource does not exist." } }), { status: 404 }),
    "/me/onenote/resources/1-R-IMGFULL/$value": () => new Response(PNG, { headers: { "Content-Type": "image/png" } }),
    "/me/onenote/resources/1-R-PDF/$value": () => new Response(PDF, { headers: { "Content-Type": "application/pdf" } }),
    ...overrides,
  };
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("Authorization");
    seen.push({ url, auth });
    if (!url.startsWith(GRAPH)) throw new Error(`the stand-in only serves Graph: ${url}`);
    const route = routes[url.slice(GRAPH.length)];
    if (!route) return new Response(JSON.stringify({ error: { code: "itemNotFound", message: `no route ${url}` } }), { status: 404 });
    return route(new Request(url));
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

describe("GraphClient", () => {
  it("sends the bearer token only to graph.microsoft.com, over https", async () => {
    const { fetcher, seen } = fakeGraph();
    const g = new GraphClient(() => "TOKEN", { fetch: fetcher });
    expect(isGraphUrl(`${GRAPH}/me`)).toBe(true);
    expect(isGraphUrl("http://graph.microsoft.com/v1.0/me")).toBe(false);
    expect(isGraphUrl("https://graph.microsoft.com.evil.example/v1.0/me")).toBe(false);
    await expect(g.request("https://tracker.example.com/pixel.png")).rejects.toMatchObject({ code: "not_graph" });
    expect(seen).toEqual([]);
    await g.request("/me/onenote/pages/1-P-2/content");
    expect(seen).toEqual([{ url: `${GRAPH}/me/onenote/pages/1-P-2/content`, auth: "Bearer TOKEN" }]);
  });

  it("retries 429 after Retry-After, then succeeds; gives up after maxTries with the Graph error", async () => {
    let n = 0;
    const waits: number[] = [];
    const { fetcher } = fakeGraph({
      "/me/onenote/pages/1-P-2/content": () => (++n < 3 ? new Response("", { status: 429, headers: { "Retry-After": "2" } }) : new Response("<p>ok</p>")),
      "/me/onenote/pages/1-P-3/content": () => new Response(JSON.stringify({ error: { code: "20166", message: "Too many requests" } }), { status: 429 }),
    });
    const g = new GraphClient(() => "T", { fetch: fetcher, sleep: async (ms) => void waits.push(ms), maxTries: 3 });
    expect(await (await g.request("/me/onenote/pages/1-P-2/content")).text()).toBe("<p>ok</p>");
    expect(waits).toEqual([2000, 2000]);
    await expect(g.request("/me/onenote/pages/1-P-3/content")).rejects.toMatchObject({ status: 429, code: "20166" });
    expect(waits).toEqual([2000, 2000, 1000, 2000]);
  });

  it("a 401 is a GraphError, not retried", async () => {
    const { fetcher, seen } = fakeGraph({ "/me/onenote/pages/1-P-2/content": () => new Response(JSON.stringify({ error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } }), { status: 401 }) });
    const g = new GraphClient(() => "T", { fetch: fetcher, sleep: async () => {} });
    const err = await g.request("/me/onenote/pages/1-P-2/content").catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err).toMatchObject({ status: 401, code: "InvalidAuthenticationToken" });
    expect(seen.length).toBe(1);
  });

  it("follows @odata.nextLink, and builds notebook / section group / section paths", async () => {
    const { fetcher } = fakeGraph();
    const sections = await listSections(new GraphClient(() => "T", { fetch: fetcher }));
    expect(sections).toEqual([
      { id: "1-S-QUICK", path: "אישי/Quick Notes" },
      { id: "1-S-ALGO", path: "Work/Courses/2026/Algorithms" },
      { id: "1-S-EMPTY", path: "Work/Empty" },
    ]);
  });
});

describe("page HTML", () => {
  it("attachments become links, images take their full-resolution source", () => {
    const out = prepareOneNoteHtml(`<img alt="a" src="${GRAPH}/x/$value" data-fullres-src="${GRAPH}/full/$value" /><object data-attachment="f.pdf" type="application/pdf" data="${GRAPH}/f/$value"></object>`);
    expect(out).toContain(`src="${GRAPH}/full/$value"`);
    expect(out).not.toContain(`src="${GRAPH}/x/$value"`);
    expect(out).toContain(`<a href="${GRAPH}/f/$value">f.pdf</a>`);
  });
});

describe("convertOneNoteGraph (synthetic account)", () => {
  async function run() {
    const g = fakeGraph();
    const progress: number[] = [];
    const v = await convertOneNoteGraph(new GraphClient(() => "T", { fetch: g.fetcher, sleep: async () => {} }), { onProgress: (d) => progress.push(d) });
    return { v, seen: g.seen, progress };
  }

  it("a note per page, in section order, under notebook/section folders; duplicate titles numbered", async () => {
    const { v, progress } = await run();
    expect([...v.notes.keys()]).toEqual(["אישי/Quick Notes/Meeting.md", "אישי/Quick Notes/רשימת קניות.md", "אישי/Quick Notes/Meeting 2.md"]);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(v.notes.get("אישי/Quick Notes/רשימת קניות.md")).toBe("---\ncreated: 2026-10-02T08:00:00Z\nmodified: 2026-10-03T09:30:00Z\n---\n\nחלב ולחם");
  });

  it("converts the page body, downloads the full-resolution image and the attached file, and embeds them", async () => {
    const { v } = await run();
    const md = v.notes.get("אישי/Quick Notes/Meeting.md")!;
    expect(md).toContain("Agenda for **Monday**");
    expect(md).toMatch(/- Budget\n- Hiring/);
    expect(md).toContain("![Whiteboard](_attachments/Whiteboard.png)");
    expect(md).toContain("[minutes.pdf](_attachments/minutes.pdf)");
    expect(v.attachments.get("אישי/Quick Notes/_attachments/Whiteboard.png")).toEqual(PNG);
    expect(v.attachments.get("אישי/Quick Notes/_attachments/minutes.pdf")).toEqual(PDF);
    expect(v.sourceAttachments).toBe(2);
  });

  it("never fetches the low-resolution copy or a non-Graph image, and never sends the token off Graph", async () => {
    const { seen } = await run();
    expect(seen.some((s) => s.url.includes("1-R-IMG/"))).toBe(false);
    expect(seen.every((s) => s.url.startsWith("https://graph.microsoft.com/v1.0/"))).toBe(true);
  });

  it("a page whose content fails is skipped as unreadable, with Graph's message", async () => {
    const { v } = await run();
    expect(v.skipped).toEqual([{ path: "Work/Courses/2026/Algorithms/Broken page", reason: "unreadable", detail: "The requested resource does not exist." }]);
  });

  it("limit: a preview stops after n pages", async () => {
    const g = fakeGraph();
    const v = await convertOneNoteGraph(new GraphClient(() => "T", { fetch: g.fetcher }), { limit: 1 });
    expect(v.notes.size).toBe(1);
  });
});
