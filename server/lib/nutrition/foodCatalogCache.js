import { createHash } from "crypto";

import admin from "../../admin.js";
import { getFoodDetails, searchFoods } from "./foodData.js";

const db = admin?.firestore ? admin.firestore() : null;

const QUERY_COLLECTION = "nutrition_query_cache_v1";
const ITEM_COLLECTION = "nutrition_item_cache_v1";
const CATALOG_COLLECTION = "nutrition_catalog_v1";

const QUERY_FRESH_MS = Number(process.env.NUTRITION_QUERY_CACHE_FRESH_MS || 6 * 60 * 60 * 1000);
const QUERY_STALE_MS = Number(process.env.NUTRITION_QUERY_CACHE_STALE_MS || 21 * 24 * 60 * 60 * 1000);
const ITEM_FRESH_MS = Number(process.env.NUTRITION_ITEM_CACHE_FRESH_MS || 7 * 24 * 60 * 60 * 1000);
const ITEM_STALE_MS = Number(process.env.NUTRITION_ITEM_CACHE_STALE_MS || 60 * 24 * 60 * 60 * 1000);
const QUERY_BG_REFRESH_MS = Number(
  process.env.NUTRITION_QUERY_BG_REFRESH_MS || 45 * 60 * 1000
);
const ITEM_BG_REFRESH_MS = Number(
  process.env.NUTRITION_ITEM_BG_REFRESH_MS || 2 * 24 * 60 * 60 * 1000
);
const MAX_CACHE_RESULTS = 30;
const MAX_CATALOG_WRITE_ITEMS = 15;

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nowMs() {
  return Date.now();
}

function hash(input) {
  return createHash("sha1").update(String(input || "")).digest("hex");
}

function normaliseQuery(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function queryDocId(queryNorm) {
  return `q_${hash(queryNorm)}`;
}

function itemDocId(provider, providerId) {
  return `i_${hash(`${String(provider || "").toLowerCase()}:${String(providerId || "")}`)}`;
}

function canonicalKey(item) {
  const clean = (v) =>
    String(v || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${clean(item?.title)}|${clean(item?.brand) || "-"}`;
}

function catalogDocId(item) {
  return `c_${hash(canonicalKey(item))}`;
}

function isUsableAge(ageMs, maxAgeMs) {
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
}

function qualityRank(item) {
  let score = 0;
  if (item?.verified || item?.verification === "verified") score += 60;
  if (item?.verification === "community") score += 35;
  if (toNum(item?.calories, 0) > 0) score += 12;
  if (toNum(item?.macros?.protein, 0) > 0) score += 10;
  if (toNum(item?.macros?.carbs, 0) > 0) score += 10;
  if (toNum(item?.macros?.fat, 0) > 0) score += 10;
  if (item?.provider === "fdc") score += 8;
  if (item?.provider === "nutritionix") score += 6;
  if (item?.provider === "openfoodfacts") score += 4;
  return score;
}

function withTimeout(promise, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label || "operation"} timed out`)), ms)
    ),
  ]);
}

function minimalSearchItem(item) {
  const clean = item || {};
  return {
    id: String(clean.id || ""),
    source: "global",
    title: String(clean.title || "Food"),
    brand: String(clean.brand || ""),
    calories: Math.round(toNum(clean.calories, 0)),
    servingText: String(clean.servingText || ""),
    macros: {
      protein: toNum(clean?.macros?.protein, 0),
      carbs: toNum(clean?.macros?.carbs, 0),
      fat: toNum(clean?.macros?.fat, 0),
    },
    provider: String(clean.provider || ""),
    providerId: String(clean.providerId || ""),
    verification: clean.verification || (clean.verified ? "verified" : "unverified"),
    verified: Boolean(clean.verified || clean.verification === "verified"),
    serving: clean.serving || null,
    sourceUrl: String(clean.sourceUrl || ""),
  };
}

function detailsPayloadFromSearchItem(item) {
  const s = minimalSearchItem(item);
  const perServing = item?.nutrientsPerServing || {
    calories: s.calories,
    protein: s.macros.protein,
    carbs: s.macros.carbs,
    fat: s.macros.fat,
  };
  const per100g = item?.nutrientsPer100g || {};

  return {
    ...s,
    nutrientsPerServing: perServing,
    nutrientsPer100g: per100g,
    item: {
      id: s.id,
      provider: s.provider,
      providerId: s.providerId,
      title: s.title,
      brand: s.brand,
      verification: s.verification,
      verified: s.verified,
      serving: s.serving || { amount: 1, unit: "serving", grams: null, text: s.servingText },
      servingText: s.servingText,
      perServing,
      per100g,
      macros: s.macros,
      calories: s.calories,
      sourceUrl: s.sourceUrl,
      notes:
        s.verification === "verified"
          ? "Deterministic nutrition data from verified provider."
          : s.verification === "community"
          ? "Community nutrition data; verify against package where possible."
          : "Unverified nutrition data; treat as approximate.",
    },
  };
}

function sanitizeDetailsPayload(payload) {
  const p = payload || {};
  const top = minimalSearchItem(p);
  const perServing = p.nutrientsPerServing || p.item?.perServing || {};
  const per100g = p.nutrientsPer100g || p.item?.per100g || {};

  return {
    ...top,
    nutrientsPerServing: perServing,
    nutrientsPer100g: per100g,
    item: {
      id: top.id,
      provider: top.provider,
      providerId: top.providerId,
      title: top.title,
      brand: top.brand,
      verification: top.verification,
      verified: top.verified,
      serving:
        p.item?.serving ||
        top.serving || { amount: 1, unit: "serving", grams: null, text: top.servingText },
      servingText: top.servingText,
      perServing,
      per100g,
      macros: top.macros,
      calories: top.calories,
      sourceUrl: top.sourceUrl,
      notes: p.item?.notes || "",
    },
  };
}

function mergeCatalogItems(a, b) {
  if (!a) return b;
  if (!b) return a;
  const best = qualityRank(b) > qualityRank(a) ? b : a;
  const other = best === b ? a : b;

  const mergedMacros = {
    protein: toNum(best?.macros?.protein, toNum(other?.macros?.protein, 0)),
    carbs: toNum(best?.macros?.carbs, toNum(other?.macros?.carbs, 0)),
    fat: toNum(best?.macros?.fat, toNum(other?.macros?.fat, 0)),
  };

  return {
    ...best,
    title: best.title || other.title,
    brand: best.brand || other.brand,
    calories: toNum(best.calories, toNum(other.calories, 0)),
    macros: mergedMacros,
    verification:
      best.verification ||
      other.verification ||
      (best.verified || other.verified ? "verified" : "unverified"),
    verified: Boolean(best.verified || other.verified),
    servingText: best.servingText || other.servingText,
    serving: best.serving || other.serving || null,
    sourceUrl: best.sourceUrl || other.sourceUrl || "",
  };
}

async function getQueryCacheState(queryNorm) {
  if (!db || !queryNorm) return null;
  const snap = await db.collection(QUERY_COLLECTION).doc(queryDocId(queryNorm)).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  const updatedAtMs = toNum(data.updatedAtMs, 0);
  const ageMs = nowMs() - updatedAtMs;
  const results = Array.isArray(data.results) ? data.results : [];

  return {
    queryNorm,
    ageMs,
    updatedAtMs,
    results,
    fresh: isUsableAge(ageMs, QUERY_FRESH_MS),
    staleUsable: isUsableAge(ageMs, QUERY_STALE_MS),
  };
}

async function getItemCacheState(provider, providerId) {
  if (!db || !provider || !providerId) return null;
  const snap = await db.collection(ITEM_COLLECTION).doc(itemDocId(provider, providerId)).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  const updatedAtMs = toNum(data.updatedAtMs, 0);
  const ageMs = nowMs() - updatedAtMs;
  const payload = data.payload || null;

  return {
    provider,
    providerId,
    ageMs,
    updatedAtMs,
    payload,
    fresh: isUsableAge(ageMs, ITEM_FRESH_MS),
    staleUsable: isUsableAge(ageMs, ITEM_STALE_MS),
  };
}

async function persistItemCachePayload(payload) {
  if (!db || !payload?.provider || !payload?.providerId) return;
  const clean = sanitizeDetailsPayload(payload);
  const stamp = nowMs();
  const ref = db
    .collection(ITEM_COLLECTION)
    .doc(itemDocId(clean.provider, clean.providerId));

  await ref.set(
    {
      provider: clean.provider,
      providerId: clean.providerId,
      title: clean.title,
      brand: clean.brand,
      verification: clean.verification,
      verified: clean.verified,
      updatedAtMs: stamp,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      payload: clean,
    },
    { merge: true }
  );
}

async function persistCatalogItems(items = []) {
  if (!db) return;
  const top = (items || []).slice(0, MAX_CATALOG_WRITE_ITEMS);
  await Promise.all(
    top.map(async (item) => {
      const minimal = minimalSearchItem(item);
      if (!minimal.title) return;

      const ref = db.collection(CATALOG_COLLECTION).doc(catalogDocId(minimal));
      const snap = await ref.get();
      const existing = snap.exists ? snap.data()?.bestItem || null : null;
      const merged = mergeCatalogItems(existing, minimal);

      const alternates = new Map();
      const pushAlt = (x) => {
        if (!x?.provider || !x?.providerId) return;
        const key = `${x.provider}:${x.providerId}`;
        alternates.set(key, {
          provider: x.provider,
          providerId: x.providerId,
          verification: x.verification || (x.verified ? "verified" : "unverified"),
          title: x.title || "",
          brand: x.brand || "",
        });
      };

      if (Array.isArray(snap.data()?.alternates)) {
        for (const alt of snap.data().alternates) pushAlt(alt);
      }
      pushAlt(existing);
      pushAlt(minimal);

      await ref.set(
        {
          canonicalKey: canonicalKey(merged),
          bestItem: merged,
          alternates: Array.from(alternates.values()).slice(0, 20),
          updatedAtMs: nowMs(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    })
  );
}

async function persistSearchCache(queryNorm, results) {
  if (!db || !queryNorm) return;
  const trimmed = (results || []).slice(0, MAX_CACHE_RESULTS).map(minimalSearchItem);
  const stamp = nowMs();
  const queryRef = db.collection(QUERY_COLLECTION).doc(queryDocId(queryNorm));

  await queryRef.set(
    {
      queryNorm,
      resultCount: trimmed.length,
      updatedAtMs: stamp,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      results: trimmed,
    },
    { merge: true }
  );

  // Keep item cache warm using search results so details open quickly.
  const batch = db.batch();
  for (const row of trimmed) {
    if (!row.provider || !row.providerId) continue;
    const payload = detailsPayloadFromSearchItem(row);
    const ref = db.collection(ITEM_COLLECTION).doc(itemDocId(row.provider, row.providerId));
    batch.set(
      ref,
      {
        provider: row.provider,
        providerId: row.providerId,
        title: row.title,
        brand: row.brand || "",
        verification: row.verification || (row.verified ? "verified" : "unverified"),
        verified: Boolean(row.verified || row.verification === "verified"),
        updatedAtMs: stamp,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        payload: payload,
      },
      { merge: true }
    );
  }
  await batch.commit();
  await persistCatalogItems(trimmed);
}

function decorateCacheMeta(payload, meta) {
  if (!payload || typeof payload !== "object") return payload;
  return { ...payload, cacheMeta: meta };
}

function shouldBackgroundRefresh(ageMs, thresholdMs) {
  return Number.isFinite(ageMs) && ageMs >= Math.max(0, thresholdMs);
}

function refreshQueryInBackground(queryNorm, limit) {
  void (async () => {
    try {
      const live = await withTimeout(
        searchFoods({ query: queryNorm, limit }),
        4000,
        "searchFoods background"
      );
      if (Array.isArray(live) && live.length) {
        await persistSearchCache(queryNorm, live);
      }
    } catch (err) {
      console.error("[nutrition/cache] background query refresh failed", err?.message || err);
    }
  })();
}

function refreshItemInBackground(provider, providerId, name) {
  void (async () => {
    try {
      const live = await withTimeout(
        getFoodDetails({ provider, id: providerId, name }),
        4500,
        "getFoodDetails background"
      );
      if (live?.provider && live?.providerId) {
        await persistItemCachePayload(live);
      }
    } catch (err) {
      console.error("[nutrition/cache] background item refresh failed", err?.message || err);
    }
  })();
}

export async function searchFoodsCached({
  query,
  limit = 30,
  networkTimeoutMs = 2400,
} = {}) {
  const qNorm = normaliseQuery(query);
  if (!qNorm || qNorm.length < 2) {
    return { results: [], cacheMeta: { source: "none", cache: "empty" } };
  }

  let cacheState = null;
  try {
    cacheState = await getQueryCacheState(qNorm);
    if (cacheState?.fresh && cacheState.results.length) {
      if (shouldBackgroundRefresh(cacheState.ageMs, QUERY_BG_REFRESH_MS)) {
        refreshQueryInBackground(qNorm, limit);
      }
      return {
        results: cacheState.results.slice(0, limit),
        cacheMeta: {
          source: "cache",
          cache: "fresh",
          ageMs: cacheState.ageMs,
          queryNorm: qNorm,
        },
      };
    }
  } catch (err) {
    console.error("[nutrition/cache] query read failed", err?.message || err);
  }

  try {
    const liveResults = await withTimeout(
      searchFoods({ query: qNorm, limit }),
      networkTimeoutMs,
      "searchFoods"
    );
    if (Array.isArray(liveResults) && liveResults.length) {
      void persistSearchCache(qNorm, liveResults).catch((err) =>
        console.error("[nutrition/cache] query write failed", err?.message || err)
      );
      return {
        results: liveResults.slice(0, limit),
        cacheMeta: {
          source: "network",
          cache: "miss",
          queryNorm: qNorm,
        },
      };
    }
  } catch (err) {
    console.error("[nutrition/cache] live search failed", err?.message || err);
  }

  if (cacheState?.staleUsable && cacheState.results.length) {
    return {
      results: cacheState.results.slice(0, limit),
      cacheMeta: {
        source: "cache",
        cache: "stale",
        ageMs: cacheState.ageMs,
        queryNorm: qNorm,
      },
    };
  }

  return {
    results: [],
    cacheMeta: {
      source: "none",
      cache: "empty",
      queryNorm: qNorm,
    },
  };
}

export async function getFoodDetailsCached({
  provider,
  id,
  name,
  networkTimeoutMs = 3200,
} = {}) {
  let p = String(provider || "").trim();
  let itemId = String(id || "").trim();
  const qName = String(name || "").trim();

  // If provider/id missing, try to infer from cached query first.
  if ((!p || !itemId) && qName) {
    try {
      const qState = await getQueryCacheState(normaliseQuery(qName));
      const first = qState?.results?.[0];
      if (first?.provider && first?.providerId) {
        p = p || first.provider;
        itemId = itemId || first.providerId;
      }
    } catch (err) {
      console.error("[nutrition/cache] infer provider/id failed", err?.message || err);
    }
  }

  let itemCache = null;
  if (p && itemId) {
    try {
      itemCache = await getItemCacheState(p, itemId);
      if (itemCache?.fresh && itemCache.payload) {
        if (shouldBackgroundRefresh(itemCache.ageMs, ITEM_BG_REFRESH_MS)) {
          refreshItemInBackground(p, itemId, qName);
        }
        return decorateCacheMeta(itemCache.payload, {
          source: "cache",
          cache: "fresh",
          ageMs: itemCache.ageMs,
        });
      }
    } catch (err) {
      console.error("[nutrition/cache] item read failed", err?.message || err);
    }
  }

  try {
    const live = await withTimeout(
      getFoodDetails({ provider: p, id: itemId, name: qName }),
      networkTimeoutMs,
      "getFoodDetails"
    );

    if (live?.provider && live?.providerId) {
      void persistItemCachePayload(live).catch((err) =>
        console.error("[nutrition/cache] item write failed", err?.message || err)
      );
    }

    const searchSeed = [minimalSearchItem(live)];
    if (qName) {
      void persistSearchCache(normaliseQuery(qName), searchSeed).catch((err) =>
        console.error("[nutrition/cache] seed query write failed", err?.message || err)
      );
    }

    return decorateCacheMeta(live, {
      source: "network",
      cache: itemCache ? "refresh" : "miss",
    });
  } catch (err) {
    if (itemCache?.staleUsable && itemCache.payload) {
      return decorateCacheMeta(itemCache.payload, {
        source: "cache",
        cache: "stale",
        ageMs: itemCache.ageMs,
      });
    }
    throw err;
  }
}
