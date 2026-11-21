import { describe, expect, it } from "vitest"
import { defaultDataDir, loadDict, lookupKanji, lookupKokugo, lookupWords, strokeSvg } from "../src/dict"

const dir = defaultDataDir()

describe("lookupWords", () => {
  it("finds an exact surface match first", () => {
    const data = loadDict(dir)
    const hits = lookupWords(data, "日本語", 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].surface).toBe("日本語")
    expect(hits[0].gloss.length).toBeGreaterThan(0)
  })

  it("finds entries by reading", () => {
    const data = loadDict(dir)
    const hits = lookupWords(data, "ねこ", 8)
    expect(hits.some((entry) => entry.surface === "猫")).toBe(true)
  })

  it("falls back to prefix matches", () => {
    const data = loadDict(dir)
    const hits = lookupWords(data, "情報", 10)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((entry) => entry.surface.startsWith("情報"))).toBe(true)
  })

  it("returns nothing for a nonsense query", () => {
    const data = loadDict(dir)
    expect(lookupWords(data, "zzqqxx", 5)).toEqual([])
  })
})

describe("lookupKokugo", () => {
  it("finds Japanese-Japanese definitions for a common noun", () => {
    const data = loadDict(dir)
    const hits = lookupKokugo(data, "猫", 8)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].surface).toBe("猫")
    // the gloss itself is Japanese (kana present), i.e. not a JMdict translation
    expect(hits[0].gloss).toMatch(/[ -ヿ]/)
  })

  it("finds kana verbs by their kanji form", () => {
    const data = loadDict(dir)
    const hits = lookupKokugo(data, "走る", 8)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((entry) => entry.pos === "動詞")).toBe(true)
  })

  it("returns nothing for a nonsense query", () => {
    const data = loadDict(dir)
    expect(lookupKokugo(data, "zzqqxx", 5)).toEqual([])
  })
})

describe("lookupKanji", () => {
  it("returns readings and meanings for a jyōyō kanji", () => {
    const data = loadDict(dir)
    const hits = lookupKanji(data, "猫")
    expect(hits.length).toBe(1)
    expect(hits[0].on.length).toBeGreaterThan(0)
    expect(hits[0].kun.length).toBeGreaterThan(0)
    expect(hits[0].strokes).toBe(11)
  })

  it("returns nothing for kana", () => {
    const data = loadDict(dir)
    expect(lookupKanji(data, "ね")).toEqual([])
  })
})

describe("strokeSvg", () => {
  it("returns an animated single-path-per-stroke svg for a jyōyō kanji", () => {
    const svg = strokeSvg(dir, "猫")
    expect(svg).toBeDefined()
    expect(svg).toContain("oc-dict-stroke")
    expect(svg).toContain('pathLength="1"')
    // 猫 has 11 strokes
    expect(svg!.match(/<path /g)?.length).toBe(11)
  })

  it("returns undefined for characters without stroke data", () => {
    expect(strokeSvg(dir, "ね")).toBeUndefined()
  })
})
