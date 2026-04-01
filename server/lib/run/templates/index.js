// lib/run/templates/index.js
import fs from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "lib/run/templates");

// Matches: 5k_4w_2.json, 10k_12w_4.json, half_16w_3.json, mara_24w_2.json
const FILE_RE = /^(5k|10k|half|mara)_(\d+)w_(2|3|4)\.json$/i;

/**
 * Controls:
 * - DISABLE_TEMPLATES=true  -> templates are fully disabled (always returns empty)
 * - STRICT_TEMPLATES=true   -> throw on errors (default true in production)
 *
 * Defaults:
 * - In dev: non-strict (warn + skip broken templates)
 * - In prod: strict (throw) unless you override STRICT_TEMPLATES=false
 */
const DISABLE_TEMPLATES =
  String(process.env.DISABLE_TEMPLATES || "").toLowerCase() === "true";

const STRICT_TEMPLATES =
  String(process.env.STRICT_TEMPLATES || "").toLowerCase() === "true" ||
  (process.env.NODE_ENV === "production" &&
    String(process.env.STRICT_TEMPLATES || "").toLowerCase() !== "false");

function listTemplateFiles() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .filter((f) => FILE_RE.test(f));
}

function parseFilename(file) {
  const m = file.match(FILE_RE);
  if (!m) return null;
  return {
    id: file.replace(/\.json$/i, ""),
    distance: m[1].toLowerCase(),
    weeks: Number(m[2]),
    daysPerWeek: Number(m[3]),
    file,
    abs: path.join(DIR, file),
  };
}

function safeJsonParse(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Minimal validation that won't block you if your schema evolves.
 * It only checks the "shape" we can reliably infer from filename.
 */
function validateTemplate(metaFromName, json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(`Template ${metaFromName.id} must be a JSON object`);
  }

  // Optional but recommended: id inside file matches filename id
  if (json.id && String(json.id) !== metaFromName.id) {
    throw new Error(
      `Template id mismatch: filename="${metaFromName.id}" json.id="${json.id}"`
    );
  }

  // Optional meta checks if present
  const meta = json.meta && typeof json.meta === "object" ? json.meta : null;

  if (
    meta?.distance &&
    String(meta.distance).toLowerCase() !== metaFromName.distance
  ) {
    throw new Error(
      `Distance mismatch in ${metaFromName.id}: meta.distance="${meta.distance}" expected="${metaFromName.distance}"`
    );
  }
  if (meta?.weeks && Number(meta.weeks) !== metaFromName.weeks) {
    throw new Error(
      `Weeks mismatch in ${metaFromName.id}: meta.weeks="${meta.weeks}" expected="${metaFromName.weeks}"`
    );
  }
  if (meta?.daysPerWeek && Number(meta.daysPerWeek) !== metaFromName.daysPerWeek) {
    throw new Error(
      `Days/week mismatch in ${metaFromName.id}: meta.daysPerWeek="${meta.daysPerWeek}" expected="${metaFromName.daysPerWeek}"`
    );
  }

  return true;
}

function loadAllTemplates() {
  // Hard disable (you said you don't want templates to do anything)
  if (DISABLE_TEMPLATES) {
    console.warn("⚠ Templates are DISABLED (DISABLE_TEMPLATES=true).");
    return { byId: {}, index: { distances: {} } };
  }

  const files = listTemplateFiles();
  const byId = {};
  const index = { distances: {} };
  const errors = [];

  for (const file of files) {
    const info = parseFilename(file);
    if (!info) continue;

    try {
      const json = safeJsonParse(info.abs);
      validateTemplate(info, json);

      byId[info.id] = json;

      if (!index.distances[info.distance]) index.distances[info.distance] = {};
      if (!index.distances[info.distance][info.weeks])
        index.distances[info.distance][info.weeks] = {};
      index.distances[info.distance][info.weeks][info.daysPerWeek] = info.id;
    } catch (e) {
      const msg = e?.message || String(e);
      errors.push(
        msg.includes(info.abs) ? msg : `Template "${info.id}": ${msg}`
      );
    }
  }

  if (errors.length) {
    const errorText = `Template load had issues:\n- ${errors.join("\n- ")}`;

    if (STRICT_TEMPLATES) {
      throw new Error(errorText);
    } else {
      // Dev-friendly: warn and continue with whatever valid templates loaded
      console.warn("⚠ " + errorText);
    }
  }

  return { byId, index };
}

const { byId: TEMPLATES_BY_ID, index: TEMPLATE_INDEX } = loadAllTemplates();

/** Get a template by id (e.g. "half_16w_3") */
export function getTemplateById(templateId) {
  if (DISABLE_TEMPLATES) return null;
  if (!templateId) return null;
  const key = String(templateId).replace(/\.json$/i, "");
  return TEMPLATES_BY_ID[key] || null;
}

/** Get template by components (e.g. distance="10k", weeks=12, daysPerWeek=4) */
export function getTemplate(distance, weeks, daysPerWeek) {
  if (DISABLE_TEMPLATES) return null;

  const d = String(distance || "").toLowerCase();
  const w = Number(weeks);
  const dpw = Number(daysPerWeek);

  const id = TEMPLATE_INDEX?.distances?.[d]?.[w]?.[dpw];
  if (!id) return null;
  return getTemplateById(id);
}

/** List available options for building your UI */
export function getTemplateIndex() {
  if (DISABLE_TEMPLATES) return { distances: {} };
  return TEMPLATE_INDEX;
}

/** List all template ids */
export function listTemplateIds() {
  if (DISABLE_TEMPLATES) return [];
  return Object.keys(TEMPLATES_BY_ID);
}