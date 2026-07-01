// Claude tool schemas — forces structured JSON output via tool_use instead of
// asking the model to produce JSON in its text response. The model MUST call
// the specified tool, so the output always matches the schema. No text parsing.

import Anthropic from '@anthropic-ai/sdk';

// Shared card/category structure reused in both single and multi-decklist tools
export const DECKLIST_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Theme name' },
    description: {
      type: 'string',
      description: 'How this deck plays in 1-2 sentences, e.g. "big creatures", "spell heavy", "lots of tokens"',
    },
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
  required: ['theme', 'description', 'categories'],
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
