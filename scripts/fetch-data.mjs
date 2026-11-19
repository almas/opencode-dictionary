/**
 * Rebuild the bundled dictionaries under data/ from their upstream sources.
 *
 * Runtime never touches the network; this script is run only when we want to
 * refresh the data. Sources (see DATA.md for full license text):
 *   - jmdict-simplified (scriptin/jmdict-simplified, CC BY-SA 4.0)
 *       jmdict-eng-common  -> data/jmdict-compact.tsv.gz
 *       kanjidic2-en       -> data/kanjidic-compact.tsv.gz
 *   - KanjiVG (KanjiVG/kanjivg, CC BY-SA 3.0, Ulrich Apel)
 *       kanji stroke files for grade 1-8 kanji -> data/strokes/<cp>.svg.gz
 *
 * Usage: node scripts/fetch-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const JMdict_TAG = "3.6.2+20261116213322"
const KANJIVG_TAG = "r20260714"
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data")
const TMP = join(OUT, ".fetch-tmp")

const url = (asset) =>
  `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMdict_TAG)}/${asset}`

mkdirSync(TMP, { recursive: true })
mkdirSync(join(OUT, "strokes"), { recursive: true })

function get(url, dest) {
  if (existsSync(dest)) return
  execSync(`curl -sL --fail -o ${JSON.stringify(dest)} ${JSON.stringify(url)}`, { stdio: "inherit" })
}

get(url(`jmdict-eng-common-3.6.2.json.zip`), `${TMP}/jmdict.zip`)
get(url(`kanjidic2-en-3.6.2.json.zip`), `${TMP}/kanjidic.zip`)
get(
  `https://github.com/KanjiVG/kanjivg/releases/download/${KANJIVG_TAG}/kanjivg-${KANJIVG_TAG.slice(1)}-main.zip`,
  `${TMP}/kanjivg.zip`,
)
execSync(`cd ${JSON.stringify(TMP)} && unzip -o -q jmdict.zip && unzip -o -q kanjidic.zip && mkdir -p kv && cd kv && unzip -o -q ../kanjivg.zip 'kanji/*'`)

// --- jmdict: surface<TAB>reading<TAB>pos<TAB>gloss, sorted by surface ---
const jmdict = JSON.parse(readFileSync(`${TMP}/jmdict-eng-common-3.6.2.json`, "utf8"))
const lines = new Map() // surface\treading -> line (first occurrence = most common)
for (const entry of jmdict.words ?? []) {
  const glosses = []
  let pos = []
  for (const sense of entry.sense ?? []) {
    for (const g of sense.gloss ?? []) {
      if (!g.lang || g.lang === "eng") glosses.push(g.text)
    }
    if (pos.length === 0 && sense.partOfSpeech?.length) pos = sense.partOfSpeech.slice(0, 2)
    if (glosses.length >= 3) break
  }
  if (glosses.length === 0) continue
  const gloss = glosses.slice(0, 3).join(" | ").replace(/[\t\n\r]+/g, " ").slice(0, 160)
  const posText = pos.slice(0, 2).join(",")
  const reads = (entry.kana ?? []).map((k) => k.text)
  const writes = (entry.kanji ?? []).map((k) => k.text)
  const pairs = writes.length > 0 ? writes.flatMap((w) => reads.map((r) => [w, r])) : reads.map((r) => [r, r])
  for (const [surface, reading] of pairs) {
    const key = `${surface}\t${reading}`
    if (!lines.has(key)) lines.set(key, `${key}\t${posText}\t${gloss}`)
  }
}
const sorted = [...lines.values()].sort((a, b) => (a < b ? -1 : 1))
writeFileSync(`${OUT}/jmdict-compact.tsv.gz`, gzipSync(Buffer.from(sorted.join("\n") + "\n"), { level: 9 }))
console.log(`jmdict lines=${lines.size}`)

// --- kanjidic: char<TAB>on<TAB>kun<TAB>meanings<TAB>grade<TAB>strokes ---
const kanjidic = JSON.parse(readFileSync(`${TMP}/kanjidic2-en-3.6.2.json`, "utf8"))
const kanjiLines = []
const jyoyo = []
for (const ch of kanjidic.characters ?? []) {
  const on = []
  const kun = []
  const meanings = []
  for (const group of ch.readingMeaning?.groups ?? []) {
    for (const r of group.readings ?? []) {
      if (r.type === "ja_on" && !on.includes(r.value)) on.push(r.value)
      if (r.type === "ja_kun" && !kun.includes(r.value)) kun.push(r.value)
    }
    for (const m of group.meanings ?? []) {
      if ((!m.lang || m.lang === "en") && m.value && !meanings.includes(m.value)) meanings.push(m.value)
    }
  }
  const grade = ch.misc?.grade ?? 0
  const strokes = ch.misc?.strokeCounts?.[0] ?? 0
  kanjiLines.push(
    [ch.literal, on.join(","), kun.join(","), meanings.slice(0, 4).join("|").replace(/[\t\n\r]+/g, " "), grade, strokes].join("\t"),
  )
  if (grade >= 1 && grade <= 8) jyoyo.push(ch.literal.codePointAt(0).toString(16).padStart(5, "0"))
}
writeFileSync(`${OUT}/kanjidic-compact.tsv.gz`, gzipSync(Buffer.from(kanjiLines.sort().join("\n") + "\n"), { level: 9 }))
console.log(`kanjidic chars=${kanjiLines.length} jyoyo=${jyoyo.length}`)

// --- KanjiVG strokes for grade 1-8 kanji, gzipped per file ---
const keep = new Set(jyoyo)
let copied = 0
for (const name of readdirSync(`${TMP}/kv/kanji`)) {
  const cp = name.replace(".svg", "")
  if (!keep.has(cp)) continue
  writeFileSync(`${OUT}/strokes/${cp}.svg.gz`, gzipSync(readFileSync(`${TMP}/kv/kanji/${name}`), { level: 9 }))
  copied++
}
console.log(`strokes copied=${copied}`)
rmSync(TMP, { recursive: true, force: true })
