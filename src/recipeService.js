const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "the",
  "with",
  "i",
  "og",
  "med",
  "til",
  "af",
  "en",
  "et",
  "de",
  "den",
  "det",
  "der",
  "som",
  "pa",
  "på"
]);

const SYNONYMS = new Map([
  ["chicken", ["kylling"]],
  ["rice", ["ris"]],
  ["dinner", ["aftensmad", "hovedretter"]],
  ["quick", ["nem", "hurtig", "30"]],
  ["easy", ["nem"]],
  ["family", ["familie"]],
  ["breakfast", ["morgenmad"]],
  ["lunch", ["frokost"]],
  ["dessert", ["dessert", "kage"]],
  ["vegetarian", ["vegetarisk"]],
  ["lactosefree", ["laktosefri"]],
  ["lactose-free", ["laktosefri"]],
  ["highprotein", ["proteinrig", "protein"]],
  ["high-protein", ["proteinrig", "protein"]],
  ["cheese", ["ost"]],
  ["milk", ["maelk", "mælk"]],
  ["butter", ["smor", "smør"]],
  ["cream", ["flode", "fløde"]]
]);

export function createRecipeService(config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const cache = {
    sitemap: null,
    recipes: new Map()
  };

  async function recommendRecipes(args) {
    const input = validateArgs(args);
    const sitemap = await getRecipeSitemap();
    const candidateUrls = selectCandidateUrls(sitemap, input).slice(0, config.candidateFetchLimit);
    const recipes = [];

    for (const url of candidateUrls) {
      const recipe = await getRecipe(url);
      if (!recipe) continue;
      const scored = scoreRecipe(recipe, input);
      if (!scored.excluded && scored.score > 0) {
        recipes.push({
          ...recipe,
          score: scored.score,
          match_rationale: scored.rationale
        });
      }
    }

    recipes.sort((a, b) => b.score - a.score);
    const selected = recipes.slice(0, input.limit).map(stripInternalScore);

    return {
      query: input.query,
      source: {
        name: "Arla.dk public recipe pages",
        sitemap_url: config.arlaRecipeSitemapUrl
      },
      recipes: selected,
      shopping_list: buildShoppingList(selected),
      caveat:
        "Results are based on public Arla.dk recipe pages. Check the linked Arla.dk recipes and any retailer basket before shopping. Nutrition and allergen-related fields are informational, not medical advice."
    };
  }

  async function getRecipeSitemap() {
    if (cache.sitemap) return cache.sitemap;
    const response = await fetchWithTimeout(config.arlaRecipeSitemapUrl);
    if (!response.ok) {
      throw new Error(`Could not fetch Arla recipe sitemap: HTTP ${response.status}`);
    }
    const xml = await response.text();
    cache.sitemap = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
      .map((match) => decodeXml(match[1]))
      .filter((url) => url.includes("/opskrifter/"));
    return cache.sitemap;
  }

  async function getRecipe(url) {
    if (cache.recipes.has(url)) return cache.recipes.get(url);

    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const html = await response.text();
    const recipe = extractRecipeJsonLd(html, url);
    cache.recipes.set(url, recipe);
    return recipe;
  }

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
    try {
      return await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ArlaMealFinderMCP/0.1 (+local pilot)"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    recommendRecipes,
    _private: {
      extractRecipeJsonLd,
      scoreRecipe,
      selectCandidateUrls,
      normalizeText,
      validateArgs
    }
  };
}

function validateArgs(args) {
  if (!args || typeof args !== "object") {
    throw new Error("Tool arguments must be an object.");
  }

  const query = String(args.query || "").trim();
  if (query.length < 2) {
    throw new Error("query is required and must be at least 2 characters.");
  }

  const limit = Math.min(Math.max(Number(args.limit || DEFAULT_LIMIT), 1), MAX_LIMIT);

  return {
    query,
    servings: optionalInteger(args.servings),
    maxTotalTimeMinutes: optionalInteger(args.max_total_time_minutes),
    mealType: optionalString(args.meal_type),
    includeIngredients: optionalStringArray(args.include_ingredients),
    excludeIngredients: optionalStringArray(args.exclude_ingredients),
    dietaryPreference: optionalString(args.dietary_preference),
    limit
  };
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function optionalString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function optionalStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function selectCandidateUrls(urls, input) {
  const searchTokens = new Set([
    ...tokenize(input.query),
    ...tokenize(input.mealType),
    ...tokenize(input.dietaryPreference),
    ...input.includeIngredients.flatMap(tokenize)
  ]);
  const expandedTokens = expandTokens(searchTokens);

  const candidates = urls.map((url) => {
    const slugTokens = tokenize(url.split("/opskrifter/")[1] || url);
    const score = [...expandedTokens].reduce(
      (total, token) => total + (hasTokenMatch(slugTokens, token) ? 5 : 0),
      0
    );
    return { url, score };
  });

  candidates.sort((a, b) => b.score - a.score);

  const scored = candidates.filter((candidate) => candidate.score > 0);
  const fallback = candidates.filter((candidate) => candidate.score === 0).slice(0, 5);
  return [...scored, ...fallback]
    .slice(0, Math.max(input.limit * 6, 12))
    .map((candidate) => candidate.url);
}

function scoreRecipe(recipe, input) {
  const haystackTokens = tokenize(
    [
      recipe.name,
      recipe.description,
      recipe.category,
      recipe.keywords,
      recipe.ingredients.join(" ")
    ].join(" ")
  );
  const titleTokens = tokenize(recipe.name);
  const queryTokens = expandTokens(new Set(tokenize(input.query)));
  const includeTokens = expandTokens(new Set(input.includeIngredients.flatMap(tokenize)));
  const excludeTokens = expandTokens(new Set(input.excludeIngredients.flatMap(tokenize)));
  const mealTokens = expandTokens(new Set(tokenize(input.mealType)));
  const dietaryTokens = expandTokens(new Set(tokenize(input.dietaryPreference)));

  const excluded = [...excludeTokens].some((token) => hasTokenMatch(haystackTokens, token));
  if (excluded) return { score: 0, excluded: true, rationale: [] };

  let score = 0;
  const rationale = [];

  for (const token of queryTokens) {
    if (hasTokenMatch(titleTokens, token)) {
      score += 6;
      rationale.push(`title matches "${token}"`);
    } else if (hasTokenMatch(haystackTokens, token)) {
      score += 2;
    }
  }

  for (const token of includeTokens) {
    if (hasTokenMatch(haystackTokens, token)) {
      score += 8;
      rationale.push(`uses ${token}`);
    } else {
      score -= 2;
    }
  }

  for (const token of mealTokens) {
    if (hasTokenMatch(haystackTokens, token)) {
      score += 4;
      rationale.push(`fits ${token}`);
    }
  }

  for (const token of dietaryTokens) {
    if (hasTokenMatch(haystackTokens, token)) {
      score += 5;
      rationale.push(`matches preference ${token}`);
    }
  }

  if (input.maxTotalTimeMinutes && recipe.total_time_minutes) {
    if (recipe.total_time_minutes <= input.maxTotalTimeMinutes) {
      score += 6;
      rationale.push(`within ${input.maxTotalTimeMinutes} minutes`);
    } else {
      score -= 8;
    }
  }

  if (recipe.rating?.rating_count) {
    score += Math.min(Number(recipe.rating.rating_count) / 200, 5);
  }

  if (!rationale.length) {
    rationale.push("closest public Arla.dk recipe match");
  }

  return {
    score,
    excluded: false,
    rationale: [...new Set(rationale)].slice(0, 5)
  };
}

function extractRecipeJsonLd(html, fallbackUrl) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    const jsonText = decodeHtml(script[1].trim());
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const recipe = findTypedNode(parsed, "Recipe");
    if (recipe) return normalizeRecipe(recipe, fallbackUrl);
  }

  return null;
}

function findTypedNode(value, type) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTypedNode(item, type);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const nodeType = value["@type"] || value.type;
    const nodeTypes = Array.isArray(nodeType) ? nodeType : [nodeType];
    if (nodeTypes.includes(type)) return value;

    if (value["@graph"]) return findTypedNode(value["@graph"], type);
    for (const child of Object.values(value)) {
      const found = findTypedNode(child, type);
      if (found) return found;
    }
  }

  return null;
}

function normalizeRecipe(recipe, fallbackUrl) {
  const rating = recipe.aggregateRating
    ? {
        rating_value: recipe.aggregateRating.ratingValue || null,
        rating_count: recipe.aggregateRating.ratingCount || null
      }
    : null;

  return {
    name: recipe.name || "Untitled Arla recipe",
    url: recipe.url || recipe.mainEntityOfPage || fallbackUrl,
    description: recipe.description || "",
    recipe_yield: recipe.recipeYield || "",
    total_time: recipe.totalTime || "",
    total_time_minutes: parseIsoDurationMinutes(recipe.totalTime),
    category: arrayOrString(recipe.recipeCategory).join(", "),
    cuisine: arrayOrString(recipe.recipeCuisine).join(", "),
    keywords: arrayOrString(recipe.keywords).join(", "),
    ingredients: arrayOrString(recipe.recipeIngredient),
    nutrition: normalizeNutrition(recipe.nutrition),
    rating
  };
}

function normalizeNutrition(nutrition) {
  if (!nutrition || typeof nutrition !== "object") return null;
  return {
    serving_size: nutrition.servingSize || null,
    calories: nutrition.calories || null,
    carbohydrate: nutrition.carbohydrateContent || null,
    fat: nutrition.fatContent || null,
    fiber: nutrition.fiberContent || null,
    protein: nutrition.proteinContent || null
  };
}

function parseIsoDurationMinutes(duration) {
  if (!duration || typeof duration !== "string") return null;
  const match = duration.match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function buildShoppingList(recipes) {
  const seen = new Set();
  const items = [];
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const normalized = normalizeText(ingredient);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      items.push(ingredient);
    }
  }
  return items;
}

function stripInternalScore(recipe) {
  const { score, ...publicRecipe } = recipe;
  return publicRecipe;
}

function arrayOrString(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of [...tokens]) {
    const synonyms = SYNONYMS.get(token) || [];
    for (const synonym of synonyms) {
      for (const synonymToken of tokenize(synonym)) expanded.add(synonymToken);
    }
  }
  return expanded;
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function hasTokenMatch(tokens, token) {
  return tokens.some(
    (candidate) =>
      candidate === token ||
      (token.length >= 3 && (candidate.startsWith(token) || candidate.endsWith(token)))
  );
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decodeXml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeHtml(text) {
  return decodeXml(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)));
}

export const recipeTestInternals = {
  normalizeText,
  extractRecipeJsonLd,
  scoreRecipe,
  selectCandidateUrls,
  validateArgs
};
