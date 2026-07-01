# Deck insert card generator

## Goal

Add a way to generate the text for a printable double-sided deck insert card (business-card
sized, 2"x3.5") for a single Jumpstart theme:

- **Front**: series, theme, color, power level, description, up to 5 suggested pairings
  (theme + color + reason each).
- **Back**: the full 20-card decklist, grouped by category with per-category counts.

## Architecture

Pairing suggestions require real Magic deckbuilding judgment (color synergy, curve, threat
balance) — that reasoning already lives in `skills/jumpstart-deck-strategy/SKILL.md` and is
done live by the calling Claude, not hardcoded server-side (see README: "Deck pairings aren't
pre-computed"). This feature follows the same split:

1. Claude calls the existing `get_jumpstart_decklists` tool to get a series' decks.
2. Claude reasons about up to 5 pairings for the target theme, using the heuristics already
   documented in the skill.
3. Claude calls a **new** MCP tool, `format_deck_insert_card`, passing the target theme's own
   data (already in hand from step 1) plus the pairings it chose in step 2.

The new tool is a **pure text formatter** — no network calls, no file reads, no Claude API
calls. It only lays out the two card faces from its input.

```
get_jumpstart_decklists → Claude reasons about pairings (skill) → format_deck_insert_card → text
```

One card per call — no batch/whole-series mode. If a user wants cards for a whole series,
Claude loops the 3-step flow once per theme.

## New tool (`src/mcp-server.ts`)

```ts
server.registerTool(
  'format_deck_insert_card',
  {
    title: 'Format deck insert card',
    description: 'Format the front and back text for a printable double-sided Jumpstart deck insert card (2"x3.5"), given one theme\'s deck data and its suggested pairings.',
    inputSchema: {
      series: z.string().optional().describe('Series name shown on the card, e.g. "Marvel Super Heroes"'),
      theme: z.string(),
      color: z.enum(['white', 'blue', 'black', 'red', 'green', 'multi']),
      description: z.string(),
      powerLevel: z.number().int().min(1).max(5),
      cards: z.array(z.object({
        title: z.string(),
        type: z.string(),
        qty: z.number().int(),
      })).min(1),
      pairings: z.array(z.object({
        theme: z.string(),
        color: z.string(),
        reason: z.string(),
      })).min(1).max(5),
    },
  },
  async (input) => ({ content: [{ type: 'text' as const, text: formatDeckInsertCard(input) }] }),
);
```

No error branches beyond zod's own schema validation — there's no I/O to fail.

## Formatter (`src/deckInsertCard.ts`, new file)

```ts
export function formatDeckInsertCard(input: DeckInsertCardInput): string
```

- Power level renders as filled/empty circles: `'●'.repeat(powerLevel) + '○'.repeat(5 - powerLevel)`.
- Cards are grouped by `type` into categories, ordered using the canonical category order
  (see below), with a `(N cards)` count per category.
- No prices anywhere in the output.
- No hard-wrapping — plain text, caller controls layout/sizing downstream (e.g. Canva, Word).

Output shape (both faces in one string, clearly delimited):

```
=== FRONT ===
Marvel Super Heroes
Agents of S.H.I.E.L.D. (White)
Power Level: ●●○○○

An agent-focused deck with espionage and support cards that leverages
S.H.I.E.L.D. themed creatures and equipment to control the board.

Suggested Pairings:
  Web-Slinging (White) - shares a low curve and evasive threats for an
    aggressive, synergistic clock.
  Soaring (Blue) - flying finishers back up S.H.I.E.L.D.'s ground-based
    control plan.

=== BACK ===
Agents of S.H.I.E.L.D. — Deck List (20 cards)

Creatures (7)
  1x Agent Phil Coulson
  1x Peggy Carter, Secret Agent
  1x Agent 13, Sharon Carter
  1x Agents of S.H.I.E.L.D.
  1x Quake, Agent of S.H.I.E.L.D.
  1x Borough Backup
  1x Nick Fury, Spymaster
Instants (1)
  1x Helicarrier Strike
Enchantments (2)
  1x Strategic Intervention
  1x Web Up
Artifacts (2)
  1x S.H.I.E.L.D. Helicarrier
  1x S.H.I.E.L.D. Spy Kit
Lands (8)
  1x Thriving Heath
  7x Plains
```

If `series` is omitted, that line is dropped from the front rather than printed empty.

## Shared refactor: category order (`src/types.ts`)

`src/output.ts:49` currently defines `ALL_TYPES` as a local const inside `exportXlsx`. Extract
it to a shared, exported constant so both `exportXlsx` and the new formatter use the same
canonical category order instead of drifting independently:

```ts
export const CATEGORY_ORDER = ['Creatures', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Lands'] as const;
```

`output.ts` imports and uses it in place of its local `ALL_TYPES`; `deckInsertCard.ts` imports
it to order categories on the back of the card. Categories are matched with `card.type.startsWith(t)`
(existing convention, since baked `type` values are plain strings like `"Creatures"`). Any
category not in `CATEGORY_ORDER` is appended at the end in first-seen order, so unexpected
`type` values never silently disappear.

## Skill update (`skills/jumpstart-deck-strategy/SKILL.md`)

Add a new section, "Generating a deck insert card", documenting the 3-step flow above and
pointing back at the existing "What to check when evaluating a pairing" / "Color pie"
sections for the pairing reasoning itself (no duplication of that guidance).

## Testing

No test framework exists in this repo. Verify manually: run the MCP server locally, call
`format_deck_insert_card` with the real "Agents of S.H.I.E.L.D." deck from `data/marvel.json`
(the same deck used in this spec's examples) plus a few hand-picked pairings, and confirm the
output matches the shape above — category grouping/counts, circle rendering, series-omitted
case.

## Out of scope

- Batch/whole-series generation in one call.
- Any pricing information on the card (front or back).
- Hard-wrapping/column-fitting text to the physical 2"x3.5" dimensions — plain text only.
- Hardcoded/server-side pairing logic — pairings always come from the caller.
