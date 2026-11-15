/**
 * Panels and dialogs App.tsx shows, each its own chunk loaded on first open
 * (moved from App.tsx verbatim to keep it under the 800-line limit, W10.E31).
 */
import { lazy } from "react";

export const LocalGraphPanel = lazy(() => import("./ui/LocalGraphPanel").then(m => ({ default: m.LocalGraphPanel })));
// Canvas on Excalidraw (plan 4.19; γ.2 had it on tldraw). The legacy custom
// canvas (CanvasWhiteboard.tsx) was removed in W10.E27 (plan 12.2).
export const CanvasWhiteboard = lazy(() => import("./ui/CanvasExcalidraw").then(m => ({ default: m.CanvasExcalidraw })));
export const PluginGallery = lazy(() => import("./ui/PluginGallery").then(m => ({ default: m.PluginGallery })));
export const TemplateGallery = lazy(() => import("./ui/TemplateGallery").then(m => ({ default: m.TemplateGallery })));
export const AuditLog = lazy(() => import("./ui/AuditLog").then(m => ({ default: m.AuditLog })));
// One settings screen (plan 11.1); the theme, AI, training, trusted-key and
// organization dialogs are its tabs.
export const SettingsScreen = lazy(() => import("./ui/SettingsScreen").then(m => ({ default: m.SettingsScreen })));
export const ReadingSettings = lazy(() => import("./ui/ReadingSettings").then(m => ({ default: m.ReadingSettings })));
export const PrivacyLedgerPanel = lazy(() => import("./ui/PrivacyLedgerPanel").then(m => ({ default: m.PrivacyLedgerPanel })));
export const TrashPanel = lazy(() => import("./ui/TrashPanel").then(m => ({ default: m.TrashPanel })));
// Properties editor (plan 4.9) — lazy: the yaml-editing code is not in the startup bundle.
export const PropertiesPanel = lazy(() => import("./ui/PropertiesPanel").then(m => ({ default: m.PropertiesPanel })));
// Quick capture to inbox.md (plan 4.16): its own chunk, loaded on first open.
export const QuickCapture = lazy(() => import("./ui/QuickCapture").then(m => ({ default: m.QuickCapture })));
export const ImageHostsPanel = lazy(() => import("./ui/ImageHostsPanel").then(m => ({ default: m.ImageHostsPanel })));
export const AiDoctorPanel = lazy(() => import("./ui/AiDoctorPanel").then(m => ({ default: m.AiDoctorPanel })));
export const AgentReviewPanel = lazy(() => import("./ui/AgentReviewPanel").then(m => ({ default: m.AgentReviewPanel })));
