// Fixture for the developer preview scan (W13.L6). MIT.
const WORDS_PER_MINUTE = 200;
lumen.commands.register({ id: "reading-time", label: "Reading time" }, async () => {
  const text = await lumen.document.getText();
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  await lumen.notifications.show(`${words} words · about ${minutes} min`, "info");
});
