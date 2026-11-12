# Crafting_WOW — historique cloud de l'Alchemist's Grimoire

Une tâche GitHub Actions scanne l'hôtel des ventes de **WoW Forever** toutes les heures via l'API Blizzard, même PC éteint, et publie les résultats sur la branche `data`. Le Grimoire les fusionne à chaque ouverture (et toutes les 20 min).

## Contenu

| Fichier | Rôle |
|---|---|
| `.github/workflows/scan-ah.yml` | Tâche planifiée (toutes les heures à :17 UTC, ou à la main via *Run workflow*) |
| `scripts/scan.mjs` | Récupère les enchères, calcule prix min / prix marché / quantité, écrit les JSON |
| `scripts/items.json` | Liste des objets suivis par le Grimoire (2 363 IDs) — seuls eux vont dans l'historique |

Sur la branche `data` (créée automatiquement au premier scan) :

- `latest.json` — `{ t, count, prices: { itemId: [min, marché, quantité] } }` : tous les objets du dernier scan
- `snaps.json` — `{ snaps: [ { t, items: { itemId: [quantité, min] } } ] }` : un scan par heure, gardé 7 jours

Si Blizzard n'a pas renouvelé ses données depuis le scan précédent, rien n'est écrit (pas de faux scan). La branche `data` ne garde qu'un seul commit, le dépôt ne grossit donc pas.

## Mise en place

1. **Secrets** — *Settings → Secrets and variables → Actions → Secrets* :
   - `BLIZZARD_CLIENT_ID`
   - `BLIZZARD_CLIENT_SECRET`
   (créés sur https://develop.battle.net/access/clients)
2. **Variables** — même page, onglet *Variables*. Copie la ligne affichée dans le Grimoire (onglet Sources → « Pour GitHub (Variables) ») :
   - `RULESET` — ex. `1` (JcJ)
   - `AH_IDS` — ex. `103,104` (les numéros de ton hôtel des ventes)
   - optionnel : `REGION` (`eu` par défaut), `NAMESPACE` (`dynamic-forever-eu` par défaut), `KEEP_HOURS` (`168` par défaut)
3. **Lancer un premier scan** — onglet *Actions → Scan hôtel des ventes → Run workflow*.
4. **Brancher le Grimoire** — onglet Sources → « Adresse des données » :
   `https://raw.githubusercontent.com/DoubleVB/Crafting_WOW/data/`

> ⚠️ `raw.githubusercontent.com` n'est lisible sans connexion que si le dépôt est **public**. Les secrets Blizzard restent protégés même en public (ils ne sont jamais écrits dans les fichiers). Si tu veux garder le dépôt privé, il faudra une autre source (ex. GitHub Pages ou un Gist public).

## Test local

```bash
BLIZZARD_CLIENT_ID=… BLIZZARD_CLIENT_SECRET=… RULESET=1 AH_IDS=103 node scripts/scan.mjs ./out
```
Node 20+, aucune dépendance.
