/**
 * Plan W10.E49: the `/oauth/onenote` redirect page. The only module the
 * startup code imports for it, and only on that path: the sign-in module
 * and Graph client load from here, on use.
 *
 * It finishes the sign-in, takes the code out of the address bar, and opens
 * the import wizard with the tokens (in memory) or the reason it failed.
 */
export async function oneNoteReturn(ready: Promise<unknown>, deps: { href?: () => string; openWizard?: () => void } = {}): Promise<"tokens" | "error" | "skipped"> {
  const m = await import("./onenoteSignIn");
  if (location.pathname !== m.REDIRECT_PATH) return "skipped";
  const href = (deps.href ?? (() => location.href))();
  // The code must not stay in the address bar or the history.
  history.replaceState(null, "", "/");
  let outcome: "tokens" | "error";
  try {
    const [{ oneNoteConfig }, ids] = await Promise.all([import("./onenoteGraph"), import("./onenoteClientId")]);
    if (!ids.userClientId()) await ids.loadDeployedClientId();
    const cfg = oneNoteConfig();
    if (!cfg) throw new Error("OneNote sign-in is not set up: no Microsoft app client id (enter one in the import wizard, or set onenote.clientId in /lumen-runtime.json)");
    m.giveOneNoteTokens(await m.finishOneNoteSignIn(href, cfg));
    outcome = "tokens";
  } catch (err) {
    m.giveOneNoteError(err instanceof Error ? err.message : String(err));
    outcome = "error";
  }
  await ready;
  (deps.openWizard ?? openWizardWhenMounted)();
  return outcome;
}

/** The app may still be mounting: ask for the wizard until it is open (≤ 10 s). */
function openWizardWhenMounted(): void {
  let tries = 0;
  const ask = () => {
    if (document.querySelector('[data-testid="import-wizard"]') || tries++ > 40) return;
    window.dispatchEvent(new Event("lumen-open-import"));
    setTimeout(ask, 250);
  };
  ask();
}
