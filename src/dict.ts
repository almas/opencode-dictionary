/**
 * Dictionary — the offline data store.
 *
 * Reads the compact, gzipped tables built by scripts/fetch-data.mjs (see
 * DATA.md for sources and licenses) and answers lookups entirely from memory:
 * no network at runtime. The word table is kept sorted so prefix queries can
 * binary-search instead of scanning.
 */
import { gunzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { KanjiEntry, WordEntry } from "./rpc"

export interface DictData {
  /** surface -> entries (exact hits, in table order = most common first) */
  wordsBySurface: Map<string, WordEntry[]>
  /** all entries sorted by surface, for prefix search */
  sortedWords: WordEntry[]
  /** single kanji -> entry */
  kanji: Map<string, KanjiEntry>
}

/** Where data/ lives relative to this module (repo layout: <pkg>/src/dict.ts). */
export function defaultDataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data")
}

function readTsv(file: string): string[][] {
  const text = gunzipSync(readFileSync(file)).toString("utf8")
  const rows: string[][] = []
  for (const line of text.split("\n")) {
    if (!line) continue
    rows.push(line.split("\t"))
  }
  return rows
}

let cache: { dir: string; data: DictData } | undefined

/** Load (once, cached) the bundled dictionaries from `dir`. */
export function loadDict(dataDir = defaultDataDir()): DictData {
  if (cache && cache.dir === dataDir) return cache.data
  const wordsBySurface = new Map<string, WordEntry[]>()
  const sortedWords: WordEntry[] = []
  for (const row of readTsv(join(dataDir, "jmdict-compact.tsv.gz"))) {
    const [surface, reading, pos, gloss] = row
    if (!surface || reading === undefined || gloss === undefined) continue
    const entry: WordEntry = { surface, reading, ...(pos ? { pos } : {}), gloss }
    sortedWords.push(entry)
    const bucket = wordsBySurface.get(surface)
    if (bucket) bucket.push(entry)
    else wordsBySurface.set(surface, [entry])
  }
  sortedWords.sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0))

  const kanji = new Map<string, KanjiEntry>()
  for (const row of readTsv(join(dataDir, "kanjidic-compact.tsv.gz"))) {
    const [char, on, kun, meanings, grade, strokes] = row
    if (!char) continue
    kanji.set(char, {
      char,
      on: on ? on.split(",") : [],
      kun: kun ? kun.split(",") : [],
      meanings: meanings ? meanings.split("|").filter(Boolean) : [],
      grade: grade ? Number(grade) : 0,
      strokes: strokes ? Number(strokes) : 0,
    })
  }
  cache = { dir: dataDir, data: { wordsBySurface, sortedWords, kanji } }
  return cache.data
}

/** First index of a row whose surface starts with `prefix` (binary search). */
function lowerBound(rows: WordEntry[], prefix: string): number {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid]!.surface < prefix) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Word lookup: exact surface matches first, then prefix matches
 * (so "書き" finds 書き物, 書き方 …). Readings are searched too, so
 * entering ひらがな finds the kanji surfaces.
 */
export function lookupWords(data: DictData, query: string, limit = 12): WordEntry[] {
  const q = query.trim()
  if (!q) return []
  const out: WordEntry[] = []
  const seen = new Set<string>()
  const push = (entries: WordEntry[]) => {
    for (const e of entries) {
      const key = `${e.surface}\u0000${e.reading}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
      if (out.length >= limit) return
    }
  }
  const exact = data.wordsBySurface.get(q)
  if (exact) push(exact)
  // exact reading hit ("読む" typed as a reading, or kana-only words)
  if (out.length < limit) {
    const byReading = data.sortedWords.filter((e) => e.reading === q)
    push(byReading.slice(0, limit - out.length))
  }
  // prefix over sorted surfaces
  if (out.length < limit) {
    const start = lowerBound(data.sortedWords, q)
    const prefix: WordEntry[] = []
    for (let i = start; i < data.sortedWords.length && prefix.length < limit - out.length; i++) {
      const e = data.sortedWords[i]!
      if (!e.surface.startsWith(q)) break
      prefix.push(e)
    }
    push(prefix)
  }
  return out
}

/** Kanji lookup when the query is a single kanji present in KANIDIC. */
export function lookupKanji(data: DictData, query: string): KanjiEntry[] {
  const q = query.trim()
  if ([...q].length !== 1) return []
  const hit = data.kanji.get(q)
  return hit ? [hit] : []
}

const STROKE_RE = /<path\s+id="([^"]+)"[^>]*?\sd="([^"]+)"/g

/**
 * Reduce a KanjiVG file to strokes we can animate: keep the viewBox and one
 * `<path>` per stroke in writing order, each with `pathLength="1"` and
 * `data-order` so the GUI can drive a dash-offset animation in CSS.
 */
export function strokeSvg(dataDir: string, char: string): string | undefined {
  const cp = char.codePointAt(0)
  if (cp === undefined) return undefined
  const file = join(dataDir, "strokes", `${cp.toString(16).padStart(5, "0")}.svg.gz`)
  let raw: string
  try {
    raw = gunzipSync(readFileSync(file)).toString("utf8")
  } catch {
    return undefined
  }
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? "0 0 109 109"
  const vbSize = Number(viewBox.split(/\s+/)[2]) || 109
  const strokeWidth = Math.max(1.4, Math.round(vbSize * 0.016 * 10) / 10)
  const paths: string[] = []
  // KanjiVG ids look like kvg:06771-s1; the file lists strokes in writing order.
  for (const m of raw.matchAll(STROKE_RE)) {
    const [, id, d] = m
    if (!id || !d) continue
    paths.push(`<path id="${id}" d="${d}" pathLength="1" data-order="${paths.length + 1}"/>`)
  }
  if (paths.length === 0) return undefined
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" class="oc-dict-stroke">` +
    `<g fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    paths.join("") +
    `</g></svg>`
  )
}
