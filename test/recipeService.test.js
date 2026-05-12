import test from "node:test";
import assert from "node:assert/strict";
import { createRecipeService, recipeTestInternals } from "../src/recipeService.js";

const recipeHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
[
  {
    "@context": "https://schema.org/",
    "@type": "Recipe",
    "name": "Kylling i karry",
    "url": "https://www.arla.dk/opskrifter/kylling-i-karry/",
    "description": "Nem aftensmad med kylling og ris.",
    "recipeYield": "4 personer",
    "totalTime": "PT45M",
    "recipeCategory": "Hovedretter, Aftensmad",
    "keywords": "Kylling, Ris, Karry",
    "recipeIngredient": ["400 g kylling", "4 dl ris", "2 dl mælk"],
    "nutrition": {
      "@type": "NutritionInformation",
      "servingSize": "100 g",
      "calories": "122 kcal",
      "proteinContent": "8 g"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.1",
      "ratingCount": "99"
    }
  }
]
</script>
</head></html>`;

test("extractRecipeJsonLd reads Arla recipe structured data", () => {
  const recipe = recipeTestInternals.extractRecipeJsonLd(
    recipeHtml,
    "https://www.arla.dk/opskrifter/kylling-i-karry/"
  );

  assert.equal(recipe.name, "Kylling i karry");
  assert.equal(recipe.total_time_minutes, 45);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.nutrition.protein, "8 g");
});

test("recipe service recommends source-linked recipes", async () => {
  const sitemap = `<?xml version="1.0" encoding="utf-8"?>
  <urlset>
    <url><loc>https://www.arla.dk/opskrifter/kylling-i-karry/</loc></url>
    <url><loc>https://www.arla.dk/opskrifter/chokoladekage/</loc></url>
  </urlset>`;

  const fakeFetch = async (url) => {
    if (url.includes("sitemap")) return response(200, sitemap);
    if (url.includes("kylling-i-karry")) return response(200, recipeHtml);
    return response(404, "not found");
  };

  const service = createRecipeService(
    {
      arlaRecipeSitemapUrl: "https://www.arla.dk/sitemap.xml",
      fetchTimeoutMs: 1000,
      candidateFetchLimit: 10
    },
    { fetch: fakeFetch }
  );

  const result = await service.recommendRecipes({
    query: "quick dinner with chicken and rice",
    include_ingredients: ["chicken", "rice"],
    meal_type: "dinner",
    max_total_time_minutes: 60,
    limit: 1
  });

  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0].name, "Kylling i karry");
  assert.equal(result.recipes[0].url, "https://www.arla.dk/opskrifter/kylling-i-karry/");
  assert.ok(result.shopping_list.includes("400 g kylling"));
});

test("validation requires a query", async () => {
  assert.throws(() => recipeTestInternals.validateArgs({ query: "" }), /query is required/);
});

function response(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
  };
}
