/**
 * W13.K3: notes in Spotlight / Windows Search — off by default, only with
 * consent, never locked or encrypted notes, a hit opens the note in its
 * vault, and turning it off deletes what was indexed.
 */
import { describe, expect, it } from "vitest";
import { OsSearchIndexer, domainOf, exclusion, itemFor, openLink, plainExcerpt, type Manifest, type OsSearchBridge, type OsSearchItem, type VaultRef } from "../desktop/osSearchIndex";
import { LOCKED_NOTE_MAGIC } from "../storage/lockedNotesRegistry";

/** A fake system index: what Spotlight would hold, by domain. */
function fakeOs(available = true) {
  const items = new Map<string, OsSearchItem>();
  const calls: string[] = [];
  const bridge: OsSearchBridge = {
    available,
    async index(list) {
      calls.push(`index:${list.length}`);
      for (const i of list) items.set(i.id, i);
    },
    async remove(ids) {
      calls.push(`remove:${ids.length}`);
      for (const id of ids) items.delete(id);
    },
    async clearDomain(domain) {
      calls.push(`clear:${domain}`);
      for (const [id, i] of items) if (i.domain === domain) items.delete(id);
    },
  };
  return { bridge, items, calls, search: (q: string) => [...items.values()].filter((i) => (i.title + " " + i.excerpt + " " + i.keywords.join(" ")).includes(q)) };
}

function memStore() {
  let m: Manifest | null = null;
  let on = false;
  return { load: () => m, save: (x: Manifest | null) => void (m = x), enabled: () => on, setEnabled: (v: boolean) => void (on = v), get manifest() { return m; } };
}

const VAULT: VaultRef = { id: "vault-1", name: "מחקר" };
const OTHER: VaultRef = { id: "vault-2", name: "Work" };

const notes = (files: Record<string, string>) => ({ paths: async () => Object.keys(files), read: async (p: string) => files[p] ?? null });

const FILES: Record<string, string> = {
  "סמינר/רעיון ראשון.md": "---\ntitle: רעיון ראשון\ntags: [מחקר, סמינר]\nsecret_prop: 123\n---\n# כותרת\n\nפסקה על **שמרים** ו-[[קישור|תווית]].\n\n```js\nconst token = 'x';\n```\n",
  "locked.md": `${LOCKED_NOTE_MAGIC}\nciphertext`,
  "age.md": "age-encryption.org/v1\n-> X25519 abc\n",
  "private.md": "---\nprivate: true\n---\nשמרים סודיים\n",
  "hidden.md": "---\nsearchable: false\n---\nשמרים\n",
  ".lumen/x.md": "שמרים",
  "image.png": "",
  "plain.md": "# Plain\nYeast #baking\n",
};

describe("what goes in the system index", () => {
  it("title, a plain excerpt without code or property values, tags as keywords, a link to the note in its vault", () => {
    const i = itemFor("סמינר/רעיון ראשון.md", FILES["סמינר/רעיון ראשון.md"], VAULT)!;
    expect(i.title).toBe("רעיון ראשון");
    expect(i.excerpt).toBe("כותרת פסקה על שמרים ו-תווית.");
    expect(i.excerpt).not.toMatch(/token|123|secret/);
    expect(i.keywords).toEqual(["מחקר", "סמינר"]);
    expect(i.url).toBe("lumen://open?path=%D7%A1%D7%9E%D7%99%D7%A0%D7%A8/%D7%A8%D7%A2%D7%99%D7%95%D7%9F%20%D7%A8%D7%90%D7%A9%D7%95%D7%9F.md&vault=%D7%9E%D7%97%D7%A7%D7%A8");
    expect(itemFor("plain.md", FILES["plain.md"], VAULT)!.keywords).toEqual(["baking"]);
  });

  it("the link names the vault, so the same path in another vault opens there", () => {
    const a = itemFor("plain.md", FILES["plain.md"], VAULT)!;
    const b = itemFor("plain.md", FILES["plain.md"], OTHER)!;
    expect(a.id).not.toBe(b.id);
    expect(a.domain).not.toBe(b.domain);
    expect(b.url).toBe(openLink("plain.md", "Work"));
    expect(b.url).toContain("&vault=Work");
  });

  it("never a locked note, an encrypted file, a private note, a dot folder, a non-note, or an encrypted vault", () => {
    expect(exclusion("locked.md", FILES["locked.md"], VAULT)).toBe("locked note");
    expect(exclusion("age.md", FILES["age.md"], VAULT)).toBe("encrypted file");
    expect(exclusion("private.md", FILES["private.md"], VAULT)).toBe("marked private");
    expect(exclusion("hidden.md", FILES["hidden.md"], VAULT)).toBe("marked private");
    expect(exclusion(".lumen/x.md", "x", VAULT)).toBe("hidden folder");
    expect(exclusion("image.png", "", VAULT)).toBe("not a note");
    expect(exclusion("plain.md", FILES["plain.md"], { ...VAULT, encrypted: true })).toBe("encrypted vault");
  });

  it("the excerpt is at most 300 characters, cut at a word", () => {
    const e = plainExcerpt("מילה ".repeat(200));
    expect([...e].length).toBeLessThanOrEqual(300);
    expect(e.endsWith("מילה…")).toBe(true);
  });
});

describe("consent", () => {
  it("is off by default: nothing is sent until the user turns it on", async () => {
    const os = fakeOs();
    const ix = new OsSearchIndexer(os.bridge, VAULT, memStore());
    expect(ix.enabled).toBe(false);
    expect(await ix.sync(notes(FILES))).toBe(0);
    await ix.noteChanged("plain.md", FILES["plain.md"]);
    expect(os.calls).toEqual([]);
  });

  it("on: the vault's notes are found; only the allowed ones", async () => {
    const os = fakeOs();
    const ix = new OsSearchIndexer(os.bridge, VAULT, memStore());
    expect(await ix.enable(notes(FILES))).toBe(2);
    expect(os.search("שמרים").map((i) => i.title)).toEqual(["רעיון ראשון"]);
    expect(os.items.size).toBe(2);
  });

  it("revoking clears the vault's whole domain and forgets what was sent (and leaves another vault alone)", async () => {
    const os = fakeOs();
    const store = memStore();
    const ix = new OsSearchIndexer(os.bridge, VAULT, store);
    const other = new OsSearchIndexer(os.bridge, OTHER, memStore());
    await ix.enable(notes(FILES));
    await other.enable(notes({ "w.md": "# W\nwork" }));
    expect(os.items.size).toBe(3);
    await ix.disable();
    expect(os.calls).toContain(`clear:${domainOf(VAULT)}`);
    expect([...os.items.values()].map((i) => i.domain)).toEqual([domainOf(OTHER)]);
    expect(store.manifest).toBeNull();
    expect(ix.enabled).toBe(false);
    // After revoking, changes are not sent.
    await ix.noteChanged("plain.md", "# Plain\nnew");
    expect(os.items.size).toBe(1);
  });

  it("refuses an encrypted vault, and does nothing where the system index is not available", async () => {
    await expect(new OsSearchIndexer(fakeOs().bridge, { ...VAULT, encrypted: true }, memStore()).enable(notes(FILES))).rejects.toThrow(/encrypted/);
    const off = new OsSearchIndexer(fakeOs(false).bridge, VAULT, memStore());
    await expect(off.enable(notes(FILES))).rejects.toThrow(/not available/);
    expect(off.enabled).toBe(false);
  });
});

describe("keeping it up to date", () => {
  it("sends only what changed; removes deleted, renamed and newly locked notes", async () => {
    const os = fakeOs();
    const store = memStore();
    const files = { ...FILES };
    const ix = new OsSearchIndexer(os.bridge, VAULT, store);
    await ix.enable(notes(files));
    os.calls.length = 0;
    await ix.sync(notes(files));
    expect(os.calls).toEqual([]); // nothing changed, nothing sent
    await ix.noteChanged("plain.md", "# Plain\nYeast and flour #baking\n");
    expect(os.calls).toEqual(["index:1"]);
    await ix.noteRenamed("plain.md", "renamed.md", "# Plain\nYeast and flour #baking\n");
    expect([...os.items.values()].map((i) => i.url).some((u) => u.includes("plain.md"))).toBe(false);
    expect([...os.items.values()].map((i) => i.url).some((u) => u.includes("renamed.md"))).toBe(true);
    // Locked after it was indexed: it leaves the index.
    await ix.noteChanged("renamed.md", `${LOCKED_NOTE_MAGIC}\nx`);
    expect([...os.items.values()].some((i) => i.url.includes("renamed.md"))).toBe(false);
    await ix.noteDeleted("סמינר/רעיון ראשון.md");
    expect(os.items.size).toBe(0);
    // A later full sync after a restart (manifest loaded) removes what disappeared while closed.
    const ix2 = new OsSearchIndexer(os.bridge, VAULT, store);
    await ix2.noteChanged("x.md", "# X");
    expect(os.items.size).toBe(1);
    await ix2.sync(notes({}));
    expect(os.items.size).toBe(0);
  });

  it("10,000 notes go in batches of at most 200", async () => {
    const os = fakeOs();
    const many: Record<string, string> = {};
    for (let i = 0; i < 10_000; i++) many[`n/${i}.md`] = `# ${i}\ntext ${i}`;
    const ix = new OsSearchIndexer(os.bridge, VAULT, memStore());
    expect(await ix.enable(notes(many))).toBe(10_000);
    expect(os.calls.filter((c) => c.startsWith("index:")).length).toBe(50);
    expect(os.items.size).toBe(10_000);
  });
});
