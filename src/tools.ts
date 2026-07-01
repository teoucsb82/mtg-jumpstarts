// Claude tool schemas — forces structured JSON output via tool_use instead of
// asking the model to produce JSON in its text response. The model MUST call
// the specified tool, so the output always matches the schema. No text parsing.

import Anthropic from '@anthropic-ai/sdk';

// Shared card/category structure reused in both single and multi-decklist tools
export const DECKLIST_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Theme name' },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Category (Creatures, Instants, Lands, etc.)' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                qty: { type: 'integer', description: 'Number of copies' },
                name: { type: 'string', description: 'Exact card name' },
              },
              required: ['qty', 'name'],
            },
          },
        },
        required: ['name', 'cards'],
      },
    },
  },
  required: ['theme', 'categories'],
};

// Used by discoverThemes: returns all theme names + their page URLs
export const THEMES_TOOL: Anthropic.Tool = {
  name: 'report_themes',
  description: 'Report all Jumpstart theme names and their decklist page URLs found on this page',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Theme name' },
            url: { type: 'string', description: 'Full URL to the decklist page' },
          },
          required: ['name', 'url'],
        },
      },
    },
    required: ['themes'],
  },
};

// Used by extractDecklist: returns one 20-card decklist
export const DECKLIST_TOOL: Anthropic.Tool = {
  name: 'report_decklist',
  description: 'Report the structured 20-card decklist for a single Jumpstart theme',
  input_schema: DECKLIST_ITEM_SCHEMA as Anthropic.Tool['input_schema'],
};

// Used by extractMultipleDecklists: returns all theme decklists from one color page
export const DECKLISTS_TOOL: Anthropic.Tool = {
  name: 'report_decklists',
  description: 'Report all structured 20-card decklists found on a color group page',
  input_schema: {
    type: 'object',
    properties: {
      decklists: { type: 'array', items: DECKLIST_ITEM_SCHEMA },
    },
    required: ['decklists'],
  },
};

// Used by describeDecks: cards are already known (parsed deterministically from
// mtg.wiki's semantic deck-block markup), so this only asks for descriptions —
// a flat, small array, one row per deck.
export const DESCRIPTIONS_TOOL: Anthropic.Tool = {
  name: 'report_descriptions',
  description: 'Report a full play-pattern description, grounded in oracle text, for each decklist',
  input_schema: {
    type: 'object',
    properties: {
      descriptions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string', description: 'Exact theme name, copied verbatim from the provided list' },
            description: {
              type: 'string',
              description:
                'A full paragraph (not 1-2 sentences) describing how this deck actually plays: its ' +
                'strategy and playstyle, grounded in the specific cards and their rules text provided. ' +
                'When the cards genuinely interact — e.g. one card\'s trigger feeds another\'s ability — ' +
                'name 1-2 concrete combos explicitly, citing the actual card names and what they do. ' +
                'Do not fabricate a combo that isn\'t really there: if the deck is a straightforward ' +
                'value/curve pile with no standout interaction, say so plainly and describe its game ' +
                'plan instead. Avoid generic filler ("big creatures", "spell heavy", "lots of tokens") ' +
                'unless immediately backed by specifics.',
            },
          },
          required: ['theme', 'description'],
        },
      },
    },
    required: ['descriptions'],
  },
};
