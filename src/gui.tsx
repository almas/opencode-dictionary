/**
 * Dictionary — the GUI half of the plugin.
 *
 * Adds a dictionary button to the chat header and a "look up" item to the
 * text-selection right-click menu; both open a dialog that queries the
 * server half over the `dictionary` RPC domain. Words show reading, part of
 * speech and glosses; a single kanji shows on/kun readings, meanings and an
 * animated KanjiVG stroke diagram. Read-aloud uses the browser's own speech
 * synthesis, so nothing here needs the network.
 */
import { For, Show, createSignal, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Command, Plugin, Slot, type MountedSession } from "@opencode/plugin/gui"
import { DictionaryRpc, type KanjiEntry, type LookupResult, type StrokeResult, type WordEntry } from "./rpc"

/** `SlotMap["session.header"]`: the session and active fields are reactive getters. */
interface HeaderProps {
  readonly screen: unknown
  readonly session: MountedSession
  readonly active: boolean
  readonly compact: boolean
}

interface RpcLike {
  lookup(input: { query: string; limit?: number }): Promise<unknown>
  stroke(input: { char: string }): Promise<unknown>
}

const BOOK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`

const DIALOG_STYLE_ID = "oc-dict-style"

function injectStyles() {
  if (document.getElementById(DIALOG_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = DIALOG_STYLE_ID
  style.textContent = `
.oc-dict-stroke path { stroke-dasharray: 1; stroke-dashoffset: 0; }
.oc-dict-stroke.oc-dict-play path { stroke-dashoffset: 1; animation: oc-dict-draw .55s ease forwards; }
@keyframes oc-dict-draw { to { stroke-dashoffset: 0; } }
.oc-dict-input:focus { outline: none; border-color: rgba(120,140,255,.7) !important; }
`
  document.head.appendChild(style)
}
injectStyles()

/** Coarse dark/light detection so the dialog follows the host theme. */
function palette() {
  const bg = getComputedStyle(document.body).backgroundColor
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/.exec(bg)
  let dark = true
  if (rgb) dark = (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000 < 128
  return dark
    ? {
        background: "#26262b",
        card: "#2e2e34",
        color: "#e9e9ea",
        border: "1px solid rgba(255,255,255,0.14)",
        soft: "rgba(255,255,255,0.55)",
        hover: "rgba(255,255,255,0.10)",
        accent: "rgba(120,140,255,0.9)",
      }
    : {
        background: "#ffffff",
        card: "#f4f4f6",
        color: "#232326",
        border: "1px solid rgba(0,0,0,0.18)",
        soft: "rgba(0,0,0,0.55)",
        hover: "rgba(0,0,0,0.06)",
        accent: "rgba(70,90,220,0.9)",
      }
}

/** Browser speech synthesis with a Japanese voice, when the OS provides one. */
function jaVoice(): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === "undefined") return undefined
  return speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("ja"))
}

function speakJa(text: string): boolean {
  if (typeof speechSynthesis === "undefined") return false
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = "ja-JP"
  const voice = jaVoice()
  if (voice) utterance.voice = voice
  speechSynthesis.cancel()
  speechSynthesis.speak(utterance)
  return true
}

export default Plugin.define({
  i18n: {
    en: {
      "dictionary.name": "Dictionary",
      "dictionary.command.lookup": "Look up word or kanji",
      "dictionary.dialog.title": "Japanese dictionary",
      "dictionary.dialog.placeholder": "Search a word, kana or kanji…",
      "dictionary.dialog.loading": "Searching…",
      "dictionary.dialog.hint": "Offline JMdict (common words) + kokugo (Japanese-Japanese) + KANIDIC + KanjiVG stroke order.",
      "dictionary.section.jmdict": "JMdict (Japanese ↔ English)",
      "dictionary.section.kokugo": "Kokugo (Japanese-Japanese)",
      "dictionary.context.lookup": "Look up in dictionary",
      "dictionary.action.read": "Read aloud",
      "dictionary.action.replay": "Replay stroke order",
      "dictionary.label.on": "On",
      "dictionary.label.kun": "Kun",
      "dictionary.label.grade": "Grade",
      "dictionary.label.strokes": "Strokes",
      "dictionary.note.noVoice": "No Japanese system voice is installed, so read-aloud is unavailable.",
    },
    ja: {
      "dictionary.name": "辞書",
      "dictionary.command.lookup": "単語・漢字を引く",
      "dictionary.dialog.title": "日本語辞書",
      "dictionary.dialog.placeholder": "単語・かな・漢字を検索…",
      "dictionary.dialog.loading": "検索中…",
      "dictionary.dialog.hint": "内蔵の JMdict（共通語彙）・国語辞典・KANIDIC・KanjiVG 筆順（すべてオフライン）。",
      "dictionary.section.jmdict": "JMdict（日英対訳）",
      "dictionary.section.kokugo": "国語辞典（日本語で説明）",
      "dictionary.context.lookup": "辞書で引く",
      "dictionary.action.read": "読み上げ",
      "dictionary.action.replay": "筆順を再生",
      "dictionary.label.on": "音読み",
      "dictionary.label.kun": "訓読み",
      "dictionary.label.grade": "学年",
      "dictionary.label.strokes": "画数",
      "dictionary.note.noVoice": "日本語のシステム音声がないため、読み上げは使えません。",
    },
  },
  setup(ctx) {
    const rpc = ctx.client.rpc(DictionaryRpc) as unknown as RpcLike

    const [open, setOpen] = createSignal(false)
    const [query, setQuery] = createSignal("")
    const [result, setResult] = createSignal<LookupResult | null>(null)
    const [busy, setBusy] = createSignal(false)

    const showDialog = (initial = "") => {
      setQuery(initial)
      setOpen(true)
      if (initial) void runLookup(initial)
    }

    let debounce: ReturnType<typeof setTimeout> | undefined
    const search = (value: string) => {
      setQuery(value)
      if (debounce) clearTimeout(debounce)
      if (!value.trim()) {
        setResult(null)
        return
      }
      debounce = setTimeout(() => void runLookup(value), 220)
    }

    const runLookup = async (value: string) => {
      setBusy(true)
      try {
        const found = (await rpc.lookup({ query: value })) as LookupResult
        if (query() === value) setResult(found)
      } catch {
        if (query() === value) setResult({ words: [], kokugo: [], kanji: [], note: "dictionary RPC unavailable" })
      } finally {
        setBusy(false)
      }
    }

    onCleanup(() => {
      if (debounce) clearTimeout(debounce)
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
    })

    // ---------- contributions ----------
    ctx.add(Command, {
      id: "dictionary.lookup",
      get title() {
        return ctx.t("dictionary.command.lookup")
      },
      keywords: "dictionary japanese kanji jmdict 辞書",
      run: () => showDialog(query()),
    })

    ctx.add(Slot, {
      at: "session.header",
      order: 36,
      render: (props: HeaderProps) => (
        <Show when={props.active}>
          <button
            type="button"
            title={ctx.t("dictionary.command.lookup")}
            aria-label={ctx.t("dictionary.command.lookup")}
            onClick={() => showDialog("")}
            style={{
              display: "inline-flex",
              "align-items": "center",
              "justify-content": "center",
              height: "24px",
              padding: "0 6px",
              background: "transparent",
              border: "none",
              "border-radius": "4px",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <span innerHTML={BOOK_ICON} />
          </button>
        </Show>
      ),
    })

    ctx.add(Slot, {
      at: "window.bottom",
      render: () => (
        <>
          <SelectionMenu onLookup={(text) => showDialog(text)} />
          <Show when={open()}>
            <Dialog
              query={query()}
              busy={busy()}
              result={result()}
              onQuery={search}
              onClose={() => setOpen(false)}
            />
          </Show>
        </>
      ),
    })

    // ---------- selection right-click ----------
    function SelectionMenu(props: { onLookup: (text: string) => void }): JSX.Element {
      const [menu, setMenu] = createSignal<{ x: number; y: number; text: string } | null>(null)
      let el: HTMLDivElement | undefined
      const close = () => setMenu(null)

      const onContextMenu = (event: MouseEvent) => {
        if (event.defaultPrevented) return
        if (el && event.target instanceof Node && el.contains(event.target)) return
        // Message bodies and the read-only preview editor count; the composer
        // (which has its own menu from the spellcheck plugin) is skipped here.
        const fromPanel = event.target instanceof Element && event.target.closest("#review-panel") != null
        let inMessage = false
        let inEditor = false
        for (const node of event.composedPath()) {
          if (!(node instanceof Element)) continue
          if (!inMessage && node.hasAttribute("data-message-id")) inMessage = true
          if (!inEditor && (node.tagName === "TEXTAREA" || node.tagName === "INPUT")) inEditor = true
          if (!inEditor && !fromPanel && node instanceof HTMLElement && node.isContentEditable) inEditor = true
          if (inMessage && inEditor) break
        }
        if ((!inMessage && !fromPanel) || inEditor) return
        const text = window.getSelection()?.toString().trim() ?? ""
        if (!text) return
        event.preventDefault()
        event.stopPropagation()
        setMenu({
          x: Math.max(4, Math.min(event.clientX, window.innerWidth - 280)),
          y: Math.max(4, Math.min(event.clientY, window.innerHeight - 100)),
          text,
        })
      }

      const onPointerDown = (event: PointerEvent) => {
        if (menu() && el && event.target instanceof Node && !el.contains(event.target)) close()
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (menu() && event.key === "Escape") close()
      }
      window.addEventListener("contextmenu", onContextMenu, true)
      window.addEventListener("pointerdown", onPointerDown, true)
      window.addEventListener("keydown", onKeyDown, true)
      window.addEventListener("scroll", close, true)
      window.addEventListener("blur", close)
      onCleanup(() => {
        window.removeEventListener("contextmenu", onContextMenu, true)
        window.removeEventListener("pointerdown", onPointerDown, true)
        window.removeEventListener("keydown", onKeyDown, true)
        window.removeEventListener("scroll", close, true)
        window.removeEventListener("blur", close)
      })

      return (
        <Show when={menu()}>
          {(entry) => {
            const p = palette()
            // Only single words look up well; trim long selections to the first token.
            const word = () => {
              const raw = entry().text.replace(/\s+/g, "")
              return raw.length > 24 ? raw.slice(0, 24) : raw
            }
            return (
              <Portal mount={document.body}>
                <div
                  ref={el}
                  role="menu"
                  style={{
                    position: "fixed",
                    left: `${entry().x}px`,
                    top: `${entry().y}px`,
                    "z-index": "2147483647",
                    "min-width": "180px",
                    background: p.background,
                    color: p.color,
                    border: p.border,
                    "border-radius": "8px",
                    padding: "4px",
                    "box-shadow": "0 10px 28px rgba(0,0,0,0.45)",
                    "font-size": "13px",
                    "font-family": "system-ui, sans-serif",
                    "user-select": "none",
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <div
                    role="menuitem"
                    style={{ padding: "6px 10px", "border-radius": "6px", cursor: "pointer" }}
                    onMouseEnter={(event) => (event.currentTarget.style.background = p.hover)}
                    onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                    onClick={() => {
                      const text = word()
                      close()
                      props.onLookup(text)
                    }}
                  >
                    {ctx.t("dictionary.context.lookup")}「{word()}」
                  </div>
                </div>
              </Portal>
            )
          }}
        </Show>
      )
    }

    // ---------- dialog ----------
    function Dialog(props: {
      query: string
      busy: boolean
      result: LookupResult | null
      onQuery: (value: string) => void
      onClose: () => void
    }): JSX.Element {
      const p = palette()
      let input: HTMLInputElement | undefined
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") props.onClose()
      }
      window.addEventListener("keydown", onKeyDown, true)
      onCleanup(() => window.removeEventListener("keydown", onKeyDown, true))
      queueMicrotask(() => input?.focus())

      return (
        <Portal mount={document.body}>
          <div
            onClick={props.onClose}
            style={{
              position: "fixed",
              inset: "0",
              "z-index": "2147483646",
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              "align-items": "flex-start",
              "justify-content": "center",
              "padding-top": "8vh",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(640px, 92vw)",
                "max-height": "76vh",
                overflow: "auto",
                background: p.background,
                color: p.color,
                border: p.border,
                "border-radius": "12px",
                "box-shadow": "0 18px 50px rgba(0,0,0,0.5)",
                "font-family": "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', system-ui, sans-serif",
                "font-size": "13px",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "12px 14px 8px" }}>
                <span style={{ "font-weight": "600" }}>{ctx.t("dictionary.dialog.title")}</span>
                <span style={{ flex: "1" }} />
                <button
                  type="button"
                  aria-label="close"
                  onClick={props.onClose}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    "font-size": "16px",
                    padding: "2px 6px",
                    "border-radius": "6px",
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ padding: "0 14px 10px" }}>
                <input
                  ref={input}
                  class="oc-dict-input"
                  value={props.query}
                  placeholder={ctx.t("dictionary.dialog.placeholder")}
                  onInput={(event) => props.onQuery(event.currentTarget.value)}
                  style={{
                    width: "100%",
                    "box-sizing": "border-box",
                    padding: "8px 10px",
                    "border-radius": "8px",
                    border: p.border,
                    background: p.card,
                    color: p.color,
                    "font-size": "14px",
                  }}
                />
                <div style={{ padding: "6px 2px 0", opacity: "0.6" }}>
                  {props.busy ? ctx.t("dictionary.dialog.loading") : ctx.t("dictionary.dialog.hint")}
                </div>
              </div>
              <Show when={props.result?.note}>
                <div style={{ padding: "4px 14px 10px", color: p.accent }}>{props.result?.note}</div>
              </Show>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: "0 14px 14px" }}>
                <For each={props.result?.kanji ?? []}>{(entry) => <KanjiCard entry={entry} />}</For>
                {(() => {
                  const words = () => props.result?.words ?? []
                  const kokugo = () => props.result?.kokugo ?? []
                  // when both dictionaries matched, cap each section so the dialog stays scannable
                  const split = () => words().length > 0 && kokugo().length > 0
                  const sectionLabel = (text: string) => (
                    <div style={{ "padding-top": "4px", "font-size": "11px", "font-weight": "600", opacity: "0.55" }}>
                      {text}
                    </div>
                  )
                  return (
                    <>
                      <Show when={words().length > 0}>{sectionLabel(ctx.t("dictionary.section.jmdict"))}</Show>
                      <For each={split() ? words().slice(0, 6) : words()}>
                        {(entry) => <WordCard entry={entry} />}
                      </For>
                      <Show when={kokugo().length > 0}>{sectionLabel(ctx.t("dictionary.section.kokugo"))}</Show>
                      <For each={split() ? kokugo().slice(0, 8) : kokugo()}>
                        {(entry) => <WordCard entry={entry} />}
                      </For>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        </Portal>
      )
    }

    function WordCard(props: { entry: WordEntry }): JSX.Element {
      const p = palette()
      return (
        <div style={{ background: p.card, "border-radius": "10px", padding: "10px 12px" }}>
          <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "flex-wrap": "wrap" }}>
            <span style={{ "font-size": "17px", "font-weight": "600" }}>{props.entry.surface}</span>
            <Show when={props.entry.reading !== props.entry.surface}>
              <span style={{ color: p.accent }}>{props.entry.reading}</span>
            </Show>
            <Show when={props.entry.pos}>
              <span style={{ "font-size": "11px", opacity: "0.6" }}>{props.entry.pos}</span>
            </Show>
            <span style={{ flex: "1" }} />
            <button
              type="button"
              title={ctx.t("dictionary.action.read")}
              aria-label={ctx.t("dictionary.action.read")}
              onClick={() => void speakJa(props.entry.reading || props.entry.surface)}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                "font-size": "13px",
                padding: "2px 6px",
                "border-radius": "6px",
              }}
            >
              🔈
            </button>
          </div>
          <div style={{ "padding-top": "4px", "white-space": "pre-wrap" }}>{props.entry.gloss}</div>
        </div>
      )
    }

    function KanjiCard(props: { entry: KanjiEntry }): JSX.Element {
      const p = palette()
      const [svg, setSvg] = createSignal<string | null>(null)
      let svgHost: HTMLDivElement | undefined
      let playToken = 0

      // Draw strokes in order with a CSS dash animation; each path's delay is
      // its index so the character writes itself stroke by stroke.
      const play = () => {
        const host = svgHost
        if (!host) return
        const paths = host.querySelectorAll("path")
        paths.forEach((path, index) => (path as SVGPathElement).style.setProperty("animation-delay", `${index * 0.55}s`))
        const root = host.querySelector("svg")
        if (!root) return
        root.classList.remove("oc-dict-play")
        void root.getBoundingClientRect()
        root.classList.add("oc-dict-play")
      }

      const replay = () => {
        const token = ++playToken
        void (async () => {
          try {
            const stroke = (await rpc.stroke({ char: props.entry.char })) as StrokeResult
            if (token !== playToken) return
            setSvg(stroke.svg ?? null)
            queueMicrotask(() => setTimeout(play, 0))
          } catch {
            /* leave the static card */
          }
        })()
      }

      return (
        <div style={{ background: p.card, "border-radius": "10px", padding: "10px 12px", display: "flex", gap: "14px" }}>
          <div
            onClick={replay}
            title={ctx.t("dictionary.action.replay")}
            style={{ cursor: "pointer", flex: "none" }}
          >
            <Show
              when={svg()}
              fallback={
                <div style={{ width: "84px", height: "84px", "font-size": "64px", "line-height": "84px", "text-align": "center" }}>
                  {props.entry.char}
                </div>
              }
            >
              <div ref={svgHost} style={{ width: "84px", height: "84px" }} innerHTML={svg() ?? ""} />
            </Show>
          </div>
          <div style={{ "min-width": "0", flex: "1" }}>
            <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "flex-wrap": "wrap" }}>
              <span style={{ "font-size": "17px", "font-weight": "600" }}>{props.entry.char}</span>
              <Show when={(props.entry.grade ?? 0) > 0}>
                <span style={{ "font-size": "11px", opacity: "0.6" }}>
                  {ctx.t("dictionary.label.grade")} {props.entry.grade}
                </span>
              </Show>
              <Show when={(props.entry.strokes ?? 0) > 0}>
                <span style={{ "font-size": "11px", opacity: "0.6" }}>
                  {ctx.t("dictionary.label.strokes")} {props.entry.strokes}
                </span>
              </Show>
              <span style={{ flex: "1" }} />
              <button
                type="button"
                title={ctx.t("dictionary.action.read")}
                aria-label={ctx.t("dictionary.action.read")}
                onClick={() => void speakJa(props.entry.char)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  "font-size": "13px",
                  padding: "2px 6px",
                  "border-radius": "6px",
                }}
              >
                🔈
              </button>
            </div>
            <Show when={(props.entry.on ?? []).length > 0}>
              <div style={{ "padding-top": "4px" }}>
                <span style={{ opacity: "0.6" }}>{ctx.t("dictionary.label.on")}: </span>
                {(props.entry.on ?? []).join("、")}
              </div>
            </Show>
            <Show when={(props.entry.kun ?? []).length > 0}>
              <div style={{ "padding-top": "2px" }}>
                <span style={{ opacity: "0.6" }}>{ctx.t("dictionary.label.kun")}: </span>
                {(props.entry.kun ?? []).join("、")}
              </div>
            </Show>
            <Show when={(props.entry.meanings ?? []).length > 0}>
              <div style={{ "padding-top": "2px", "white-space": "pre-wrap" }}>{(props.entry.meanings ?? []).join(" / ")}</div>
            </Show>
            <div style={{ "padding-top": "4px", "font-size": "11px", opacity: "0.5" }}>{ctx.t("dictionary.action.replay")} ▸</div>
          </div>
        </div>
      )
    }
  },
})
