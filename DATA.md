# Bundled data, sources and licenses

All dictionaries are bundled in `data/` and served entirely offline at runtime.

| File | Source | License |
| --- | --- | --- |
| `data/jmdict-compact.tsv.gz` | [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) (`jmdict-eng-common` release), derived from the JMdict dictionary by the Electronic Dictionary Research and Computing Group | CC BY-SA 4.0 (JMdict) |
| `data/kanjidic-compact.tsv.gz` | [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) (`kanjidic2-en` release), derived from KANIDIC by the Electronic Dictionary Research and Computing Group | CC BY-SA 4.0 (KANIDIC) |
| `data/strokes/*.svg.gz` | [KanjiVG](https://kanjivg.tagaini.net) by Ulrich Apel | CC BY-SA 3.0 |

Notes:

- The jmdict tables are converted to a compact gzipped TSV (surface / reading /
  part of speech / gloss, and character / on / kun / meanings / grade / stroke
  count). Only the common-vocabulary subset ships to keep the bundle small.
- KanjiVG stroke files are stripped to their ordered stroke paths for the
  2,136 grade 1–8 kanji and gzipped per file.
- To regenerate everything from the upstream releases run `node scripts/fetch-data.mjs`.
- Full license texts: <https://creativecommons.org/licenses/by-sa/4.0/> and
  <https://creativecommons.org/licenses/by-sa/3.0/>.
