// Scan horaire de l'hôtel des ventes WoW Forever via l'API Blizzard.
// Écrit latest.json (derniers prix) et snaps.json (historique) lus par l'Alchemist's Grimoire.
// Node 20+, aucune dépendance.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const env = (k, d = "") => (process.env[k] ?? "").trim() || d;
const OUT = path.resolve(process.argv[2] || "data-branch");
const REGION = env("REGION", "eu").toLowerCase();
const NAMESPACE = env("NAMESPACE", `dynamic-forever-${REGION}`);
const RULESET = env("RULESET", "1");
const AH_IDS = env("AH_IDS").split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite);
const KEEP_HOURS = Number(env("KEEP_HOURS", "168")) || 168;
const CLIENT_ID = env("BLIZZARD_CLIENT_ID");
const CLIENT_SECRET = env("BLIZZARD_CLIENT_SECRET");

if (!CLIENT_ID || !CLIENT_SECRET) fail("Secrets BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET manquants.");
if (!AH_IDS.length) fail("Variable AH_IDS manquante (ex. 103,104). Copie-la depuis le Grimoire : onglet Sources → « Pour GitHub (Variables) ».");

function fail(m) { console.error("✖ " + m); process.exit(1); }

async function token() {
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) fail(`Authentification Blizzard refusée (${res.status}). Vérifie l'ID et le secret.`);
  return (await res.json()).access_token;
}

let TOKEN, lastMod = 0;
async function api(p) {
  const sep = p.includes("?") ? "&" : "?";
  const url = `https://${REGION}.api.blizzard.com${p}${sep}namespace=${encodeURIComponent(NAMESPACE)}&locale=fr_FR`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN } });
    if (res.ok) {
      const lm = Date.parse(res.headers.get("last-modified") || "");
      if (lm) lastMod = Math.max(lastMod, lm);
      return res.json();
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
    const e = new Error(`API ${res.status} sur ${p}`); e.status = res.status; throw e;
  }
}

// Même logique que le Grimoire : route « ruleset » d'abord, puis les routes alternatives
async function fetchHouse(id) {
  const routes = [`/data/wow/ruleset/${RULESET}/auctions/${id}`, `/data/wow/connected-realm/${RULESET}/auctions/${id}`, `/data/wow/auctions/${id}`];
  const tried = [];
  for (const r of routes) {
    try {
      const h = await api(r);
      let all = [...(h.auctions || []), ...(h.commodities || [])];
      if (r === routes[0] && !Array.isArray(h.commodities)) {
        try { const c = await api(`${r}/commodities`); if (Array.isArray(c.auctions)) all = all.concat(c.auctions); }
        catch (e) { if (e.status !== 404) throw e; }
      }
      if (all.length) { console.log(`✔ HV #${id} : ${all.length} enchères (${r})`); return all; }
      tried.push(`${r}: vide`);
    } catch (e) { tried.push(`${r}: ${e.status || e.message}`); }
  }
  console.warn(`⚠ HV #${id} : aucune enchère — ${tried.join(" · ")}`);
  return [];
}

// Prix min, prix « marché » (moyenne des 15 % les moins chers) et quantité — identique à ingest() du Grimoire
function aggregate(auctions) {
  const by = {};
  for (const a of auctions) {
    const id = a.item && a.item.id, q = a.quantity || 1;
    const total = a.buyout ?? (a.unit_price != null ? a.unit_price * q : null);
    if (!id || !total) continue;
    (by[id] ||= []).push([total / q, q]);
  }
  const prices = {};
  for (const id in by) {
    const l = by[id].sort((a, b) => a[0] - b[0]);
    const tot = l.reduce((s, x) => s + x[1], 0), lim = Math.max(1, tot * 0.15);
    let n = 0, sum = 0;
    for (const [p, q] of l) { const take = Math.min(q, lim - n); sum += p * take; n += take; if (n >= lim) break; }
    prices[id] = [Math.round(l[0][0]), Math.round(sum / n), tot];
  }
  return prices;
}

const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };

TOKEN = await token();
let auctions = [];
for (const id of AH_IDS) auctions = auctions.concat(await fetchHouse(id));
if (!auctions.length) fail("Aucune enchère récupérée : vérifie RULESET, AH_IDS et NAMESPACE.");

// Signature identique au Grimoire : si Blizzard n'a pas renouvelé l'HV, pas de faux scan
let sig = auctions.length;
for (let i = 0; i < auctions.length; i += 97) { const a = auctions[i]; sig = (sig * 31 + (a.id || 0) + (a.buyout || a.unit_price || 0)) % 2147483647; }

await mkdir(OUT, { recursive: true });
const latestF = path.join(OUT, "latest.json"), snapsF = path.join(OUT, "snaps.json");
const prev = await readJson(latestF, {});
if (prev.sig === sig) { console.log("= Données Blizzard inchangées depuis le dernier scan : rien à écrire."); process.exit(0); }

const now = Date.now();
const t = lastMod && lastMod > now - 3 * 3600e3 ? lastMod : now;
const prices = aggregate(auctions);
const tracked = new Set(JSON.parse(await readFile(new URL("./items.json", import.meta.url), "utf8")).map(String));
const items = {};
for (const id in prices) if (tracked.has(id)) items[id] = [prices[id][2], prices[id][0]]; // [quantité, prix min]

const sj = await readJson(snapsF, { snaps: [] });
const cutoff = now - KEEP_HOURS * 3600e3;
let snaps = (sj.snaps || []).filter(s => s.t >= cutoff && Math.abs(s.t - t) >= 60000);
snaps.push({ t, items });
snaps.sort((a, b) => a.t - b.t);

await writeFile(latestF, JSON.stringify({ t, count: auctions.length, sig, region: REGION, namespace: NAMESPACE, ruleset: RULESET, ahIds: AH_IDS, prices }));
await writeFile(snapsF, JSON.stringify({ updated: now, keepHours: KEEP_HOURS, snaps }));
if (!existsSync(path.join(OUT, "README.md")))
  await writeFile(path.join(OUT, "README.md"), "# Données du Grimoire\n\nBranche générée automatiquement par `.github/workflows/scan-ah.yml`. Ne pas modifier à la main.\n");
console.log(`✔ Scan écrit : ${auctions.length} enchères, ${Object.keys(prices).length} objets, ${Object.keys(items).length} suivis, ${snaps.length} scans en historique (données Blizzard du ${new Date(t).toISOString()}).`);
