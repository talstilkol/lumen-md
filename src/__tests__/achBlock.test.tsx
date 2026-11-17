/**
 * Plan R12.20: an ```ach block — Analysis of Competing Hypotheses (Heuer) in
 * a note: the hypotheses ranked by the least weighted inconsistency, rows
 * that are not diagnostic, linchpins, and whether the leader holds without
 * the rows at risk of deception.
 *
 * The four matrices below are SYNTHETIC (made up for this test). The
 * expected numbers were produced by running the owner's reference
 * implementation — israelconnect tools/research/ach_matrix.py `score()` —
 * on exactly these matrices (as notebooks with own rows only, no graph);
 * they are its output, pasted, not computed by this code. Our module is a
 * separate implementation (no code was copied).
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { achMarkdownTable, parseAch, readMark, scoreAch } from "../research/ach";
import AchBlock from "../plugins/AchBlock";

const BLOCKS: Record<string, string> = {
  leak: `title: Who leaked the report?
hypotheses:
  H1: inside
  H2: contractor
  H3: accident
evidence:
  - { id: E1, text: metadata, weight: 3, marks: { H1: CC, H2: I, H3: N } }
  - { id: E2, text: blog post, deceptive: true, marks: { H1: N, H2: C, H3: I } }
  - { id: E3, text: access log, weight: 2, marks: { H1: I, H2: II, H3: C } }
  - { id: E4, text: timing, marks: { H1: C } }
  - { id: E5, text: same everywhere, weight: 5, marks: { H1: C, H2: C, H3: C } }
  - { id: E6, text: email, weight: 2, marks: { H1: I, H2: N, H3: II } }
`,
  "deception-flips": `hypotheses: [{ id: A }, { id: B }]
evidence:
  - { id: R1, weight: 2, marks: { A: I, B: N } }
  - { id: R2, deceptive: true, marks: { A: N, B: II } }
  - { id: R3, marks: { A: C, B: C } }
`,
  "one-hypothesis": `hypotheses: { H1: only }
evidence:
  - { id: E1, marks: { H1: II } }
`,
  "tie-by-id": `hypotheses: { Hb: b, Ha: a }
evidence:
  - { id: E1, marks: { Ha: C, Hb: C } }
`,
};

// ach_matrix.py score() on the same matrices (its `leader_without` is our `leaderWithout`; its row `kind` is left out).
const REFERENCE = {
  "leak": {
    "hypotheses": [
      {
        "id": "H1",
        "inconsistency": 4,
        "consistency": 12,
        "rank": 1
      },
      {
        "id": "H3",
        "inconsistency": 5,
        "consistency": 7,
        "rank": 2
      },
      {
        "id": "H2",
        "inconsistency": 7,
        "consistency": 6,
        "rank": 3
      }
    ],
    "leader": "H1",
    "margin": 1,
    "rows": [
      {
        "id": "E1",
        "weight": 3,
        "deceptive": false,
        "diagnostic": true
      },
      {
        "id": "E2",
        "weight": 1,
        "deceptive": true,
        "diagnostic": true
      },
      {
        "id": "E3",
        "weight": 2,
        "deceptive": false,
        "diagnostic": true
      },
      {
        "id": "E4",
        "weight": 1,
        "deceptive": false,
        "diagnostic": true
      },
      {
        "id": "E5",
        "weight": 5,
        "deceptive": false,
        "diagnostic": false
      },
      {
        "id": "E6",
        "weight": 2,
        "deceptive": false,
        "diagnostic": true
      }
    ],
    "linchpins": [
      "E6"
    ],
    "deception": {
      "rows": [
        "E2"
      ],
      "leaderWithout": "H1",
      "changes": false
    },
    "unmarked": 2
  },
  "deception-flips": {
    "hypotheses": [
      {
        "id": "A",
        "inconsistency": 2,
        "consistency": 1,
        "rank": 1
      },
      {
        "id": "B",
        "inconsistency": 2,
        "consistency": 1,
        "rank": 2
      }
    ],
    "leader": "A",
    "margin": 0,
    "rows": [
      {
        "id": "R1",
        "weight": 2,
        "deceptive": false,
        "diagnostic": true
      },
      {
        "id": "R2",
        "weight": 1,
        "deceptive": true,
        "diagnostic": true
      },
      {
        "id": "R3",
        "weight": 1,
        "deceptive": false,
        "diagnostic": false
      }
    ],
    "linchpins": [
      "R2"
    ],
    "deception": {
      "rows": [
        "R2"
      ],
      "leaderWithout": "B",
      "changes": true
    },
    "unmarked": 0
  },
  "one-hypothesis": {
    "hypotheses": [
      {
        "id": "H1",
        "inconsistency": 2,
        "consistency": 0,
        "rank": 1
      }
    ],
    "leader": null,
    "margin": null,
    "rows": [
      {
        "id": "E1",
        "weight": 1,
        "deceptive": false,
        "diagnostic": false
      }
    ],
    "linchpins": [],
    "deception": {
      "rows": [],
      "leaderWithout": null,
      "changes": false
    },
    "unmarked": 0
  },
  "tie-by-id": {
    "hypotheses": [
      {
        "id": "Ha",
        "inconsistency": 0,
        "consistency": 1,
        "rank": 1
      },
      {
        "id": "Hb",
        "inconsistency": 0,
        "consistency": 1,
        "rank": 2
      }
    ],
    "leader": "Ha",
    "margin": 0,
    "rows": [
      {
        "id": "E1",
        "weight": 1,
        "deceptive": false,
        "diagnostic": false
      }
    ],
    "linchpins": [],
    "deception": {
      "rows": [],
      "leaderWithout": "Ha",
      "changes": false
    },
    "unmarked": 0
  }
};

describe("ACH scores = the reference's (R12.20)", () => {
  for (const [name, src] of Object.entries(BLOCKS))
    it(name, () => {
      const model = parseAch(src);
      expect(model.problems).toEqual([]);
      expect(scoreAch(model)).toEqual(REFERENCE[name as keyof typeof REFERENCE]);
    });
  it("no hypotheses: no leader, nothing ranked", () => {
    expect(scoreAch(parseAch(""))).toEqual({ hypotheses: [], leader: null, margin: null, rows: [], linchpins: [], deception: { rows: [], leaderWithout: null, changes: false }, unmarked: 0 });
  });
});

describe("reading the block", () => {
  it("marks: the five letters and the + / - shorthand; anything else is a problem", () => {
    expect(["cc", "C", "n", "i", "II", "++", "+", "0", "-", "--"].map(readMark)).toEqual(["CC", "C", "N", "I", "II", "CC", "C", "N", "I", "II"]);
    const m = parseAch("hypotheses: { H1: a, H2: b }\nevidence:\n  - { marks: { H1: maybe, H3: C }, weight: 1.5 }");
    expect(m.problems).toEqual(["evidence E1: weight is a whole number above 0", "evidence E1: maybe is not one of CC C N I II", "evidence E1: no hypothesis H3"]);
    expect(m.rows[0]).toMatchObject({ id: "E1", weight: 1, marks: {} });
  });
  it("bad YAML is one problem line, not a crash", () => {
    expect(parseAch("hypotheses: [").problems.length).toBe(1);
  });
  it("export as a table: GFM, hypotheses in rank order, the scores at the bottom", () => {
    const model = parseAch(BLOCKS["deception-flips"]);
    const md = achMarkdownTable(model, scoreAch(model), { evidence: "ראיה", weight: "משקל", inconsistency: "סתירה", consistency: "התאמה" });
    expect(md.split("\n")).toEqual([
      "| ראיה | משקל | A | B |",
      "| --- | --- | --- | --- |",
      "| R1 | 2 | I | N |",
      "| R2 | 1 | N | II |",
      "| R3 | 1 | C | C |",
      "| סתירה |  | 2 | 2 |",
      "| התאמה |  | 1 | 1 |",
    ]);
  });
});

describe("the block", () => {
  for (const dir of ["rtl", "ltr"] as const)
    it(`${dir}: ranking, matrix with headers, flags; axe clean`, async () => {
      const { container } = render(
        <div dir={dir} lang={dir === "rtl" ? "he" : "en"}>
          <AchBlock source={BLOCKS.leak} />
        </div>,
      );
      const block = container.querySelector(".lumen-ach-block")!;
      expect(block.getAttribute("data-ach-leader")).toBe("H1");
      expect([...container.querySelectorAll("[data-ach-rank]")].map((li) => li.getAttribute("data-ach-rank"))).toEqual(["1", "2", "3"]);
      expect([...container.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Evidence", "Weight", "H1", "H3", "H2"]);
      expect(container.querySelector('[data-ach-row="E6"] th')!.textContent).toContain("linchpin");
      expect(container.querySelector('[data-ach-row="E5"] th')!.textContent).toContain("not diagnostic");
      expect(container.querySelector('[data-ach-row="E2"] th')!.textContent).toContain("risk of deception");
      expect(container.querySelector("[data-ach-deception]")!.textContent).toContain("holds");
      const foot = [...container.querySelectorAll("tfoot tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
      expect(foot).toEqual([
        ["", "4", "5", "7"],
        ["", "12", "7", "6"],
      ]);
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
    });

  it("copy as a table puts the GFM table on the clipboard", async () => {
    let written = "";
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (s: string) => void (written = s) }, configurable: true });
    const { container } = render(<AchBlock source={BLOCKS["deception-flips"]} />);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-ach-copy]")!);
    });
    expect(written.split("\n")[0]).toBe("| Evidence | Weight | A | B |");
    expect(container.querySelector("[data-ach-deception]")!.textContent).toContain("B");
  });
});
