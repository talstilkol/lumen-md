// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { uiSelect } from "../ui/PromptDialog";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("uiSelect — real <select> dropdown", () => {
  it("renders the choices, honours the default, and resolves it on OK", async () => {
    const promise = uiSelect({
      message: "Pick provider",
      defaultValue: "anthropic",
      choices: [
        { value: "openai", label: "OpenAI" },
        { value: "anthropic", label: "Claude" },
        { value: "ollama", label: "Ollama" },
      ],
    });
    await tick();
    const select = document.querySelector<HTMLSelectElement>(".prompt-dialog select");
    expect(select).not.toBeNull();
    expect(select!.options.length).toBe(3);
    // The defaultValue (which is one of the choices) is pre-selected.
    expect(select!.value).toBe("anthropic");
    // It is a real <select>, not a free-text input.
    expect(document.querySelector(".prompt-dialog input")).toBeNull();

    document.querySelector<HTMLButtonElement>(".prompt-btn-ok")!.click();
    await expect(promise).resolves.toBe("anthropic");
  });

  it("falls back to the first choice when defaultValue is not in the list", async () => {
    const promise = uiSelect({
      message: "Pick",
      defaultValue: "", // not a valid choice
      choices: [
        { value: "openai", label: "OpenAI" },
        { value: "mistral", label: "Mistral" },
      ],
    });
    await tick();
    const select = document.querySelector<HTMLSelectElement>(".prompt-dialog select");
    expect(select!.value).toBe("openai");
    document.querySelector<HTMLButtonElement>(".prompt-btn-ok")!.click();
    await expect(promise).resolves.toBe("openai");
  });

  it("resolves null when cancelled", async () => {
    const promise = uiSelect({
      message: "Pick",
      choices: [{ value: "a", label: "A" }],
    });
    await tick();
    document.querySelector<HTMLButtonElement>(".prompt-btn-cancel")!.click();
    await expect(promise).resolves.toBeNull();
  });
});
