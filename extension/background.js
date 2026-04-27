/**
 * Lumen Web Clipper — service worker.
 *
 * Owns:
 *   • Right-click "Save selection to Lumen" context-menu entry.
 *   • Receives clip payloads from popup.html / contentScript.js and POSTs
 *     them to the configured Lumen endpoint.
 *   • Caches the chosen Lumen URL + workspace name in chrome.storage.local.
 *
 * The destination URL defaults to `http://localhost:5173` (the dev server)
 * but options.html lets the user point it at any deployed Lumen instance.
 */

const DEFAULT_LUMEN_URL = "http://localhost:5173";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lumen-clip-selection",
    title: "Save selection to Lumen",
    contexts: ["selection", "page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "lumen-clip-selection" || !tab?.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["contentScript.js"],
  });
  chrome.tabs.sendMessage(tab.id, { type: "lumen-clip-page" });
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg?.type !== "lumen-clip") return;
  try {
    const { lumenUrl } = await chrome.storage.local.get({ lumenUrl: DEFAULT_LUMEN_URL });
    const res = await fetch(`${lumenUrl}/api/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sendResponse({ ok: true });
  } catch (e) {
    // No Lumen API endpoint yet — fall back to opening the editor with the
    // payload in the URL hash so the user can paste the clip in manually.
    const { lumenUrl } = await chrome.storage.local.get({ lumenUrl: DEFAULT_LUMEN_URL });
    const url = `${lumenUrl}/#clip=${encodeURIComponent(JSON.stringify(msg.payload))}`;
    chrome.tabs.create({ url });
    sendResponse({ ok: true, fallback: true, error: String(e) });
  }
  return true;
});
