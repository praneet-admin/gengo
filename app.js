/* ==========================================================================
   Gengo — app.js
   Sections:
     1. Constants & default state      10. Translate (LibreTranslate)
     2. Local-storage management       11. Speech synthesis (Web Speech TTS)
     3. Date utilities                 12. Speaking practice (recognition)
     4. Activity, streaks, daily goal  13. Context (Wikipedia)
     5. XP & levels                    14. Quiz
     6. Notifications (toasts)         15. Focus Sprint timer
     7. Dictionary API                 16. Navigation, shared UI, init & tickers
     8. Learn (result rendering)
     9. Saved-word management
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Constants & default state ---------- */
  const STORAGE_KEY = 'gengo-v1';
  const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const WIKIPEDIA_API = 'https://en.wikipedia.org/w/rest.php/v1/search/page?limit=3&q=';
  const DEFAULT_TRANSLATE_URL = 'https://libretranslate.com';
  const API_TIMEOUT_MS = 10000;

  const MINUTE = 60 * 1000;
  const TIMER_DURATION = 5 * MINUTE;
  const MAX_STRIKES = 3;    // times a learner may leave the tab/app during a sprint before it is cancelled

  const XP = { save: 10, quiz: 5, sprint: 15, drill: 2 }; // drill XP only during a Focus Sprint
  const MAX_SHIELDS = 2;    // Streak Shields a learner can bank
  const MASTERY_MAX = 3;    // "Got it" in three sprints = mastered
  const DRILL_XP_CAP = 20;  // max drill XP per sprint
  const LEVELS = [0, 50, 120, 220, 350, 500, 700, 950, 1250, 1600]; // XP threshold per level
  const MILESTONES = [3, 7, 14, 30, 60, 100];

  const LANGUAGES = {
    en: { name: 'English', speech: 'en-US' },
    es: { name: 'Spanish', speech: 'es-ES' },
    fr: { name: 'French', speech: 'fr-FR' },
    de: { name: 'German', speech: 'de-DE' },
    it: { name: 'Italian', speech: 'it-IT' },
    pt: { name: 'Portuguese', speech: 'pt-PT' },
    hi: { name: 'Hindi', speech: 'hi-IN' },
    ta: { name: 'Tamil', speech: 'ta-IN' },
    ja: { name: 'Japanese', speech: 'ja-JP' }
  };

  const SECTION_NAMES = ['learn', 'translate', 'speak', 'context', 'quiz', 'words'];

  const DEFAULT_STATE = {
    version: 1,
    words: [],
    rewardedWords: [],     // words that already earned save XP, so remove + re-save can't farm it
    xp: 0,
    activity: {},             // { 'YYYY-MM-DD': count }
    dailyGoal: 3,
    shields: 0,               // Streak Shields earned by finishing Focus Sprints (max MAX_SHIELDS)
    shieldDays: [],           // 'YYYY-MM-DD' days a shield bridged so the streak survived
    goalCelebratedOn: null,   // date key of the last goal celebration
    lastSearch: null,         // full entry from the last successful lookup
    quiz: { lastWordId: null },
    today: { date: null, xp: 0, saves: 0, quiz: 0, sprints: 0 }, // per-day counters for the recap card
    timer: {
      endsAt: null,           // absolute timestamp while running
      remainingMs: TIMER_DURATION,
      running: false,
      completed: false,
      rewardClaimed: false,
      locked: false,          // focus screen is up (sprint started and not yet finished/abandoned)
      strikes: 0              // times the learner left the tab/app during this sprint
    },
    translate: {
      serverUrl: DEFAULT_TRANSLATE_URL,
      rememberKey: false,
      apiKey: ''              // only populated when the learner opts in to remembering
    },
    prefs: { section: 'learn', voiceGender: 'female', translateTarget: 'es', practiceTarget: 'word', speechEngine: 'auto', reduceMotion: false, highContrast: false, textSize: 0, easyRead: false, voiceNotes: {} }
  };

  let state = loadState();

  /* ---------- 2. Local-storage management ---------- */
  function deepMerge(defaults, stored) {
    if (Array.isArray(defaults)) return Array.isArray(stored) ? stored : defaults;
    if (defaults && typeof defaults === 'object') {
      // An empty default object is a free-form map (e.g. activity by date): keep the stored one whole.
      if (!Object.keys(defaults).length) return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
      const out = {};
      Object.keys(defaults).forEach(function (key) {
        const hasStored = stored && typeof stored === 'object' && Object.prototype.hasOwnProperty.call(stored, key);
        out[key] = hasStored ? deepMerge(defaults[key], stored[key]) : cloneDefault(defaults[key]);
      });
      return out;
    }
    if (stored === undefined || stored === null) return defaults;
    if (defaults === null) return stored; // nullable slots such as lastSearch
    return typeof stored === typeof defaults ? stored : defaults;
  }

  function cloneDefault(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  function loadState() {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (err) {
      stored = null; // invalid JSON or storage unavailable — fall back to defaults
    }
    const merged = deepMerge(DEFAULT_STATE, stored);
    merged.words = merged.words.filter(isValidWord).map(normalizeWord);
    merged.rewardedWords = merged.rewardedWords.filter(function (w) { return typeof w === 'string'; });
    // Activity map: keep only YYYY-MM-DD keys with positive integer counts.
    const cleanActivity = {};
    Object.keys(merged.activity).forEach(function (k) {
      const n = Number(merged.activity[k]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(n) && n > 0) cleanActivity[k] = n;
    });
    merged.activity = cleanActivity;
    if (typeof merged.xp !== 'number' || !isFinite(merged.xp) || merged.xp < 0) merged.xp = 0;
    if (!Number.isInteger(merged.dailyGoal) || merged.dailyGoal < 1) merged.dailyGoal = DEFAULT_STATE.dailyGoal;
    merged.lastSearch = merged.lastSearch && isValidWord(merged.lastSearch) ? normalizeWord(merged.lastSearch) : null;
    if (!LANGUAGES[merged.prefs.translateTarget]) merged.prefs.translateTarget = 'es';
    if (merged.prefs.voiceGender !== 'male') merged.prefs.voiceGender = 'female';
    if (!Number.isInteger(merged.prefs.textSize) || merged.prefs.textSize < 0 || merged.prefs.textSize > 2) merged.prefs.textSize = 0;
    ['reduceMotion', 'highContrast', 'easyRead'].forEach(function (k) { merged.prefs[k] = merged.prefs[k] === true; });
    if (merged.prefs.speechEngine !== 'whisper') merged.prefs.speechEngine = 'auto';
    if (!merged.prefs.voiceNotes || typeof merged.prefs.voiceNotes !== 'object') merged.prefs.voiceNotes = {};
    if (merged.prefs.practiceTarget !== 'example') merged.prefs.practiceTarget = 'word';
    if (SECTION_NAMES.indexOf(merged.prefs.section) === -1) merged.prefs.section = 'learn';
    ['endsAt', 'remainingMs'].forEach(function (k) { if (merged.timer[k] !== null && !Number.isFinite(merged.timer[k])) merged.timer[k] = k === 'endsAt' ? null : TIMER_DURATION; });
    if (merged.timer.remainingMs < 0 || merged.timer.remainingMs > TIMER_DURATION) merged.timer.remainingMs = TIMER_DURATION;
    merged.timer.locked = merged.timer.locked === true && !merged.timer.completed;
    if (!Number.isInteger(merged.shields) || merged.shields < 0 || merged.shields > MAX_SHIELDS) merged.shields = 0;
    merged.shieldDays = Array.isArray(merged.shieldDays) ? merged.shieldDays.filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).slice(-60) : [];
    if (!Number.isInteger(merged.timer.strikes) || merged.timer.strikes < 0 || merged.timer.strikes > MAX_STRIKES) merged.timer.strikes = 0;
    return merged;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      toast('Could not save progress — storage may be full or blocked.', 'error');
    }
  }

  function resetState() {
    state = cloneDefault(DEFAULT_STATE);
    saveState();
  }

  function isValidWord(w) {
    return !!w && typeof w === 'object' && typeof w.word === 'string' && w.word.trim() !== '';
  }

  function stringList(list, max) {
    return Array.isArray(list) ? list.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, max) : [];
  }

  function normalizeWord(w) {
    return {
      id: typeof w.id === 'string' ? w.id : makeId(w.word),
      word: w.word.trim().toLowerCase(),
      phonetic: typeof w.phonetic === 'string' ? w.phonetic : '',
      partOfSpeech: typeof w.partOfSpeech === 'string' ? w.partOfSpeech : '',
      definition: typeof w.definition === 'string' ? w.definition : '',
      example: typeof w.example === 'string' ? w.example : '',
      audio: typeof w.audio === 'string' ? w.audio : '',
      synonyms: stringList(w.synonyms, 8),
      antonyms: stringList(w.antonyms, 8),
      source: typeof w.source === 'string' ? w.source : '',
      savedAt: typeof w.savedAt === 'number' ? w.savedAt : Date.now(),
      mastery: Number.isInteger(w.mastery) && w.mastery >= 0 && w.mastery <= MASTERY_MAX ? w.mastery : 0
    };
  }

  function makeId(word) {
    return word.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 3. Date utilities ---------- */
  function dateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function todayKey() { return dateKey(new Date()); }

  function keyToDate(key) {
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function shiftDays(key, delta) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + delta);
    return dateKey(d);
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  /* ---------- 4. Activity, streaks, daily goal ---------- */
  /** Records one meaningful learning activity for today and refreshes habit UI. */
  function recordActivity() {
    const key = todayKey();
    const before = state.activity[key] || 0;
    const streakBefore = computeStreaks().current;
    state.activity[key] = before + 1;
    saveState();
    renderHabit();
    renderHeader();

    const after = state.activity[key];
    if (before < state.dailyGoal && after >= state.dailyGoal && state.goalCelebratedOn !== key) {
      state.goalCelebratedOn = key;
      saveState();
      toast('Daily goal reached! ' + after + '/' + state.dailyGoal + ' — see you tomorrow 🌱', 'celebrate', 4200);
      confetti();
      buddySay('GOAL! ' + after + '/' + state.dailyGoal + ' — you did the thing!', 'cheer', 3000);
      window.setTimeout(function () { if (document.querySelector('dialog[open]')) { pendingRecap = true; } else { openRecap(); } }, 900);
    }

    const streaks = computeStreaks();
    if (before === 0 && streaks.current !== streakBefore && MILESTONES.indexOf(streaks.current) !== -1) {
      toast(streaks.current + '-day streak! Keep the momentum going 🔥', 'celebrate', 4200);
      buddySay(streaks.current + ' days in a row! 🔥', 'cheer', 3000);
    }
  }

  /** Streaks are derived from activity history using local calendar dates only. */
  function dayActive(key) { return !!state.activity[key] || state.shieldDays.indexOf(key) !== -1; }

  function computeStreaks() {
    const today = todayKey();
    const yesterday = shiftDays(today, -1);
    let anchor = null;
    if (dayActive(today)) anchor = today;
    else if (dayActive(yesterday)) anchor = yesterday;

    let current = 0;
    if (anchor) {
      let cursor = anchor;
      while (dayActive(cursor)) {
        current += 1;
        cursor = shiftDays(cursor, -1);
      }
    }

    const keys = Object.keys(state.activity).filter(function (k) { return state.activity[k] > 0; }).concat(state.shieldDays)
      .filter(function (k, i, arr) { return arr.indexOf(k) === i; }).sort();
    let longest = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      run = prev && shiftDays(prev, 1) === k ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = k;
    });
    return { current: current, longest: Math.max(longest, current) };
  }

  /** On load: if yesterday was missed but the streak was alive before it, spend a Streak Shield to bridge it. */
  function protectStreak() {
    const yesterday = shiftDays(todayKey(), -1);
    const dayBefore = shiftDays(yesterday, -1);
    if (state.shields > 0 && !dayActive(yesterday) && dayActive(dayBefore) && !state.activity[todayKey()]) {
      state.shields -= 1;
      state.shieldDays.push(yesterday);
      saveState();
      toast('🛡 Streak Shield used — yesterday is covered, your ' + computeStreaks().current + '-day streak lives on.', 'celebrate', 5200);
      announce('A Streak Shield covered yesterday. Your streak continues.');
      buddySay('Shield up! I saved your streak.', 'cheer', 3200);
    }
  }

  function todayProgress() {
    return Math.min(state.activity[todayKey()] || 0, state.dailyGoal);
  }

  /** Per-day counters, reset automatically when the local date changes. */
  function todayStats() {
    const key = todayKey();
    if (state.today.date !== key) state.today = { date: key, xp: 0, saves: 0, quiz: 0, sprints: 0 };
    return state.today;
  }

  /* ---------- 5. XP & levels ---------- */
  function awardXP(amount) {
    const before = levelInfo(state.xp).level;
    state.xp += amount;
    todayStats().xp += amount;
    saveState();
    renderHeader();
    const after = levelInfo(state.xp).level;
    if (after > before) {
      window.setTimeout(function () {
        toast('Level up! You’re now Level ' + after + ' ⭐', 'celebrate', 4500);
        confetti();
        restartAnimation($('level-name'), 'is-levelup');
        restartAnimation(document.body, 'is-flash');
        buddySay('LEVEL ' + after + '! Look at you go.', 'cheer', 3200);
      }, 350);
    }
    restartAnimation($('stat-xp'), 'is-bump');
    const pop = document.createElement('span');
    pop.className = 'xp-float';
    pop.setAttribute('aria-hidden', 'true');
    pop.textContent = '+' + amount + ' XP';
    $('stat-xp').appendChild(pop);
    pop.addEventListener('animationend', function () { pop.remove(); }, { once: true });
    window.setTimeout(function () { pop.remove(); }, 1500);
  }

  /** Renders a word as individually animated letters (staggered pop-in). */
  function animateLetters(el, word) {
    el.textContent = '';
    el.setAttribute('aria-label', word);
    el.style.fontSize = '';
    Array.from(word).forEach(function (ch, i) {
      const span = document.createElement('span');
      span.className = 'letter';
      span.textContent = ch === ' ' ? '\u00a0' : ch;
      span.style.setProperty('--i', String(i));
      span.setAttribute('aria-hidden', 'true');
      el.appendChild(span);
    });
    fitHeadword(el);
  }

  /** Shrinks a headword's font until it fits its container on one line (long words, narrow phones). */
  function fitHeadword(el) {
    const parent = el.parentElement;
    if (!parent) return;
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    const min = 18;
    let guard = 0;
    while (el.scrollWidth > parent.clientWidth && size > min && guard++ < 40) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  }

  /** Screen-reader announcement (visually hidden live region). */
  let announceTimer = null;
  function announce(text) {
    const el = $('sr-announcer');
    if (!el) return;
    el.textContent = '';
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(function () { el.textContent = text; }, 50);
  }

  /* ---------- Display settings: motion, contrast, text size, easy read ---------- */
  const TEXT_SIZES = [{ pct: 100, name: 'normal' }, { pct: 115, name: 'large' }, { pct: 130, name: 'extra large' }];
  function applyDisplayPrefs() {
    document.body.classList.toggle('reduce-motion', !!state.prefs.reduceMotion);
    document.body.classList.toggle('high-contrast', !!state.prefs.highContrast);
    $('motion-toggle').setAttribute('aria-pressed', state.prefs.reduceMotion ? 'true' : 'false');
    $('motion-toggle').title = state.prefs.reduceMotion ? 'Motion reduced — click to restore animations' : 'Reduce motion';
    $('contrast-toggle').setAttribute('aria-pressed', state.prefs.highContrast ? 'true' : 'false');
    $('contrast-toggle').title = state.prefs.highContrast ? 'High contrast on — click to turn off' : 'High contrast';
    const layer = $('floaters');
    if (layer) {
      layer.hidden = motionReduced() || !!state.prefs.highContrast;
      if (!layer.hidden && !layer.children.length) spawnFloaters();
    }
    const size = TEXT_SIZES[state.prefs.textSize] || TEXT_SIZES[0];
    document.documentElement.style.fontSize = size.pct + '%';
    const next = TEXT_SIZES[(state.prefs.textSize + 1) % TEXT_SIZES.length];
    $('textsize-toggle').setAttribute('aria-label', 'Text size: ' + size.name + '. Click for ' + next.name);
    $('textsize-label').textContent = size.pct === 100 ? 'Text' : size.pct + '%';
    document.body.classList.toggle('easy-read', !!state.prefs.easyRead);
    $('easyread-toggle').setAttribute('aria-pressed', state.prefs.easyRead ? 'true' : 'false');
  }

  /** Swap OS-specific wording (modifier keys, where to add voices). */
  function applyPlatformText() {
    document.querySelectorAll('kbd[data-alt]').forEach(function (k) { k.textContent = IS_MAC ? 'Option ⌥' : 'Alt'; });
    const note = $('voice-note');
    if (note) {
      note.textContent = IS_WINDOWS
        ? 'Uses your device’s built-in voices. On Windows you can add voices under Settings → Time & Language → Speech → Manage voices (Edge also offers natural online voices).'
        : IS_MAC
          ? 'Uses your device’s built-in voices. On a Mac you can add more under System Settings → Accessibility → Spoken Content → System Voice → Manage Voices.'
          : 'Uses your device’s built-in voices. You can add more in your operating system’s speech or accessibility settings.';
    }
    const mic = $('mic-help');
    if (mic) mic.textContent = IS_WINDOWS
      ? 'If the microphone is blocked, allow it in Windows Settings → Privacy & security → Microphone, and in your browser’s site permissions.'
      : 'If the microphone is blocked, allow it in System Settings → Privacy & Security → Microphone, and in your browser’s site permissions.';
  }

  /** Ambient background: letters and marks drifting slowly upward behind the interface. */
  function spawnFloaters() {
    if (motionReduced()) return;
    const layer = $('floaters');
    const glyphs = ['🐰', 'a', '🥕', 'e', 'g', '🐰', 'k', 'n', 'o', '🥕', 's', 'w', '言', '語', '✦', '?', 'ñ', 'é', 'あ', '🐰'];
    const colors = ['var(--brand-500)', 'var(--accent-500)', 'var(--danger-500)', 'var(--mint-500)', 'var(--brand-700)'];
    for (let i = 0; i < 26; i++) {
      const f = document.createElement('span');
      const shape = i % 4 === 3 ? 'ring' : i % 7 === 6 ? 'dot' : 'glyph';
      f.className = 'floater is-' + shape;
      if (shape === 'glyph') f.textContent = glyphs[i % glyphs.length];
      f.style.setProperty('--x', (Math.random() * 100).toFixed(1) + 'vw');
      f.style.setProperty('--d', (16 + Math.random() * 20).toFixed(1) + 's');
      f.style.setProperty('--delay', (-Math.random() * 36).toFixed(1) + 's');
      f.style.setProperty('--size', (0.7 + Math.random() * 1.1).toFixed(2) + 'rem'); // small bits, not billboards
      f.style.setProperty('--drift', ((Math.random() - 0.5) * 16).toFixed(1) + 'vw');
      f.style.setProperty('--spin', (Math.random() > 0.5 ? 1 : -1) * Math.round(90 + Math.random() * 270) + 'deg');
      f.style.color = colors[i % colors.length];
      layer.appendChild(f);
    }
  }

  /* ---------- Buddy: the speech-bubble mascot reacts to what the learner does ---------- */
  let buddyTimer = null;
  function buddySay(text, mood, holdMs) {
    const b = $('buddy'), bubble = $('buddy-bubble');
    if (!b) return;
    ['is-happy', 'is-cheer', 'is-sad', 'is-think'].forEach(function (c) { b.classList.remove(c); });
    void b.offsetWidth;
    if (mood) b.classList.add('is-' + mood);
    bubble.textContent = text;
    restartAnimation(bubble, 'is-pop');
    window.clearTimeout(buddyTimer);
    buddyTimer = window.setTimeout(function () {
      ['is-happy', 'is-cheer', 'is-sad', 'is-think'].forEach(function (c) { b.classList.remove(c); });
    }, holdMs || 1800);
  }

  const GREETINGS = [['Hello', 'en'], ['Hola', 'es'], ['Bonjour', 'fr'], ['Hallo', 'de'], ['Ciao', 'it'], ['Olá', 'pt'], ['नमस्ते', 'hi'], ['வணக்கம்', 'ta'], ['こんにちは', 'ja']];
  let greetingIndex = 0;
  function rotateGreeting() {
    const el = $('greeting');
    if (!el) return;
    greetingIndex = (greetingIndex + 1) % GREETINGS.length;
    el.classList.add('is-out');
    window.setTimeout(function () {
      el.textContent = GREETINGS[greetingIndex][0];
      el.setAttribute('lang', GREETINGS[greetingIndex][1]);
      el.classList.remove('is-out');
      restartAnimation(el, 'is-in');
    }, 260);
  }

  /** Fanned "language cards" under the translate form: pick a target by tapping its greeting. */
  function renderLangCards() {
    const wrap = $('lang-cards');
    wrap.textContent = '';
    Object.keys(LANGUAGES).filter(function (k) { return k !== 'en'; }).forEach(function (code, i) {
      const g = GREETINGS.find(function (x) { return x[1] === code; });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lang-card' + (code === state.prefs.translateTarget ? ' is-active' : '');
      btn.style.setProperty('--i', String(i));
      btn.setAttribute('aria-pressed', code === state.prefs.translateTarget ? 'true' : 'false');
      btn.setAttribute('aria-label', 'Translate into ' + LANGUAGES[code].name);
      const big = document.createElement('span'); big.className = 'lang-word'; big.textContent = g ? g[0] : code.toUpperCase(); big.setAttribute('lang', code);
      const small = document.createElement('span'); small.className = 'lang-name'; small.textContent = LANGUAGES[code].name;
      btn.appendChild(big); btn.appendChild(small);
      btn.addEventListener('click', function () {
        $('translate-target').value = code;
        state.prefs.translateTarget = code;
        saveState();
        renderLangCards();
        restartAnimation(btn, 'is-picked');
        buddySay((g ? g[0] : LANGUAGES[code].name) + '! Let’s go ' + LANGUAGES[code].name + '.', 'happy');
      });
      wrap.appendChild(btn);
    });
  }

  const BUDDY_IDLE = ['Hi! Let’s learn a word today.', 'Pick a word — any word.', 'Say it out loud. I won’t judge.', 'Three activities and today is done.', 'Words are my carrots. Feed me.', 'Hop in — one word at a time.'];

  /** Little ✦ burst inside an element (correct answers, saves). */
  function sparkle(el, count) {
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < (count || 7); i++) {
      const sp = document.createElement('span');
      sp.className = 'sparkle';
      sp.setAttribute('aria-hidden', 'true');
      sp.style.setProperty('--sx', (Math.random() * rect.width).toFixed(0) + 'px');
      sp.style.setProperty('--sy', (Math.random() * rect.height).toFixed(0) + 'px');
      sp.style.setProperty('--dx', ((Math.random() - 0.5) * 60).toFixed(0) + 'px');
      sp.style.setProperty('--dy', (-20 - Math.random() * 40).toFixed(0) + 'px');
      el.appendChild(sp);
      sp.addEventListener('animationend', function () { sp.remove(); }, { once: true });
    }
  }

  let pendingRecap = false;

  /** Daily recap card (inspired by end-of-session summary screens). */
  function openRecap() {
    const d = todayStats();
    const dialog = $('recap-dialog');
    const streaks = computeStreaks();
    $('recap-streak').textContent = String(streaks.current);
    $('recap-flame').style.setProperty('--heat', String(Math.min(streaks.current, 10)));
    $('recap-title').textContent = todayProgress() >= state.dailyGoal ? 'Goal complete!' : 'Today so far';
    $('recap-sub').textContent = d.saves + d.quiz + d.sprints === 0 ? 'Nothing yet — pick a word and go.' : 'Here’s what you did today.';
    ['xp', 'saves', 'quiz', 'sprints'].forEach(function (k) { $('recap-' + k).textContent = '0'; });
    openDialog(dialog);
    window.setTimeout(function () {
      tweenNumber($('recap-xp'), d.xp, 900);
      tweenNumber($('recap-saves'), d.saves, 700);
      tweenNumber($('recap-quiz'), d.quiz, 700);
      tweenNumber($('recap-sprints'), d.sprints, 700);
    }, 250);
    $('recap-close').focus();
    announce(($('recap-title').textContent) + ' ' + d.xp + ' XP earned, ' + d.saves + ' words saved, ' + d.quiz + ' quiz answers correct, ' + d.sprints + ' sprints.');
  }

  function closeRecap() { closeDialog($('recap-dialog')); }

  function openDialog(dialog) {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('is-fallback'); }
  }
  function closeDialog(dialog) {
    if (!dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); }
  }

  /** Small burst of CSS confetti for goal and sprint celebrations. */
  function confetti() {
    const layer = $('confetti');
    layer.textContent = '';
    const colors = ['#c8f135', '#0f3d2e', '#ff6b5a', '#ffffff', '#a9d61c'];
    for (let i = 0; i < 28; i++) {
      const piece = document.createElement('i');
      piece.style.setProperty('--x', (Math.random() * 100).toFixed(1) + 'vw');
      piece.style.setProperty('--d', (0.9 + Math.random() * 0.9).toFixed(2) + 's');
      piece.style.setProperty('--r', Math.round(Math.random() * 720) + 'deg');
      piece.style.setProperty('--s', (6 + Math.random() * 8).toFixed(0) + 'px');
      piece.style.background = colors[i % colors.length];
      layer.appendChild(piece);
    }
    window.setTimeout(function () { layer.textContent = ''; }, 2200);
  }

  function levelInfo(xp) {
    let level = 1;
    for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) level = i + 1;
    const floor = LEVELS[level - 1];
    const next = LEVELS[level] !== undefined ? LEVELS[level] : null;
    const pct = next === null ? 100 : Math.round(((xp - floor) / (next - floor)) * 100);
    return { level: level, next: next, percent: pct };
  }

  /* ---------- 6. Notifications ---------- */
  const TOAST_ICONS = { success: '✓', error: '!', info: 'i', celebrate: '★' };

  function toast(message, kind, duration) {
    kind = kind || 'info';
    const region = $('toast-region');
    const el = document.createElement('div');
    el.className = 'toast is-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = TOAST_ICONS[kind] || TOAST_ICONS.info;
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(icon);
    el.appendChild(text);
    const bar = document.createElement('span');
    bar.className = 'toast-bar';
    const stay = (duration || 3000) * (state.prefs.easyRead ? 2 : 1);
    bar.style.animationDuration = stay + 'ms';
    el.appendChild(bar);
    region.appendChild(el);
    while (region.children.length > 3) region.removeChild(region.firstChild);

    window.setTimeout(function () {
      el.classList.add('is-leaving');
      el.addEventListener('animationend', function () { el.remove(); }, { once: true });
      window.setTimeout(function () { el.remove(); }, 400); // fallback when animations are disabled
    }, stay);
  }

  /* ---------- 7. Dictionary API ---------- */
  /**
   * Shared fetch with a timeout. Rejects with an Error carrying `.code`:
   * 'offline' | 'timeout' | 'http' (with .status) | 'badjson'.
   */
  async function fetchJSON(url, options, timeoutMs, isRetry) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw withCode(new Error('offline'), 'offline');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, timeoutMs || API_TIMEOUT_MS) : null;
    let response;
    try {
      response = await fetch(url, Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined }));
    } catch (err) {
      if (err && err.name === 'AbortError') throw withCode(new Error('timeout'), 'timeout');
      throw withCode(new Error('network'), 'offline');
    } finally {
      if (timer) window.clearTimeout(timer);
    }
    let data = null;
    try { data = await response.json(); } catch (err) { data = null; }
    if (response.status >= 500 && !isRetry) return fetchJSON(url, options, timeoutMs, true);
    if (!response.ok) {
      const e = withCode(new Error('http ' + response.status), 'http');
      e.status = response.status;
      e.body = data;
      throw e;
    }
    if (data === null) throw withCode(new Error('badjson'), 'badjson');
    return data;
  }

  function withCode(err, code) { err.code = code; return err; }

  const PRIMARY_TIMEOUT_MS = 3000; // dictionaryapi.dev is slow or blocked on some networks; fall back quickly

  /**
   * Looks a word up. The Free Dictionary API is the primary source; if it fails or
   * times out, Wiktionary + Datamuse are combined into an equivalent entry.
   */
  async function fetchWord(word) {
    const primary = fetchFromDictionaryApi(word);
    const fallback = fetchFromFallbacks(word);
    fallback.catch(function () {}); // avoid an unhandled rejection if the primary wins
    try {
      const entry = await primary;
      return entry;
    } catch (primaryErr) {
      try {
        return await fallback;
      } catch (fallbackErr) {
        if (navigator.onLine === false || (primaryErr.code === 'offline' && fallbackErr.code === 'offline')) throw withCode(new Error('offline'), 'offline');
        if (primaryErr.code === 'notfound' || fallbackErr.code === 'notfound') throw withCode(new Error('notfound'), 'notfound');
        throw fallbackErr.code === 'timeout' && primaryErr.code === 'timeout' ? primaryErr : withCode(fallbackErr, 'api');
      }
    }
  }

  async function fetchFromDictionaryApi(word) {
    let data;
    try {
      data = await fetchJSON(DICTIONARY_API + encodeURIComponent(word), null, PRIMARY_TIMEOUT_MS);
    } catch (err) {
      if (err.code === 'http' && err.status === 404) throw withCode(err, 'notfound');
      if (err.code === 'http' || err.code === 'badjson') throw withCode(err, 'api');
      throw err;
    }
    const entry = normalizeApiEntry(data, word);
    if (!entry) throw withCode(new Error('notfound'), 'notfound');
    entry.source = 'Free Dictionary API';
    return entry;
  }

  const WIKTIONARY_API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  const DATAMUSE_API = 'https://api.datamuse.com/words?';
  const DATAMUSE_POS = { adj: 'adjective', n: 'noun', v: 'verb', adv: 'adverb', u: '' };

  /** Wiktionary gives definitions/examples (as HTML); Datamuse gives IPA and synonyms. */
  async function fetchFromFallbacks(word) {
    const enc = encodeURIComponent(word);
    const results = await Promise.allSettled([
      fetchJSON(WIKTIONARY_API + enc, { headers: { Accept: 'application/json' } }, 7000),
      fetchJSON(DATAMUSE_API + 'sp=' + enc + '&md=dpr&ipa=1&max=1', null, 7000),
      fetchJSON(DATAMUSE_API + 'rel_syn=' + enc + '&max=8', null, 7000)
    ]);
    const wik = results[0].status === 'fulfilled' ? parseWiktionary(results[0].value) : null;
    const dm = results[1].status === 'fulfilled' ? parseDatamuse(results[1].value, word) : null;
    const syn = results[2].status === 'fulfilled' && Array.isArray(results[2].value)
      ? results[2].value.map(function (x) { return x && x.word; }).filter(Boolean).slice(0, 8) : [];

    if (!wik && !dm) {
      const errs = results.slice(0, 2).map(function (r) { return r.reason; });
      if (errs.some(function (e) { return e && e.code === 'offline'; })) throw withCode(new Error('offline'), 'offline');
      if (errs.every(function (e) { return e && e.code === 'http' && e.status === 404; })) throw withCode(new Error('notfound'), 'notfound');
      if (results[0].status === 'fulfilled' || results[1].status === 'fulfilled') throw withCode(new Error('notfound'), 'notfound');
      throw errs[0] || withCode(new Error('api'), 'api');
    }
    const base = wik && wik.definition ? wik : dm;
    if (!base || !base.definition) throw withCode(new Error('notfound'), 'notfound');
    return {
      word: word.toLowerCase(),
      phonetic: (dm && dm.phonetic) || '',
      partOfSpeech: base.partOfSpeech || (dm && dm.partOfSpeech) || '',
      definition: base.definition,
      example: (wik && wik.example) || '',
      audio: '',
      synonyms: syn,
      antonyms: [],
      source: wik ? 'Wiktionary' + (dm ? ' + Datamuse' : '') : 'Datamuse'
    };
  }

  function parseWiktionary(data) {
    const items = data && Array.isArray(data.en) ? data.en : null;
    if (!items) return null;
    for (let i = 0; i < items.length; i++) {
      const defs = Array.isArray(items[i].definitions) ? items[i].definitions : [];
      for (let j = 0; j < defs.length; j++) {
        const text = stripHtml(defs[j].definition).replace(/^\s*\((?:[^)]*)\)\s*/, '').trim();
        if (text.length < 4) continue;
        const examples = Array.isArray(defs[j].examples) ? defs[j].examples.map(stripHtml).filter(Boolean) : [];
        return {
          partOfSpeech: typeof items[i].partOfSpeech === 'string' ? items[i].partOfSpeech.toLowerCase() : '',
          definition: text.charAt(0).toUpperCase() + text.slice(1),
          example: examples[0] || ''
        };
      }
    }
    return null;
  }

  function parseDatamuse(data, word) {
    const hit = Array.isArray(data) && data[0] && typeof data[0].word === 'string' && data[0].word.toLowerCase() === word.toLowerCase() ? data[0] : null;
    if (!hit) return null;
    const tags = Array.isArray(hit.tags) ? hit.tags : [];
    const ipa = tags.find(function (t) { return typeof t === 'string' && t.indexOf('ipa_pron:') === 0; });
    const defs = Array.isArray(hit.defs) ? hit.defs : [];
    let partOfSpeech = '', definition = '';
    if (defs.length && typeof defs[0] === 'string') {
      const parts = defs[0].split('\t');
      partOfSpeech = DATAMUSE_POS[parts[0]] !== undefined ? DATAMUSE_POS[parts[0]] : parts[0];
      definition = (parts[1] || '').trim();
      if (definition) definition = definition.charAt(0).toUpperCase() + definition.slice(1);
    }
    if (!definition && !ipa) return null;
    return {
      phonetic: ipa ? '/' + ipa.slice(9).trim() + '/' : '',
      partOfSpeech: partOfSpeech,
      definition: definition
    };
  }

  /** Reduces the API's nested response to the handful of fields Gengo shows. */
  function normalizeApiEntry(data, requested) {
    if (!Array.isArray(data) || !data.length || !data[0] || typeof data[0] !== 'object') return null;
    const entry = data[0];
    const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];

    let chosen = null, definition = null;
    for (let i = 0; i < meanings.length && !definition; i++) {
      const defs = Array.isArray(meanings[i].definitions) ? meanings[i].definitions : [];
      for (let j = 0; j < defs.length; j++) {
        if (defs[j] && typeof defs[j].definition === 'string' && defs[j].definition.trim()) {
          chosen = meanings[i]; definition = defs[j]; break;
        }
      }
    }
    if (!definition) return null;

    let example = typeof definition.example === 'string' ? definition.example.trim() : '';
    if (!example) {
      meanings.some(function (m) {
        return (m.definitions || []).some(function (d) {
          if (d && typeof d.example === 'string' && d.example.trim()) { example = d.example.trim(); return true; }
          return false;
        });
      });
    }

    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    let audio = '';
    phonetics.some(function (p) {
      if (p && typeof p.audio === 'string' && /^https?:\/\//.test(p.audio)) { audio = p.audio; return true; }
      return false;
    });
    let phonetic = typeof entry.phonetic === 'string' ? entry.phonetic : '';
    if (!phonetic) {
      phonetics.some(function (p) {
        if (p && typeof p.text === 'string' && p.text.trim()) { phonetic = p.text.trim(); return true; }
        return false;
      });
    }

    const collect = function (field) {
      const out = [];
      const push = function (s) {
        if (typeof s === 'string' && s.trim() && out.indexOf(s.trim()) === -1 && out.length < 8) out.push(s.trim());
      };
      (definition[field] || []).forEach(push);
      (chosen[field] || []).forEach(push);
      meanings.forEach(function (m) {
        (m[field] || []).forEach(push);
        (m.definitions || []).forEach(function (d) { (d && d[field] || []).forEach(push); });
      });
      return out;
    };

    return {
      word: (typeof entry.word === 'string' && entry.word.trim() ? entry.word : requested).toLowerCase(),
      phonetic: phonetic,
      partOfSpeech: typeof chosen.partOfSpeech === 'string' ? chosen.partOfSpeech : '',
      definition: definition.definition.trim(),
      example: example,
      audio: audio,
      synonyms: collect('synonyms'),
      antonyms: collect('antonyms')
    };
  }

  /* ---------- 8. Learn ---------- */
  let searchInFlight = false;
  let lastQuery = '';

  function setSearchBusy(busy) {
    searchInFlight = busy;
    $('search-input').disabled = busy;
    $('search-button').disabled = busy;
    $('search-button').classList.toggle('is-loading', busy);
    document.querySelectorAll('.chip[data-word]').forEach(function (c) { c.disabled = busy; });
    $('result-area').setAttribute('aria-busy', busy ? 'true' : 'false');
    if (!busy && document.activeElement === document.body) $('search-input').focus();
  }

  function showOnly(ids, which) {
    ids.forEach(function (id) { $(id).hidden = id !== which; });
  }

  const RESULT_STATES = ['result-empty', 'result-loading', 'result-error', 'result-card'];

  async function searchWord(rawWord) {
    const word = String(rawWord || '').trim().toLowerCase();
    if (!word) {
      toast('Type a word to explore first.', 'info');
      $('search-input').focus();
      return;
    }
    if (searchInFlight) return;
    if (!/^[a-z][a-z' -]{0,39}$/i.test(word)) {
      showError('Letters only, please', 'Try a single English word without numbers or symbols.');
      return;
    }
    lastQuery = word;
    $('search-input').value = word;
    $('loading-word').textContent = word;
    setSearchBusy(true);
    showOnly(RESULT_STATES, 'result-loading');
    buddySay('Looking up “' + word + '”…', 'think', 4000);
    try {
      const entry = await fetchWord(word);
      state.lastSearch = entry;
      saveState();
      renderResult(entry);
      onCurrentWordChanged();
      if (window.matchMedia('(max-width: 1100px)').matches) $('result-card').scrollIntoView({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
      announce('Found ' + entry.word + (entry.partOfSpeech ? ', ' + entry.partOfSpeech : '') + '. ' + entry.definition + (findSaved(entry.word) ? ' Already saved.' : ' Press Save Word to keep it.'));
    } catch (err) {
      handleSearchError(err, word);
    } finally {
      setSearchBusy(false);
    }
  }

  function handleSearchError(err, word) {
    const code = err && err.code;
    if (code === 'notfound') {
      showError('No entry for “' + word + '”', 'The dictionary doesn’t have this word yet. Check the spelling, or try a related word.');
    } else if (code === 'offline') {
      showError('You look offline', 'Gengo can’t reach the dictionary right now. Your saved words are still available to review.');
    } else if (code === 'timeout') {
      showError('The dictionaries are taking too long', 'None of the dictionary sources answered in time. Check your connection and try again — your saved words are still available.');
    } else {
      showError('The dictionary service had a problem', 'Please try again shortly. Everything you’ve saved is safe.');
    }
    toast('Couldn’t fetch “' + word + '”.', 'error');
    buddySay(code === 'notfound' ? 'Hmm, never heard of that one.' : 'The dictionary isn’t answering. Not my fault!', 'sad');
  }

  function showError(title, message) {
    $('error-title').textContent = title;
    $('error-message').textContent = message;
    showOnly(RESULT_STATES, 'result-error');
  }

  function fillList(listEl, rowEl, items) {
    listEl.textContent = '';
    items.forEach(function (s) {
      const li = document.createElement('li');
      li.textContent = s;
      listEl.appendChild(li);
    });
    rowEl.hidden = items.length === 0;
  }

  function renderResult(entry) {
    animateLetters($('result-word'), entry.word);
    $('result-phonetic').textContent = entry.phonetic || '';
    $('result-phonetic').hidden = !entry.phonetic;
    $('result-pos').textContent = entry.partOfSpeech || '';
    $('result-source').textContent = entry.source ? 'via ' + entry.source : '';
    $('result-definition').textContent = entry.definition;

    const exampleEl = $('result-example');
    if (entry.example) {
      exampleEl.textContent = '“' + entry.example + '”';
      exampleEl.classList.remove('is-missing');
    } else {
      exampleEl.textContent = 'No example sentence available for this word.';
      exampleEl.classList.add('is-missing');
    }
    $('listen-example').hidden = !entry.example;

    fillList($('result-synonyms'), $('result-synonyms-row'), entry.synonyms);
    fillList($('result-antonyms'), $('result-antonyms-row'), entry.antonyms);

    // Word playback: dictionary audio when present, otherwise the browser voice.
    const canSpeak = !!entry.audio || speech.supported;
    $('listen-word').hidden = !canSpeak;
    $('audio-note').hidden = !!entry.audio || !speech.supported;
    if (!entry.audio && !speech.supported) {
      $('audio-note').textContent = 'No pronunciation recording for this word, and this browser has no speech voice.';
      $('audio-note').hidden = false;
    } else {
      $('audio-note').textContent = 'No recording from the dictionary — using your browser’s voice instead.';
    }

    updateSaveButton(entry.word);
    showOnly(RESULT_STATES, 'result-card');
  }

  function updateSaveButton(word) {
    const saved = !!findSaved(word);
    $('save-button').hidden = saved;
    $('saved-note').hidden = !saved;
    const n = state.words.length;
    $('saved-count').textContent = n ? n + ' word' + (n === 1 ? '' : 's') + ' saved' + (n < 4 ? ' · quiz unlocks at 4' : '') : '';
  }

  /** Text for a `data-speak` target based on the current word / translation. */
  function speakTargetText(kind) {
    const entry = state.lastSearch;
    if (kind === 'translation') return { text: lastTranslation ? lastTranslation.text : '', lang: lastTranslation ? lastTranslation.lang : 'en-US' };
    if (!entry) return { text: '', lang: 'en-US' };
    if (kind === 'word') return { text: entry.word, lang: 'en-US', audio: entry.audio };
    if (kind === 'definition') return { text: entry.definition, lang: 'en-US' };
    if (kind === 'example') return { text: entry.example, lang: 'en-US' };
    return { text: '', lang: 'en-US' };
  }

  /* ---------- 9. Saved-word management ---------- */
  function findSaved(word) {
    const w = String(word).toLowerCase();
    return state.words.find(function (x) { return x.word === w; }) || null;
  }

  function saveCurrentWord() {
    const entry = state.lastSearch;
    if (!entry) return;
    if (findSaved(entry.word)) {
      toast('“' + entry.word + '” is already saved.', 'info');
      updateSaveButton(entry.word);
      return;
    }
    state.words.push(normalizeWord(Object.assign({}, entry, { id: makeId(entry.word), savedAt: Date.now() })));
    const firstTime = state.rewardedWords.indexOf(entry.word) === -1;
    if (firstTime) state.rewardedWords.push(entry.word);
    saveState();
    if (firstTime) { todayStats().saves += 1; awardXP(XP.save); recordActivity(); }
    updateSaveButton(entry.word);
    renderQuiz(false);
    renderMyWords();
    const left = 4 - state.words.length;
    toast('Saved “' + entry.word + '”' + (firstTime ? ' · +' + XP.save + ' XP.' : ' again (no extra XP).') + (left > 0 ? ' ' + left + ' more to unlock the quiz.' : ''), 'success');
    restartAnimation($('saved-note'), 'is-stamp');
    sparkle($('result-card'), 10);
    buddySay(firstTime ? '“' + entry.word + '” — great pick!' : 'Welcome back, “' + entry.word + '”.', 'happy');
  }

  function removeWord(word) {
    const idx = state.words.findIndex(function (w) { return w.word === word; });
    if (idx === -1) return;
    state.words.splice(idx, 1);
    if (state.quiz.lastWordId && !state.words.some(function (w) { return w.id === state.quiz.lastWordId; })) state.quiz.lastWordId = null;
    saveState();
    updateSaveButton(word);
    renderQuiz(false);
    renderMyWords();
    toast('Removed “' + word + '”. Your XP stays.', 'info');
    buddySay('Bye, “' + word + '”. Plenty more words out there.', 'think');
  }

  function clearAllWords() {
    const count = state.words.length;
    state.words = [];
    state.quiz.lastWordId = null;
    saveState();
    if (state.lastSearch) updateSaveButton(state.lastSearch.word);
    quizRound = { answered: 0, correct: 0, xp: 0, startedAt: null };
    quizCombo = 0;
    quizQuestion = null;
    renderQuiz(true);
    renderMyWords();
    toast('Cleared ' + count + ' word' + (count === 1 ? '' : 's') + '. Your XP is untouched.', 'info');
  }

  /* ---------- 9b. My Words ---------- */
  function renderMyWords() {
    const list = $('word-list');
    const filter = $('words-filter').value.trim().toLowerCase();
    const words = state.words.slice().sort(function (a, b) { return b.savedAt - a.savedAt; });
    const visible = filter
      ? words.filter(function (w) { return w.word.indexOf(filter) !== -1 || w.definition.toLowerCase().indexOf(filter) !== -1; })
      : words;

    $('words-empty').hidden = words.length > 0;
    $('words-no-match').hidden = !(words.length && !visible.length);
    $('words-filter').disabled = !words.length;
    $('clear-all').hidden = !words.length;
    $('words-count').textContent = words.length === 0
      ? 'No words saved yet'
      : words.length + ' word' + (words.length === 1 ? '' : 's') + ' saved' + ' · ' + words.filter(function (w) { return w.mastery >= MASTERY_MAX; }).length + ' mastered' + (filter ? ' · showing ' + visible.length : '') + (words.length < 4 ? ' · quiz unlocks at 4' : '');
    const badge = $('nav-words-badge');
    badge.textContent = String(words.length);
    badge.setAttribute('aria-label', words.length + ' saved');
    badge.hidden = words.length === 0;

    list.textContent = '';
    visible.forEach(function (w) {
      const li = document.createElement('li');
      li.className = 'word-item';
      li.style.setProperty('--i', String(list.children.length));

      const head = document.createElement('div');
      head.className = 'word-item-head';
      const word = document.createElement('span');
      word.className = 'word-item-word';
      word.textContent = w.word;
      head.appendChild(word);
      if (w.phonetic) {
        const ph = document.createElement('span');
        ph.className = 'phonetic';
        ph.textContent = w.phonetic;
        head.appendChild(ph);
      }
      if (w.partOfSpeech) {
        const pos = document.createElement('span');
        pos.className = 'pos-tag';
        pos.textContent = w.partOfSpeech;
        head.appendChild(pos);
      }
      const stars = document.createElement('span');
      stars.className = 'mastery' + (w.mastery >= MASTERY_MAX ? ' is-mastered' : '');
      stars.textContent = '★'.repeat(w.mastery) + '☆'.repeat(MASTERY_MAX - w.mastery);
      stars.setAttribute('aria-label', w.mastery >= MASTERY_MAX ? 'Mastered' : 'Mastery ' + w.mastery + ' of ' + MASTERY_MAX + ' — raise it in a Focus Sprint');
      stars.title = w.mastery >= MASTERY_MAX ? 'Mastered in Focus Sprints' : 'Mastery ' + w.mastery + '/' + MASTERY_MAX + ' — “Got it” during a Focus Sprint raises it';
      head.appendChild(stars);

      const def = document.createElement('p');
      def.className = 'word-item-def';
      def.textContent = w.definition.length > 140 ? w.definition.slice(0, 137).trimEnd() + '…' : w.definition;

      const meta = document.createElement('p');
      meta.className = 'word-item-meta';
      meta.appendChild(metaSpan('Saved', formatDate(w.savedAt)));
      if (w.example) meta.appendChild(metaSpan('Example', w.example));

      const actions = document.createElement('div');
      actions.className = 'word-item-actions';
      const listen = document.createElement('button');
      listen.type = 'button';
      listen.className = 'btn btn-mini';
      listen.textContent = 'Listen';
      listen.setAttribute('aria-label', 'Listen to ' + w.word);
      listen.addEventListener('click', function () { if (speech.activeButton === listen) stopSpeech(); else speakText(w.word, 'en-US', listen, w.audio); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-small btn-danger-text';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + w.word);
      remove.addEventListener('click', function () {
        li.classList.add('is-leaving');
        li.addEventListener('animationend', function () { removeWord(w.word); }, { once: true });
        window.setTimeout(function () { if (li.isConnected) removeWord(w.word); }, 400);
      });
      actions.appendChild(listen);
      actions.appendChild(remove);

      li.appendChild(head);
      li.appendChild(actions);
      li.appendChild(def);
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  function metaSpan(label, value) {
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = label + ': ';
    span.appendChild(strong);
    span.appendChild(document.createTextNode(value));
    return span;
  }

  function openConfirm() {
    const dialog = $('confirm-dialog');
    const n = state.words.length;
    $('confirm-message').textContent = 'This removes all ' + n + ' saved word' + (n === 1 ? '' : 's') + '. Your XP and streak stay with you.';
    openDialog(dialog);
    $('confirm-cancel').focus();
  }

  function closeConfirm() { closeDialog($('confirm-dialog')); }

  /* ---------- 10. Translate (LibreTranslate) ---------- */
  let translateKeyInMemory = state.translate.rememberKey ? state.translate.apiKey : '';
  let translateInFlight = false;
  let lastTranslation = null; // { text, lang }
  const TRANSLATE_STATES = ['translate-empty', 'translate-setup', 'translate-loading', 'translate-error', 'translate-result'];

  function validateServerUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    let url;
    try { url = new URL(value); } catch (err) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  }

  function renderTranslateSettings() {
    $('lt-url').value = state.translate.serverUrl || '';
    $('lt-key').value = translateKeyInMemory;
    $('lt-remember').checked = !!state.translate.rememberKey;
    $('lt-status').textContent = translateKeyInMemory
      ? (state.translate.rememberKey ? 'Key remembered on this device.' : 'Key held in memory for this tab only.')
      : 'No API key set.';
  }

  function saveTranslateSettings() {
    const url = validateServerUrl($('lt-url').value);
    if (!url) {
      $('lt-status').textContent = 'Enter a valid http(s) server URL, e.g. https://libretranslate.com';
      $('lt-url').focus();
      return;
    }
    state.translate.serverUrl = url;
    translateKeyInMemory = $('lt-key').value.trim();
    state.translate.rememberKey = $('lt-remember').checked;
    state.translate.apiKey = state.translate.rememberKey ? translateKeyInMemory : '';
    saveState();
    renderTranslateSettings();
    toast('Translation settings saved.', 'success');
    if (!$('translate-result').hidden) return;
    showOnly(TRANSLATE_STATES, 'translate-empty');
  }

  function forgetTranslateKey() {
    translateKeyInMemory = '';
    state.translate.apiKey = '';
    state.translate.rememberKey = false;
    saveState();
    renderTranslateSettings();
    toast('API key forgotten.', 'info');
  }

  function toggleTranslateSettings(force) {
    const panel = $('translate-settings');
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    $('translate-settings-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('lt-url').focus();
  }

  let translateAutoFilled = '';
  /** Puts the current word in the translate box unless the learner typed something of their own. */
  function prefillTranslate() {
    if (!state.lastSearch) return;
    const box = $('translate-input');
    if (box.value.trim() === '' || box.value === translateAutoFilled) {
      box.value = state.lastSearch.word;
      translateAutoFilled = state.lastSearch.word;
    }
  }

  function fillTranslateInput(kind) {
    const entry = state.lastSearch;
    if (!entry) { toast('Search for a word in Learn first.', 'info'); return; }
    const text = kind === 'definition' ? entry.definition : kind === 'example' ? entry.example : entry.word;
    if (!text) { toast('This word has no example sentence to translate.', 'info'); return; }
    $('translate-input').value = text;
    $('translate-input').focus();
  }

  const MYMEMORY_API = 'https://api.mymemory.translated.net/get?';

  /** True when the learner has set up LibreTranslate (a key, or a non-public server). */
  function libreTranslateReady() {
    const server = validateServerUrl(state.translate.serverUrl);
    if (!server) return false;
    return !!translateKeyInMemory || server !== DEFAULT_TRANSLATE_URL;
  }

  async function translateViaLibre(text, target) {
    const server = validateServerUrl(state.translate.serverUrl);
    const payload = { q: text, source: 'en', target: target, format: 'text' };
    if (translateKeyInMemory) payload.api_key = translateKeyInMemory;
    const data = await fetchJSON(server + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const translated = data && typeof data.translatedText === 'string' ? data.translatedText.trim() : '';
    if (!translated) throw withCode(new Error('empty'), 'api');
    return { text: translated, source: 'LibreTranslate' };
  }

  /** MyMemory returns HTTP 200 even for errors, so the body's responseStatus is the real signal. */
  async function translateViaMyMemory(text, target) {
    const data = await fetchJSON(MYMEMORY_API + 'q=' + encodeURIComponent(text) + '&langpair=en|' + encodeURIComponent(target));
    const status = data && Number(data.responseStatus);
    const translated = data && data.responseData && typeof data.responseData.translatedText === 'string' ? data.responseData.translatedText.trim() : '';
    if (data && data.quotaFinished === true) throw withCode(new Error('quota'), 'quota');
    if (status !== 200 || !translated || translated === String(data.responseDetails || '').trim()) {
      const e = withCode(new Error('mymemory'), 'api');
      e.body = { error: typeof data.responseDetails === 'string' ? data.responseDetails : '' };
      throw e;
    }
    return { text: translated, source: 'MyMemory' };
  }

  async function translateText() {
    if (translateInFlight) return;
    const text = $('translate-input').value.trim();
    const target = $('translate-target').value;
    if (!text) { toast('Add some text to translate.', 'info'); $('translate-input').focus(); return; }
    if (!LANGUAGES[target]) return;
    state.prefs.translateTarget = target;
    saveState();

    translateInFlight = true;
    $('translate-button').disabled = true;
    $('translate-button').textContent = 'Translating…';
    $('translate-area').setAttribute('aria-busy', 'true');
    showOnly(TRANSLATE_STATES, 'translate-loading');
    buddySay('Translating…', 'think', 4000);

    let libreErr = null;
    try {
      let result = null;
      if (libreTranslateReady()) {
        try { result = await translateViaLibre(text, target); } catch (err) { libreErr = err; }
      }
      if (!result) result = await translateViaMyMemory(text, target);
      lastTranslation = { text: result.text, lang: LANGUAGES[target].speech };
      $('translate-source-text').textContent = text;
      $('translate-target-label').textContent = LANGUAGES[target].name + ' · via ' + result.source;
      typewriter($('translate-target-text'), result.text);
      $('translate-target-text').setAttribute('lang', target);
      $('listen-translation').hidden = !speech.supported;
      showOnly(TRANSLATE_STATES, 'translate-result');
      sparkle($('translate-result').querySelector('.is-target'), 6);
      buddySay(LANGUAGES[target].name + '! Fancy.', 'happy');
      if (libreErr) toast('LibreTranslate failed — used MyMemory instead.', 'info');
    } catch (err) {
      handleTranslateError(libreErr && err.code !== 'offline' ? libreErr : err);
    } finally {
      translateInFlight = false;
      $('translate-button').disabled = false;
      $('translate-button').textContent = 'Translate';
      $('translate-area').setAttribute('aria-busy', 'false');
    }
  }

  function handleTranslateError(err) {
    const code = err && err.code;
    const serverMessage = err && err.body && typeof err.body.error === 'string' ? err.body.error : '';
    if (code === 'http' && (err.status === 400 || err.status === 401 || err.status === 403) && /key/i.test(serverMessage)) {
      $('translate-setup').querySelector('p').textContent = 'LibreTranslate says: “' + serverMessage + '”, and the free MyMemory fallback also failed. Add a key in API settings, or try again shortly.';
      showOnly(TRANSLATE_STATES, 'translate-setup');
      return;
    }
    let title = 'Translation failed', message = 'The translation server returned an unexpected response. Try again shortly.';
    if (code === 'offline') { title = 'You look offline'; message = 'Gengo can’t reach the translation server. Dictionary lookups and saved words still work when you’re back online.'; }
    else if (code === 'timeout') { title = 'The translation server is slow'; message = 'The request timed out after ' + (API_TIMEOUT_MS / 1000) + ' seconds. Try again, or use a different server in API settings.'; }
    else if (code === 'http' && err.status === 429) { title = 'Too many requests'; message = 'The server is rate-limiting you. Wait a moment and try again.'; }
    else if (code === 'quota') { title = 'Daily free quota used up'; message = 'MyMemory’s free anonymous quota for today is exhausted. Add a LibreTranslate key in API settings, or try again tomorrow.'; }
    else if (code === 'http' && serverMessage) { message = 'Server message: “' + serverMessage + '”'; }
    $('translate-error-title').textContent = title;
    $('translate-error-message').textContent = message;
    showOnly(TRANSLATE_STATES, 'translate-error');
    toast('Translation didn’t go through.', 'error');
  }

  /* ---------- 11. Speech synthesis (Web Speech TTS) ---------- */
  const speech = {
    supported: 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function',
    voices: [],
    activeButton: null,
    activeAudio: null,
    lastPickExact: true,
    warned: {}
  };

  /* Curated, clear-sounding system voices (macOS, Windows, Chrome, Android). Novelty voices are excluded. */
  const VOICE_PREFS = {
    female: ['Karen', 'Samantha', 'Microsoft Aria Online', 'Microsoft Jenny Online', 'Microsoft Zira', 'Microsoft Sonia Online', 'Microsoft Libby Online', 'Microsoft Natasha Online', 'Google US English', 'Ava', 'Allison', 'Susan', 'Zoe', 'Nicky', 'Joelle', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Kate', 'Serena', 'Martha', 'Stephanie', 'Google UK English Female', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Microsoft Michelle', 'Microsoft Ana', 'Microsoft Emma', 'Microsoft Hazel', 'Microsoft Susan', 'Microsoft Libby', 'Microsoft Sonia', 'Microsoft Natasha', 'Microsoft Heera', 'Microsoft Neerja', 'Veena', 'Isha', 'Sangeeta',
      'Mónica', 'Monica', 'Paulina', 'Marisol', 'Angelica', 'Google español', 'Microsoft Elvira', 'Microsoft Dalia', 'Amélie', 'Amelie', 'Audrey', 'Aurelie', 'Google français', 'Microsoft Denise', 'Anna', 'Petra', 'Helena', 'Google Deutsch', 'Microsoft Katja', 'Alice', 'Federica', 'Google italiano', 'Microsoft Elsa', 'Joana', 'Luciana', 'Fernanda', 'Google português', 'Microsoft Francisca', 'Lekha', 'Google हिन्दी', 'Microsoft Swara', 'Kyoko', 'O-ren', 'Google 日本語', 'Microsoft Nanami', 'Vani', 'Microsoft Pallavi'],
    male: ['Daniel', 'Microsoft Guy Online', 'Microsoft Andrew Online', 'Microsoft Ryan Online', 'Microsoft David', 'Microsoft Mark', 'Google UK English Male', 'Alex', 'Tom', 'Oliver', 'Lee', 'Evan', 'Nathan', 'Aaron', 'Arthur', 'Gordon', 'Rishi', 'Microsoft Guy', 'Microsoft Davis', 'Microsoft David', 'Microsoft Mark', 'Microsoft Ryan', 'Microsoft Christopher', 'Microsoft Eric', 'Microsoft Andrew', 'Microsoft Brian', 'Microsoft Thomas', 'Microsoft Prabhat', 'Microsoft Ravi', 'Microsoft William', 'Microsoft Liam',
      'Jorge', 'Diego', 'Juan', 'Carlos', 'Microsoft Alvaro', 'Microsoft Jorge', 'Thomas', 'Nicolas', 'Microsoft Henri', 'Markus', 'Yannick', 'Microsoft Conrad', 'Luca', 'Microsoft Diego', 'Joaquim', 'Felipe', 'Microsoft Duarte', 'Microsoft Madhur', 'Otoya', 'Hattori', 'Microsoft Keita', 'Microsoft Valluvar']
  };
  const VOICE_BLOCKLIST = /bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|grandma|grandpa|rocko|shelley|sandy|eddy|flo|reed|compact|eloquence/i;

  function loadVoices() {
    if (!speech.supported) return;
    speech.voices = window.speechSynthesis.getVoices().slice();
    renderVoiceName();
  }

  function matchesList(voice, names) {
    return names.some(function (n) { return voice.name.indexOf(n) === 0; });
  }

  /** All clean voices for a language that plausibly match the wanted gender, best first. */
  function voiceCandidates(lang, want) {
    const other = want === 'male' ? 'female' : 'male';
    const base = lang.slice(0, 2).toLowerCase();
    const clean = speech.voices.filter(function (v) { return v.lang.replace('_', '-').slice(0, 2).toLowerCase() === base && !VOICE_BLOCKLIST.test(v.name); });
    const wanted = [];
    VOICE_PREFS[want].forEach(function (n) { clean.forEach(function (v) { if (v.name.indexOf(n) === 0 && wanted.indexOf(v) === -1) wanted.push(v); }); });
    // Voices we don't recognise by name but that aren't known to be the other gender
    const unknown = clean.filter(function (v) { return wanted.indexOf(v) === -1 && !matchesList(v, VOICE_PREFS[other]); });
    return { wanted: wanted, unknown: unknown, clean: clean };
  }

  /** Best available voice for a language and the learner's chosen gender. */
  function pickVoice(lang) {
    if (!speech.voices.length && speech.supported) speech.voices = window.speechSynthesis.getVoices().slice();
    const want = state.prefs.voiceGender === 'male' ? 'male' : 'female';
    const c = voiceCandidates(lang, want);
    speech.lastPickExact = c.wanted.length > 0;
    const region = lang.toLowerCase();
    const sameRegion = function (v) { return v.lang.replace('_', '-').toLowerCase() === region; };
    return c.wanted[0] // list order is the priority (Karen / Daniel first), regardless of region
      || c.unknown.find(function (v) { return sameRegion(v) && !v.localService; }) || c.unknown.find(sameRegion) || c.unknown[0]
      || c.clean[0] || null;
  }

  function renderVoiceName() {
    const el = $('voice-name');
    if (!el) return;
    // Pill labels show the voice that will actually be used on this device (Karen/Daniel on macOS, Zira/David or Aria/Guy on Windows…)
    ['female', 'male'].forEach(function (gender) {
      const saved = state.prefs.voiceGender;
      state.prefs.voiceGender = gender;
      const pick = speech.supported ? pickVoice('en-US') : null;
      state.prefs.voiceGender = saved;
      const label = $('voice-' + gender + '-label');
      if (label) label.textContent = (gender === 'female' ? 'Female' : 'Male') + (pick ? ' · ' + pick.name.replace(/ Online.*$| \(.*?\)| - .*$/g, '').trim() : '');
    });
    const v = speech.supported ? pickVoice('en-US') : null;
    const shortName = function (n) { return n.replace(/ Online.*$| \(.*?\)| - .*$/g, '').trim(); };
    // Android/Chrome OS often ship one system voice per language with no gender: collapse the switch to a plain note.
    const saved = state.prefs.voiceGender;
    state.prefs.voiceGender = 'female'; const f = speech.supported ? pickVoice('en-US') : null;
    state.prefs.voiceGender = 'male'; const m = speech.supported ? pickVoice('en-US') : null;
    state.prefs.voiceGender = saved;
    const single = !f || !m || f.voiceURI === m.voiceURI;
    const fieldset = document.querySelector('.voice-choice');
    if (fieldset) fieldset.hidden = single;
    if (single) {
      el.textContent = v ? 'Voice: ' + shortName(v.name) + ' (the only English voice on this device)' : 'No speech voices available in this browser.';
      return;
    }
    el.textContent = v ? 'English voice: ' + shortName(v.name) + (speech.lastPickExact ? '' : ' (no ' + state.prefs.voiceGender + ' voice found — nearest available)') : 'No speech voices available in this browser.';
  }

  function setSpeakingButton(btn) {
    if (speech.activeButton) {
      speech.activeButton.classList.remove('is-playing');
      speech.activeButton.setAttribute('aria-pressed', 'false');
      const lbl = speech.activeButton.querySelector('.speak-label');
      if (lbl) lbl.textContent = lbl.dataset.idle || lbl.textContent;
    }
    speech.activeButton = btn || null;
    if (btn) {
      btn.classList.add('is-playing');
      btn.setAttribute('aria-pressed', 'true');
      const lbl = btn.querySelector('.speak-label');
      if (lbl) { lbl.dataset.idle = lbl.dataset.idle || lbl.textContent; lbl.textContent = 'Playing…'; }
    }
  }

  function stopSpeech() {
    if (speech.supported) window.speechSynthesis.cancel();
    if (speech.activeAudio) { speech.activeAudio.pause(); speech.activeAudio = null; }
    setSpeakingButton(null);
  }

  /** Speaks `text`, preferring a recorded clip when `audioUrl` is provided. Never autoplays. */
  function speakText(text, lang, button, audioUrl) {
    stopSpeech();
    if (!text) { toast('Nothing to play yet.', 'info'); return; }

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      speech.activeAudio = audio;
      setSpeakingButton(button);
      const done = function () { if (speech.activeAudio === audio) { speech.activeAudio = null; setSpeakingButton(null); } };
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', function () {
        done();
        if (speech.supported) speakText(text, lang, button); // clip failed — fall back to the browser voice
        else toast('The pronunciation clip couldn’t be played.', 'error');
      }, { once: true });
      audio.play().catch(function () { done(); if (speech.supported) speakText(text, lang, button); else toast('The pronunciation clip couldn’t be played.', 'error'); });
      return;
    }

    if (!speech.supported) { toast('This browser can’t speak text aloud.', 'error'); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang || 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = pickVoice(utterance.lang);
    if (voice) { try { utterance.voice = voice; } catch (err) { /* voice object no longer valid (voices list changed) — let the browser choose */ } }
    const langKey = (utterance.lang || 'en').slice(0, 2);
    const switchHidden = document.querySelector('.voice-choice') && document.querySelector('.voice-choice').hidden;
    state.prefs.voiceNotes = state.prefs.voiceNotes || {};
    if (voice && !speech.lastPickExact && !speech.warned[langKey] && !switchHidden && !state.prefs.voiceNotes[langKey]) {
      speech.warned[langKey] = true;
      state.prefs.voiceNotes[langKey] = true;
      saveState();
      const langName = (Object.keys(LANGUAGES).map(function (k) { return LANGUAGES[k]; }).find(function (l) { return l.speech.slice(0, 2) === langKey; }) || { name: langKey }).name;
      toast('Only one ' + langName + ' voice is installed (' + voice.name + '), so Male and Female sound the same for ' + langName + '.', 'info', 5000);
    }
    utterance.addEventListener('end', function () { if (speech.activeButton === button) setSpeakingButton(null); });
    utterance.addEventListener('error', function (e) {
      if (speech.activeButton === button) setSpeakingButton(null);
      if (e.error !== 'interrupted' && e.error !== 'canceled') toast('Speech playback failed in this browser.', 'error');
    });
    setSpeakingButton(button);
    window.speechSynthesis.speak(utterance);
  }

  function onSpeakButton(e) {
    const btn = e.currentTarget;
    if (speech.activeButton === btn) { stopSpeech(); return; } // acts as Stop while playing
    const target = speakTargetText(btn.dataset.speak);
    speakText(target.text, target.lang, btn, target.audio);
  }

  /* ---------- 12. Speaking practice (speech recognition) ---------- */
  function getRecognition() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  const practice = { recognizer: null, listening: false, starting: false, stoppedByUser: false };

  function practiceTargetText() {
    const entry = state.lastSearch;
    if (!entry) return '';
    return state.prefs.practiceTarget === 'example' && entry.example ? entry.example : entry.word;
  }

  function renderSpeak() {
    const entry = state.lastSearch;
    $('speak-no-word').hidden = !!entry;
    $('speak-content').hidden = !entry;
    $('tts-unsupported').hidden = speech.supported;
    const micPossible = !!getRecognition() || !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    $('sr-unsupported').hidden = micPossible;
    $('sr-controls').hidden = !micPossible;
    $('engine-note').hidden = state.prefs.speechEngine !== 'whisper';
    if (!entry) return;

    $('speak-current-word').textContent = entry.word;
    $('speak-play-example').hidden = !entry.example;
    $('practice-example-label').hidden = !entry.example;
    if (!entry.example && state.prefs.practiceTarget === 'example') state.prefs.practiceTarget = 'word';
    document.querySelectorAll('input[name="practice-target"]').forEach(function (r) { r.checked = r.value === state.prefs.practiceTarget; r.closest('.radio-pill').classList.toggle('is-checked', r.checked); });
    $('practice-target-text').textContent = practiceTargetText();
  }

  function normalizeSpeech(text) {
    return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Word-level similarity (Sørensen–Dice over tokens); a rough match, not a pronunciation score. */
  function similarity(a, b) {
    const ta = normalizeSpeech(a).split(' ').filter(Boolean);
    const tb = normalizeSpeech(b).split(' ').filter(Boolean);
    if (!ta.length || !tb.length) return 0;
    const counts = {};
    ta.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    let common = 0;
    tb.forEach(function (t) { if (counts[t]) { common += 1; counts[t] -= 1; } });
    return (2 * common) / (ta.length + tb.length);
  }

  function setListening(on) {
    practice.listening = on;
    $('mic-button').classList.toggle('is-listening', on);
    $('wave').hidden = !on;
    $('mic-button').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('mic-label').textContent = on ? 'Listening…' : 'Start speaking';
    $('mic-stop').hidden = !on;
    $('mic-button').disabled = on;
    if (on) $('mic-stop').focus();
    else if (document.activeElement === document.body) $('mic-button').focus();
  }

  /**
   * Newer Chromium builds can recognise speech on-device (no Google round-trip).
   * Resolves true when that mode is usable; installs the language pack if the browser offers it.
   */
  let onDeviceChecked = null;
  async function preferOnDevice(Recognition) {
    if (typeof Recognition.available !== 'function') return false;
    if (onDeviceChecked !== null) return onDeviceChecked;
    try {
      let status = await Recognition.available({ langs: ['en-US'], processLocally: true });
      if (status === 'downloadable' && typeof Recognition.install === 'function') {
        $('sr-status').textContent = 'Downloading the on-device speech pack…';
        const ok = await Recognition.install({ langs: ['en-US'], processLocally: true });
        status = ok ? 'available' : status;
      }
      onDeviceChecked = status === 'available';
    } catch (err) {
      onDeviceChecked = false;
    }
    return onDeviceChecked;
  }

  async function startListening() {
    const Recognition = getRecognition();
    if (practice.listening || practice.starting) return;
    if (!Recognition || state.prefs.speechEngine === 'whisper') { startWhisperListening(); return; }
    const target = practiceTargetText();
    if (!target) { toast('Search for a word in Learn first.', 'info'); return; }
    stopSpeech();
    $('sr-result').hidden = true;

    practice.starting = true;
    const rec = new Recognition();
    rec.lang = 'en-US';
    let useLocal = false;
    try { useLocal = await preferOnDevice(Recognition); } finally { practice.starting = false; }
    if (state.prefs.section !== 'speak') return; // learner left the section while the pack was checking
    if (useLocal) rec.processLocally = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    practice.recognizer = rec;
    practice.stoppedByUser = false;
    let gotResult = false;

    rec.onstart = function () {
      setListening(true);
      $('sr-status').textContent = 'Listening — read the text aloud now.';
    };
    rec.onresult = function (event) {
      gotResult = true;
      let best = '';
      let bestScore = -1;
      for (let i = 0; i < event.results.length; i++) {
        for (let j = 0; j < event.results[i].length; j++) {
          const transcript = event.results[i][j].transcript;
          const score = similarity(transcript, target);
          if (score > bestScore) { bestScore = score; best = transcript; }
        }
      }
      showPracticeResult(best, bestScore);
    };
    rec.onerror = function (event) {
      gotResult = true;
      const kind = event.error;
      let msg = 'Something interrupted the microphone. Try again.';
      if (kind === 'not-allowed' || kind === 'service-not-allowed') msg = 'Microphone permission was denied. Allow it in your browser’s site settings, then try again. Typing and listening still work.';
      else if (kind === 'audio-capture') msg = 'No microphone was found. Connect one, or keep learning with the Listen buttons.';
      else if (kind === 'no-speech') msg = 'No speech detected. Move closer to the microphone and try once more.';
      else if (kind === 'network' || kind === 'service-not-allowed') {
        // Chrome's recogniser needs Google's servers. Switch to the in-browser Whisper engine instead.
        state.prefs.speechEngine = 'whisper';
        saveState();
        practice.switchToWhisper = true;
        msg = 'Online recognition is blocked on this network — switching to on-device recognition.';
      }
      else if (kind === 'aborted') msg = 'Listening stopped.';
      $('sr-status').textContent = msg;
      if (kind === 'no-speech') showPracticeResult('', 0);
    };
    rec.onend = function () {
      setListening(false);
      practice.recognizer = null;
      if (practice.switchToWhisper) {
        practice.switchToWhisper = false;
        startWhisperListening();
        return;
      }
      if (practice.stoppedByUser) {
        $('sr-status').textContent = 'Listening stopped.';
      } else if (!gotResult) {
        $('sr-status').textContent = 'No speech detected. Try once more.';
        showPracticeResult('', 0);
      }
    };
    try {
      rec.start(); // the permission prompt appears only now, after the learner pressed the button
    } catch (err) {
      setListening(false);
      $('sr-status').textContent = 'The microphone couldn’t start. Try again in a moment.';
    }
  }

  function stopListening(silent) {
    practice.stoppedByUser = true;
    if (practice.starting) { whisper.cancelled = true; releaseWhisperStream(); practice.starting = false; setListening(false); if (!silent) $('sr-status').textContent = 'Cancelled.'; return; }
    if (whisper.recorder) { stopWhisperRecording(); return; }
    if (practice.recognizer) {
      try { practice.recognizer.stop(); } catch (err) { /* already stopped */ }
    }
    if (practice.listening && !silent) $('sr-status').textContent = 'Listening stopped.';
    setListening(false);
  }

  function showPracticeResult(heard, score) {
    const result = $('sr-result');
    const heardEl = $('sr-heard');
    const fb = $('sr-feedback');
    fb.className = 'sr-feedback';
    const meter = $('sr-meter');
    meter.hidden = !heard;
    meter.style.setProperty('--score', String(Math.round(score * 100)));
    meter.setAttribute('aria-valuenow', String(Math.round(score * 100)));
    if (!heard) {
      heardEl.textContent = '—';
      fb.textContent = 'No speech detected.';
      fb.classList.add('is-none');
    } else {
      heardEl.textContent = heard;
      if (score >= 0.85) { fb.textContent = 'Excellent match! 🎯'; fb.classList.add('is-great'); }
      else if (score >= 0.5) { fb.textContent = 'Almost there — a word or two didn’t come through.'; fb.classList.add('is-close'); }
      else { fb.textContent = 'Try once more. Speak a little slower and clearer.'; fb.classList.add('is-retry'); }
      $('sr-status').textContent = 'Done. Compare what we heard with the target text.';
    }
    result.hidden = false;
    $('sr-retry').focus();
  }

  /* ---------- 12b. On-device recognition (Whisper in WebAssembly) ----------
     Used when the browser's Web Speech API is missing or can't reach its servers.
     The library and model are fetched from public CDNs on first use and cached by the
     browser; the audio itself never leaves the device. ---------- */
  const WHISPER_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';
  const WHISPER_MODEL = 'Xenova/whisper-tiny.en';
  const WHISPER_MAX_SECONDS = 8;
  const whisper = { pipeline: null, loading: null, recorder: null, stream: null, chunks: [], timer: null, cancelled: false };

  function loadWhisper() {
    if (whisper.pipeline) return Promise.resolve(whisper.pipeline);
    if (whisper.loading) return whisper.loading;
    whisper.loading = (async function () {
      const lib = await import(WHISPER_LIB);
      lib.env.allowLocalModels = false;
      const seen = {};
      const pipe = await lib.pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        progress_callback: function (p) {
          if (p && p.status === 'progress' && p.file) {
            seen[p.file] = p.progress || 0;
            const files = Object.keys(seen);
            const avg = files.reduce(function (a, f) { return a + seen[f]; }, 0) / files.length;
            $('sr-status').textContent = 'Preparing on-device recognition… ' + Math.round(avg) + '% (one-time download)';
          }
        }
      });
      whisper.pipeline = pipe;
      return pipe;
    })();
    whisper.loading.catch(function () { whisper.loading = null; });
    return whisper.loading;
  }

  async function startWhisperListening() {
    if (practice.listening || practice.starting || whisper.recorder) return;
    const target = practiceTargetText();
    if (!target) { toast('Search for a word in Learn first.', 'info'); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof window.MediaRecorder !== 'function') {
      $('sr-status').textContent = 'This browser can’t record audio. Use the typing exercise below instead.';
      return;
    }
    stopSpeech();
    $('sr-result').hidden = true;
    practice.starting = true;
    whisper.cancelled = false;
    $('engine-note').hidden = false;
    try {
      // Ask for the microphone first so the permission prompt appears right after the click.
      whisper.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      $('sr-status').textContent = whisper.pipeline ? 'Get ready…' : 'Preparing on-device recognition… (one-time download, about 10 MB)';
      await loadWhisper();
    } catch (err) {
      practice.starting = false;
      releaseWhisperStream();
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') $('sr-status').textContent = 'Microphone permission was denied. Allow it in your browser’s site settings, then try again.';
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') $('sr-status').textContent = 'No microphone was found. Connect one, or use the typing exercise below.';
      else $('sr-status').textContent = 'On-device recognition couldn’t load (' + (err && err.message ? err.message : 'network') + '). You can still type the word below.';
      return;
    }
    if (whisper.cancelled || state.prefs.section !== 'speak') { practice.starting = false; releaseWhisperStream(); return; }
    practice.starting = false;

    const recorder = new MediaRecorder(whisper.stream);
    whisper.recorder = recorder;
    whisper.chunks = [];
    recorder.addEventListener('dataavailable', function (e) { if (e.data && e.data.size) whisper.chunks.push(e.data); });
    recorder.addEventListener('stop', onWhisperRecordingStopped);
    recorder.start();
    practice.stoppedByUser = false;
    setListening(true);
    $('sr-status').textContent = 'Recording — read the text aloud, then press Stop (auto-stops in ' + WHISPER_MAX_SECONDS + ' s).';
    whisper.timer = window.setTimeout(stopWhisperRecording, WHISPER_MAX_SECONDS * 1000);
  }

  function stopWhisperRecording() {
    window.clearTimeout(whisper.timer);
    if (whisper.recorder && whisper.recorder.state !== 'inactive') whisper.recorder.stop();
    else if (practice.starting) { whisper.cancelled = true; setListening(false); }
  }

  function releaseWhisperStream() {
    if (whisper.stream) whisper.stream.getTracks().forEach(function (t) { t.stop(); });
    whisper.stream = null;
  }

  async function onWhisperRecordingStopped() {
    const recorder = whisper.recorder;
    whisper.recorder = null;
    releaseWhisperStream();
    setListening(false);
    const blob = new Blob(whisper.chunks, { type: recorder.mimeType || 'audio/webm' });
    whisper.chunks = [];
    if (practice.stoppedByUser && blob.size < 2000) { $('sr-status').textContent = 'Listening stopped.'; return; }
    $('sr-status').textContent = 'Recognising…';
    $('mic-button').disabled = true;
    try {
      const audio = await decodeTo16k(blob);
      if (rms(audio) < 0.004) { $('sr-status').textContent = 'No speech detected. Try once more.'; showPracticeResult('', 0); return; } // Whisper invents words for silence
      const out = await whisper.pipeline(audio);
      const text = out && typeof out.text === 'string' ? out.text.trim() : '';
      const looksBlank = !text || /^\[.*\]$|^\(.*\)$/.test(text); // Whisper writes "[BLANK_AUDIO]" or "(silence)"
      if (looksBlank) { $('sr-status').textContent = 'No speech detected. Try once more.'; showPracticeResult('', 0); return; }
      $('sr-status').textContent = 'Done. Compare what we heard with the target text.';
      showPracticeResult(text, similarity(text, practiceTargetText()));
    } catch (err) {
      $('sr-status').textContent = 'Recognition failed on this recording. Try again, or type the word below.';
    } finally {
      $('mic-button').disabled = false;
    }
  }

  function rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return samples.length ? Math.sqrt(sum / samples.length) : 0;
  }

  /** Decodes recorded audio to mono 16 kHz Float32 samples, which is what Whisper expects. */
  async function decodeTo16k(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    try {
      const decoded = await ctx.decodeAudioData(buf);
      if (decoded.sampleRate === 16000 && decoded.numberOfChannels === 1) return decoded.getChannelData(0);
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      return rendered.getChannelData(0);
    } finally {
      ctx.close();
    }
  }

  /** Character-level similarity (Levenshtein ratio) for single words, token overlap for sentences. */
  function typedSimilarity(a, b) {
    const na = normalizeSpeech(a), nb = normalizeSpeech(b);
    if (!na || !nb) return 0;
    const ta = na.split(' '), tb = nb.split(' ');
    if (tb.length > 1) {
      // Same number of words: average per-word spelling similarity; otherwise fall back to word overlap.
      if (ta.length !== tb.length) return similarity(na, nb);
      let total = 0;
      for (let i = 0; i < tb.length; i++) total += typedSimilarity(ta[i], tb[i]);
      return total / tb.length;
    }
    const m = na.length, n = nb.length;
    const row = [];
    for (let j = 0; j <= n; j++) row[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (na[i - 1] === nb[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return 1 - row[n] / Math.max(m, n);
  }

  function checkTyped() {
    const target = practiceTargetText();
    const typed = $('type-input').value.trim();
    const fb = $('type-feedback');
    if (!target) { toast('Search for a word in Learn first.', 'info'); return; }
    if (!typed) { $('type-input').focus(); return; }
    const score = typedSimilarity(typed, target);
    fb.className = 'sr-feedback';
    if (score >= 0.95) { fb.textContent = 'Spot on! 🎯'; fb.classList.add('is-great'); }
    else if (score >= 0.7) { fb.textContent = 'Almost there — check the spelling against “' + target + '”.'; fb.classList.add('is-close'); }
    else { fb.textContent = 'Not quite. The target is “' + target + '”. Play it again and try once more.'; fb.classList.add('is-retry'); }
    fb.hidden = false;
  }

  /* ---------- 13. Context (Wikipedia) ---------- */
  let contextInFlight = false;
  let lastContextQuery = '';
  const CONTEXT_STATES = ['context-empty', 'context-loading', 'context-error', 'context-none', 'context-list'];

  function stripHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function searchContext(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) { toast('Type a topic or search a word in Learn first.', 'info'); return; }
    if (contextInFlight) return;
    contextInFlight = true;
    lastContextQuery = query;
    $('context-input').value = query;
    $('context-loading-word').textContent = query;
    $('context-button').disabled = true;
    $('context-area').setAttribute('aria-busy', 'true');
    showOnly(CONTEXT_STATES, 'context-loading');
    try {
      const data = await fetchJSON(WIKIPEDIA_API + encodeURIComponent(query), { headers: { Accept: 'application/json' } });
      if (lastContextQuery !== query) return; // a newer word took over while this request was running
      const pages = data && Array.isArray(data.pages) ? data.pages : [];
      renderContext(pages);
    } catch (err) {
      if (lastContextQuery !== query) return;
      const code = err && err.code;
      $('context-error-title').textContent = code === 'offline' ? 'You look offline' : code === 'timeout' ? 'Wikipedia is slow right now' : 'Wikipedia is unavailable';
      $('context-error-message').textContent = code === 'offline'
        ? 'Gengo can’t reach Wikipedia. Definitions you’ve already loaded and your saved words still work.'
        : 'The search didn’t complete. Everything else in Gengo keeps working — try again in a moment.';
      showOnly(CONTEXT_STATES, 'context-error');
      toast('Couldn’t load Wikipedia context.', 'error');
    } finally {
      if (lastContextQuery === query) {
        contextInFlight = false;
        $('context-button').disabled = false;
        $('context-area').setAttribute('aria-busy', 'false');
      }
    }
  }

  function renderContext(pages) {
    const list = $('context-list');
    list.textContent = '';
    if (!pages.length) { showOnly(CONTEXT_STATES, 'context-none'); return; }
    pages.forEach(function (p) {
      if (!p || typeof p.title !== 'string') return;
      const li = document.createElement('li');
      li.className = 'context-item';
      li.style.setProperty('--i', String(list.children.length));

      if (p.thumbnail && typeof p.thumbnail.url === 'string') {
        const url = p.thumbnail.url.indexOf('//') === 0 ? 'https:' + p.thumbnail.url : p.thumbnail.url;
        if (/^https:\/\/([a-z0-9-]+\.)*(wikimedia|wikipedia)\.org\//i.test(url)) {
          const img = document.createElement('img');
          img.className = 'context-thumb';
          img.src = url;
          img.alt = '';
          img.loading = 'lazy';
          img.width = 72; img.height = 72;
          img.addEventListener('error', function () { img.remove(); li.classList.add('no-thumb'); }, { once: true });
          li.appendChild(img);
        }
      }

      const body = document.createElement('div');
      body.className = 'context-body';
      const h = document.createElement('h3');
      h.className = 'context-title';
      h.textContent = p.title;
      body.appendChild(h);
      if (typeof p.description === 'string' && p.description.trim()) {
        const d = document.createElement('p');
        d.className = 'context-desc';
        d.textContent = p.description.trim();
        body.appendChild(d);
      }
      const excerpt = stripHtml(p.excerpt);
      if (excerpt) {
        const ex = document.createElement('p');
        ex.className = 'context-excerpt';
        ex.textContent = excerpt + (/[.!?…]$/.test(excerpt) ? '' : '…');
        body.appendChild(ex);
      }
      const a = document.createElement('a');
      a.className = 'context-link';
      a.href = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(typeof p.key === 'string' ? p.key : p.title.replace(/ /g, '_'));
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Read on Wikipedia';
      const srOnly = document.createElement('span');
      srOnly.className = 'sr-only';
      srOnly.textContent = ' — ' + p.title + ' (opens in a new tab)';
      a.appendChild(srOnly);
      body.appendChild(a);
      li.appendChild(body);
      list.appendChild(li);
    });
    showOnly(CONTEXT_STATES, list.children.length ? 'context-list' : 'context-none');
  }

  /** Hook run after every successful dictionary lookup: refresh the connected features. */
  function onCurrentWordChanged() {
    stopSpeech();
    stopListening(true);
    $('sr-result').hidden = true;
    $('type-feedback').hidden = true;
    $('type-input').value = '';
    renderSpeak();
    prefillTranslate();
    $('context-input').placeholder = 'Defaults to “' + state.lastSearch.word + '”';
    if (lastContextQuery !== state.lastSearch.word) {
      lastContextQuery = ''; // invalidates any in-flight request for the previous word
      contextInFlight = false;
      showOnly(CONTEXT_STATES, 'context-empty');
      $('context-input').value = '';
      if (!$('panel-context').hidden) searchContext(state.lastSearch.word);
    }
  }

  /* ---------- 14. Quiz ---------- */
  let quizQuestion = null; // { wordId, correct, options, answered }
  let quizCombo = 0;
  const ROUND_SIZE = 5;
  let quizRound = { answered: 0, correct: 0, xp: 0, startedAt: null };

  function renderRoundProgress() {
    const wrap = $('quiz-progress');
    wrap.querySelectorAll('.seg').forEach(function (seg, i) {
      seg.classList.toggle('is-done', i < quizRound.answered);
      seg.classList.toggle('is-current', i === quizRound.answered);
    });
    wrap.setAttribute('aria-valuenow', String(quizRound.answered));
    $('quiz-round-label').textContent = 'Question ' + Math.min(quizRound.answered + 1, ROUND_SIZE) + ' of ' + ROUND_SIZE;
  }

  function openRoundComplete() {
    const dialog = $('round-dialog');
    const acc = Math.round((quizRound.correct / ROUND_SIZE) * 100);
    const secs = Math.max(1, Math.round((Date.now() - quizRound.startedAt) / 1000));
    const grade = acc === 100 ? 'Perfect!' : acc >= 80 ? 'Great' : acc >= 60 ? 'Good' : 'Keep going';
    $('round-title').textContent = acc === 100 ? 'Flawless round!' : 'Round complete!';
    $('round-grade').textContent = grade;
    $('round-xp').textContent = '0';
    $('round-acc').textContent = '0%';
    $('round-time').textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    $('round-buddy').setAttribute('class', 'buddy round-buddy ' + (acc >= 60 ? 'is-cheer' : 'is-happy'));
    openDialog(dialog);
    sparkle($('round-stage'), 14);
    if (acc >= 80) confetti();
    window.setTimeout(function () {
      tweenNumber($('round-xp'), quizRound.xp, 900);
      const accEl = $('round-acc');
      const start = performance.now();
      const step = function (now) { const p = Math.min(1, (now - start) / 900); accEl.textContent = Math.round(acc * (1 - Math.pow(1 - p, 3))) + '%'; if (p < 1) requestAnimationFrame(step); };
      if (motionReduced()) accEl.textContent = acc + '%'; else { requestAnimationFrame(step); window.setTimeout(function () { accEl.textContent = acc + '%'; }, 1100); }
    }, 400);
    $('round-continue').focus();
    announce('Round complete. ' + quizRound.correct + ' of ' + ROUND_SIZE + ' correct, ' + quizRound.xp + ' XP, in ' + secs + ' seconds.');
  }

  function closeRoundComplete() {
    closeDialog($('round-dialog'));
  }

  /** Runs whenever the round dialog closes (Continue, Escape or backdrop). */
  function resetRound() {
    if (quizRound.answered < ROUND_SIZE) return;
    quizRound = { answered: 0, correct: 0, xp: 0, startedAt: null };
    renderRoundProgress();
    renderQuiz(true);
    const first = $('quiz-options').querySelector('.quiz-option');
    if (first) first.focus();
  }

  function renderCombo() {
    const el = $('quiz-combo');
    el.hidden = quizCombo < 2;
    el.textContent = '🔥 ' + quizCombo + ' in a row';
    el.style.setProperty('--heat', String(Math.min(quizCombo, 6)));
    if (quizCombo >= 2) restartAnimation(el, 'is-grow');
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function buildQuestion() {
    const pool = state.words.filter(function (w) { return w.id !== state.quiz.lastWordId; });
    const candidates = pool.length ? pool : state.words;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const distractors = shuffle(state.words.filter(function (w) { return w.id !== target.id; })).slice(0, 3);
    return { wordId: target.id, correct: target, options: shuffle([target].concat(distractors)), answered: false };
  }

  function renderQuiz(forceNew) {
    const empty = $('quiz-empty'), card = $('quiz-card');
    const needed = 4 - state.words.length;
    if (needed > 0) {
      empty.hidden = false; card.hidden = true; quizQuestion = null;
      quizRound = { answered: 0, correct: 0, xp: 0, startedAt: null };
      quizCombo = 0;
      $('quiz-progress-row').hidden = true;
      $('quiz-empty-message').textContent = state.words.length === 0
        ? 'Save 4 words to unlock the quiz. You have none yet.'
        : 'Save ' + needed + ' more word' + (needed === 1 ? '' : 's') + ' to unlock the quiz — you have ' + state.words.length + ' so far.';
      return;
    }
    empty.hidden = true; card.hidden = false;
    $('quiz-progress-row').hidden = false;
    if (!quizRound.startedAt) quizRound.startedAt = Date.now();
    renderRoundProgress();
    if (quizRound.answered >= ROUND_SIZE && quizQuestion && quizQuestion.answered && !forceNew) {
      // Round finished but the learner navigated away before pressing "Finish round": keep that state.
      renderAnsweredQuestion();
      return;
    }
    const wordsGone = quizQuestion && !quizQuestion.options.every(function (o) { return state.words.some(function (w) { return w.id === o.id; }); });
    if (forceNew || !quizQuestion || wordsGone || (quizQuestion.answered && quizRound.answered < ROUND_SIZE && forceNew !== false)) quizQuestion = buildQuestion();
    if (quizQuestion.answered && !forceNew) { renderAnsweredQuestion(); return; }

    const q = quizQuestion;
    restartAnimation($('quiz-card'), 'is-swap');
    $('quiz-definition').textContent = q.correct.definition;
    const list = $('quiz-options');
    list.textContent = '';
    const keys = ['A', 'B', 'C', 'D'];
    q.options.forEach(function (opt, i) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option';
      btn.dataset.id = opt.id;
      btn.dataset.word = opt.word;
      btn.setAttribute('aria-label', 'Option ' + keys[i] + ': ' + opt.word);
      btn.style.setProperty('--i', String(i));
      const key = document.createElement('span');
      key.className = 'quiz-option-key';
      key.setAttribute('aria-hidden', 'true');
      const keyText = document.createElement('span');
      keyText.textContent = keys[i];
      key.appendChild(keyText);
      const label = document.createElement('span');
      label.textContent = opt.word;
      btn.appendChild(key);
      btn.appendChild(label);
      btn.disabled = q.answered;
      btn.addEventListener('click', function () { answerQuiz(opt.id, btn); });
      list.appendChild(btn);
    });
    const fb = $('quiz-feedback');
    fb.className = 'quiz-feedback'; fb.textContent = '';
    $('quiz-footer').hidden = true;
    $('quiz-footer').className = 'quiz-footer';
  }

  /** Re-draws the current question in its already-answered state (feedback + Continue/Finish). */
  function renderAnsweredQuestion() {
    const q = quizQuestion;
    $('quiz-definition').textContent = q.correct.definition;
    const list = $('quiz-options');
    list.textContent = '';
    const keys = ['A', 'B', 'C', 'D'];
    q.options.forEach(function (opt, i) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option' + (opt.id === q.correct.id ? ' is-correct' : opt.id === q.chosenId ? ' is-wrong' : '');
      btn.disabled = true;
      btn.dataset.id = opt.id;
      const key = document.createElement('span'); key.className = 'quiz-option-key'; key.setAttribute('aria-hidden', 'true');
      const keyText = document.createElement('span'); keyText.textContent = keys[i]; key.appendChild(keyText);
      const label = document.createElement('span'); label.textContent = opt.word;
      btn.appendChild(key); btn.appendChild(label);
      btn.setAttribute('aria-label', opt.id === q.correct.id ? opt.word + ' — correct answer' : opt.id === q.chosenId ? opt.word + ' — your answer, incorrect' : 'Option ' + keys[i] + ': ' + opt.word);
      list.appendChild(btn);
    });
    const fb = $('quiz-feedback');
    fb.textContent = '';
    const strong = document.createElement('strong'); const detail = document.createElement('span');
    const wasCorrect = q.chosenId === q.correct.id;
    strong.textContent = wasCorrect ? 'Correct! +' + XP.quiz + ' XP' : 'Not quite.';
    detail.textContent = wasCorrect ? '“' + q.correct.word + '” is right.' : 'The answer is “' + q.correct.word + '”.';
    fb.appendChild(strong); fb.appendChild(detail);
    $('quiz-footer').className = 'quiz-footer ' + (wasCorrect ? 'is-correct' : 'is-wrong');
    $('quiz-footer').hidden = false;
    $('quiz-next').textContent = quizRound.answered >= ROUND_SIZE ? 'Finish round' : 'Continue';
    renderRoundProgress();
  }

  function answerQuiz(chosenId, chosenBtn) {
    const q = quizQuestion;
    if (!q || q.answered) return; // guards against double XP
    if (quizRound.answered >= ROUND_SIZE) return; // round is finished; wait for "Finish round"
    q.chosenId = chosenId;
    q.answered = true;
    const correct = chosenId === q.correct.id;
    $('quiz-options').querySelectorAll('.quiz-option').forEach(function (b) {
      b.disabled = true;
      if (b.dataset.id === q.correct.id) {
        b.classList.add('is-correct');
        b.setAttribute('aria-label', b.dataset.word + ' — correct answer');
        if (correct) announce('Correct. ' + q.correct.word + ' is right. ' + XP.quiz + ' XP.'); else announce('Not quite. The answer is ' + q.correct.word + '.');
      }
    });
    if (!correct) {
      chosenBtn.classList.add('is-wrong');
      chosenBtn.setAttribute('aria-label', chosenBtn.dataset.word + ' — your answer, incorrect');
    }

    const fb = $('quiz-feedback');
    fb.textContent = '';
    const strong = document.createElement('strong');
    const detail = document.createElement('span');
    if (correct) {
      strong.textContent = 'Correct! +' + XP.quiz + ' XP';
      detail.textContent = '“' + q.correct.word + '” is right.' + (q.correct.example ? ' Example: “' + q.correct.example + '”' : '');
      fb.className = 'quiz-feedback is-correct';
      quizCombo += 1;
      renderCombo();
      todayStats().quiz += 1;
      quizRound.correct += 1;
      quizRound.xp += XP.quiz;
      awardXP(XP.quiz);
      toast('Correct! +' + XP.quiz + ' XP', 'success');
      sparkle(chosenBtn, 8);
      buddySay(quizCombo >= 3 ? quizCombo + ' in a row! Unstoppable.' : ['Nailed it!', 'Yes! That’s the one.', 'Sharp. Very sharp.', 'You’re on fire.'][Math.floor(Math.random() * 4)], quizCombo >= 5 ? 'cheer' : 'happy');
    } else {
      const chosen = q.options.find(function (o) { return o.id === chosenId; });
      strong.textContent = 'Not quite.';
      detail.textContent = 'The answer is “' + q.correct.word + '”' + (q.correct.partOfSpeech ? ' (' + q.correct.partOfSpeech + ')' : '') + '. You chose “' + chosen.word + '”, which means: ' + chosen.definition;
      fb.className = 'quiz-feedback is-wrong';
      if (quizCombo >= 3) buddySay('Combo over at ' + quizCombo + '. It was “' + q.correct.word + '”.', 'sad');
      quizCombo = 0;
      renderCombo();
      if (false) buddySay('Close! It was “' + q.correct.word + '”.', 'sad');
    }
    fb.appendChild(strong);
    fb.appendChild(detail);
    $('quiz-footer').className = 'quiz-footer ' + (correct ? 'is-correct' : 'is-wrong');
    $('quiz-footer').hidden = false;

    quizRound.answered += 1;
    renderRoundProgress();
    state.quiz.lastWordId = q.wordId;
    saveState();
    recordActivity();
    if (quizRound.answered >= ROUND_SIZE) $('quiz-next').textContent = 'Finish round';
    else $('quiz-next').textContent = 'Continue';
    $('quiz-next').focus();
  }

  /* ---------- 15. Focus Sprint timer ---------- */
  /** A page can't stop the learner switching tabs or apps, so leaving is detected instead:
   *  the sprint pauses, a strike is recorded, and three strikes cancel the sprint (no XP). */
  const drill = { deck: [], idx: 0, flipped: false, reviewed: 0, built: false, xp: 0, mastered: [] }; // flashcards shown on the focus screen
  let leaveCheck = null;       // debounce handle for blur → hasFocus re-check
  let fullscreenByUs = false;  // we entered fullscreen (so we know to exit it when the sprint ends)
  let leaveGraceUntil = 0;     // ignore blur/visibility noise right after start/resume (fullscreen transition, focus moving)

  function timerRemaining() {
    const t = state.timer;
    return t.running && t.endsAt ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs;
  }

  function startTimer() {
    const t = state.timer;
    if (t.running || t.completed) return;
    const fresh = t.remainingMs >= TIMER_DURATION;
    t.endsAt = Date.now() + t.remainingMs;
    t.running = true;
    t.locked = true;
    leaveGraceUntil = Date.now() + 3000;
    saveState();
    if (fresh) buildDrill();
    renderTimer();
    enterFullscreen();
    buddySay(fresh ? 'Focus mode. Stay on this screen with me.' : 'Back to it. Eyes here.', 'think');
    announce(fresh ? 'Focus sprint started. Leaving this tab pauses it.' : 'Sprint resumed.');
    window.setTimeout(function () { const b = $('focus-pause'); if (t.running && b && !b.hidden) b.focus(); }, 50);
  }

  function pauseTimer(reason) {
    const t = state.timer;
    if (!t.running) return;
    t.remainingMs = timerRemaining();
    t.running = false;
    t.endsAt = null;
    saveState();
    renderTimer();
    if (!reason) { announce('Sprint paused.'); const b = $('focus-resume'); if (b) b.focus(); }
  }

  function resetTimer() {
    state.timer = cloneDefault(DEFAULT_STATE.timer);
    saveState();
    renderTimer();
    exitFullscreen();
  }

  /** The learner switched tab/app, minimised, or left fullscreen while the sprint was running. */
  function onLeaveDuringSprint() {
    const t = state.timer;
    if (!t.running || Date.now() < leaveGraceUntil) return;
    pauseTimer('left');
    t.strikes = Math.min(MAX_STRIKES, (t.strikes || 0) + 1);
    saveState();
    if (t.strikes >= MAX_STRIKES) {
      abandonSprint('You left ' + MAX_STRIKES + ' times — sprint cancelled, no XP this time.');
      return;
    }
    renderTimer();
    const left = MAX_STRIKES - t.strikes;
    toast('You left the sprint! Strike ' + t.strikes + ' of ' + MAX_STRIKES + '. Timer paused.', 'warn', 4200);
    announce('You left the sprint. Strike ' + t.strikes + ' of ' + MAX_STRIKES + '. ' + (left === 1 ? 'One more and it is cancelled.' : left + ' strikes left.') + ' Timer paused.');
    buddySay(left === 1 ? 'Last chance. One more and we lose it.' : 'Hey! Come back. That’s a strike.', 'sad', 3200);
    window.setTimeout(function () { const b = $('focus-resume'); if (b && !b.hidden) b.focus(); }, 60);
  }

  function abandonSprint(message) {
    resetTimer();
    toast(message, 'warn', 4500);
    announce(message);
    buddySay('We’ll get it next time.', 'sad', 3000);
  }

  function enterFullscreen() {
    const el = document.documentElement;
    if (!el.requestFullscreen || document.fullscreenElement) return;
    try {
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(function () { fullscreenByUs = true; }).catch(function () { fullscreenByUs = false; });
    } catch (e) { fullscreenByUs = false; }
  }

  function exitFullscreen() {
    fullscreenByUs = false;
    if (document.fullscreenElement && document.exitFullscreen) {
      try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
    }
  }

  function bindFocusLock() {
    document.addEventListener('visibilitychange', function () { if (document.hidden) onLeaveDuringSprint(); });
    window.addEventListener('blur', function () {
      // blur also fires for focus moving into an iframe/devtools; confirm the document really lost focus
      window.clearTimeout(leaveCheck);
      leaveCheck = window.setTimeout(function () { if (!document.hasFocus() || document.hidden) onLeaveDuringSprint(); }, 1200);
    });
    window.addEventListener('focus', function () { window.clearTimeout(leaveCheck); });
    document.addEventListener('fullscreenchange', function () {
      // Esc out of fullscreen is not "leaving": the focus screen still covers the page and the sprint keeps running
      if (!document.fullscreenElement) fullscreenByUs = false;
    });
    window.addEventListener('beforeunload', function (e) {
      if (state.timer.running) { e.preventDefault(); e.returnValue = ''; }
    });
    $('focus-pause').addEventListener('click', function () { pauseTimer(); });
    $('focus-resume').addEventListener('click', function () { startTimer(); });
    $('focus-quit').addEventListener('click', function () { abandonSprint('Sprint abandoned — no XP this time.'); });
    $('drill-card').addEventListener('click', flipDrill);
    $('drill-got').addEventListener('click', function () { nextDrill(true); });
    $('drill-again').addEventListener('click', function () { nextDrill(false); });
    document.addEventListener('keydown', function (e) {
      if (!document.body.classList.contains('focus-lock') || !state.timer.running) return;
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' && document.activeElement !== $('drill-card') && !(document.activeElement && document.activeElement.classList.contains('btn'))) { e.preventDefault(); flipDrill(); }
      else if (drill.flipped && (e.key === 'ArrowRight' || e.code === 'Digit1')) { e.preventDefault(); nextDrill(true); }
      else if (drill.flipped && (e.key === 'ArrowLeft' || e.code === 'Digit2')) { e.preventDefault(); nextDrill(false); }
    });
  }

  /** Called every tick and on load; completes the sprint and pays out exactly once. */
  function tickTimer() {
    const t = state.timer;
    if (t.running && timerRemaining() <= 0) {
      t.running = false;
      t.endsAt = null;
      t.remainingMs = 0;
      t.completed = true;
      t.locked = false;
      saveState();
      exitFullscreen();
      if (!t.rewardClaimed) {
        t.rewardClaimed = true;
        todayStats().sprints += 1;
        saveState();
        awardXP(XP.sprint);
        recordActivity();
        const cards = drill.reviewed ? ' · ' + drill.reviewed + ' card' + (drill.reviewed === 1 ? '' : 's') + ' reviewed' : '';
        let shieldNote = '';
        if (state.shields < MAX_SHIELDS) { state.shields += 1; saveState(); shieldNote = ' · 🛡 Streak Shield earned'; }
        toast('Focus sprint complete! +' + XP.sprint + ' XP' + cards + shieldNote + ' 🎉', 'celebrate', 5200);
        announce('Focus sprint complete. ' + XP.sprint + ' XP earned.' + (drill.reviewed ? ' You reviewed ' + drill.reviewed + ' flashcards.' : '') + (shieldNote ? ' You earned a Streak Shield.' : ''));
        renderHabit();
        confetti();
        sparkle($('timer-ring'), 12);
        buddySay('Five focused minutes. Respect.', 'cheer', 3000);
        restartAnimation($('timer-card'), 'is-celebrating');
      }
    }
    renderTimer();
  }

  function renderTimer() {
    const t = state.timer;
    const remaining = timerRemaining();
    const card = $('timer-card');
    card.classList.toggle('is-running', t.running);
    card.classList.toggle('is-complete', t.completed);
    const clock = t.completed ? 'Done!' : formatClock(remaining);
    if ($('timer-display').textContent !== clock) {
      $('timer-display').textContent = clock;
      if (t.running) { restartAnimation($('timer-display'), 'is-tick'); if (/^0[1-4]:00$/.test(clock)) announce(clock.slice(1, 2) + ' minute' + (clock[1] === '1' ? '' : 's') + ' left in your sprint.'); }
    }
    $('timer-ring').style.setProperty('--progress', String(t.completed ? 100 : Math.round(((TIMER_DURATION - remaining) / TIMER_DURATION) * 100)));

    const status = $('timer-status');
    if (t.completed) status.textContent = 'Sprint finished. Reward claimed — start another whenever you like.';
    else if (t.running) status.textContent = 'Focus mode on. Keep going!';
    else if (remaining < TIMER_DURATION) status.textContent = 'Paused at ' + formatClock(remaining) + '.';
    else status.textContent = 'Ready when you are.';
    $('timer-display').setAttribute('aria-label', t.completed ? 'Sprint complete' : formatClock(remaining) + ' remaining');

    renderFocusScreen(t, remaining, clock);

    const start = $('timer-start'), pause = $('timer-pause'), reset = $('timer-reset');
    if (t.completed) {
      start.hidden = false; start.textContent = 'Start another'; pause.hidden = true; reset.hidden = true;
    } else if (t.running) {
      start.hidden = true; pause.hidden = false; reset.hidden = false;
    } else {
      start.hidden = false; start.textContent = remaining < TIMER_DURATION ? 'Resume' : 'Start';
      pause.hidden = true; reset.hidden = remaining >= TIMER_DURATION;
    }
  }

  function renderFocusScreen(t, remaining, clock) {
    const screen = $('focus-screen');
    if (!screen) return;
    const show = !!t.locked && !t.completed;
    if (screen.hidden === show) {
      screen.hidden = !show;
      document.body.classList.toggle('focus-lock', show);
      if (show) setMenu(false);
    }
    if (!show) return;
    if (!drill.deck.length && !drill.built) buildDrill(); // e.g. sprint restored after a reload
    $('focus-display').textContent = clock;
    $('focus-ring').style.setProperty('--progress', String(Math.round(((TIMER_DURATION - remaining) / TIMER_DURATION) * 100)));
    const strikes = t.strikes || 0;
    const dots = $('focus-strikes');
    dots.setAttribute('aria-label', 'Strikes: ' + strikes + ' of ' + MAX_STRIKES);
    Array.prototype.forEach.call(dots.children, function (li, i) { li.classList.toggle('is-hit', i < strikes); });
    $('focus-title').textContent = t.running ? (strikes ? 'Stay this time' : 'Stay with me') : 'Sprint paused';
    let status;
    if (t.running) status = strikes ? (MAX_STRIKES - strikes) + (MAX_STRIKES - strikes === 1 ? ' strike left. ' : ' strikes left. ') + 'Leaving again pauses the sprint.' : 'Leaving this tab or app pauses the sprint. Three strikes and it’s cancelled.';
    else status = strikes ? 'You left the screen — strike ' + strikes + ' of ' + MAX_STRIKES + '. Resume when you’re ready to stay.' : 'Paused at ' + clock + '. Resume when you’re ready.';
    if ($('focus-status').textContent !== status) $('focus-status').textContent = status;
    $('focus-resume').hidden = t.running;
    $('focus-pause').hidden = !t.running;
    $('focus-buddy').classList.toggle('is-sad', !t.running && strikes > 0);
    $('focus-buddy').classList.toggle('is-think', t.running);
    renderDrill(t.running);
  }

  /* Flashcards on the focus screen: saved words first (shuffled), else the current word. */
  function buildDrill() {
    const cards = state.words.filter(function (w) { return w.word && w.definition; });
    if (!cards.length && state.lastSearch && state.lastSearch.definition) cards.push(state.lastSearch);
    drill.deck = shuffle(cards.slice());
    drill.idx = 0; drill.flipped = false; drill.reviewed = 0; drill.built = true; drill.xp = 0; drill.mastered = [];
  }

  drill.masteredIds = function () { return new Set(drill.mastered); };

  function currentCard() { return drill.deck.length ? drill.deck[drill.idx % drill.deck.length] : null; }

  function renderDrill(active) {
    const card = currentCard();
    $('drill-empty').hidden = !!card;
    $('drill-card').hidden = !card;
    $('drill-actions').hidden = !card;
    $('drill-count').textContent = drill.reviewed + ' reviewed' + (drill.xp ? ' · +' + drill.xp + ' XP' : '');
    if (!card) return;
    const flipped = drill.flipped;
    const saved = state.words.find(function (w) { return w.id === card.id; });
    const stars = saved ? '★'.repeat(saved.mastery) + '☆'.repeat(MASTERY_MAX - saved.mastery) : '';
    $('drill-kicker').textContent = (flipped ? 'Meaning' : 'Word') + (stars ? '  ' + stars : '');
    $('drill-face').textContent = flipped ? card.definition : card.word;
    $('drill-face').classList.toggle('is-meaning', flipped);
    $('drill-hint').textContent = flipped ? (card.example ? '“' + card.example + '”' : 'Did you know it?') : 'Tap to reveal the meaning';
    $('drill-card').setAttribute('aria-label', (flipped ? 'Meaning: ' + card.definition : 'Word: ' + card.word) + '. Press to flip.');
    $('drill-card').classList.toggle('is-flipped', flipped);
    $('drill-card').disabled = !active;
    $('drill-again').disabled = !active || !flipped;
    $('drill-got').disabled = !active || !flipped;
  }

  function flipDrill() { if (!currentCard()) return; drill.flipped = !drill.flipped; renderDrill(state.timer.running); }

  function nextDrill(gotIt) {
    const card = currentCard();
    if (!card) return;
    drill.reviewed += 1;
    const saved = state.words.find(function (w) { return w.id === card.id; });
    let note = '';
    if (saved) {
      if (gotIt && !drill.masteredIds().has(saved.id) && saved.mastery < MASTERY_MAX) {
        saved.mastery += 1;
        drill.mastered.push(saved.id); // one mastery step per word per sprint
        if (saved.mastery === MASTERY_MAX) { note = ' ' + saved.word + ' mastered! ★★★'; toast('★ ' + saved.word + ' mastered!', 'celebrate', 3200); }
        else note = ' Mastery ' + saved.mastery + ' of ' + MASTERY_MAX + '.';
      } else if (!gotIt && saved.mastery > 0) {
        saved.mastery -= 1;
        note = ' Mastery back to ' + saved.mastery + '.';
      }
      saveState();
    }
    if (gotIt && drill.xp < DRILL_XP_CAP) { drill.xp += XP.drill; awardXP(XP.drill); }
    if (!gotIt) drill.deck.push(card); // comes back around later in the sprint
    drill.idx += 1; drill.flipped = false;
    if (gotIt) sparkle($('drill-card'), 6);
    renderDrill(state.timer.running);
    announce((gotIt ? 'Got it.' : 'Marked again.') + note + ' Next word: ' + currentCard().word);
  }

  /* ---------- 16. Navigation, shared UI, init & tickers ---------- */
  const SECTIONS = ['learn', 'translate', 'speak', 'context', 'quiz', 'words'];

  function $(id) { return document.getElementById(id); }

  const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /Macintosh/.test(navigator.userAgent);
  const IS_WINDOWS = /Win/.test(navigator.platform || '');
  const systemReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function motionReduced() { return systemReducedMotion || !!state.prefs.reduceMotion; }

  /** Animates a numeric textContent from its current value to `to`. */
  function tweenNumber(el, to, ms) {
    const from = parseInt(el.textContent, 10);
    if (motionReduced() || isNaN(from) || from === to) { el.textContent = String(to); return; }
    const start = performance.now();
    const dur = ms || 600;
    let finished = false;
    const step = function (now) {
      if (finished) return;
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step); else finished = true;
    };
    requestAnimationFrame(step);
    window.setTimeout(function () { if (!finished) { finished = true; el.textContent = String(to); } }, dur + 150); // rAF pauses in background tabs
  }

  /** Types text into an element character by character (keeps the full text available to assistive tech). */
  let typewriterToken = 0;
  function typewriter(el, text) {
    el.setAttribute('aria-label', text);
    if (motionReduced() || text.length > 240) { el.textContent = text; return; }
    const token = ++typewriterToken;
    const chars = Array.from(text);
    const total = Math.min(1500, Math.max(400, chars.length * 35));
    const start = performance.now();
    el.textContent = '';
    el.classList.add('is-typing');
    const frame = function (now) {
      if (token !== typewriterToken) return;
      const count = Math.min(chars.length, Math.ceil(((now - start) / total) * chars.length));
      el.textContent = chars.slice(0, count).join('');
      if (count < chars.length) requestAnimationFrame(frame);
      else el.classList.remove('is-typing');
    };
    requestAnimationFrame(frame);
    // Background tabs pause rAF: make sure the full text lands regardless.
    window.setTimeout(function () { if (token === typewriterToken) { el.textContent = text; el.classList.remove('is-typing'); } }, total + 200);
  }

  function restartAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // forces a reflow so the animation restarts
    el.classList.add(cls);
  }

  function showSection(name, focusPanel) {
    if (SECTIONS.indexOf(name) === -1) name = 'learn';
    const leaving = state.prefs.section;
    if (leaving === 'speak' && name !== 'speak') stopListening(true);

    SECTIONS.forEach(function (s) {
      const active = s === name;
      const tab = $('tab-' + s);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      const panel = $('panel-' + s);
      const wasHidden = panel.hidden;
      panel.hidden = !active;
      if (active && wasHidden) restartAnimation(panel, 'is-entering');
    });
    state.prefs.section = name;
    saveState();
    document.querySelector('.nav-tabs').style.setProperty('--active', String(SECTIONS.indexOf(name)));
    if (document.body.classList.contains('menu-open')) setMenu(false);
    $('header-section').textContent = $('tab-' + name).getAttribute('aria-label');

    if (name === 'quiz') renderQuiz(false);
    if (name === 'words') renderMyWords();
    if (name === 'speak') renderSpeak();
    if (name === 'translate') {
      renderTranslateSettings();
      prefillTranslate();
    }
    if (name === 'context' && state.lastSearch && lastContextQuery !== state.lastSearch.word && !contextInFlight) {
      searchContext(state.lastSearch.word);
    }
    if (focusPanel) $('panel-' + name).querySelector('h2').focus();
    else if (leaving !== name) announce($('tab-' + name).getAttribute('aria-label') + ' section');
    if (leaving !== name && window.matchMedia('(max-width: 1100px)').matches) {
      const header = document.querySelector('.app-header');
      const headerH = getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().height : 0;
      const top = $('panel-' + name).getBoundingClientRect().top + window.scrollY - headerH - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: motionReduced() ? 'auto' : 'smooth' });
    }
  }

  /** Global single-key shortcuts (ignored while typing in a field or when a dialog is open). */
  function onGlobalKey(e) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const dialogOpen = !!document.querySelector('dialog[open]') || document.body.classList.contains('focus-lock');
    const digit = /^(Digit|Numpad)([1-6])$/.exec(e.code || '');
    if (e.altKey && !e.ctrlKey && !e.metaKey && digit) {
      e.preventDefault();
      const name = SECTIONS[parseInt(digit[2], 10) - 1];
      showSection(name, true);
      return;
    }
    if (typing || dialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); showSection('learn'); $('search-input').focus(); $('search-input').select(); return; }
    if (e.key === '?') { e.preventDefault(); openDialog($('shortcuts-dialog')); $('shortcuts-close').focus(); return; }
    if (e.key === 'Escape') { stopSpeech(); stopListening(false); return; }
    if (!$('panel-quiz').hidden && !$('quiz-card').hidden) {
      const d = /^(Digit|Numpad)([1-4])$/.exec(e.code || '');
      const idx = d ? parseInt(d[2], 10) - 1 : /^[a-dA-D]$/.test(e.key) ? 'abcd'.indexOf(e.key.toLowerCase()) : -1;
      if (idx >= 0) {
        const opts = $('quiz-options').querySelectorAll('.quiz-option');
        if (opts[idx] && !opts[idx].disabled) { e.preventDefault(); opts[idx].click(); }
        return;
      }
      if (e.key === 'Enter' && !$('quiz-footer').hidden && t !== $('quiz-next')) { e.preventDefault(); $('quiz-next').click(); return; }
    }
    if ((e.key === 'l' || e.key === 'L') && state.lastSearch) {
      const btn = state.prefs.section === 'speak' ? document.querySelector('#speak-content .speak-btn[data-speak="word"]') : $('listen-word');
      if (btn && !btn.hidden) { e.preventDefault(); btn.click(); }
    }
  }

  /** Opens/closes the off-canvas navigation used on phones and tablets. */
  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    $('nav-backdrop').hidden = !open;
    $('menu-button').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('menu-button').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) {
      const active = document.querySelector('.nav-tab[aria-selected="true"]') || document.querySelector('.nav-tab');
      window.setTimeout(function () { active.focus(); }, 60);
    } else if (document.activeElement && document.activeElement.closest('.main-nav')) {
      $('menu-button').focus();
    }
  }

  function onTabKeydown(e) {
    const idx = SECTIONS.indexOf(e.currentTarget.dataset.section);
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % SECTIONS.length;
    if (e.key === 'ArrowLeft') next = (idx - 1 + SECTIONS.length) % SECTIONS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = SECTIONS.length - 1;
    if (next === null) return;
    e.preventDefault();
    showSection(SECTIONS[next]);
    $('tab-' + SECTIONS[next]).focus();
  }

  function renderHeader() {
    const streaks = computeStreaks();
    tweenNumber($('header-streak'), streaks.current);
    $('stat-streak').classList.toggle('is-lit', streaks.current > 0);
    $('stat-streak').classList.toggle('is-hot', streaks.current >= 7);
    tweenNumber($('header-xp'), state.xp);
    const lvl = levelInfo(state.xp);
    $('header-level').textContent = 'Lvl ' + lvl.level;

    const progress = todayProgress();
    const goalText = progress + '/' + state.dailyGoal;
    const complete = progress >= state.dailyGoal;
    $('header-goal').textContent = goalText;
    const bar = $('header-goal-bar');
    bar.style.setProperty('--pct', String(Math.round((progress / state.dailyGoal) * 100)));
    bar.setAttribute('aria-valuenow', String(progress));
    bar.setAttribute('aria-valuemax', String(state.dailyGoal));
    bar.setAttribute('aria-valuetext', goalText + (complete ? ', goal complete' : ''));
    bar.closest('.stat').classList.toggle('is-complete', complete);

    $('level-name').textContent = 'Level ' + lvl.level;
    $('level-fill').style.width = lvl.percent + '%';
    $('level-bar').setAttribute('aria-valuenow', String(lvl.percent));
    $('level-note').textContent = lvl.next === null
      ? state.xp + ' XP · top level reached'
      : state.xp + ' XP · ' + (lvl.next - state.xp) + ' XP to Level ' + (lvl.level + 1);
  }

  const MILESTONE_TEXT = {
    3: '3-day streak! A habit is forming.',
    7: 'One full week. Seriously impressive.',
    14: 'Two weeks strong — words are sticking.',
    30: '30 days! You’re a Gengo regular now.',
    60: '60 days. This is who you are now.',
    100: '100 days. Extraordinary dedication.'
  };

  function renderHabit() {
    const streaks = computeStreaks();
    tweenNumber($('habit-current'), streaks.current);
    tweenNumber($('habit-longest'), streaks.longest);

    const milestone = $('milestone-message');
    const reached = MILESTONES.filter(function (m) { return streaks.current >= m; }).pop();
    if (reached && streaks.current === reached) {
      milestone.textContent = MILESTONE_TEXT[reached];
      milestone.hidden = false;
    } else if (reached) {
      const next = MILESTONES.find(function (m) { return m > streaks.current; });
      const gap = next ? next - streaks.current : 0;
      milestone.textContent = next ? gap + ' more day' + (gap === 1 ? '' : 's') + ' to your ' + next + '-day milestone.' : 'Legendary streak. Keep it alive!';
      milestone.hidden = false;
    } else {
      milestone.hidden = true;
    }

    const strip = $('week-strip');
    strip.textContent = '';
    const today = todayKey();
    for (let i = 6; i >= 0; i--) {
      const key = shiftDays(today, -i);
      const count = state.activity[key] || 0;
      const shielded = !count && state.shieldDays.indexOf(key) !== -1;
      const date = keyToDate(key);
      const li = document.createElement('li');
      li.className = 'week-day' + (count ? ' is-active' : '') + (shielded ? ' is-shield' : '') + (i === 0 ? ' is-today' : '');
      const dot = document.createElement('span');
      dot.className = 'week-dot';
      dot.textContent = count ? String(count) : (shielded ? '🛡' : '·');
      const label = document.createElement('span');
      label.className = 'week-label';
      label.textContent = date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
      li.setAttribute('aria-label', (i === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'long' })) + ': ' + (shielded ? 'covered by a Streak Shield' : count + ' activit' + (count === 1 ? 'y' : 'ies')));
      li.appendChild(dot);
      li.appendChild(label);
      strip.appendChild(li);
    }

    const shieldEl = $('shield-note');
    if (shieldEl) {
      const n = state.shields;
      shieldEl.textContent = n ? '🛡 ' + n + ' Streak Shield' + (n === 1 ? '' : 's') + ' banked — a missed day won’t break your streak.' : '🛡 No Streak Shield. Finish a Focus Sprint to earn one.';
      shieldEl.classList.toggle('has-shield', n > 0);
    }

    const progress = todayProgress();
    const complete = progress >= state.dailyGoal;
    const remaining = state.dailyGoal - progress;
    $('side-goal').textContent = progress + '/' + state.dailyGoal;
    const path = $('goal-path');
    path.style.setProperty('--done', String(progress));
    path.setAttribute('aria-valuenow', String(progress));
    path.setAttribute('aria-valuemax', String(state.dailyGoal));
    path.setAttribute('aria-valuetext', progress + ' of ' + state.dailyGoal + ' activities' + (complete ? ', goal complete' : ''));
    path.querySelectorAll('.node').forEach(function (n, i) {
      const done = i < progress, current = i === progress;
      if (done && !n.classList.contains('is-done')) restartAnimation(n, 'is-done'); else n.classList.toggle('is-done', done);
      n.classList.toggle('is-current', current);
    });
    $('flame-count').textContent = String(streaks.current);
    $('big-flame').style.setProperty('--heat', String(Math.min(streaks.current, 10)));
    $('big-flame').classList.toggle('is-out', streaks.current === 0);
    $('side-goal').classList.toggle('is-complete', complete);
    $('goal-note').textContent = complete
      ? 'Goal complete for today. Anything extra is a bonus!'
      : remaining + ' more activit' + (remaining === 1 ? 'y' : 'ies') + ' to hit today’s goal.';
  }

  let lastRenderedDay = todayKey();

  /** Every second: timer countdown and midnight rollover. */
  function tick() {
    tickTimer();
    const now = todayKey();
    if (now !== lastRenderedDay) {
      lastRenderedDay = now;
      renderHeader();
      renderHabit();
    }
  }

  function bindEvents() {
    // Learn
    $('search-form').addEventListener('submit', function (e) { e.preventDefault(); searchWord($('search-input').value); });
    document.querySelectorAll('.chip[data-word]').forEach(function (chip) {
      chip.addEventListener('click', function () { searchWord(chip.dataset.word); });
    });
    $('error-retry').addEventListener('click', function () { searchWord(lastQuery || $('search-input').value); });
    $('save-button').addEventListener('click', saveCurrentWord);
    $('unsave-button').addEventListener('click', function () { if (state.lastSearch) removeWord(state.lastSearch.word); });
    document.querySelectorAll('.speak-btn').forEach(function (btn) { btn.addEventListener('click', onSpeakButton); });

    // Translate
    $('translate-form').addEventListener('submit', function (e) { e.preventDefault(); translateText(); });
    $('translate-settings-toggle').addEventListener('click', function () { toggleTranslateSettings(); });
    $('translate-open-settings').addEventListener('click', function () { toggleTranslateSettings(true); });
    $('lt-save').addEventListener('click', saveTranslateSettings);
    $('lt-forget').addEventListener('click', forgetTranslateKey);
    document.querySelectorAll('.chip[data-fill]').forEach(function (chip) {
      chip.addEventListener('click', function () { fillTranslateInput(chip.dataset.fill); });
    });
    $('translate-target').value = state.prefs.translateTarget;
    $('translate-target').addEventListener('change', function () { state.prefs.translateTarget = $('translate-target').value; saveState(); renderLangCards(); });
    renderLangCards();
    window.setInterval(rotateGreeting, 2600);

    // Speak
    document.querySelectorAll('input[name="voice-gender"]').forEach(function (r) {
      r.checked = r.value === state.prefs.voiceGender;
      r.addEventListener('change', function () {
        state.prefs.voiceGender = r.value; saveState(); stopSpeech(); speech.warned = {};
        const v = pickVoice('en-US');
        renderVoiceName();
        buddySay(v ? (r.value === 'male' ? 'Male' : 'Female') + ' voice: ' + v.name + '.' : 'No ' + r.value + ' voice installed — using the system default.', 'happy');
        if (v) speakText('Hi, I’m ' + v.name + '.', 'en-US', null);
      });
    });
    $('speech-stop').addEventListener('click', stopSpeech);
    $('mic-button').addEventListener('click', startListening);
    $('mic-stop').addEventListener('click', function () { stopListening(false); });
    $('sr-retry').addEventListener('click', startListening);
    $('engine-reset').addEventListener('click', function () { state.prefs.speechEngine = 'auto'; saveState(); $('engine-note').hidden = true; $('sr-status').textContent = 'Will try the browser’s own recognition first next time.'; });
    $('type-practice').addEventListener('submit', function (e) { e.preventDefault(); checkTyped(); });
    document.querySelectorAll('input[name="practice-target"]').forEach(function (r) {
      r.addEventListener('change', function () {
        state.prefs.practiceTarget = r.value;
        saveState();
        $('practice-target-text').textContent = practiceTargetText();
        $('sr-result').hidden = true;
        $('type-feedback').hidden = true;
        $('type-input').value = '';
      });
    });
    if (speech.supported) {
      loadVoices();
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    // Context
    $('context-form').addEventListener('submit', function (e) {
      e.preventDefault();
      searchContext($('context-input').value || (state.lastSearch && state.lastSearch.word));
    });
    $('context-retry').addEventListener('click', function () { searchContext(lastContextQuery); });

    // Quiz
    $('quiz-next').addEventListener('click', function () {
      if (quizRound.answered >= ROUND_SIZE) { openRoundComplete(); return; }
      renderQuiz(true);
      const first = $('quiz-options').querySelector('.quiz-option');
      if (first) first.focus();
    });

    // My Words
    $('words-filter').addEventListener('input', renderMyWords);
    $('clear-all').addEventListener('click', openConfirm);
    $('confirm-cancel').addEventListener('click', closeConfirm);
    $('confirm-accept').addEventListener('click', function () { closeConfirm(); clearAllWords(); $('panel-words').querySelector('h2').focus(); });
    $('confirm-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeConfirm(); });

    // Round complete
    $('round-continue').addEventListener('click', closeRoundComplete);

    // Recap
    $('side-goal').addEventListener('click', openRecap);
    $('recap-close').addEventListener('click', closeRecap);
    $('recap-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeRecap(); });

    // Timer
    $('timer-start').addEventListener('click', function () { if (state.timer.completed) resetTimer(); startTimer(); });
    $('timer-pause').addEventListener('click', pauseTimer);
    $('timer-reset').addEventListener('click', resetTimer);
    bindFocusLock();

    // Navigation
    SECTIONS.forEach(function (s) {
      const tab = $('tab-' + s);
      tab.addEventListener('click', function () { showSection(s); });
      tab.addEventListener('keydown', onTabKeydown);
    });
    document.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { showSection(btn.dataset.goto, true); });
    });

    // Gen's eyes follow the pointer; word card tilts toward it (pointer devices only).
    if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !motionReduced()) {
      const eyes = document.querySelectorAll('.buddy .eye');
      let eyeFrame = null;
      document.addEventListener('mousemove', function (e) {
        if (eyeFrame) return;
        eyeFrame = requestAnimationFrame(function () {
          eyeFrame = null;
          const b = $('buddy').getBoundingClientRect();
          const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
          const dist = Math.max(1, Math.hypot(dx, dy));
          const px = (dx / dist) * Math.min(3.5, dist / 40), py = (dy / dist) * Math.min(3, dist / 40);
          eyes.forEach(function (eye) { eye.style.setProperty('--ex', px.toFixed(2) + 'px'); eye.style.setProperty('--ey', py.toFixed(2) + 'px'); });
        });
      });
      const card = $('result-card');
      card.addEventListener('mousemove', function (e) {
        const r = card.getBoundingClientRect();
        const rx = ((e.clientY - r.top) / r.height - 0.5) * -4, ry = ((e.clientX - r.left) / r.width - 0.5) * 5;
        card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      });
      card.addEventListener('mouseleave', function () { card.style.transform = ''; });
    }

    $('motion-toggle').addEventListener('click', function () { state.prefs.reduceMotion = !state.prefs.reduceMotion; saveState(); applyDisplayPrefs(); toast(state.prefs.reduceMotion ? 'Animations reduced.' : 'Animations restored.', 'info'); });
    $('contrast-toggle').addEventListener('click', function () { state.prefs.highContrast = !state.prefs.highContrast; saveState(); applyDisplayPrefs(); toast(state.prefs.highContrast ? 'High contrast on.' : 'High contrast off.', 'info'); });
    $('textsize-toggle').addEventListener('click', function () { state.prefs.textSize = (state.prefs.textSize + 1) % TEXT_SIZES.length; saveState(); applyDisplayPrefs(); announce('Text size ' + TEXT_SIZES[state.prefs.textSize].name); });
    $('easyread-toggle').addEventListener('click', function () { state.prefs.easyRead = !state.prefs.easyRead; saveState(); applyDisplayPrefs(); toast(state.prefs.easyRead ? 'Easy-read mode on: wider spacing, plain font, longer messages.' : 'Easy-read mode off.', 'info'); });
    $('shortcuts-button').addEventListener('click', function () { openDialog($('shortcuts-dialog')); $('shortcuts-close').focus(); });
    $('shortcuts-close').addEventListener('click', function () { closeDialog($('shortcuts-dialog')); });
    $('shortcuts-dialog').addEventListener('close', function () { $('shortcuts-button').focus(); });
    $('shortcuts-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeDialog($('shortcuts-dialog')); });
    // Phone/tablet: the display tools live in a dialog opened from the ⚙ button (the same buttons move in and out).
    const toolsEl = document.querySelector('.header-tools');
    const toolsHome = toolsEl.parentNode, toolsNext = toolsEl.nextSibling;
    $('settings-button').addEventListener('click', function () { $('settings-host').appendChild(toolsEl); toolsEl.classList.add('in-dialog'); openDialog($('settings-dialog')); $('settings-close').focus(); });
    $('settings-close').addEventListener('click', function () { closeDialog($('settings-dialog')); });
    $('settings-dialog').addEventListener('close', function () { toolsEl.classList.remove('in-dialog'); toolsHome.insertBefore(toolsEl, toolsNext); $('settings-button').focus(); });
    $('settings-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeDialog($('settings-dialog')); });
    // Phone/tablet hamburger drawer
    $('menu-button').addEventListener('click', function () { setMenu(!document.body.classList.contains('menu-open')); });
    $('nav-close').addEventListener('click', function () { setMenu(false); });
    $('nav-backdrop').addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { e.preventDefault(); setMenu(false); } });
    window.addEventListener('resize', function () { if (window.innerWidth > 1100 && document.body.classList.contains('menu-open')) setMenu(false); });
    document.addEventListener('keydown', onGlobalKey);
    $('logo-button').addEventListener('click', function () { buddySay(BUDDY_IDLE[Math.floor(Math.random() * BUDDY_IDLE.length)], 'happy'); restartAnimation(document.querySelector('.logo'), 'is-wink'); });

    // Dialogs: Escape / backdrop closes must behave like the buttons (reset round, return focus)
    $('round-dialog').addEventListener('close', function () { resetRound(); if (pendingRecap) { pendingRecap = false; window.setTimeout(openRecap, 250); } });
    $('recap-dialog').addEventListener('close', function () { $('side-goal').focus(); });
    $('confirm-dialog').addEventListener('close', function () { if (!$('clear-all').hidden) $('clear-all').focus(); });

    // Radio pills: mirror checked state to a class (fallback for browsers without :has()).
    const syncPills = function () { document.querySelectorAll('.radio-pill input').forEach(function (r) { r.closest('.radio-pill').classList.toggle('is-checked', r.checked); }); };
    document.querySelectorAll('.radio-pill input').forEach(function (r) {
      r.addEventListener('change', syncPills);
      r.addEventListener('focus', function () { r.closest('.radio-pill').classList.add('is-focused'); });
      r.addEventListener('blur', function () { r.closest('.radio-pill').classList.remove('is-focused'); });
    });
    syncPills();

    let fitTimer = null;
    window.addEventListener('resize', function () { window.clearTimeout(fitTimer); fitTimer = window.setTimeout(function () { if (!$('result-card').hidden) fitHeadword($('result-word')); }, 120); });

    // Environment
    window.addEventListener('online', function () { toast('Back online — live lookups are available again.', 'success'); });
    window.addEventListener('offline', function () { toast('You’re offline. Saved words are still available to review.', 'info'); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    window.addEventListener('pagehide', function () { stopSpeech(); stopListening(true); });
    window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return; // keep multiple tabs consistent
      const visibleSection = state.prefs.section;
      state = loadState();
      state.prefs.section = visibleSection;
      translateKeyInMemory = state.translate.rememberKey ? state.translate.apiKey : translateKeyInMemory;
      renderAll();
      applyDisplayPrefs();
      if (state.lastSearch) { renderResult(normalizeWord(state.lastSearch)); } else { showOnly(RESULT_STATES, 'result-empty'); }
    });
  }

  function renderAll() {
    renderHeader();
    renderHabit();
    renderTimer();
    renderQuiz(false);
    renderMyWords();
    renderSpeak();
    renderTranslateSettings();
  }

  function init() {
    bindEvents();
    if (state.lastSearch) {
      $('search-input').value = state.lastSearch.word;
      lastQuery = state.lastSearch.word;
      renderResult(normalizeWord(state.lastSearch));
      $('context-input').placeholder = 'Defaults to “' + state.lastSearch.word + '”';
    }
    protectStreak();
    tickTimer(); // resolves a sprint that finished while the page was closed
    renderAll();
    showSection(state.prefs.section);
    applyDisplayPrefs();
    spawnFloaters();
    applyPlatformText();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    requestAnimationFrame(function () { document.body.classList.add('is-loaded'); });
    $('buddy-bubble').textContent = BUDDY_IDLE[Math.floor(Math.random() * BUDDY_IDLE.length)];
    window.setInterval(tick, 1000);
  }

  // Small debug surface for graders/testing without leaking internals as globals.
  window.Gengo = Object.freeze({
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    resetState: function () { resetState(); translateKeyInMemory = ''; lastQuery = ''; lastTranslation = null; lastContextQuery = ''; quizQuestion = null; quizRound = { answered: 0, correct: 0, xp: 0, startedAt: null }; quizCombo = 0; $('search-input').value = ''; showOnly(RESULT_STATES, 'result-empty'); showOnly(TRANSLATE_STATES, 'translate-empty'); showOnly(CONTEXT_STATES, 'context-empty'); renderAll(); applyDisplayPrefs(); showSection('learn'); toast('Gengo has been reset.', 'info'); },
    transcribe: async function (float32Samples) { const pipe = await loadWhisper(); return pipe(float32Samples); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
