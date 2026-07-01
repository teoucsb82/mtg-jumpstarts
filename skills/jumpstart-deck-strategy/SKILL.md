---
name: jumpstart-deck-strategy
description: Use when discussing MTG Jumpstart deck pairings, synergies, power level, or overall strategy for decks returned by the mtg-jumpstarts MCP tool (get_jumpstart_decklists) — evaluates which theme packs combine well and why.
---

# Jumpstart Deck Strategy

Domain knowledge for evaluating and recommending Jumpstart theme-pack pairings using data from the `get_jumpstart_decklists` MCP tool.

## Ground every judgment in the tool's actual data

Always read the specific `cards` array returned by the tool before judging a deck — never assume card pool contents from memory.

This matters especially for:
- **Marvel Super Heroes Jumpstart** (released June 26, 2026) and **Avatar: The Last Airbender Jumpstart** — both postdate typical training cutoffs. Treat any recalled "knowledge" of their specific cards as unreliable; the tool's `cards` field is the only trustworthy source.
- Older sets (Jumpstart 2020, Jumpstart 2022, Foundations Jumpstart, LOTR Jumpstart) may be better-known, but still verify against the returned data rather than assuming.

## How Jumpstart actually works

Jumpstart has **no deckbuilding** — you don't cut cards or build a deck from a pool. Two players (or one player picking two packs) each take one 20-card themed pack, combine them as-is into a 40-card deck, shuffle, and play. Every card in both packs is in the final deck.

This means "evaluating a pairing" is really "will combining these two *fixed* 20-card sets play well together" — not deckbuilding advice.

## What to check when evaluating a pairing

- **Color balance**: two decks of the *same* color usually add redundant mana sources without adding new effects — Jumpstart pack design deliberately discourages mono-color pairs. Two decks of *different* colors add variety but risk mana consistency (no fixing beyond what's already printed in each pack — check land counts and any mana-fixing cards).
- **Curve complementarity**: a top-heavy pack (many 4+ CMC cards) pairs well with a low-curve pack (1-2 CMC) — the combined 40 gets a full curve. Two top-heavy packs risk flooding on expensive spells early; two low-curve packs risk running out of gas late.
- **Removal/threat balance**: does one pack bring removal/interaction to protect the other's creatures or answer opposing threats? A pack heavy on creatures with no removal benefits from pairing with one that has it.
- **Evasion and win conditions**: flying/menace/unblockable creatures are more valuable when the other pack can't easily punch through stalled boards.
- **Archetype identity**: aggressive decks want to stay aggressive when paired (another low-curve, evasive pack); value/midrange decks want another value pack, not a rushdown pack that outraces them before the value plan comes online.

## Color pie — ally vs. enemy relationships

Colors adjacent on Magic's color wheel are **allies** and share more strategic identity; colors across from each other are **enemies** and tend to pull in different directions (though enemy pairs can still work — just usually need a clearer shared plan):

- White's allies: Blue, Green — enemies: Black, Red
- Blue's allies: Black, White — enemies: Red, Green
- Black's allies: Red, Blue — enemies: Green, White
- Red's allies: Green, Black — enemies: White, Blue
- Green's allies: White, Red — enemies: Blue, Black

Default to favoring an ally-color pairing when recommending a second deck, unless the specific cards in an enemy-color pack make a compelling case (e.g. strong removal answering the first deck's weakness).

## `powerLevel` caveat

The tool's `powerLevel` (1-5) is a **price-based** signal — a z-score of the deck's total Scryfall value relative to the series mean. It's a reasonable proxy (rarer/more powerful cards tend to cost more) but it is NOT a direct measure of competitive strength. A deck can be cheap and excellent (efficient commons) or expensive and clunky (an overcosted mythic bomb with no support). When asked about a deck's actual strength or play pattern, read the `cards` and `description` fields — don't just cite the number.

## Giving recommendations

When asked "what pairs well with X," pull the full list of themes/colors/descriptions from the same `get_jumpstart_decklists` response (it returns the whole series in one call) and reason across the heuristics above. Give a specific reason tied to the actual cards/colors involved — not a generic "these combine well" answer.

## Generating a deck insert card

When asked for a "cheat sheet" or "deck insert card" for a theme (a printable double-sided 2"x3.5" card):

1. Call `get_jumpstart_decklists` for the series if you haven't already.
2. Reason about up to 5 pairing themes for the target theme, using the heuristics above (color balance, curve, removal/threat balance, evasion, archetype identity, color pie). Write a specific 1-2 sentence reason for each, same standard as any other pairing recommendation.
3. Call `format_deck_insert_card` with the target theme's own data (theme, color, description, powerLevel, cards) plus the pairings from step 2. That tool only formats text — it does not choose pairings itself, so step 2 must happen first.
