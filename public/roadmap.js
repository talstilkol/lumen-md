// Renders public/roadmap.html cards from the inline JSON data block.
// External (not inline) so the page works under script-src 'self' and
// builds DOM nodes with textContent so it needs no Trusted Types policy.
(function () {
  const data = JSON.parse(document.getElementById("roadmap-data").textContent);
  for (const [phase, items] of data) {
    const root = document.getElementById("phase-" + phase);
    if (!root) continue;
    for (const [id, status, title, body] of items) {
      const card = document.createElement("article");
      card.className = "card";
      const tag = document.createElement("span");
      tag.className = "tag " + status;
      tag.textContent = status;
      const idEl = document.createElement("div");
      idEl.className = "id";
      idEl.textContent = id;
      const h3 = document.createElement("h3");
      h3.textContent = title;
      const p = document.createElement("p");
      p.textContent = body;
      card.append(tag, idEl, h3, p);
      root.appendChild(card);
    }
  }
})();
