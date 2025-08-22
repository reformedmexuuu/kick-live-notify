const streamersContainer = document.getElementById("streamers");
const liveCountElement = document.getElementById("liveCount");
const membersElement = document.getElementById("members");
const povSelector = document.getElementById("pov");
const searchInput = document.getElementById("search");
const refreshBtn = document.getElementById("refreshBtn");
const banner = document.getElementById("banner");

let state = {
  members: [],
  liveCount: 0,
  totalMembers: 0,
  updatedAt: null,
};

function setBanner(text, isError = false) {
  if (!text) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }
  banner.classList.remove("hidden");
  banner.textContent = text;
  banner.style.background = isError ? "#3b0d0d" : "#263238";
  banner.style.color = isError ? "#ffd1d1" : "#e0f2f1";
}

async function fetchStreamers() {
  try {
    setBanner("Aktualizuję dane…");
    const res = await fetch("/api/streamers", { cache: "no-store" });
    if (!res.ok) throw new Error("Błąd pobierania danych");
    const data = await res.json();
    state = data;
    renderStreamers();
    setBanner(`Ostatnia aktualizacja: ${new Date(state.updatedAt).toLocaleTimeString()}`);
  } catch (err) {
    setBanner("Nie udało się pobrać danych z serwera.", true);
  }
}

function renderStreamers() {
  const pov = povSelector.value;
  const query = searchInput.value.trim().toLowerCase();

  streamersContainer.innerHTML = "";

  let list = state.members;

  if (pov === "live") list = list.filter((m) => m.live);
  if (pov === "offline") list = list.filter((m) => !m.live);
  if (query) list = list.filter((m) => (m.name || "").toLowerCase().includes(query) || (m.username || "").toLowerCase().includes(query));

  // Update stats
  liveCountElement.textContent = `Live: ${state.liveCount}`;
  membersElement.textContent = `Streamerów: ${state.totalMembers}`;

  if (!list.length) {
    streamersContainer.textContent = "Brak wyników.";
    return;
  }

  list.forEach((m) => {
    const div = document.createElement("div");
    div.className = `streamer ${m.live ? "live" : "offline"}`;

    const img = document.createElement("img");
    img.className = "avatar";
    img.alt = m.name;
    img.src = m.avatar || "";
    img.referrerPolicy = "no-referrer";

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "flex-start";

    const name = document.createElement("div");
    name.className = "name";
    const link = document.createElement("a");
    link.href = m.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = m.name || m.username;
    name.appendChild(link);

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = m.title || "";

    const status = document.createElement("div");
    status.className = "status";
    status.textContent = m.live ? "LIVE" : "Offline";

    wrap.appendChild(name);
    if (title.textContent) wrap.appendChild(title);

    div.appendChild(img);
    div.appendChild(wrap);
    div.appendChild(status);
    streamersContainer.appendChild(div);
  });
}

// UI events
povSelector.addEventListener("change", renderStreamers);
searchInput.addEventListener("input", renderStreamers);
refreshBtn.addEventListener("click", fetchStreamers);

// Auto refresh
setInterval(fetchStreamers, 10000);
fetchStreamers();
