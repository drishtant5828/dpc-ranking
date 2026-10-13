// Points tab (Break Point and First Serve boards): the board ranked by score —
// total match points — with each player's rating beside their name. It opens
// first; the rating-based Ranking tab is still one tap away.
(function () {
  const SRC = { "first-serve": ["firstServe", "rankings"], "break-point": ["breakPoint", "breakPointOverall"] }[document.body.dataset.page];
  const switcher = document.querySelector(".tab-switcher"), firstPanel = document.querySelector(".subsection");
  if (!SRC || !switcher || !firstPanel) return;
  const SB = { url: "https://zruqzybdpniofxbcwuat.supabase.co", key: "sb_publishable_O5kl7By_s23gMXNULck-yw_cksU-9Oy" };
  const MIN_MATCHES = 2;

  const tab = document.createElement("button");
  tab.type = "button"; tab.className = "tab-button"; tab.id = "pointsTab";
  tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "pointsPanel");
  tab.textContent = "Points";
  switcher.prepend(tab);

  const panel = document.createElement("section");
  panel.className = "subsection points-panel"; panel.id = "pointsPanel";
  panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", "pointsTab");
  panel.innerHTML = `<p class="pts-note">Ranked by points from every match. Rating is shown beside each name.</p>
    <input class="pts-search" type="search" placeholder="Search player name" aria-label="Search player name">
    <div class="pts-head" aria-hidden="true"><span>#</span><span>Player · rating</span><span>Score</span></div>
    <ol class="pts-list"><li class="pts-empty">Loading…</li></ol>`;
  firstPanel.parentNode.insertBefore(panel, firstPanel);

  function show(on) {
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", String(on));
    panel.hidden = !on;
    panel.classList.toggle("panel-hidden", !on);
    if (!on) return;
    switcher.querySelectorAll(".tab-button").forEach((b) => { if (b !== tab) { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); } });
    document.querySelectorAll(".subsection").forEach((p) => { if (p !== panel) { p.hidden = true; p.classList.add("panel-hidden"); } });
  }
  tab.addEventListener("click", () => show(true));
  switcher.querySelectorAll(".tab-button").forEach((b) => { if (b !== tab) b.addEventListener("click", () => show(false)); });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Same colours as the levels on the rating explainer.
  const BAND = [[0, "#9c968b"], [1, "#6f9a7a"], [2, "#2e4e8e"], [3, "#c8752d"], [4.1, "#7a3b57"], [5, "#b58a2e"], [6, "#9d2e2e"]];
  const bandColour = (r) => BAND.filter((b) => r >= b[0]).pop()[1];
  let me = "";
  try { me = String(JSON.parse(localStorage.getItem("dpcPlayerSession") || "{}").name || "").trim().toLowerCase(); } catch (e) {}

  let rows = [];
  function render(q) {
    const list = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    panel.querySelector(".pts-list").innerHTML = list.length ? list.map((r) => {
      const rating = Number(r.rating);
      return `<li class="pts-row${r.rank <= 3 ? " pts-top" : ""}${me && r.name.toLowerCase() === me ? " pts-me" : ""}">
        <span class="pts-rank">${r.rank}</span>
        <span class="pts-player"><span class="pts-name">${esc(r.name)}</span>${isNaN(rating) ? "" : `<span class="pts-rating" style="--band:${bandColour(rating)}">${rating.toFixed(2)}</span>`}
          <span class="pts-mp">${r.mp} matches${r.tied ? " · tied" : ""}</span></span>
        <span class="pts-score">${r.score}<small>pts</small></span></li>`;
    }).join("") : `<li class="pts-empty">${q ? "No player by that name on this board." : "The board fills up after two matches."}</li>`;
  }
  panel.querySelector(".pts-search").addEventListener("input", (e) => render(e.target.value.trim().toLowerCase()));

  fetch(`${SB.url}/rest/v1/leaderboard_cache?source=eq.${SRC[0]}&select=payload`, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((data) => {
      const board = ((data[0] && data[0].payload && data[0].payload[SRC[1]]) || [])
        .map((x) => ({ name: String(x.Name || "").trim(), score: Math.round(Number(x.Score) || 0), rating: x.Rating, mp: Number(x["Matches played"]) || 0 }))
        .filter((x) => x.name && x.mp >= MIN_MATCHES)
        .sort((a, b) => b.score - a.score || Number(b.rating) - Number(a.rating) || a.name.localeCompare(b.name));
      board.forEach((x, i) => {   // equal points share a rank: 1, 2, 2, 4
        const prev = board[i - 1], next = board[i + 1];
        x.rank = prev && prev.score === x.score ? prev.rank : i + 1;
        x.tied = (prev && prev.score === x.score) || (next && next.score === x.score);
      });
      rows = board;
      render("");
    })
    .catch((e) => {
      window.DPC?.report("Leaderboard: points", e);
      panel.querySelector(".pts-list").innerHTML = `<li class="pts-empty">Couldn't load points. Pull to refresh or try again.</li>`;
    });

  // Open on Points, unless someone arrived with a search (?q=…), which belongs to the Ranking tab.
  if (!new URLSearchParams(location.search).get("q")) {
    show(true);
    document.addEventListener("DOMContentLoaded", () => setTimeout(() => show(true), 0));
  }
})();
