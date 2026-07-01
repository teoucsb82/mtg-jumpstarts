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
> "What's a good beginner-friendly pairing in Marvel Super Heroes Jumpstart?"
>
> "Show me the most expensive Foundations Jumpstart decks"

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

Every card comes with a live Scryfall price, and `powerLevel` (1-5) ranks each deck against the rest of its series. Ask Claude which decks pair well together, what to expect power-wise, or anything else — it reasons about strategy live from the actual card data, not a canned answer.

## License

[GPL-3.0-or-later](LICENSE) — free to install and use. Forks and redistributions must stay open-source under the same license.

---

Contributing or running this locally? See [DEVELOPMENT.md](DEVELOPMENT.md).
