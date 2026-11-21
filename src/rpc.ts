/**
 * Dictionary — RPC contract shared by the server and GUI halves.
 *
 * Plain JSON Schema literals: the server validates input and output with
 * them, and the GUI types its client proxy from the same definition.
 */
import type { Rpc } from "@opencode/schema/rpc"

const WORD_ITEMS = {
  type: "object",
  properties: {
    surface: { type: "string" },
    reading: { type: "string" },
    pos: { type: "string" },
    gloss: { type: "string" },
  },
  required: ["surface", "reading", "gloss"],
}

export const DictionaryRpc = {
  id: "dictionary",
  methods: {
    // Look a word or kanji up in the bundled dictionaries:
    // `words` = JMdict (Japanese↔English), `kokugo` = Japanese-Japanese
    // definitions from the 日本語ウィクショナリー extraction (see DATA.md).
    lookup: {
      input: {
        type: "object",
        properties: {
          query: { type: "string", description: "word, kana, romaji-free surface, or a single kanji" },
          limit: { type: "integer", description: "max word entries to return (default 12)" },
        },
        required: ["query"],
      },
      output: {
        type: "object",
        properties: {
          words: {
            type: "array",
            items: WORD_ITEMS,
          },
          kokugo: {
            type: "array",
            description: "Japanese-Japanese dictionary senses for the same query",
            items: WORD_ITEMS,
          },
          kanji: {
            type: "array",
            items: {
              type: "object",
              properties: {
                char: { type: "string" },
                on: { type: "array", items: { type: "string" } },
                kun: { type: "array", items: { type: "string" } },
                meanings: { type: "array", items: { type: "string" } },
                grade: { type: "integer" },
                strokes: { type: "integer" },
              },
              required: ["char"],
            },
          },
          note: { type: "string", description: "user-facing hint (Japanese) when nothing matched" },
        },
        required: ["words", "kokugo", "kanji"],
      },
    },
    // Stroke-order SVG for one kanji (KanjiVG), stripped to drawable paths.
    stroke: {
      input: {
        type: "object",
        properties: { char: { type: "string" } },
        required: ["char"],
      },
      output: {
        type: "object",
        properties: {
          svg: { type: "string", description: "svg with one <path pathLength=1 data-order=n> per stroke" },
          char: { type: "string" },
        },
        required: ["svg"],
      },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export type LookupInput = { query: string; limit?: number }
export type WordEntry = { surface: string; reading: string; pos?: string; gloss: string }
export type KanjiEntry = { char: string; on?: string[]; kun?: string[]; meanings?: string[]; grade?: number; strokes?: number }
export type LookupResult = { words: WordEntry[]; kokugo: WordEntry[]; kanji: KanjiEntry[]; note?: string }
export type StrokeInput = { char: string }
export type StrokeResult = { svg?: string; char: string }
