/**
 * The one inline script in index.html (C1): runs before the first paint so
 * a returning visitor sees the neutral skeleton (not the prerendered
 * welcome text) and the saved light theme. Allowed by its hash in every
 * CSP (index.html, public/_headers, vercel.json, docker/nginx.conf,
 * src-tauri/tauri.conf.json); bootScript.test.ts keeps them in sync.
 */
import { createHash } from "node:crypto";

export const BOOT_JS =
  'try{var s=localStorage.getItem("lumen-md");if(s){var d=document.documentElement;d.setAttribute("data-returning","");if((JSON.parse(s).state||{}).theme==="light")d.classList.remove("dark")}}catch(e){}';

export const BOOT_JS_HASH = `'sha256-${createHash("sha256").update(BOOT_JS).digest("base64")}'`;
