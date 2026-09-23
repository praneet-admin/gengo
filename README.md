# Gengo

**Live app:** https://praneet-admin.github.io/gengo/ · **Source:** https://github.com/praneet-admin/gengo

**Gengo** (from the Japanese 言語, "language") is a single-page vocabulary trainer for English learners. It helps you discover useful words, hear and say them, translate them, read them in real context, save them, and test yourself through short daily sessions built around quizzes, a five-minute focus timer, XP, daily goals, and streaks.

> Note: the flashcard Review / spaced-repetition section from the original brief was removed at the author's request. Saved words live in **My Words** and feed the quiz.

Everything runs in the browser with plain HTML, CSS, and vanilla JavaScript. There is no framework, build step, backend, database, or account.

---

## Main features

| Feature | What it does |
| --- | --- |
| **Live word lookup** | Search any English word and see its phonetic spelling, part of speech, a clear definition, an example sentence, synonyms, antonyms, and a pronunciation clip. |
| **Translate** | Translate the word, its definition, its example, or your own text into Spanish, French, German, Italian, Portuguese, Hindi, Tamil, Japanese, or English via LibreTranslate. |
| **Speak** | Listen to the word, definition, example, or translation with your browser's own voice (choose Female (Karen) or Male (Daniel)), then read the text aloud and compare what the microphone heard with the target. |
| **Context** | Pull three short Wikipedia excerpts (title, description, excerpt, thumbnail, link) so you see the word used in real writing. |
| **Saved vocabulary** | Save words from the Learn card (+10 XP, once per word). **My Words** lists them with phonetics, part of speech, definition, example and save date, with filter, Listen, Remove and a confirmed Clear All. Saved words feed the quiz. |
| **Vocabulary quiz** | Definition shown, four shuffled words, one answer, instant feedback with an explanation. |
| **Focus Sprint** | A five-minute timer with start, pause, resume, reset; completing it awards 15 XP once. |
| **XP & levels** | 10 XP save · 5 XP correct quiz · 15 XP sprint. Level is derived from XP. |
| **Daily goal** | Three meaningful activities per day, shown as `n/3` with a progress bar and a one-time celebration. |
| **Streaks** | Consecutive local calendar days with activity; current and longest streak, a seven-day strip, and milestone messages at 3, 7, 14, 30, 60 and 100 days. |

---

## Assignment requirements

### Gets information from the internet
Three free, key-optional APIs are called with `fetch()`:

- **Free Dictionary API** — definitions, phonetics, parts of speech, examples, synonyms, antonyms, audio. The Wiktionary and Datamuse fallback requests are fired in parallel with it; if the primary doesn't answer within 3 seconds (it is blocked on some networks), Gengo uses **Wiktionary** (definition, part of speech, example) combined with **Datamuse** (IPA pronunciation, synonyms) and labels the result "via Wiktionary + Datamuse".
- **Wikipedia REST search** — related articles for the "Learn in context" section.
- **LibreTranslate** — translations for the word, definition, example, or custom text. Because the public LibreTranslate server requires an API key, Gengo uses the free **MyMemory** translation API automatically whenever no LibreTranslate key or self-hosted server is configured (or when LibreTranslate fails), and labels the result "via MyMemory".

The primary dictionary gets 3 seconds, its fallbacks 7, and translation/Wikipedia 10; every request has independent loading, success, empty, not-found, offline, and error states. A failure in one API never blocks the others: if translation fails, dictionary and Wikipedia keep working; if Wikipedia fails, definitions and translation keep working; if the dictionary is unreachable, saved words can still be quizzed.

### Remembers information
All state lives in one versioned `localStorage` entry, `gengo-v1` (see below). `loadState()` merges whatever is stored with a default state object, so missing properties, invalid JSON, or a future schema change never crash the app. `saveState()` writes after every meaningful change, and `resetState()` restores defaults.

### Reacts to time passing
- **Focus Sprint** stores an absolute end timestamp; on reload the remaining time is recomputed from the clock, and a sprint that ended while the tab was closed shows as complete (with the reward paid exactly once).
- **Streaks and daily goal** are computed from local calendar dates (`YYYY-MM-DD` keys), not 24-hour differences. Progress resets on a new day while activity history is kept; a one-second tick detects midnight rollover.

---

## External APIs and voice features

| API | Endpoint | Key |
| --- | --- | --- |
| Free Dictionary API (primary) | `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` | none |
| Wiktionary (fallback) | `https://en.wiktionary.org/api/rest_v1/page/definition/{word}` | none |
| Datamuse (fallback) | `https://api.datamuse.com/words?sp={word}&md=dpr&ipa=1` and `?rel_syn={word}` | none |
| Wikipedia REST search | `https://en.wikipedia.org/w/rest.php/v1/search/page?q={query}&limit=3` | none |
| MyMemory (translation) | `https://api.mymemory.translated.net/get?q={text}&langpair=en\|{lang}` | none (≈5,000 chars/day anonymous quota) |

**Translation.** Translation works out of the box through MyMemory (free, ≈5,000 characters/day anonymous quota) — no API key and no settings screen. The LibreTranslate client code remains in `app.js` for anyone who forks the project and wants to point it at their own server, but the app ships with no key and asks for none.

**Text-to-speech** uses `window.speechSynthesis`. Listen buttons sit beside the word, definition, example, and translated result. Dictionary audio is used for the word when available; otherwise the browser voice speaks it. You choose **Female · Karen** (default) or **Male · Daniel** — two clear built-in voices. On systems without them (Windows, Android) Gengo falls back to the best available voice of the same gender (Zira / David, Google US English / Google UK English Male…), and for other languages it picks a matching voice (Mónica, Amélie, Kyoko, Vani…), skipping novelty and compact voices. Speech plays at full volume with a natural rate. Switching the voice plays a short spoken preview ("Hi, I'm Samantha."), and the active English voice is shown under the switch. Some languages ship with a single system voice (e.g. Tamil → Vani, Hindi → Lekha, Japanese → Kyoko); Gengo tells you when Male and Female will therefore sound the same, and more voices can be installed from the operating system's accessibility settings. Speech never autoplays, any existing utterance is cancelled before a new one starts, and every Listen button doubles as Stop while playing.

**Speech recognition** uses `window.SpeechRecognition || window.webkitSpeechRecognition` (Chrome, Edge, Safari) first. Chromium browsers run that recogniser on Google's servers; if that fails (blocked network) or the API is missing, Gengo switches to an **on-device recogniser**: OpenAI's Whisper (`whisper-tiny.en`) running in WebAssembly via the `@huggingface/transformers` library, loaded at runtime from jsDelivr and the Hugging Face CDN (one-time ~10 MB download, then cached). Audio is captured with `MediaRecorder` into memory only, decoded to 16 kHz in the browser, transcribed locally, then discarded — nothing is saved or uploaded. This is the one external script the app loads, and only when needed. In **Speak → Speaking practice** you press the microphone (permission is requested only then), read the word or example aloud, and see the recognised text with simple feedback: *Excellent match*, *Almost there*, *Try once more*, or *No speech detected*. Comparison lower-cases both texts, strips punctuation, collapses whitespace, and computes word-level overlap — this is a rough match, **not** a pronunciation score, because the browser only returns recognised text. Audio is never recorded, stored, or uploaded by the app. Denied permission, missing hardware, silence, and network errors each show a clear message, recognition stops when you leave the section, and unsupported browsers see an explanation while all other features keep working.

---

## Visual identity

Gengo's "Electric Playground" look: deep indigo/violet as the brand colour, sunny yellow for rewards and progress, mint for correct answers, hot pink for errors, and a soft lavender dotted background. Typography is Nunito 800/900 (Google Fonts, rounded system fallback). The interface borrows the *patterns* that make game-like learning apps fun — a left icon rail that becomes a bottom tab bar on phones, chunky pressable buttons with a depth edge, a lesson-style quiz with a full-width feedback banner and Continue button, glossy progress bars — but every asset is original.

**Gen**, the mascot and logo, is Gengo's own purple bunny hugging a carrot that reads "Gengo" — the original artwork (`assets/bunny-*.png`, background removed) used for the favicon, header logo, mascot card, Learn empty state and the round-complete screen. It breathes while idle and reacts to what you do with whole-body motion: hops when you save a word, wobbles (and dims slightly) on a wrong answer, bounces repeatedly when you hit the daily goal or finish a sprint, and tilts thoughtfully while a lookup is running. Small bunnies and carrots drift in the background and mark the empty states. The speech bubble is decorative for assistive technology; the same information reaches screen readers through the hidden announcer and toasts.

Other micro-interactions: headwords reveal letter by letter; a "✓ Saved" stamp slams onto the card with ✦ sparkles; correct quiz options bounce and sparkle while wrong ones shake; options, saved words and Wikipedia cards pop in staggered; removed words slide away; floating "+XP" pops in the header; a **level-up** flash with confetti and a spinning level badge; a streak flame that lights at 1 day and glows at 7; a pulsing goal ring at 3/3; bouncing loading dots on Explore; wiggling suggestion chips; a glowing, ticking timer ring; a live waveform while the microphone records; translation columns sliding in from both sides; drifting pastel blobs in the background; toast icons that spin in; a logo that winks when clicked; shimmering milestone banners; and springy panel transitions. Animation also carries meaning: header numbers (XP, streak) count up rather than jump; the daily-goal bar shows moving stripes until it completes; the quiz keeps a **combo** badge that grows hotter with each consecutive correct answer and Gen comments when a streak of answers ends; the speaking exercise shows a colour meter filling to the match score; translations type themselves out with a caret; dictionary lookups show a shimmering skeleton of the card that is about to appear; toasts drain a progress bar for the time they stay; the timer ring gains an orbiting dotted track while running; the streak flame emits embers; and Gen's eyes follow the pointer while the word card tilts toward it. Language-learning motifs borrowed from popular reference designs (a Pinterest survey of language-app UI pins) and rebuilt with original assets: a **greeting rotator** in the header that flips through Hello · Hola · Bonjour · नमस्ते · வணக்கம் · こんにちは; a **learning path** in the Today card — three nodes on a track that light up and pop as you complete activities, ending in a star; a **big animated streak flame** with the day count inside it, plus tiny flames on active days in the week strip; **fanned language cards** in Translate that show each language's greeting and straighten when picked; a **lesson-style quiz round** — five questions tracked by a segmented progress bar, cards sliding in between questions, ending in a full-screen **"Round complete!"** celebration (Gen bouncing among sparkles, a big title, and three stat tiles for Total XP ⚡, accuracy 🎯 with a grade, and time ⏱ that pop in one after another and count up); and a **daily recap card** (also opened by tapping the goal pill) with a flame, streak count and four stat tiles — XP earned, words saved, quiz correct, sprints — that pop in and count up.

The interface itself is always gently alive: the header's indigo gradient slowly flows with a thin rainbow rule beneath it; the page choreographs its entrance (header drops in, nav items and cards rise in sequence); faint letters and marks (a, 言, ✦, あ…) drift up behind the content over pastel blobs; primary buttons get a periodic light sweep; the active navigation tab wears a slowly rotating gradient border; headings carry a flowing underline; the XP star twinkles; the timer ring has an idle orbiting track; today's tile in the week strip pulses; progress bars carry a travelling highlight; and the suggestion chips and Gen's bubble bob softly. All motion respects `prefers-reduced-motion` (ambient effects, blobs, confetti, waveform, skeleton shimmer and embers are disabled; counters and typewriters render instantly).

Every text/background pair in the interface — including dynamic states such as the wrong-answer banner, speech feedback chips, error cards and toasts — was measured against WCAG 2.1 AA (4.5:1 for body text, 3:1 for large text) with an in-browser audit and adjusted until it passed; the pink "danger" shades were darkened for that reason.

> The original brief specified a forest-green/lime palette; the current theme was changed at the author's request. Colours live in CSS custom properties at the top of `styles.css`, so swapping palettes is a token change.

## Focus Sprint: focus lock

A web page cannot stop someone switching tabs or apps, so the sprint makes leaving *cost* something instead:

- Starting a sprint opens a full-screen **focus screen** (and asks the browser for fullscreen where supported). Menus, shortcuts and the rest of the app are out of reach until the sprint ends, is paused, or is given up.
- Leaving is detected with `visibilitychange`, `window.blur` (debounced and confirmed with `document.hasFocus()`) and `fullscreenchange`. Leaving **pauses the timer and records a strike**; three strikes cancel the sprint with no XP. Closing the tab while running triggers the browser's leave-page prompt.
- The screen is productive: a **flashcard drill** cycles through the learner's saved words (shuffled; falls back to the current word). Tap/Space flips word ↔ meaning, "Got it" moves on, "Again" puts the card back in the deck. Cards reviewed are reported when the sprint completes.
- Strikes and the lock survive a reload (stored in `timer.locked` / `timer.strikes` under `gengo-v1`); the drill deck is rebuilt on a fresh start.

### Why do a sprint? (mastery & Streak Shields)

- **Word mastery (★★★)** is earned *only* inside a Focus Sprint: each "Got it" on a word's flashcard raises its mastery by one (one step per word per sprint; "Again" lowers it). Three stars = mastered, shown in My Words and on the card during the drill. Each "Got it" also pays +2 XP (capped at 20 XP per sprint).
- **Streak Shield 🛡**: finishing a sprint banks a shield (max 2). If a day is missed, a shield is spent automatically on the next visit to cover that day, so the streak survives. Shielded days show a 🛡 in the week strip; shields are shown on the Today card.
- Stored under `gengo-v1`: `words[].mastery` (0–3), `shields`, `shieldDays`.

## Accessibility

Built so that people with disabilities can use every feature, not just look at it.

**Blind and low-vision users (screen readers)**
- Landmarks (`header`, `nav`, `main`, `aside`), one `h1`, ordered headings, a skip link, and the ARIA tab pattern (roving `tabindex`, arrow keys) for the section switcher. Every tab, button and answer option has an explicit accessible name ("Option B: resilient", "Remove eloquent", "Listen to curious").
- A dedicated hidden **announcer** speaks what matters without reading whole cards: section changes ("Quiz section"), lookup results ("Found resilient, adjective. Able to… Press Save Word to keep it"), quiz outcomes, round and daily-recap summaries, timer minutes and completion. Decorative layers — background shapes, confetti, sparkles, the mascot and its rotating greeting — are hidden from assistive tech.
- Text scales with the browser and with the in-app **Text size** button (100 / 115 / 130 %), and the layout reflows without horizontal scrolling at 320 px and at 200 % zoom.

**Keyboard-only and motor-impaired users**
- Everything is reachable and operable with Tab / Enter / Space / arrows, with a strong focus ring; dialogs trap focus, close on Escape and return focus.
- Single-key shortcuts (list under the ⌨ button or by pressing `?`): `Alt+1…6` jump between sections, `/` focuses search, `1–4` / `A–D` answer a quiz question, `Enter` continues, `L` plays the current word, `Esc` stops audio or listening.
- Touch targets are ≥ 44 px on touch devices; nothing depends on hover or on precise drags.

**Deaf and hard-of-hearing users**
- Every spoken or recorded sound has an on-screen text equivalent (word, phonetics, definition, example, translation); speaking practice shows the recognised text and a visual match meter, and a typed alternative exists for every voice feature.

**Dyslexic and cognitive-accessibility needs**
- **Easy-read** mode: plain sans-serif, wider letter/word spacing, taller lines, no italics, left-aligned text, larger buttons and toasts that stay twice as long. Language is short and plain; layout and navigation never change between sections.

**Works the same on macOS and Windows**
- Shortcuts use physical key codes, so `Option+1…6` on a Mac (which normally types ¡™£…) and `Alt+1…6` on Windows both work; the shortcut list shows the right modifier for your OS.
- Voice pills show the voice your device will actually use — Karen / Daniel on macOS, Zira / David or Edge's natural Aria / Guy voices on Windows — and the help text points to the right settings screen for adding voices or unblocking the microphone.
- Windows **High Contrast (forced-colors) mode** is supported: borders, focus outlines, selected states and progress fills are redrawn with system colours (`ButtonText`, `Highlight`) so nothing disappears when backgrounds are removed.
- Tested with the accessibility tree and axe on both Chromium and Chrome; font stacks fall back to Segoe UI / Verdana on Windows and SF / Avenir on macOS.

**Colour and motion**
- All text meets WCAG 2.1 AA contrast (verified with axe-core on every panel and dialog state, at phone and desktop widths, once animations have settled); state is never conveyed by colour alone (✓/✕, labels).
- Motion honours `prefers-reduced-motion` and can be switched off in-app on desktop; `prefers-contrast: more` and an in-app high-contrast mode are supported. On phones and tablets the in-app display toggles are hidden — the app follows the device's own accessibility settings (text size, reduce motion, contrast) instead.

## Layout & responsiveness

- **≥ 1101 px (desktop):** sticky header, sticky left icon rail (labels shown ≥ 1181 px, icons only below), main workspace, 330 px sidebar. Speak shows Listening and Speaking practice side by side from 1500 px, stacked below that.
- **≤ 1100 px (tablets and phones):** single column with a sticky one-row header (logo, current section, streak/XP/goal, **☰ menu**). The six sections live in a slide-in drawer opened from ☰ — it closes on selection, Escape, backdrop tap or the ✕, and returns focus to the menu button. Sidebar cards stack (three across on landscape tablets, two on portrait, one on phones); word rows, language cards and Listen buttons collapse to fewer columns; touch targets grow to ≥ 44 px; decorative background shapes are hidden.
- No horizontal scrolling or overflowing elements at any width: every section was scanned automatically at 320, 360, 375, 390, 412, 430, 540, 600, 768, 820, 912, 1024, 1180, 1280 and 1456 px (iPhone SE through iPad Pro and laptops).

## Browser support

Tested in Chromium (the desktop app's built-in browser) and Google Chrome 153 on macOS; the code avoids features that would break elsewhere:

| Feature | Chrome / Edge | Safari | Firefox |
| --- | --- | --- | --- |
| Core app (lookup, translate, quiz, words, timer, storage) | ✅ | ✅ | ✅ |
| Text-to-speech (Karen / Daniel on macOS; best same-gender voice elsewhere) | ✅ | ✅ | ✅ |
| Built-in speech recognition | ✅ (needs Google's servers) | ✅ (Apple's servers) | ✗ → on-device Whisper is used automatically |
| On-device Whisper recognition (WebAssembly) | ✅ | ✅ 16+ | ✅ |
| `<dialog>` recap / round / confirm | ✅ | ✅ 15.4+ (older browsers get an in-page fallback) | ✅ 98+ |
| Rotating gradient tab border (`@property`) | ✅ | ✅ | ✅ 128+ (static border earlier) |

Selected-state styling has a class-based fallback for browsers without `:has()`, and Gen's expressions use swapped SVG paths rather than the CSS `d` property, which Safari lacks.

## Browser storage

Key: **`gengo-v1`** — a single JSON object:

- `words[]` — each saved word: `id, word, phonetic, partOfSpeech, definition, example, audio, synonyms, antonyms, source, savedAt`
- `rewardedWords[]` — words that already earned their save XP (removing and re-saving a word never pays twice)
- `xp` — total XP (level is derived, never stored)
- `activity` — `{ 'YYYY-MM-DD': count }` daily activity history (drives streaks and the daily goal)
- `dailyGoal`, `goalCelebratedOn` — goal size and the date the celebration last fired
- `lastSearch` — the last successful dictionary result, restored after refresh
- `quiz.lastWordId` — prevents the same question twice in a row
- `today` — `{ date, xp, saves, quiz, sprints }` counters for the daily recap card, reset on a new local date
- `timer` — `endsAt, remainingMs, running, completed, rewardClaimed`
- `translate` — `serverUrl, rememberKey, apiKey` (key only when opted in)
- `prefs` — active section, voice gender, translation target language, practice target, speech engine, reduce-motion / high-contrast / text-size / easy-read display settings

---

## Running locally

Open `index.html` directly in a modern browser — that's it.

Some browsers restrict microphone access or `dialog` behaviour on `file://` URLs, so a static server is recommended:

```bash
cd gengo && python3 -m http.server 8080
```

then visit `http://localhost:8080`. Any static server (`npx serve`, VS Code Live Server, etc.) works the same.

To reset all progress, run `Gengo.resetState()` in the browser console.

---

### Seeing an old version?

Browsers cache `index.html` aggressively when it is served by a simple static server. If a change doesn't appear — for example the bottom tab bar missing in a phone emulator — hard-refresh once (**⌘⇧R** on Mac, **Ctrl+F5** on Windows) or open the page with a query string such as `index.html?fresh=1`.

## Project structure

```
gengo/
├── index.html   Semantic structure: header, tablist navigation, six panels, sidebar, toast region, confirm dialog, favicon
├── styles.css   Design tokens, icon-rail / hamburger-drawer navigation, pressable "depth" buttons, lesson-style quiz, components, states, animations, focus styles, reduced-motion support
├── app.js       State & storage, date utilities, streak/goal logic, the three API clients, speech synthesis & recognition,
│                rendering for each section, quiz generation, timer, navigation, toasts, init
└── README.md    This file
```

`app.js` is one IIFE split into numbered sections so each concern (storage, dictionary, translate, speech, quiz, timer…) lives in a small group of named functions. All API text is inserted with `textContent`, never `innerHTML`.

---

## Limitations

- Dictionary coverage, examples, synonyms, antonyms, and audio depend on the Free Dictionary API; not every word has all of them. Some networks block that host — Gengo then falls back to Wiktionary + Datamuse, which provide no audio or antonyms and fewer examples.
- The public LibreTranslate server requires an API key, so translation defaults to MyMemory, which has a daily anonymous quota and occasionally leaves rare words untranslated.
- Wikipedia results are keyword matches and may be tangential for very common words.
- Built-in speech recognition exists only in browsers that implement the Web Speech API (Chrome, Edge, Safari), and Chromium browsers send audio to Google's servers, so on networks that block Google it fails; in both cases Gengo falls back to Whisper running locally in WebAssembly (needs a one-time ~10 MB download from jsDelivr/Hugging Face and a device fast enough to run it — a few seconds per clip) and also offers a type-what-you-hear exercise. The match feedback is a word-overlap heuristic, not pronunciation scoring.
- Progress lives only in the current browser profile. Clearing site data removes it, and there is no account sync.
- Streaks are based on the device's local clock and calendar.
