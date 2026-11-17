// Failing fixture for the developer preview scan (W13.L6): eval is refused. MIT.
lumen.commands.register({ id: "calc", label: "Calculate" }, async () => {
  const sel = await lumen.document.getText();
  await lumen.notifications.show(String(eval(sel)), "info");
});
