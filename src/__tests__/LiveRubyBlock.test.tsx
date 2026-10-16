/**
 * Live Ruby block — fence routing and the worker lifecycle (Stop, unmount,
 * timeout) with a fake worker; the runtime itself is covered on the real
 * ruby.wasm in liveRuby.test.ts.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../renderer/pipeline";
import { components } from "../renderer/components";

class FakeWorker extends EventTarget {
  posted: unknown[] = [];
  terminated = false;
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
const workers: FakeWorker[] = [];
vi.mock("../plugins/ruby/rubyClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plugins/ruby/rubyClient")>();
  let current: FakeWorker | null = null;
  let seq = 0;
  return {
    RUBY_KILLED_EVENT: "lumen-ruby-killed",
    rubyWorker: () => {
      if (!current) workers.push((current = new FakeWorker()));
      return current as unknown as Worker;
    },
    killRubyWorker: (target?: Worker) => {
      if (!current || (target && (target as unknown) !== current)) return;
      const w = current;
      current = null;
      w.dispatchEvent(new Event("lumen-ruby-killed"));
      w.terminate();
    },
    nextRubyRunId: () => ++seq,
    rubyTurn: real.rubyTurn,
    __reset: () => {
      current = null;
    },
  };
});

import LiveRubyBlock from "../plugins/LiveRubyBlock";
import * as client from "../plugins/ruby/rubyClient";

afterEach(() => {
  cleanup();
  workers.length = 0;
  (client as unknown as { __reset: () => void }).__reset();
  vi.useRealTimers();
});

async function rubyLangs(src: string): Promise<string[]> {
  const target = (components as Record<string, unknown>)["lumen-liveruby"];
  const found: string[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const props = n.props as { lang?: string; children?: ReactNode };
    if (n.type === target) found.push(String(props.lang));
    walk(props.children);
  };
  walk(await renderMarkdown(src, () => false));
  return found;
}

describe("live-ruby", () => {
  it("routes live-ruby / ruby-live to the block, plain ruby stays code", async () => {
    expect(await rubyLangs("```live-ruby\nputs 1\n```")).toEqual(["live-ruby"]);
    expect(await rubyLangs("```ruby-live\nputs 1\n```")).toEqual(["ruby-live"]);
    expect(await rubyLangs("```ruby\nputs 1\n```")).toEqual([]);
  });

  it("shows output, the result and the final state", async () => {
    render(<LiveRubyBlock source="puts 1" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await act(async () => {});
    const w = workers[0];
    const { runId } = w.posted[0] as { runId: number };
    act(() => {
      w.reply({ type: "ready", runId });
      w.reply({ type: "output", runId, stream: "out", text: "1\n" });
      w.reply({ type: "result", runId, text: "nil?" });
      w.reply({ type: "done", runId, ms: 5 });
    });
    expect(screen.getByTestId("live-ruby").getAttribute("data-state")).toBe("success");
    expect(screen.getByTestId("live-ruby").textContent).toContain("=> nil?");
    expect(w.terminated).toBe(false); // kept for the next run
  });

  it("terminates the worker when unmounted mid-run", async () => {
    const { unmount } = render(<LiveRubyBlock source="loop {}" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await act(async () => {});
    unmount();
    expect(workers[0].terminated).toBe(true);
  });

  it("leaves the shared worker alone when unmounted idle", async () => {
    const { unmount } = render(<LiveRubyBlock source="1" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await act(async () => {});
    const w = workers[0];
    const { runId } = w.posted[0] as { runId: number };
    act(() => {
      w.reply({ type: "ready", runId });
      w.reply({ type: "done", runId, ms: 1 });
    });
    unmount();
    expect(w.terminated).toBe(false);
  });

  it("runs take turns: a queued block neither arms timers nor can kill the active run", async () => {
    vi.useFakeTimers();
    render(
      <>
        <LiveRubyBlock source="loop {}" meta="timeout=300000" />
        <LiveRubyBlock source="puts 2" />
      </>,
    );
    const [a, b] = screen.getAllByTestId("live-ruby");
    fireEvent.click(a.querySelector("button")!);
    await act(async () => {});
    const w = workers[0];
    const { runId } = w.posted[0] as { runId: number };
    act(() => w.reply({ type: "ready", runId }));
    fireEvent.click(b.querySelector("button")!);
    await act(async () => {});
    expect(w.posted).toHaveLength(1); // b waits for its turn
    // b's 180 s load timeout must not fire while it is only queued.
    await act(async () => {
      vi.advanceTimersByTime(200_000);
    });
    expect(w.terminated).toBe(false);
    // Stop on the queued block leaves the active run alone.
    fireEvent.click(b.querySelector("button")!);
    expect(w.terminated).toBe(false);
    expect(a.getAttribute("data-state")).toBe("running");
  });

  it("kills a runaway run at its timeout; the next queued run then gets a fresh worker", async () => {
    vi.useFakeTimers();
    render(
      <>
        <LiveRubyBlock source="loop {}" meta="timeout=1000" />
        <LiveRubyBlock source="puts 2" />
      </>,
    );
    const [a, b] = screen.getAllByTestId("live-ruby");
    fireEvent.click(a.querySelector("button")!);
    await act(async () => {});
    const w = workers[0];
    const { runId } = w.posted[0] as { runId: number };
    act(() => w.reply({ type: "ready", runId }));
    fireEvent.click(b.querySelector("button")!);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1001);
    });
    expect(w.terminated).toBe(true);
    expect(a.getAttribute("data-state")).toBe("timeout");
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);
    expect(b.getAttribute("data-state")).toBe("loading");
  });
});
