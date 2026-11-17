/**
 * Plan W13.R3 — the RSVP reader's UI: pivot, keys along the text's
 * direction, rewind, play / pause, empty note.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { RsvpReader } from "../ui/RsvpReader";

describe("the reader", () => {
  beforeEach(() => cleanup());

  it("shows the word around its pivot, steps with the keys and rewinds a sentence", () => {
    render(<RsvpReader content={"שלום עולם. מה שלומך היום?"} initialWpm={300} close={() => undefined} />);
    const word = () => screen.getByTestId("rsvp-word").textContent;
    expect(word()).toBe("שלום");
    expect(screen.getByTestId("rsvp-word").getAttribute("dir")).toBe("rtl");
    expect(screen.getByTestId("rsvp-pivot").textContent).toBe("ל");
    const box = screen.getByTestId("rsvp-word").parentElement!.parentElement!;
    // Hebrew: ← is forward.
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(word()).toBe("שלומך");
    expect(screen.getByTestId("rsvp-context").textContent).toContain("מה שלומך היום?");
    fireEvent.click(screen.getByTestId("rsvp-rewind"));
    expect(word()).toBe("מה");
    fireEvent.click(screen.getByTestId("rsvp-rewind"));
    expect(word()).toBe("שלום");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect((screen.getByTestId("rsvp-wpm") as HTMLInputElement).value).toBe("310");
  });

  it("plays at the set speed and pauses with Space", async () => {
    render(<RsvpReader content={"one two three"} initialWpm={600} close={() => undefined} />);
    const box = screen.getByTestId("rsvp-word").parentElement!.parentElement!;
    fireEvent.keyDown(box, { key: " " });
    expect(screen.getByTestId("rsvp-play").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 130));
    });
    expect(screen.getByTestId("rsvp-word").textContent).toBe("two");
    fireEvent.keyDown(box, { key: " " });
    expect(screen.getByTestId("rsvp-play").getAttribute("aria-pressed")).toBe("false");
  });

  it("says so when there is nothing to read", () => {
    render(<RsvpReader content={"```\ncode\n```"} initialWpm={300} close={() => undefined} />);
    expect(screen.getByText("This note has no words to read.")).toBeTruthy();
  });
});
