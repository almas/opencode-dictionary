/**
 * Rebuild the bundled dictionaries under data/ from their upstream sources.
 *
 * Runtime never touches the network; this script is run only when we want to
 * refresh the data. Sources (see DATA.md for full license text):
 *   - jmdict-simplified (scriptin/jmdict-simplified, CC BY-SA 4.0)
 *       jmdict-eng-common  -> data/jmdict-compact.tsv.gz
 *       kanjidic2-en       -> data/kanjidic-compact.tsv.gz
 *   - kaikki.org jawiktionary extraction of 日本語ウィクショナリー (CC BY-SA 4.0)
 *       Japanese word senses -> data/kokugo-kaikki.tsv.gz
 *       (if the rotating upstream dump is unavailable, set OC_DICT_KOKUGO or
 *        place a snapshot at ~/.local/share/opencode-dict-assets/)
 *   - KanjiVG (KanjiVG/kanjivg, CC BY-SA 3.0, Ulrich Apel)
 *       kanji stroke files for grade 1-8 kanji -> data/strokes/<cp>.svg.gz
 *
 * Usage: node scripts/fetch-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs"
import { gzipSync, gunzipSync } from "node:zlib"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const JMdict_TAG = "3.6.2+20261116213322"
const KANJIVG_TAG = "r20260714"
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data")
const TMP = join(OUT, ".fetch-tmp")

// jmdict-simplified daily releases name assets "<kind>-<tag>.json.zip".
const url = (asset) =>
  `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMdict_TAG)}/${encodeURIComponent(asset)}`

mkdirSync(TMP, { recursive: true })
mkdirSync(join(OUT, "strokes"), { recursive: true })

function get(url, dest) {
  if (existsSync(dest)) return
  execSync(`curl -sL --fail -o ${JSON.stringify(dest)} ${JSON.stringify(url)}`, { stdio: "inherit" })
}

get(url(`jmdict-eng-common-${JMdict_TAG}.json.zip`), `${TMP}/jmdict.zip`)
get(url(`kanjidic2-en-${JMdict_TAG}.json.zip`), `${TMP}/kanjidic.zip`)
get(
  `https://github.com/KanjiVG/kanjivg/releases/download/${KANJIVG_TAG}/kanjivg-${KANJIVG_TAG.slice(1)}-main.zip`,
  `${TMP}/kanjivg.zip`,
)
execSync(`cd ${JSON.stringify(TMP)} && unzip -o -q jmdict.zip && unzip -o -q kanjidic.zip && mkdir -p kv && cd kv && unzip -o -q ../kanjivg.zip 'kanji/*'`)

// --- jmdict: surface<TAB>reading<TAB>pos<TAB>gloss, sorted by surface ---
// (the tag is only in the release asset name; the file inside keeps its plain name)
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

// --- kokugo (jawiktionary via kaikki.org): surface<TAB>reading<TAB>pos<TAB>gloss
// Japanese-Japanese definitions. One JSON line per word x part-of-speech; verbs
// and adjectives live under a kana headword whose forms carry a `kanji` field.
// kaikki rotates its dump files, so a pinned snapshot in the local asset cache
// is used as a fallback (see DATA.md for the snapshot date and license). The
// .jsonl URL is served with `Content-Encoding: gzip` when we ask for it, so
// curl stores gzip bytes without the 190 MB plain-text round-trip.
const KOKUGO_URL =
  "https://kaikki.org/jawiktionary/%E6%97%A5%E6%9C%AC%E8%AA%9E/kaikki.org-dictionary-%E6%97%A5%E6%9C%AC%E8%AA%9E.jsonl"
const KOKUGO_CACHE =
  process.env.OC_DICT_KOKUGO ?? join(homedir(), ".local", "share", "opencode-dict-assets", "kaikki-ja-jawiktionary.jsonl.gz")
function tryGet(src, dest, curlArgs = "") {
  if (existsSync(dest)) return true
  try {
    execSync(`curl -sSL --fail ${curlArgs} -o ${JSON.stringify(dest)} ${JSON.stringify(src)}`, { stdio: "pipe" })
    return existsSync(dest)
  } catch (error) {
    console.log(`fetch failed: ${src.split("/").pop()} (${String(error.stderr ?? error.status ?? error).split("\n")[0]})`)
    rmSync(dest, { force: true })
    return false
  }
}
if (!tryGet(KOKUGO_URL, `${TMP}/kaikki-ja.jsonl.gz`, `-H ${JSON.stringify("Accept-Encoding: gzip")}`)) {
  if (!existsSync(KOKUGO_CACHE)) {
    console.error(`kokugo: ${KOKUGO_URL} is unavailable and no cached snapshot at ${KOKUGO_CACHE}`)
    process.exit(1)
  }
  console.log(`kokugo: upstream dump rotated; using cached snapshot ${KOKUGO_CACHE}`)
  execSync(`cp ${JSON.stringify(KOKUGO_CACHE)} ${JSON.stringify(`${TMP}/kaikki-ja.jsonl.gz`)}`)
}
const JA = /[\u3041-\u309f\u30a1-\u30ff\u4e00-\u9fff]/
const HIRA = /^[\u3041-\u309f\u30fc\s]+$/
const KANA_ONLY = /^[\u3041-\u309f\u30a1-\u30ff\u30fc・\s]+$/
const BAD = /\{\{|\}\}|https?:|Wikipedia/
const ONYOMI = /go-on|kan-on|goon|kanon|irregular/
const POS_JA = {
  noun: "名詞",
  proper_noun: "固有名詞",
  name: "固有名詞",
  verb: "動詞",
  adj: "形容詞",
  adj_noun: "形容動詞",
  adv: "副詞",
  advnum: "副詞",
  pron: "代名詞",
  num: "数詞",
  phrase: "成句",
  expression: "表現",
  intj: "感動詞",
  particle: "助詞",
  prefix: "接頭辞",
  suffix: "接尾辞",
  abbrev: "略語",
  classifier: "助数詞",
  determiner: "連体詞",
  conjunction: "接続詞",
}
const kokugoLines = new Map() // surface\treading\tgloss -> tsv row (one per sense)
const kokugoSeen = new Map() // surface -> kept glosses (containment dedupe)
let kokugoTotal = 0
let kokugoKept = 0
function addKokugo(surface, reading, pos, gloss) {
  const key = `${surface}\t${reading}\t${gloss}`
  if (kokugoLines.has(key)) return
  const seen = kokugoSeen.get(surface) ?? []
  if (seen.some((u) => u.includes(gloss) || gloss.includes(u))) return
  seen.push(gloss)
  kokugoSeen.set(surface, seen)
  kokugoLines.set(key, `${surface}\t${reading}\t${pos}\t${gloss}`)
  kokugoKept++
}
{
  const kokugoRaw = readFileSync(`${TMP}/kaikki-ja.jsonl.gz`)
const raw = (kokugoRaw[0] === 0x1f && kokugoRaw[1] === 0x8b ? gunzipSync(kokugoRaw) : kokugoRaw).toString("utf8")
  for (const line of raw.split("\n")) {
    if (!line) continue
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    kokugoTotal++
    if (d.lang_code && d.lang_code !== "ja") continue
    const word = (d.word ?? "").trim()
    if (!word || word.length > 20) continue
    if (d.pos === "character") continue
    const senses = d.senses ?? []
    if (senses.length === 0) continue
    // reading: a hiragana transliteration form, skipping pure on-yomi forms
    let reading = ""
    let kana = ""
    for (const f of d.forms ?? []) {
      const tags = f.tags ?? []
      const form = (f.form ?? "").trim()
      if (!tags.includes("transliteration") || !form || form === word) continue
      if (!HIRA.test(form)) continue
      if (!kana) kana = form
      if (!ONYOMI.test(tags.join(" ")) || tags.includes("kun")) {
        if (!reading) reading = form
      }
    }
    if (!reading) reading = kana || (KANA_ONLY.test(word) ? word : "")
    const pos = POS_JA[d.pos] ?? ""
    // kanji spellings of a kana headword (verbs and adjectives live under kana)
    const kanjiForms = []
    if (KANA_ONLY.test(word)) {
      for (const f of d.forms ?? []) {
        const form = (f.form ?? "").trim()
        if (form && form !== word && (f.tags ?? []).includes("kanji") && form.length <= 20) kanjiForms.push(form)
      }
    }
    const cleanGlosses = []
    for (const s of senses) {
      if (cleanGlosses.length >= 4) break
      if ((s.tags ?? []).includes("no-gloss")) continue
      const gloss = (s.glosses ?? []).join(" ").replace(/[\t\n\r]+/g, " ").replace(/\s+/g, " ").trim()
      if (!gloss || !JA.test(gloss) || BAD.test(gloss) || gloss.length < 3 || gloss.length > 120) continue
      cleanGlosses.push(gloss)
      addKokugo(word, reading, pos, gloss)
    }
    for (const kf of kanjiForms) for (const gloss of cleanGlosses) addKokugo(kf, word, pos, gloss)
  }
}
// Sort by surface only (not the whole line) so each surface keeps its sense order.
const kokugoOut = [...kokugoLines.values()]
{
  const surf = (l) => l.slice(0, l.indexOf("\t"))
  const order = new Map([...new Set(kokugoOut.map(surf))].sort((a, b) => (a < b ? -1 : 1)).map((s, i) => [s, i]))
  kokugoOut.sort((a, b) => order.get(surf(a)) - order.get(surf(b)))
}
writeFileSync(`${OUT}/kokugo-kaikki.tsv.gz`, gzipSync(Buffer.from(kokugoOut.join("\n") + "\n"), { level: 9 }))
console.log(`kokugo lines=${kokugoTotal} rows=${kokugoKept} headwords=${kokugoSeen.size}`)

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
