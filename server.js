//
// Kick Live Tracker + Admin Panel + Discord Webhook (Embeds)
// ----------------------------------------------------------
// - Sprawdza status LIVE streamerów z Kick.com (nieoficjalny endpoint kanału)
// - Panel admina (Basic Auth) do edycji listy streamerów, odświeżania i trybu debug
// - Webhook na Discord (embedy) przy przejściu offline → live
//
// Wymagany Node.js 18+ (globalny fetch).
// ----------------------------------------------------------

const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || null;

// --- Basic Auth ---
function requireAuth(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin Panel"');
    return res.status(401).send("Authentication required");
  }
  const [user, pass] = Buffer.from(auth.split(" ")[1], "base64").toString().split(":");
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="Admin Panel"');
  return res.status(401).send("Invalid credentials");
}

// --- Config (pliki) ---
const CONFIG_PATH = path.join(__dirname, "config.json");
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      refreshInterval: 10000,
      debug: false,
      kickUsers: [
        { username: "kickusername1", displayName: "Streamer 1" },
        { username: "kickusername2", displayName: "Streamer 2" }
      ]
    };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error("Błąd czytania config.json:", e);
    return { refreshInterval: 10000, debug: false, kickUsers: [] };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
let config = loadConfig();

// --- Kick helpers ---
async function fetchKickChannel(username) {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "kick-live-tracker/1.0"
    }
  });
  if (!res.ok) {
    throw new Error(`Kick API error for ${username}: ${res.status}`);
  }
  return res.json();
}

function pickAvatar(user) {
  return (
    user?.profile_pic ||
    user?.profilePic ||
    user?.pfp ||
    user?.avatar ||
    null
  );
}

function pickThumb(live) {
  // Różne formaty miniatur w danych Kick – próbujemy kilku pól
  return (
    live?.thumbnail?.url ||
    live?.thumbnail_url ||
    live?.thumbnail ||
    null
  );
}

async function getKickStatus(username) {
  try {
    const data = await fetchKickChannel(username);
    const liveObj = data?.livestream || null;
    const live = !!(liveObj && (liveObj.is_live === true || liveObj?.isLive === true));
    const title = liveObj?.session_title || liveObj?.slug || null;
    const viewers = liveObj?.viewer_count ?? liveObj?.viewers ?? null;
    const name = data?.user?.display_name || data?.user?.displayName || data?.user?.username || username;
    const avatar = pickAvatar(data?.user);
    const thumbnail = pickThumb(liveObj);
    return {
      id: username,
      username,
      name,
      live,
      title,
      viewers,
      url: `https://kick.com/${username}`,
      avatar,
      thumbnail
    };
  } catch (e) {
    if (config.debug) console.error("Kick fetch failed:", username, e.message);
    return {
      id: username,
      username,
      name: username,
      live: false,
      title: null,
      viewers: null,
      url: `https://kick.com/${username}`,
      avatar: null,
      thumbnail: null,
      error: true
    };
  }
}

// --- Discord Webhook (Embed) ---
async function sendDiscordWebhook(streamer) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Kick Live Notifier",
        avatar_url: "https://i.imgur.com/3QhZq.png",
        embeds: [
          {
            title: `🚀 ${streamer.name} jest teraz LIVE!`,
            url: streamer.url,
            description: streamer.title || "Brak opisu transmisji",
            color: 5763719,
            thumbnail: { url: streamer.thumbnail || streamer.avatar || "https://i.imgur.com/3QhZq.png" },
            fields: [
              { name: "Widownia", value: streamer.viewers?.toString() || "brak danych", inline: true }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: "Kick Live Tracker" }
          }
        ]
      })
    });
  } catch (err) {
    if (config.debug) console.error("Webhook error:", err.message);
  }
}

// --- Aktualizacje i pamięć statusów ---
let members = [];
const prevStatus = new Map(); // username -> live
let timer = null;

async function updateAll() {
  const users = Array.isArray(config.kickUsers) ? config.kickUsers : [];
  const results = await Promise.all(users.map(u => getKickStatus(u.username)));

  // powiadomienia offline->live
  for (const m of results) {
    const prev = prevStatus.get(m.username) || false;
    if (!prev && m.live) sendDiscordWebhook(m);
    prevStatus.set(m.username, m.live);
  }

  // wstaw displayName z config, jeśli podano
  members = results.map((m) => ({
    ...m,
    name: (users.find(u => u.username.toLowerCase() === m.username.toLowerCase())?.displayName) || m.name
  }));

  // sortowanie: live → nazwa
  members.sort((a, b) => (b.live - a.live) || (a.name || "").localeCompare(b.name || "", "pl"));

  if (config.debug) {
    console.log(`[update] ${new Date().toISOString()} live=${members.filter(x=>x.live).length}/${members.length}`);
  }
}

function startUpdater() {
  if (timer) clearInterval(timer);
  const interval = Math.max(3000, Number(config.refreshInterval || 10000));
  timer = setInterval(updateAll, interval);
}

// start
startUpdater();
updateAll();

// --- API ---
app.get("/api/streamers", (req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    totalMembers: members.length,
    liveCount: members.filter(m => m.live).length,
    members
  });
});

app.get("/api/config", requireAuth, (req, res) => {
  res.json(config);
});

app.post("/api/config", requireAuth, (req, res) => {
  const body = req.body || {};
  // Obsługa textarea kickUsersText
  if (typeof body.kickUsersText === "string") {
    const lines = body.kickUsersText.split("\n").map(l => l.trim()).filter(Boolean);
    body.kickUsers = lines.map(line => {
      const [u, name] = line.split("|").map(s => s && s.trim());
      return { username: (u||"").toLowerCase(), displayName: name || u };
    });
    delete body.kickUsersText;
  }
  config = { ...config, ...body };
  saveConfig(config);
  startUpdater();
  res.json({ success: true, config });
});

// --- Routing ---
app.get("/admin", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🟢 Server running at http://localhost:${PORT}`);
});
