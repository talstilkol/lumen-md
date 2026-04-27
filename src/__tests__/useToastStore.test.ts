import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore, toast } from "../store/useToastStore";

describe("useToastStore", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  it("push returns an id and adds a toast", () => {
    const id = useToastStore.getState().push({ kind: "info", title: "Hello" });
    expect(typeof id).toBe("string");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].title).toBe("Hello");
  });

  it("dismiss removes the matching toast", () => {
    const id = useToastStore.getState().push({ kind: "info", title: "x" });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("clear removes everything at once", () => {
    useToastStore.getState().push({ kind: "info", title: "1" });
    useToastStore.getState().push({ kind: "warning", title: "2" });
    useToastStore.getState().push({ kind: "error", title: "3" });
    useToastStore.getState().clear();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("caps the queue at 4 toasts", () => {
    for (let i = 0; i < 10; i++) {
      useToastStore.getState().push({ kind: "info", title: `t${i}` });
    }
    expect(useToastStore.getState().toasts).toHaveLength(4);
    // Should keep the most recent four
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual([
      "t6",
      "t7",
      "t8",
      "t9",
    ]);
  });

  it("default ttl differs by kind (errors are sticky, info auto-dismisses)", () => {
    useToastStore.getState().push({ kind: "info", title: "i" });
    useToastStore.getState().push({ kind: "error", title: "e" });
    const [info, err] = useToastStore.getState().toasts;
    expect(info.ttlMs).toBeGreaterThan(0);
    expect(err.ttlMs).toBe(0);
  });

  it("imperative `toast.error` exposes a one-liner API", () => {
    toast.error("Failed", "Details");
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
    expect(useToastStore.getState().toasts[0].body).toBe("Details");
  });
});
