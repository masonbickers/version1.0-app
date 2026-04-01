const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_BASE = "https://world.openfoodfacts.org";
const NUTRITIONIX_BASE = "https://trackapi.nutritionix.com/v2";

const NUTRIENT_KEYS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "fibre",
  "sugar",
  "saturatedFat",
  "monounsaturatedFat",
  "polyunsaturatedFat",
  "transFat",
  "cholesterolMg",
  "sodiumMg",
  "potassiumMg",
  "calciumMg",
  "ironMg",
  "vitaminAMcg",
  "vitaminCMg",
];

function toNum(v, d = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? v : d;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").trim());
    return Number.isFinite(n) ? n : d;
  }
  return d;
}

function round(v, dp = 1) {
  const n = toNum(v, 0);
  const p = 10 ** dp;
  return Math.round(n * p) / p;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, timeoutMs = 5500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseServingTextToGrams(text) {
  const raw = String(text || "").toLowerCase();
  if (!raw) return null;
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(g|gram|grams|ml|milliliter|millilitre|milliliters|millilitres)\b/);
  if (!match) return null;
  const value = toNum(match[1], 0);
  if (value <= 0) return null;
  return { value, unit: match[2].startsWith("m") ? "ml" : "g" };
}

function normaliseUnit(unit) {
  const u = String(unit || "").trim().toLowerCase();
  if (!u) return "serving";
  if (u === "g" || u === "gram" || u === "grams") return "g";
  if (u === "ml" || u === "milliliter" || u === "millilitre") return "ml";
  if (u === "oz" || u === "ounce" || u === "ounces") return "oz";
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return "lb";
  if (u === "serving" || u === "servings") return "serving";
  return u;
}

function normaliseServing(input = {}) {
  const amount = clamp(toNum(input.amount, 1), 0.01, 100000);
  const unit = normaliseUnit(input.unit);
  const grams = input.grams != null ? clamp(toNum(input.grams, 0), 0, 100000) : null;
  const text = input.text || `${round(amount, amount < 10 ? 2 : 1)} ${unit}`;
  return { amount, unit, grams, text };
}

function emptyNutrients() {
  const out = {};
  for (const key of NUTRIENT_KEYS) out[key] = 0;
  return out;
}

function applyNutrients(base, patch) {
  const out = { ...base };
  for (const key of NUTRIENT_KEYS) {
    if (patch?.[key] == null) continue;
    out[key] = round(toNum(patch[key], out[key]), key === "calories" ? 0 : 1);
  }
  return out;
}

function scaleNutrients(source, factor) {
  const out = {};
  const f = toNum(factor, 1);
  for (const key of NUTRIENT_KEYS) {
    const dp = key === "calories" ? 0 : 1;
    out[key] = round(toNum(source?.[key], 0) * f, dp);
  }
  return out;
}

function hasMacroDensity(item) {
  return (
    toNum(item?.nutrientsPerServing?.calories, 0) > 0 ||
    toNum(item?.nutrientsPerServing?.protein, 0) > 0 ||
    toNum(item?.nutrientsPerServing?.carbs, 0) > 0 ||
    toNum(item?.nutrientsPerServing?.fat, 0) > 0
  );
}

function qualityScore(item) {
  let score = 0;
  if (item?.verification === "verified") score += 60;
  if (item?.verification === "community") score += 32;
  if (hasMacroDensity(item)) score += 20;
  if (toNum(item?.nutrientsPerServing?.fibre, 0) > 0) score += 4;
  if (toNum(item?.nutrientsPerServing?.sodiumMg, 0) > 0) score += 4;
  if (item?.provider === "fdc") score += 8;
  if (item?.provider === "nutritionix") score += 6;
  if (item?.provider === "openfoodfacts") score += 4;
  return score;
}

function mergeFoodItems(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const better = qualityScore(secondary) > qualityScore(primary) ? secondary : primary;
  const other = better === secondary ? primary : secondary;

  return {
    ...better,
    title: better.title || other.title,
    brand: better.brand || other.brand,
    servingText: better.servingText || other.servingText,
    serving: better.serving || other.serving,
    nutrientsPerServing: applyNutrients(
      better.nutrientsPerServing || emptyNutrients(),
      other.nutrientsPerServing
    ),
    nutrientsPer100g: applyNutrients(
      better.nutrientsPer100g || emptyNutrients(),
      other.nutrientsPer100g
    ),
    alternates: Array.from(
      new Set([...(better.alternates || []), ...(other.alternates || []), other.provider])
    ).filter(Boolean),
  };
}

function canonicalKey(item) {
  const clean = (v) =>
    String(v || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const title = clean(item?.title);
  const brand = clean(item?.brand);
  return `${title}|${brand || "-"}`;
}

function dedupeResults(items) {
  const map = new Map();
  for (const item of items) {
    const key = canonicalKey(item);
    const prev = map.get(key);
    map.set(key, mergeFoodItems(prev, item));
  }
  return Array.from(map.values())
    .sort((a, b) => qualityScore(b) - qualityScore(a))
    .slice(0, 40);
}

function formatServingText(serving) {
  if (!serving) return "1 serving";
  const amount = serving.amount ?? 1;
  const value = round(amount, amount < 10 ? 2 : 1);
  return `${value} ${serving.unit || "serving"}`;
}

function toAppSearchItem(base) {
  const nutrients = base.nutrientsPerServing || emptyNutrients();
  const serving = base.serving || normaliseServing({});
  return {
    id: `${base.provider}_${base.providerId}`,
    source: "global",
    title: base.title,
    brand: base.brand || "",
    calories: round(nutrients.calories, 0),
    servingText: formatServingText(serving),
    macros: {
      protein: round(nutrients.protein, 1),
      carbs: round(nutrients.carbs, 1),
      fat: round(nutrients.fat, 1),
    },
    provider: base.provider,
    providerId: String(base.providerId),
    verification: base.verification,
    verified: base.verification === "verified",
    serving,
    nutrientsPerServing: nutrients,
    nutrientsPer100g: base.nutrientsPer100g || emptyNutrients(),
    sourceUrl: base.sourceUrl || "",
    raw: base.raw || {},
  };
}

function fromAppSearchItem(item) {
  return buildFoodBase({
    provider: item?.provider || "unknown",
    providerId: item?.providerId || item?.id || "unknown",
    title: item?.title || "Food",
    brand: item?.brand || "",
    verification: item?.verification || (item?.verified ? "verified" : "unverified"),
    serving: item?.serving || { amount: 1, unit: "serving", text: item?.servingText },
    perServing: item?.nutrientsPerServing || {
      calories: toNum(item?.calories, 0),
      protein: toNum(item?.macros?.protein, 0),
      carbs: toNum(item?.macros?.carbs, 0),
      fat: toNum(item?.macros?.fat, 0),
    },
    per100g: item?.nutrientsPer100g || {},
    sourceUrl: item?.sourceUrl || "",
    raw: item?.raw || {},
  });
}

function fromOpenFoodFactsNutriments(nutriments, suffix) {
  const k = (name) => toNum(nutriments?.[`${name}${suffix}`], 0);
  return {
    calories: k("energy-kcal"),
    protein: k("proteins"),
    carbs: k("carbohydrates"),
    fat: k("fat"),
    fibre: k("fiber"),
    sugar: k("sugars"),
    saturatedFat: k("saturated-fat"),
    monounsaturatedFat: k("monounsaturated-fat"),
    polyunsaturatedFat: k("polyunsaturated-fat"),
    transFat: k("trans-fat"),
    cholesterolMg: k("cholesterol"),
    sodiumMg: k("sodium"),
    potassiumMg: k("potassium"),
    calciumMg: k("calcium"),
    ironMg: k("iron"),
    vitaminAMcg: k("vitamin-a"),
    vitaminCMg: k("vitamin-c"),
  };
}

function fromFdcFoodNutrients(foodNutrients = []) {
  const out = emptyNutrients();

  for (const row of foodNutrients || []) {
    const nutrient = row?.nutrient || {};
    const number = String(row?.nutrientNumber || nutrient?.number || "");
    const name = String(row?.nutrientName || nutrient?.name || "").toLowerCase();
    const amount = toNum(row?.amount ?? row?.value, 0);

    if (number === "1008" || name.includes("energy")) out.calories = amount;
    else if (number === "1003" || name.includes("protein")) out.protein = amount;
    else if (number === "1005" || name.includes("carbohydrate")) out.carbs = amount;
    else if (number === "1004" || name.includes("total lipid")) out.fat = amount;
    else if (number === "1079" || name.includes("fiber")) out.fibre = amount;
    else if (number === "2000" || name.includes("sugars")) out.sugar = amount;
    else if (number === "1258" || name.includes("saturated")) out.saturatedFat = amount;
    else if (number === "1292" || name.includes("monounsaturated"))
      out.monounsaturatedFat = amount;
    else if (number === "1293" || name.includes("polyunsaturated"))
      out.polyunsaturatedFat = amount;
    else if (number === "1257" || name.includes("trans")) out.transFat = amount;
    else if (number === "1253" || name.includes("cholesterol"))
      out.cholesterolMg = amount;
    else if (number === "1093" || name.includes("sodium")) out.sodiumMg = amount;
    else if (number === "1092" || name.includes("potassium")) out.potassiumMg = amount;
    else if (number === "1087" || name.includes("calcium")) out.calciumMg = amount;
    else if (number === "1089" || name.includes("iron")) out.ironMg = amount;
    else if (number === "1106" || name.includes("vitamin a")) out.vitaminAMcg = amount;
    else if (number === "1162" || name.includes("vitamin c")) out.vitaminCMg = amount;
  }

  return out;
}

function fromFdcLabelNutrients(label = {}) {
  return {
    calories: toNum(label?.calories?.value, 0),
    protein: toNum(label?.protein?.value, 0),
    carbs: toNum(label?.carbohydrates?.value, 0),
    fat: toNum(label?.fat?.value, 0),
    fibre: toNum(label?.fiber?.value, 0),
    sugar: toNum(label?.sugars?.value, 0),
    saturatedFat: toNum(label?.saturatedFat?.value, 0),
    monounsaturatedFat: toNum(label?.monounsaturatedFat?.value, 0),
    polyunsaturatedFat: toNum(label?.polyunsaturatedFat?.value, 0),
    transFat: toNum(label?.transFat?.value, 0),
    cholesterolMg: toNum(label?.cholesterol?.value, 0),
    sodiumMg: toNum(label?.sodium?.value, 0),
    potassiumMg: toNum(label?.potassium?.value, 0),
    calciumMg: toNum(label?.calcium?.value, 0),
    ironMg: toNum(label?.iron?.value, 0),
    vitaminAMcg: toNum(label?.vitaminA?.value, 0),
    vitaminCMg: toNum(label?.vitaminC?.value, 0),
  };
}

function buildFoodBase({
  provider,
  providerId,
  title,
  brand,
  verification = "unverified",
  serving,
  perServing,
  per100g,
  sourceUrl,
  raw,
}) {
  const safeServing = normaliseServing(serving || {});
  const safePerServing = applyNutrients(emptyNutrients(), perServing || {});
  const safePer100g = applyNutrients(emptyNutrients(), per100g || {});

  return {
    provider,
    providerId: String(providerId),
    title: String(title || "Food"),
    brand: String(brand || ""),
    verification,
    serving: safeServing,
    servingText: formatServingText(safeServing),
    nutrientsPerServing: safePerServing,
    nutrientsPer100g: safePer100g,
    sourceUrl: sourceUrl || "",
    raw: raw || {},
  };
}

async function searchOff(query, pageSize = 18) {
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(
    query
  )}&search_simple=1&action=process&json=1&page_size=${pageSize}`;
  const data = await fetchJson(url);
  const products = Array.isArray(data?.products) ? data.products : [];

  return products
    .filter((p) => p?.product_name || p?.product_name_en)
    .map((p) => {
      const servingFromText = parseServingTextToGrams(p?.serving_size);
      const serving = normaliseServing({
        amount: servingFromText?.value || toNum(p?.serving_quantity, 1) || 100,
        unit: servingFromText?.unit || (toNum(p?.serving_quantity, 0) > 0 ? "g" : "serving"),
        grams: servingFromText?.unit === "g" ? servingFromText.value : null,
        text: p?.serving_size || undefined,
      });

      const per100g = fromOpenFoodFactsNutriments(p?.nutriments || {}, "_100g");
      const perServingFromApi = fromOpenFoodFactsNutriments(
        p?.nutriments || {},
        "_serving"
      );
      const hasServingFromApi = Object.values(perServingFromApi).some((v) => v > 0);

      const factor =
        serving.grams && serving.grams > 0 ? serving.grams / 100 : serving.amount || 1;
      const perServing = hasServingFromApi
        ? perServingFromApi
        : scaleNutrients(per100g, factor);

      return buildFoodBase({
        provider: "openfoodfacts",
        providerId: p?.code || p?._id || p?.id || p?.product_name || Math.random(),
        title: p?.product_name_en || p?.product_name || p?.generic_name_en || p?.generic_name,
        brand: p?.brands || "",
        verification: "community",
        serving,
        perServing,
        per100g,
        sourceUrl: p?.url || `${OFF_BASE}/product/${p?.code || ""}`,
        raw: p,
      });
    });
}

async function detailsOff(code) {
  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json`;
  const data = await fetchJson(url);
  if (toNum(data?.status, 0) !== 1 || !data?.product) {
    throw new Error("OpenFoodFacts product not found");
  }
  const p = data.product;

  const servingFromText = parseServingTextToGrams(p?.serving_size);
  const serving = normaliseServing({
    amount: servingFromText?.value || toNum(p?.serving_quantity, 1) || 100,
    unit: servingFromText?.unit || (toNum(p?.serving_quantity, 0) > 0 ? "g" : "serving"),
    grams: servingFromText?.unit === "g" ? servingFromText.value : null,
    text: p?.serving_size || undefined,
  });

  const per100g = fromOpenFoodFactsNutriments(p?.nutriments || {}, "_100g");
  const perServingFromApi = fromOpenFoodFactsNutriments(p?.nutriments || {}, "_serving");
  const hasServingFromApi = Object.values(perServingFromApi).some((v) => v > 0);
  const factor =
    serving.grams && serving.grams > 0 ? serving.grams / 100 : serving.amount || 1;
  const perServing = hasServingFromApi ? perServingFromApi : scaleNutrients(per100g, factor);

  return buildFoodBase({
    provider: "openfoodfacts",
    providerId: p?.code || code,
    title: p?.product_name_en || p?.product_name || p?.generic_name_en || p?.generic_name,
    brand: p?.brands || "",
    verification: "community",
    serving,
    perServing,
    per100g,
    sourceUrl: p?.url || `${OFF_BASE}/product/${p?.code || code}`,
    raw: p,
  });
}

async function searchFdc(query, pageSize = 18) {
  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) return [];

  const url =
    `${USDA_BASE}/foods/search?query=${encodeURIComponent(query)}` +
    `&pageSize=${pageSize}` +
    `&dataType=Branded,Foundation,SR%20Legacy,Survey%20(FNDDS)` +
    `&api_key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(url);
  const foods = Array.isArray(data?.foods) ? data.foods : [];

  return foods.map((f) => {
    const perFromNutrients = fromFdcFoodNutrients(f?.foodNutrients || []);
    const servingAmount = toNum(f?.servingSize, 0);
    const servingUnit = normaliseUnit(f?.servingSizeUnit || "");
    const serving = normaliseServing({
      amount: servingAmount > 0 ? servingAmount : 100,
      unit: servingUnit || (servingAmount > 0 ? "g" : "serving"),
      grams: servingUnit === "g" ? servingAmount : null,
      text: f?.householdServingFullText || undefined,
    });

    const isPer100gLikely =
      serving.unit === "g" && Math.abs(serving.amount - 100) < 0.0001;
    const per100g = isPer100gLikely
      ? perFromNutrients
      : serving.grams
      ? scaleNutrients(perFromNutrients, 100 / serving.grams)
      : perFromNutrients;

    const perServing = serving.grams
      ? scaleNutrients(per100g, serving.grams / 100)
      : perFromNutrients;

    return buildFoodBase({
      provider: "fdc",
      providerId: f?.fdcId,
      title: f?.description || "Food",
      brand: f?.brandOwner || f?.brandName || "",
      verification: "verified",
      serving,
      perServing,
      per100g,
      sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${f?.fdcId}`,
      raw: f,
    });
  });
}

async function detailsFdc(fdcId) {
  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) throw new Error("USDA_FDC_API_KEY missing");

  const url = `${USDA_BASE}/food/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(
    apiKey
  )}`;
  const f = await fetchJson(url);

  const perFromNutrients = fromFdcFoodNutrients(f?.foodNutrients || []);
  const perLabel = fromFdcLabelNutrients(f?.labelNutrients || {});
  const hasLabel = Object.values(perLabel).some((v) => v > 0);

  const servingAmount = toNum(f?.servingSize, 0);
  const servingUnit = normaliseUnit(f?.servingSizeUnit || "");
  const serving = normaliseServing({
    amount: servingAmount > 0 ? servingAmount : 100,
    unit: servingUnit || (servingAmount > 0 ? "g" : "serving"),
    grams: servingUnit === "g" ? servingAmount : null,
    text: f?.householdServingFullText || undefined,
  });

  const perServing = hasLabel
    ? perLabel
    : serving.grams
    ? scaleNutrients(perFromNutrients, serving.grams / 100)
    : perFromNutrients;
  const per100g =
    hasLabel && serving.grams
      ? scaleNutrients(perLabel, 100 / serving.grams)
      : perFromNutrients;

  return buildFoodBase({
    provider: "fdc",
    providerId: f?.fdcId || fdcId,
    title: f?.description || "Food",
    brand: f?.brandOwner || f?.brandName || "",
    verification: "verified",
    serving,
    perServing,
    per100g,
    sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${f?.fdcId || fdcId}`,
    raw: f,
  });
}

async function searchNutritionix(query, pageSize = 15) {
  const appId = process.env.NUTRITIONIX_APP_ID;
  const apiKey = process.env.NUTRITIONIX_API_KEY;
  if (!appId || !apiKey) return [];

  const url = `${NUTRITIONIX_BASE}/search/instant?query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, {
    headers: { "x-app-id": appId, "x-app-key": apiKey },
  });

  const branded = Array.isArray(data?.branded) ? data.branded.slice(0, pageSize) : [];
  const common = Array.isArray(data?.common) ? data.common.slice(0, Math.floor(pageSize / 2)) : [];

  const asFood = (item, isBranded) => {
    const servingAmount = toNum(item?.serving_qty, 1) || 1;
    const servingUnit = normaliseUnit(item?.serving_unit || "serving");
    const serving = normaliseServing({
      amount: servingAmount,
      unit: servingUnit,
      grams: servingUnit === "g" ? servingAmount : null,
    });

    const perServing = {
      calories: toNum(item?.nf_calories, 0),
      protein: toNum(item?.nf_protein, 0),
      carbs: toNum(item?.nf_total_carbohydrate, 0),
      fat: toNum(item?.nf_total_fat, 0),
      fibre: toNum(item?.nf_dietary_fiber, 0),
      sugar: toNum(item?.nf_sugars, 0),
      saturatedFat: toNum(item?.nf_saturated_fat, 0),
      transFat: toNum(item?.nf_trans_fatty_acid, 0),
      cholesterolMg: toNum(item?.nf_cholesterol, 0),
      sodiumMg: toNum(item?.nf_sodium, 0),
      potassiumMg: toNum(item?.nf_potassium, 0),
      calciumMg: toNum(item?.nf_calcium_dv, 0),
      ironMg: toNum(item?.nf_iron_dv, 0),
      vitaminAMcg: toNum(item?.nf_vitamin_a_dv, 0),
      vitaminCMg: toNum(item?.nf_vitamin_c_dv, 0),
    };

    const grams = serving.grams || 100;
    const per100g = grams > 0 ? scaleNutrients(perServing, 100 / grams) : emptyNutrients();

    return buildFoodBase({
      provider: "nutritionix",
      providerId: item?.nix_item_id || item?.tag_id || item?.food_name || Math.random(),
      title: item?.food_name || "Food",
      brand: item?.brand_name || "",
      verification: isBranded ? "verified" : "unverified",
      serving,
      perServing,
      per100g,
      sourceUrl: "",
      raw: item,
    });
  };

  return [...branded.map((x) => asFood(x, true)), ...common.map((x) => asFood(x, false))];
}

async function detailsNutritionix(nixItemId) {
  const appId = process.env.NUTRITIONIX_APP_ID;
  const apiKey = process.env.NUTRITIONIX_API_KEY;
  if (!appId || !apiKey) throw new Error("Nutritionix API keys missing");

  const url = `${NUTRITIONIX_BASE}/search/item?nix_item_id=${encodeURIComponent(nixItemId)}`;
  const data = await fetchJson(url, {
    headers: { "x-app-id": appId, "x-app-key": apiKey },
  });
  const item = Array.isArray(data?.foods) ? data.foods[0] : null;
  if (!item) throw new Error("Nutritionix item not found");

  const servingAmount = toNum(item?.serving_qty, 1) || 1;
  const servingUnit = normaliseUnit(item?.serving_unit || "serving");
  const serving = normaliseServing({
    amount: servingAmount,
    unit: servingUnit,
    grams: servingUnit === "g" ? servingAmount : null,
  });

  const perServing = {
    calories: toNum(item?.nf_calories, 0),
    protein: toNum(item?.nf_protein, 0),
    carbs: toNum(item?.nf_total_carbohydrate, 0),
    fat: toNum(item?.nf_total_fat, 0),
    fibre: toNum(item?.nf_dietary_fiber, 0),
    sugar: toNum(item?.nf_sugars, 0),
    saturatedFat: toNum(item?.nf_saturated_fat, 0),
    transFat: toNum(item?.nf_trans_fatty_acid, 0),
    cholesterolMg: toNum(item?.nf_cholesterol, 0),
    sodiumMg: toNum(item?.nf_sodium, 0),
    potassiumMg: toNum(item?.nf_potassium, 0),
    calciumMg: toNum(item?.nf_calcium_dv, 0),
    ironMg: toNum(item?.nf_iron_dv, 0),
    vitaminAMcg: toNum(item?.nf_vitamin_a_dv, 0),
    vitaminCMg: toNum(item?.nf_vitamin_c_dv, 0),
  };
  const grams = serving.grams || 100;
  const per100g = grams > 0 ? scaleNutrients(perServing, 100 / grams) : emptyNutrients();

  return buildFoodBase({
    provider: "nutritionix",
    providerId: item?.nix_item_id || nixItemId,
    title: item?.food_name || "Food",
    brand: item?.brand_name || "",
    verification: "verified",
    serving,
    perServing,
    per100g,
    sourceUrl: "",
    raw: item,
  });
}

export async function searchFoods({ query, limit = 30 }) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const providers = [searchFdc(q, 18), searchNutritionix(q, 15), searchOff(q, 18)];
  const settled = await Promise.allSettled(providers);
  const all = settled
    .filter((x) => x.status === "fulfilled")
    .flatMap((x) => x.value || []);
  const merged = dedupeResults(all).slice(0, clamp(toNum(limit, 30), 1, 60));
  return merged.map(toAppSearchItem);
}

export async function getFoodDetails({ provider, id, name }) {
  const p = String(provider || "").trim().toLowerCase();
  const itemId = String(id || "").trim();
  const queryName = String(name || "").trim();

  let base = null;

  if (p === "fdc" && itemId) base = await detailsFdc(itemId);
  else if ((p === "openfoodfacts" || p === "off") && itemId) base = await detailsOff(itemId);
  else if (p === "nutritionix" && itemId) base = await detailsNutritionix(itemId);
  else if (itemId && itemId.startsWith("fdc_")) base = await detailsFdc(itemId.replace(/^fdc_/, ""));
  else if (itemId && itemId.startsWith("openfoodfacts_"))
    base = await detailsOff(itemId.replace(/^openfoodfacts_/, ""));
  else if (itemId && itemId.startsWith("nutritionix_"))
    base = await detailsNutritionix(itemId.replace(/^nutritionix_/, ""));
  else {
    // No provider/id passed: search then resolve best candidate with deterministic data.
    const results = await searchFoods({ query: queryName || itemId, limit: 5 });
    const best = results[0];
    if (!best) throw new Error("No matching food found");

    if (best.provider === "fdc") base = await detailsFdc(best.providerId);
    else if (best.provider === "openfoodfacts") base = await detailsOff(best.providerId);
    else if (best.provider === "nutritionix") base = await detailsNutritionix(best.providerId);
    else base = fromAppSearchItem(best);

    // avoid throttling if clients chain this heavily
    await sleep(30);
  }

  const app = toAppSearchItem(base);
  return {
    ...app,
    item: {
      id: app.id,
      provider: app.provider,
      providerId: app.providerId,
      title: app.title,
      brand: app.brand,
      verification: app.verification,
      verified: app.verified,
      serving: app.serving,
      servingText: app.servingText,
      perServing: app.nutrientsPerServing,
      per100g: app.nutrientsPer100g,
      macros: {
        protein: app.macros.protein,
        carbs: app.macros.carbs,
        fat: app.macros.fat,
      },
      calories: app.calories,
      sourceUrl: app.sourceUrl,
      notes:
        app.verification === "verified"
          ? "Deterministic nutrition data from verified provider."
          : app.verification === "community"
          ? "Community nutrition data; verify against package where possible."
          : "Unverified nutrition data; treat as approximate.",
    },
  };
}
