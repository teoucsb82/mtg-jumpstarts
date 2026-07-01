# mtg-jumpstarts

Get MTG Jumpstart decklists — with live prices — right inside Claude Code.

## Install

```
claude plugin marketplace add teoucsb82/mtg-jumpstarts
claude plugin install mtg-jumpstarts@mtg-jumpstarts
```

## Update

Custom marketplaces auto-refresh on startup, so re-running the install command picks up the latest version:

```
claude plugin install mtg-jumpstarts@mtg-jumpstarts
```

If your marketplace listing seems stale, force a refresh first:

```
claude plugin marketplace update mtg-jumpstarts
```

## Use it

Just ask Claude, e.g.:

> "Use mtg-jumpstarts to get the Avatar: The Last Airbender decklist for Aang"
>
> "Show me the most expensive Foundations Jumpstart decks"
>
> "Give me a printable cheat sheet for the Fantastic Four Marvel deck"

Real example:

**Aang** (mono-white, Power Level 4/5) — go-wide tokens via airbending: exile your own creatures for value, then Aang converts those exile triggers into experience counters that make Ally tokens each upkeep.

```
Creatures (8)
  Aang, Airbending Master (Mythic) — $8.35
  Appa, Loyal Sky Bison (Uncommon) — $0.23
  Invasion Reinforcements (Uncommon) — $0.19
  Kindly Customer (Common) — $0.27
  Koala-Sheep (Common) — $0.13
  Kyoshi Warriors (Common) — $0.14
  Momo, Rambunctious Rascal (Uncommon) — $0.19
  Water Tribe Captain (Common) — $0.08
Instants (3)
  Airbending Lesson (Common) — $0.23
  Cloudshift (Common) — $1.08
  Enter the Avatar State (Uncommon) — $0.38
Enchantments (1)
  Path to Redemption (Common) — $0.11
Lands (2)
  Thriving Heath — 1
  Plains — 7

Total: 20 cards, ~$11.69
```

Tips: Airbend your own creatures for value · Stack experience counters early · Blink ETB creatures with Cloudshift · Use Path to Redemption on threats you can't otherwise answer

**Supported series:**

- Jumpstart (2020)
- Jumpstart 2022
- Foundations Jumpstart
- Lord of the Rings: Tales of Middle-earth Jumpstart
- Avatar: The Last Airbender
- Marvel Super Heroes
- Dominaria United Jumpstart
- The Brothers' War Jumpstart
- Phyrexia: All Will Be One Jumpstart
- March of the Machine Jumpstart

## Sample output

```json
{
  "theme": "Aang",
  "color": "white",
  "description": "This mono-white deck revolves around airbending — exiling nonland permanents (often your own creatures) so they can be recast cheaply for {2}, and Aang, Airbending Master converts that motion into free tokens.",
  "playstyle": ["Go-wide tokens", "Blink/exile value", "Airbending synergy"],
  "tips": ["Airbend your own creatures for value", "Stack experience counters early"],
  "cards": [
    { "title": "Aang, Airbending Master", "type": "Creatures", "qty": 1, "unitPrice": 8.35, "lineTotal": 8.35 },
    { "title": "Cloudshift", "type": "Instants", "qty": 1, "unitPrice": 1.08, "lineTotal": 1.08 }
  ],
  "cardCount": 20,
  "deckTotal": 11.69,
  "powerLevel": 4
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

Ask for a "deck insert card" or "cheat sheet" and Claude reasons about pairings (same live logic as above), picks the deck's leader card(s) (its rare/mythic "face" card — ties are shown in full, not arbitrarily broken), and formats a double-sided, business-card-sized (2"x3.5", portrait) insert — front with theme, color, power level, leader, playstyle, tips, and synergies; back with the full decklist tagged by rarity and color. Real example, a trickier 4-color deck:

> **"Give me a printable cheat sheet for the Fantastic Four Marvel deck"**

**FRONT**
```
Marvel Super Heroes
Fantastic
Color: Multicolor
Power Level: ●●●○○
Leader: The Fantastic Four (Mythic)

Playstyle: Value/card-draw engine, Counter synergy, Go-wide defense into big finisher

Tips:
  - Chain draws off Mister Fantastic
  - Use Sue Storm for free Walls
  - Grow The Thing before attacking
  - Combo Thing Swing with pumped Heroes
  - Ramp mana with Farseek/Terramorphic first

Synergies:
  Trained (Green) - counter-doubling combos Sue Storm Walls
  Geniuses (Blue) - own Reed Richards, stacks card-draw engine
  Thor (Red) - damage-doubling turns Torch pings lethal
  Squadron (White) - Hero tribal buffs, exalted lone attacker
  Towering (Green) - ramp, power-4 payoffs, fixes 4-color mana
```

**BACK**
```
Fantastic

Creatures (6)
  Human Torch, Johnny Storm (Uncommon, R)
  H.E.R.B.I.E. Scout Unit (Common, C)
  Mister Fantastic, Reed Richards (Uncommon, U)
  Invisible Woman, Sue Storm (Uncommon, W)
  The Thing, Ben Grimm (Uncommon, G)
  The Fantastic Four (Mythic, G/R/U/W)
Instants (4)
  Wall Off (Common, W)
  Fantastic Bounce (Common, U)
  Inspired Fire (Common, R)
  Thing Swing (Common, G)
Sorceries (1)
  Farseek (Common, G)
Artifacts (1)
  Daily Bugle Newspaper (Uncommon, C)
Lands (8)
  Baxter Building (Uncommon, C)
  Thriving Grove (Common, C)
  Pym Technologies (Common, C)
  Forest (Common, C)
  Plains (Common, C)
  Island (Common, C)
  Mountain (Common, C)
  Terramorphic Expanse (Common, C)
```

> This pack is 4-color (WURG), missing only black — no clean ally-color fit exists. Claude called that out and reinforced the deck's existing colors instead, picking pairings on actual card-text synergy: Trained's counter-doubling plays directly off Sue Storm's Wall trigger, Geniuses has its own Reed Richards to stack the draw engine, and Thor's damage-doubling turns Human Torch's draw-pings into real burn.

Output is plain text, no price info, no forced line-wrapping — drop it into a design tool to lay out and print.

## License

[GPL-3.0-or-later](LICENSE) — free to install and use. Forks and redistributions must stay open-source under the same license.

---

Contributing or running this locally? See [DEVELOPMENT.md](DEVELOPMENT.md).
