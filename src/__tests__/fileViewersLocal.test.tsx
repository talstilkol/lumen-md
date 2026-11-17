/**
 * W12.F4/F5/F7, wave g5: the file viewers on the live page.
 *
 *  - A notebook output that points at a remote image, stylesheet or SVG
 *    resource loads nothing: the reference is removed in an inert document
 *    before the markup reaches the page, and the viewer says how many were
 *    held back (privacy: nothing leaves the device without consent).
 *  - An image without a text alternative gets a generic one.
 *  - (The colour-token check that found the transparent overlay is in
 *    cssTokenColours.test.ts, in Node: it reads every stylesheet.)
 *  - The 10,000-row table's scroller is reachable from the keyboard.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { localOnlyHtml } from "../viewers/notebookHtml";
import { NotebookView } from "../viewers/NotebookView";
import { parseNotebook } from "../viewers/notebook";
import { DataTableView } from "../viewers/DataFileView";
import { parseDataText } from "../viewers/dataFile";

afterEach(cleanup);

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("notebook outputs load nothing from the network", () => {
  it("removes remote src, srcset, poster, CSS url() and SVG image hrefs; keeps data: images; counts what it held back", () => {
    const html =
      `<table><tr><td>שלום</td></tr></table>` +
      `<img src="https://tracker.example/p.gif">` +
      `<img src="${PNG}" alt="נקודה">` +
      `<img srcset="https://cdn.example/a.png 1x, ${PNG} 2x">` +
      `<video poster="//cdn.example/poster.jpg"></video>` +
      `<div style="background-image: url('https://cdn.example/bg.png'); color: red">x</div>` +
      `<div style="background: url(${PNG})">y</div>`;
    const r = localOnlyHtml(html, "html", "תמונה");
    const box = document.createElement("div");
    box.innerHTML = r.html;
    expect(box.querySelector("td")?.textContent).toBe("שלום");
    expect(box.innerHTML).not.toMatch(/example/);
    expect(r.blocked).toBe(4);
    const imgs = Array.from(box.querySelectorAll("img"));
    expect(imgs[1].getAttribute("src")).toBe(PNG);
    expect(imgs[1].getAttribute("alt")).toBe("נקודה");
    expect(imgs[0].getAttribute("alt")).toBe("תמונה");
    expect(imgs[0].hasAttribute("data-lumen-blocked")).toBe(true);
    expect(box.innerHTML).toContain(PNG);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="https://cdn.example/i.png" width="5" height="5"/><image xlink:href="${PNG}" width="5" height="5"/><circle r="3"/></svg>`;
    const s = localOnlyHtml(svg, "svg", "תמונה");
    expect(s.html).not.toMatch(/example/);
    expect(s.html).toContain("<circle");
    expect(s.blocked).toBe(1);
  });

  it("the viewer shows the output without the remote image, and says so", async () => {
    const nb = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        {
          cell_type: "code",
          execution_count: 3,
          source: "df.style",
          metadata: {},
          outputs: [{ output_type: "display_data", metadata: {}, data: { "text/html": '<p>טבלה</p><img src="https://tracker.example/p.gif">' } }],
        },
      ],
    };
    const { container } = render(<NotebookView notebook={parseNotebook(JSON.stringify(nb))} render={async (md) => <pre>{md}</pre>} />);
    expect(container.querySelector(".nb-html p")?.textContent).toBe("טבלה");
    expect(container.querySelector('img[src^="http"]')).toBeNull();
    expect(container.querySelector(".nb-blocked")?.textContent).toMatch(/\b1\b/);
    expect(container.querySelector(".nb-blocked")?.textContent).not.toMatch(/fileViewer\./);
  });
});

describe("the data table on the keyboard", () => {
  it("its scroller is focusable and named, so 10,000 rows can be scrolled without a mouse", () => {
    const lines = ["מזהה,שם"];
    for (let i = 0; i < 10_000; i++) lines.push(`${i},תלמיד ${i}`);
    const { getByTestId } = render(<DataTableView table={parseDataText("csv", lines.join("\n"))} onEdit={() => {}} />);
    const scroller = getByTestId("data-scroll");
    expect(scroller.tabIndex).toBe(0);
    expect(scroller.getAttribute("aria-label")).toBeTruthy();
  });
});
