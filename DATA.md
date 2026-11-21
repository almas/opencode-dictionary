# Data sources

All tables are built by `scripts/fetch-data.mjs` (run it once, network needed at
*build* time only) and shipped inside the package. The plugin itself works fully
offline: it reads gzipped TSV files from memory, and the only runtime network
call is the optional `speechSynthesis` read-aloud, which the browser provides.

| File                    | Source                                                  | License                       |
| ----------------------- | ------------------------------------------------------- | ----------------------------- |
| `words-jmdict.tsv.gz`   | JMdict-EDICT common vocabulary (`jmdict-eng-common`)     | CC BY-SA 4.0 (see below)      |
| `kokugo-kaikki.tsv.gz`  | 日本語ウィクショナリー extraction by kaikki.org          | CC BY-SA 4.0 (see below)      |
| `kanji-kanidic.tsv.gz`  | KANIDIC (`kanjidic2-en`)                                 | CC BY-SA 4.0 (see below)      |
| `strokes/*.svg.gz`      | KanjiVG                                                  | CC BY-SA 3.0 (see below)      |

## Attribution (required by CC BY-SA)

- **JMdict** — Copyright Electronic Dictionary Research and Development Group
  (Monash University IMADB), licensed under CC BY-SA 4.0.
  Data: <https://www.edrdg.org/jmdict/edict_doc.html> —
  converted with <https://github.com/jedirt/jmdict-simplified>.
- **Japanese Wiktionary (kokugo table)** — definitions from the community-run
  日本語ウィクショナリー (<https://ja.wiktionary.org>), extracted by
  kaikki.org (<https://kaikki.org>). Text is licensed CC BY-SA 4.0; the
  extraction is in the public domain (CC0). Because definitions are
  user-contributed, glosses carry no editorial guarantee — treat them like any
  wiki. Each gloss in the table cites its source template (e.g.
  「デジタル大辞泉」の解説) so provenance stays visible.
- **KANIDIC** — Jim Breen's WWWJDIC Dictionary Server Project (EDRDG),
  CC BY-SA 4.0.
- **KanjiVG** — Ulrich Apel, <https://kanjivg.tagaini.net>, CC BY-SA 3.0.

Since derivatives of CC BY-SA data are shared under the same license, the data
files in `data/` are distributed under CC BY-SA 4.0. The plugin source code
itself is MIT (see LICENSE).

## Kokugo table details

`kokugo-kaikki.tsv.gz` holds Japanese-Japanese definitions: one row per
surface × sense (columns: surface, reading, part of speech, definition),
sorted by surface. Headword+POS combinations are capped at four senses to keep
the dialog scannable. Readings prefer kun-yomi kana over on-yomi.
`scripts/fetch-data.mjs` maps it from the kaikki.org JSONL
(`parts of speech: 名詞/動詞/形容詞/副詞/記号/感動詞/…`). The upstream file
rotates occasionally; if the URL 404s, point `OC_DICT_KOKUGO` (or the default
cache path, see the script header) at a saved snapshot of the same JSONL.

## Regenerating

```sh
npm run fetch-data   # downloads sources, rewrites data/ (needs network)
```

## Why JMdict + Wiktionary?

JMdict covers everyday vocabulary with English glosses and is the same base
many commercial learner's dictionaries use. It answers "what does this mean in
English". The 日本語ウィクショナリー extraction covers roughly 124k headwords
with Japanese-Japanese definitions — it answers "what does this mean", with
native-style explanations, usage notes and cited sources, including terms JMdict
does not carry. Kanji lookups use KANIDIC for meanings/readings/grades and
KanjiVG for stroke-order animations. JAML and NAIST J dictionary are not
redistributed here because their licenses restrict redistribution.
