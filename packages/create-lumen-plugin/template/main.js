// __PLUGIN_TITLE__ — a Lumen plugin. It runs in Lumen's sandbox (QuickJS):
// no network, no DOM, only the `lumen` API your granted capabilities open.
// API reference: https://lumen-md docs → Plugins → Plugin API.

await lumen.commands.register({ id: "run", label: "__PLUGIN_TITLE__" }, async () => {
  const text = await lumen.document.getText();
  const words = (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
  await lumen.notifications.show(`${words} words`, "info");
});
