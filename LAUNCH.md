# Gengo launch note

*25 September 2026 · budget: ₹0 · team: one person and a purple rabbit*

## Who it is for

**Final-year students in India preparing for campus placements** — the verbal-ability section of aptitude tests and the HR/communication rounds — who today google a word, read one definition, and have lost it by the weekend.

Explicitly **not** for: children (no parental layer, quiz assumes dictionary-level reading), absolute beginners in English (the app is in English; translation is a helper, not a teacher), IELTS/TOEFL band-chasers who need graded word lists and timed essays, and teachers looking for a classroom dashboard.

## What that person does today without Gengo

Googles the word → reads the first result → maybe screenshots it → moves on. Some keep a "vocab" note they never reopen; some installed a flashcard app in February. Nothing in that loop tests them, speaks the word, or notices when they stop.

## Jobs I picked (and what I built)

Everything below keeps working while nobody is standing next to it.

### 1. Marketing — get people to hear about it
| What | Where | Why it works unattended |
|---|---|---|
| **Link previews** — Open Graph / Twitter meta + a 1200×630 card (Gen, "Learn English words that actually stick", Free · No account) | `index.html`, `assets/og-image.png` | Every share on WhatsApp, LinkedIn, X, Slack unfurls into a rabbit card instead of a bare URL. WhatsApp college groups are where this audience lives. |
| **"Share" button on the Today card** — one tap sends *"I'm on a 5-day streak learning English words with Gengo 🐰 (12 words saved, 85 XP). Free, no sign-up…"* via the phone's share sheet (clipboard on desktop) | `app.js shareStreak()` | The only growth loop that doesn't need me: a learner with a streak is the ad. |
| **Installable app** — web manifest + service worker (network-first, offline shell) | `manifest.webmanifest`, `sw.js` | Chrome/Safari offer "Add to Home Screen"; an icon on the phone beats a bookmark for daily return. |
| **Launch post kit** — WhatsApp group message, LinkedIn post, Reddit post (rules-compliant), X, Product Hunt tagline, faculty email | `launch/posts.md` | Copy that anyone (me, a friend, a junior) can paste without asking. |
| **Launch blog** | `launch/blog.txt` | The long-form "who/why/how" for LinkedIn articles, Dev.to, college newsletters. |
| **Promo video** | `docs/gengo-promo.mp4` | 1:42, narrated, for the LinkedIn post and any college WhatsApp group. |

### 2. Support — help the people who get stuck, and the ones who complain
| What | Where | Why it works unattended |
|---|---|---|
| **In-app Help** — instructions dialog, guided tour, shortcuts, FAQ | app (Help button / ☰ → How to use Gengo), `GUIDE.md §17` | Answers the top ten questions (mic, voices, quota, quiz locked, old version, offline) before anyone writes in. |
| **Report a problem** — button in Help opens a GitHub issue with app version, browser, viewport, section, speech support and settings pre-filled | `app.js reportProblem()` | The learner only describes what happened; I get a reproducible report without a back-and-forth. |
| **Issue forms** — 🐛 bug, 💡 idea, plus a "read the FAQ first" link | `.github/ISSUE_TEMPLATE/` | Structured, labelled, triage-able from a phone. |
| **SUPPORT.md** — self-serve → async (48 h weekdays) → complaints read first, with an honest "what we don't do" | `SUPPORT.md` | Sets expectations so silence never reads as neglect. |

### 3. Pricing — decide what it costs
**Free, forever, no tiers.** Two reasons, stated in the blog: (1) it costs nothing to run — no server, no accounts, free public APIs, GitHub Pages hosting — so there is nothing to bill for; (2) the audience is three months away from their first salary; a vocabulary app that charges them is solving the wrong problem. Being free is also what makes the Reddit/WhatsApp posts acceptable under self-promotion rules.

## Jobs I dropped, and why

- **Sales** — there is nothing to buy and no enterprise version; "getting one person to say yes" here means one student opening the link, which Marketing already covers.
- **Public relations** — no story a journalist needs yet (no users, no numbers). The blog and video are the PR kit for the day there is one.
- **Partners** — the right partner is a college communication-skills faculty who assigns it to a batch. The email is drafted in `launch/posts.md`, but a partnership needs a human to follow up, and this launch had to run unattended.
- **Marketplace** — Gengo isn't in an app store by design (no build, no account, no review cycle). The PWA manifest gets it the "install" behaviour without a store; PWA directories are a later, manual submission.
- **Community** — a Discord/Discussions space with zero members is a liability, not a community. GitHub Issues is the conversation for now; the Share loop is how the first hundred users find each other.

## What "done" looks like in 30 days

Ten WhatsApp shares I didn't send myself, five GitHub issues from strangers, one faculty reply. If none of that happens, the audience statement above is wrong before the product is.
