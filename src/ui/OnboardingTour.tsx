import { useState, useEffect, useCallback } from "react";

interface TourStep {
  target: string; // CSS selector
  title: string;
  body: string;
  placement: "top" | "bottom" | "left" | "right";
}

const STEPS: TourStep[] = [
  {
    target: ".titlebar",
    title: "📋 Menu Bar",
    body: "Access File, Edit, Insert, View, and Help — each menu has clear sections, hover tooltips, and per-action descriptions.",
    placement: "bottom",
  },
  {
    target: ".seg-group",
    title: "👁️ View Modes",
    body: "Switch between Source, Split, Preview, and WYSIWYG anytime (⌘1-4).",
    placement: "bottom",
  },
  {
    target: ".file-tree",
    title: "📁 Workspace",
    body: "Manage files in your local workspace. Everything is stored in-browser.",
    placement: "right",
  },
  {
    target: ".status-bar",
    title: "📊 Status Bar",
    body: "Word count, character count, reading time — always visible.",
    placement: "top",
  },
  {
    target: "main",
    title: "✍️ Editor",
    body: "Write Markdown with full syntax highlighting, live preview, and AI assistance.",
    placement: "top",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OnboardingTour({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });

  const current = STEPS[step];

  const updatePos = useCallback(() => {
    if (!current) return;
    const el = document.querySelector(current.target);
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
  }, [current]);

  useEffect(() => {
    if (!open) {
      setStep(0);
      return;
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    return () => window.removeEventListener("resize", updatePos);
  }, [open, step, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (step < STEPS.length - 1) setStep(step + 1);
        else onClose();
      }
      if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  if (!open || !current) return null;

  // Calculate tooltip position
  const gap = 12;
  let tooltipStyle: React.CSSProperties = {};
  switch (current.placement) {
    case "bottom":
      tooltipStyle = { top: pos.top + pos.height + gap, left: pos.left + pos.width / 2 };
      break;
    case "top":
      tooltipStyle = { top: pos.top - gap, left: pos.left + pos.width / 2 };
      break;
    case "right":
      tooltipStyle = { top: pos.top + pos.height / 2, left: pos.left + pos.width + gap };
      break;
    case "left":
      tooltipStyle = { top: pos.top + pos.height / 2, left: pos.left - gap };
      break;
  }

  return (
    <>
      {/* Overlay with spotlight cutout */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "auto",
        }}
        onClick={onClose}
      >
        {/* Semi-transparent overlay */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <defs>
            <mask id="spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={pos.left - 6}
                y={pos.top - 6}
                width={pos.width + 12}
                height={pos.height + 12}
                rx={10}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.6)"
            mask="url(#spotlight-mask)"
          />
        </svg>
      </div>
      {/* Tooltip */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          zIndex: 10000,
          ...tooltipStyle,
          transform:
            current.placement === "bottom" || current.placement === "top"
              ? "translateX(-50%)"
              : "translateY(-50%)",
          background: "hsl(var(--bg-muted))",
          border: "1px solid hsl(var(--accent) / 0.3)",
          borderRadius: 14,
          padding: "18px 22px",
          width: "min(320px, 80vw)",
          boxShadow: "0 12px 40px hsl(0 0% 0% / 0.5), 0 0 0 1px hsl(var(--accent) / 0.15)",
        }}
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 700,
            marginBottom: 6,
            color: "hsl(var(--fg))",
          }}
        >
          {current.title}
        </h3>
        <p
          style={{
            fontSize: 12.5,
            color: "hsl(var(--fg-subtle))",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {current.body}
        </p>
        {/* Navigation */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 14,
          }}
        >
          <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
            {step + 1} / {STEPS.length}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  background: "transparent",
                  color: "hsl(var(--fg-muted))",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ←
              </button>
            )}
            <button
              onClick={() => {
                if (step < STEPS.length - 1) setStep(step + 1);
                else onClose();
              }}
              style={{
                padding: "4px 14px",
                fontSize: 11,
                border: "1px solid hsl(var(--accent) / 0.5)",
                borderRadius: 6,
                background: "hsl(var(--accent) / 0.15)",
                color: "hsl(var(--accent))",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 600,
              }}
            >
              {step < STEPS.length - 1 ? "→ Next" : "✓ Done"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
