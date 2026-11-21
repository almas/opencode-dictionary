/**
 * Dictionary — the server half of the plugin.
 *
 * Registers the `dictionary` RPC domain over the bundled offline data
 * (JMdict common vocabulary, a kokugo table from the 日本語ウィクショナリー
 * extraction, KANIDIC kanji summaries, KanjiVG stroke files — see DATA.md).
 * Everything is served from memory once the gzipped tables are
 * loaded on first use; the runtime never reaches the network.
 */
import { Plugin } from "@opencode/plugin"
import { loadDict, lookupKanji, lookupKokugo, lookupWords, strokeSvg, defaultDataDir } from "./dict"
import { DictionaryRpc, type LookupInput, type LookupResult, type StrokeInput, type StrokeResult } from "./rpc"

export default Plugin.define({
  id: "dictionary",
  async setup(ctx) {
    const dataDir = defaultDataDir()

    await ctx.rpc.register(DictionaryRpc, {
      lookup: async (raw): Promise<LookupResult> => {
        const input = (raw ?? {}) as LookupInput
        const query = typeof input.query === "string" ? input.query.trim() : ""
        if (!query) return { words: [], kokugo: [], kanji: [], note: "検索語が入力されていません" }
        const limit = Math.min(Math.max(Math.trunc(input.limit ?? 12), 1), 40)
        const data = loadDict(dataDir)
        const words = lookupWords(data, query, limit)
        const kokugo = lookupKokugo(data, query, limit)
        const kanji = lookupKanji(data, query)
        if (words.length === 0 && kokugo.length === 0 && kanji.length === 0) {
          return { words: [], kokugo: [], kanji: [], note: `「${query.slice(0, 24)}」は見つかりませんでした（内蔵の辞書のみ検索します）` }
        }
        return { words, kokugo, kanji }
      },
      stroke: async (raw): Promise<StrokeResult> => {
        const input = (raw ?? {}) as StrokeInput
        const char = typeof input.char === "string" ? input.char.trim() : ""
        if ([...char].length !== 1) return { char }
        const svg = strokeSvg(dataDir, char)
        return svg ? { svg, char } : { char }
      },
    })
  },
})
