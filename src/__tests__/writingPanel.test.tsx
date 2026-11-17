/**
 * Plan W13.W1 — the writing suggestions panel, on a real source editor:
 * cards with a word diff, Accept / Reject / Edit, per-hunk ticks, a blocked
 * card that cannot be accepted, Accept all as one transaction, the
 * keyboard (↓ / Enter / Delete) and the empty state.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { WritingPanel, type WritingHost } from "../ui/WritingSuggestionsPanel";
import { acceptInView, focusSuggestion, onSuggestionsChange, rejectInView, showSuggestions } from "../agents/writing/cmBridge";
import { coachRules } from "../agents/writing/agents/styleCoach";
import { makeSuggestion } from "../agents/writing/suggestion";

const TEXT = "Basically, the report was written by Dana in order to explain the end result. We made a decision to revert back.";

function mount(text = TEXT) {
  const trs: Transaction[] = [];
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: [EditorView.updateListener.of((u) => trs.push(...u.transactions.filter((t) => t.docChanged)))] }) });
  const host: WritingHost = {
    subscribe: (fn) => onSuggestionsChange(view, fn),
    accept: (c) => acceptInView(view, c),
    reject: (ids) => rejectInView(view, ids),
    focus: (id) => focusSuggestion(view, id),
  };
  return { view, host, trs };
}

describe("the writing suggestions panel (W13.W1)", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("lists the coach's findings as cards with a diff; Accept all is one transaction", () => {
    const { view, host, trs } = mount();
    showSuggestions(view, coachRules(TEXT, "en", "everyday"));
    render(<WritingPanel host={host} state={{ agentLabel: "Clarity & style" }} onClose={() => {}} />);
    const cards = screen.getAllByTestId("ws-card");
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByTestId("ws-diff").some((d) => d.querySelector("del, ins"))).toBe(true);
    // The passive is advice: no Accept button on its card.
    const passive = cards.find((c) => c.textContent?.includes("Passive"))!;
    expect(passive.querySelector("[data-testid=ws-accept]")).toBeNull();
    fireEvent.click(screen.getByTestId("ws-acceptAll"));
    expect(trs).toHaveLength(1);
    expect(view.state.doc.toString()).toBe("The report was written by Dana to explain the result. We decided to revert.");
    expect(screen.getByTestId("ws-status").textContent).toMatch(/Applied \d+/);
    // Only the advice-only card stays.
    expect(screen.getAllByTestId("ws-card")).toHaveLength(1);
    view.destroy();
  });

  it("per card: Reject removes it, Edit accepts the user's text (not AI text), keyboard Enter accepts", () => {
    const { view, host } = mount();
    showSuggestions(view, coachRules(TEXT, "en", "everyday"));
    render(<WritingPanel host={host} state={{ agentLabel: "x" }} onClose={() => {}} />);
    const before = screen.getAllByTestId("ws-card").length;
    fireEvent.click(screen.getAllByTestId("ws-reject")[0]);
    expect(screen.getAllByTestId("ws-card")).toHaveLength(before - 1);
    const wordy = screen.getAllByTestId("ws-card").find((c) => c.textContent?.includes("Wordy"))!;
    fireEvent.click(wordy.querySelector("[data-testid=ws-editBtn]")!);
    fireEvent.change(screen.getByTestId("ws-edit"), { target: { value: "so as to" } });
    fireEvent.click(wordy.querySelector("[data-testid=ws-accept]")!);
    expect(view.state.doc.toString()).toContain("Dana so as to explain");
    const card = screen.getAllByTestId("ws-card").find((c) => c.textContent?.includes("Redundant"))!;
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(view.state.doc.toString()).toContain("explain the result.");
    view.destroy();
  });

  it("several word changes: tick only some; a blocked rewrite cannot be accepted as is", () => {
    const text = "The report was very long and was written by Dana in 2024.";
    const { view, host } = mount(text);
    const s = makeSuggestion(text, { range: { from: 0, to: text.length }, kind: "tone", message: "Formal tone", rationale: "r", confidence: 0.7, replacement: "The report was long and Dana wrote it in 2024.", agentId: "toneShifter", model: "local-m", id: "t1" });
    const blocked = { ...makeSuggestion(text, { range: { from: 0, to: 3 }, kind: "tone", message: "Friendly", rationale: "r", confidence: 0.2, replacement: "A", agentId: "toneShifter", model: "local-m", id: "t2" }), blocked: "numbers added: 7" };
    showSuggestions(view, [blocked, s]);
    render(<WritingPanel host={host} state={{ agentLabel: "Tone" }} onClose={() => {}} />);
    const [bCard, sCard] = screen.getAllByTestId("ws-card");
    expect(bCard.querySelector("[data-testid=ws-blocked]")!.textContent).toContain("numbers added: 7");
    expect((bCard.querySelector("[data-testid=ws-accept]") as HTMLButtonElement).disabled).toBe(true);
    const boxes = sCard.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    expect(boxes.length).toBe(2);
    fireEvent.click(boxes[1]);
    fireEvent.click(sCard.querySelector("[data-testid=ws-accept]")!);
    expect(view.state.doc.toString()).toBe("The report was long and was written by Dana in 2024.");
    view.destroy();
  });

  it("↓ moves between cards; Delete rejects; the empty state says so", () => {
    const text = "It was in order to go. The end result.";
    const { view, host } = mount(text);
    showSuggestions(view, coachRules(text, "en", "everyday"));
    render(<WritingPanel host={host} state={{ agentLabel: "x" }} onClose={() => {}} />);
    const panel = screen.getByTestId("writing-panel");
    const cards = screen.getAllByTestId("ws-card");
    cards[0].focus();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cards[1]);
    fireEvent.keyDown(cards[1], { key: "Delete" });
    fireEvent.keyDown(screen.getAllByTestId("ws-card")[0], { key: "Delete" });
    expect(screen.getByTestId("ws-empty")).toBeTruthy();
    view.destroy();
  });

  it("Hebrew: the card text is dir=auto and the diff keeps whole words", () => {
    const text = "הם חזרו שוב למשרד על מנת לבדוק.";
    const { view, host } = mount(text);
    showSuggestions(view, coachRules(text, "he", "everyday"));
    render(<WritingPanel host={host} state={{ agentLabel: "בהירות" }} onClose={() => {}} />);
    const diffs = screen.getAllByTestId("ws-diff");
    expect(diffs[0].getAttribute("dir")).toBe("auto");
    expect(diffs[0].querySelector("del")!.textContent).toContain("שוב");
    fireEvent.click(screen.getByTestId("ws-acceptAll"));
    expect(view.state.doc.toString()).toBe("הם חזרו למשרד כדי לבדוק.");
    view.destroy();
  });

  it("audit r4 A2.4: after a keyboard accept or reject, focus moves to the card now in its place (or the panel), never to <body>", () => {
    const { view, host } = mount();
    showSuggestions(view, coachRules(TEXT, "en", "everyday"));
    render(<WritingPanel host={host} state={{ agentLabel: "x" }} onClose={() => {}} />);
    const ids = () => screen.getAllByTestId("ws-card").map((c) => c.dataset.wsId);
    const before = ids();
    const second = screen.getAllByTestId("ws-card")[1];
    second.focus();
    fireEvent.keyDown(second, { key: "Delete" });
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement).dataset.wsId).toBe(before[2]);
    const now = document.activeElement as HTMLElement;
    fireEvent.keyDown(now, { key: "Enter" });
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId("writing-panel").contains(document.activeElement)).toBe(true);
    // Reject all: nothing left — the panel itself holds the focus.
    fireEvent.click(screen.getByTestId("ws-rejectAll"));
    expect(document.activeElement).toBe(screen.getByTestId("writing-panel"));
    view.destroy();
  });
});
