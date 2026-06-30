# MTG Jumpstart Orchestrator — Design Spec

**Date:** 2026-06-29  
**File:** `mtg-jumpstarts.ts`  
**Runtime:** `npx tsx mtg-jumpstarts.ts "<keyword>"`

---

## Overview

A CLI TypeScript script that accepts a Jumpstart series name and orchestrates Claude Haiku agents to discover all themes in the series and extract each theme's 20-card decklist, grouped by card type, then prints results to stdout.

---

## Usage

```bash
npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender"
npx tsx mtg-jumpstarts.ts "foundations"
npx tsx mtg-jumpstarts.ts "marvel super heroes"
```

Requires `ANTHROPIC_API_KEY` in the environment.

---

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `node` built-ins only for HTTP (`fetch`) — no extra HTTP library needed

### HTML Preprocessing

Before passing any page HTML to an agent, strip noise to reduce token usage:
- Remove all `<script>` and `<style>` tag blocks (including contents)
- Remove HTML comments
- Extract the inner text of `<body>` only
- Collapse runs of whitespace/newlines to single newlines

This is done in the orchestrator (`stripHtml(raw: string): string`), not by the agent.

---

## Phase 1 — Theme Discovery

**Goal:** Given a keyword, return an array of `{ name: string, url: string }` for every Jumpstart theme in the series.

### URL Construction

Transform the keyword into a wiki URL:
1. Normalize: trim, title-case each word
2. Replace spaces with underscores
3. Append `_Jumpstart`
4. Encode colons as-is (wiki URLs use literal colons)

Example: `"Avatar: The Last Airbender"` → `https://mtg.wiki/page/Avatar:_The_Last_Airbender_Jumpstart`

### Fallback: MediaWiki Search API

If the constructed URL returns a non-200 or the page body indicates "not found":

```
https://mtg.wiki/api.php?action=query&list=search&srsearch={keyword}+Jumpstart&format=json
```

Pick the top result's `title` and construct `https://mtg.wiki/page/{title}`.

### Agent 1 — Theme Extractor

- **Model:** `claude-haiku-4-5-20251001`
- **Input:** Raw HTML of the main series page
- **Task:** Extract all theme names and their decklist subpage URLs
- **Output (JSON):**
  ```json
  [
    { "name": "White", "url": "https://mtg.wiki/page/Avatar:_The_Last_Airbender_Jumpstart/Decklists_-_White" },
    { "name": "Water Tribe", "url": "..." }
  ]
  ```
- **Prompt strategy:** Instruct agent to find all links/sections referencing individual decklist pages (pattern: `/Decklists_-_*`). Return only valid theme entries; skip navigation/footer links.

---

## Phase 2 — Decklist Extraction (Parallel)

**Goal:** For each theme, return a structured decklist.

### Orchestrator steps

1. Fetch all theme decklist page HTMLs **in parallel** (`Promise.all`)
2. Dispatch one Haiku agent per theme **in parallel**
3. Collect results; warn to stderr for any theme where total card count ≠ 20

### Agent N — Decklist Extractor (one per theme)

- **Model:** `claude-haiku-4-5-20251001`
- **Input:** Raw HTML of a single theme's decklist page
- **Task:** Extract theme title and all cards grouped by category
- **Output (JSON):**
  ```json
  {
    "theme": "White",
    "categories": [
      {
        "name": "Creatures",
        "cards": [
          { "qty": 2, "name": "Aang, Avatar of Peace" },
          { "qty": 1, "name": "Air Nomad Monk" }
        ]
      },
      {
        "name": "Instants",
        "cards": [...]
      },
      {
        "name": "Lands",
        "cards": [{ "qty": 9, "name": "Plains" }]
      }
    ]
  }
  ```
- **Prompt strategy:** Instruct agent to preserve the category order as it appears on the page. Include quantity. If no explicit quantity, assume 1.

---

## Output Format

Printed to stdout after all agents complete.

```
=== AVATAR: THE LAST AIRBENDER JUMPSTART ===
Found 10 themes.

--- White ---
Creatures (5 cards)
  2x Aang, Avatar of Peace
  1x Air Nomad Monk
  ...
Instants (3 cards)
  2x Gust of Wind
  ...
Lands (9 cards)
  9x Plains

[20 cards total]

--- Water Tribe ---
...
```

Category headers include card count for that category. Each theme ends with total count. If count ≠ 20, print a warning inline.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Main page URL 404 | Try MediaWiki search fallback; if still fails, exit with clear error message |
| Theme page fetch fails | Print error for that theme, continue with others |
| Agent returns malformed JSON | Retry once; if still malformed, print raw agent response and skip |
| Card count ≠ 20 | Print warning `⚠ X cards found (expected 20)` next to theme header |
| No `ANTHROPIC_API_KEY` | Exit immediately with clear message |

---

## Code Structure

Single file `mtg-jumpstarts.ts`. Internal sections:

1. **Types** — `Theme`, `Card`, `Category`, `Decklist`
2. **`fetchHtml(url)`** — wraps `fetch`, returns text, throws on non-200
3. **`stripHtml(raw)`** — removes scripts/styles, collapses whitespace
4. **`buildSeriesUrl(keyword)`** — keyword → mtg.wiki URL
5. **`discoverThemes(html)`** — calls Agent 1, parses JSON response
6. **`extractDecklist(theme, html)`** — calls Agent N, parses JSON response
7. **`printResults(keyword, decklists)`** — formats and prints to stdout
8. **`main()`** — orchestrates phases 1 and 2, handles errors

---

## Out of Scope

- Caching fetched pages
- Writing output to file
- Card legality / format checking
- Deck comparison or analysis
