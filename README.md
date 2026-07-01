# mtg-jumpstarts

Get MTG Jumpstart decklists — with live prices — right inside Claude Code.

## Install

```
claude plugin marketplace add teoucsb82/mtg-jumpstarts
claude plugin install mtg-jumpstarts@mtg-jumpstarts
```

## Use it

Just ask Claude, e.g.:

> "Use mtg-jumpstarts to get the Avatar: The Last Airbender decklists"
>
> "Show me the most expensive Foundations Jumpstart decks"
>
> "Make a deck insert card for Agents of S.H.I.E.L.D. from Marvel Super Heroes Jumpstart"

**Supported series:**

- Jumpstart (2020)
- Jumpstart 2022
- Foundations Jumpstart
- Lord of the Rings: Tales of Middle-earth Jumpstart
- Avatar: The Last Airbender
- Marvel Super Heroes

## Sample output

```json
{
  "theme": "Aang",
  "color": "white",
  "description": "Airbending tempo deck built around evasive creatures and tactical disruption.",
  "cards": [
    { "title": "Aang, Airbending Master", "type": "Creatures", "qty": 1, "unitPrice": 8.24, "lineTotal": 8.24 },
    { "title": "Gale Force", "type": "Instants", "qty": 1, "unitPrice": 0.15, "lineTotal": 0.15 }
  ],
  "cardCount": 20,
  "deckTotal": 11.56,
  "powerLevel": 3
}
```

Every card comes with a live Scryfall price, and `powerLevel` (1-5) ranks each deck against the rest of its series.

## It reasons about strategy too

Deck pairings aren't pre-computed — Claude reasons about them live from the actual returned card data, using a bundled Magic-deckbuilding skill. Real example:

> **"What's a good beginner-friendly pairing in Marvel Super Heroes Jumpstart?"**
>
> **Recommendation: Web-Slinging (White) + Soaring (Blue)**
>
> - **Ally colors** — White/Blue sit next to each other on the color wheel, so the strategies naturally reinforce rather than fight each other.
> - **Simple, low-complexity cards** — mostly vanilla/French-vanilla creatures (Spider-Man, Falcon, Vulture, etc.) with a handful of straightforward combat tricks (Thwip!, Whoosh!). No graveyard loops, sacrifice engines, or combo pieces to track — good for a new player.
> - **Curve/plan fit** — Web-Slinging brings small, efficient early bodies; Soaring brings evasive fliers as the closer. Together you get a full curve instead of two decks front-loaded the same way.
> - **Built-in fixing** — each pack includes a Thriving land (Heath/Isle), so splashing the other color is smooth even without extra help.
> - Both sit at `powerLevel` 2, so it's an even, non-overwhelming matchup rather than one deck steamrolling the other.
>
> If you want something punchier instead, Speedy (Red) + Rampaging (Green) is the aggressive-but-still-simple alternative: haste creatures early, big green stompers to close — also allied colors, also no fiddly synergies to learn.

## Printable deck insert cards

Ask for a "deck insert card" or "cheat sheet" and Claude reasons about pairings (same live logic as above), then formats a double-sided, business-card-sized (2"x3.5") insert — front with theme, power level, and suggested pairings; back with the full decklist. Real example:

> **"Make a deck insert card for Agents of S.H.I.E.L.D. from Marvel Super Heroes Jumpstart"**

```
=== FRONT ===
Marvel Super Heroes
Agents of S.H.I.E.L.D. (White)
Power Level: ●●○○○

An agent-focused deck with espionage and support cards that leverages S.H.I.E.L.D. themed creatures and equipment to control the board.

Suggested Pairings:
  Soaring (blue) - Blue is an ally of white, and its evasive fliers give this control shell the reach it lacks (only 7 creatures) — Web Up and Strategic Intervention buy time for fliers to close the game.
  Iron Man (blue) - Ally-color artifact synergy: Iron Suitcase, Collector's Case, and Futurist Forge stack with S.H.I.E.L.D. Spy Kit and Helicarrier, and its creatures are equip-worthy bodies for this deck's gear.
  Trained (green) - Green allies with white and adds eight more creatures plus extra removal and combat tricks (Punishing Punch, Colossal Collision), filling out the curve this support-heavy pack is missing.
  Great Lakes Avengers (green) - Its quirky utility creatures and instants echo the espionage/support-cards identity of Agents of S.H.I.E.L.D., adding board presence without changing the game plan.
  Tenacious (green) - A resilient, creature-heavy green pack that applies sustained pressure while this deck's control pieces protect the board.

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

Output is plain text, no price info — drop it into a design tool to lay out and print.

## License

[GPL-3.0-or-later](LICENSE) — free to install and use. Forks and redistributions must stay open-source under the same license.

---

Contributing or running this locally? See [DEVELOPMENT.md](DEVELOPMENT.md).
