/* My Word — classroom projector game. No network, no names. */

(function () {
  "use strict";

  var STORAGE_KEY = "my-word-settings";

  var TEAMS = [
    { id: "red", name: "Red", bg: "#C4172A", fg: "#FFFFFF", splash: "#C4172A" },
    { id: "blue", name: "Blue", bg: "#1B4FD8", fg: "#FFFFFF", splash: "#1B4FD8" },
    { id: "green", name: "Green", bg: "#0E7A42", fg: "#FFFFFF", splash: "#0E7A42" },
    { id: "yellow", name: "Yellow", bg: "#F5C400", fg: "#1C2430", splash: "#8A6400" },
    { id: "purple", name: "Purple", bg: "#6D28D9", fg: "#FFFFFF", splash: "#6D28D9" },
    { id: "orange", name: "Orange", bg: "#C2410C", fg: "#FFFFFF", splash: "#C2410C" }
  ];

  // 49 single letters, weighted toward common English letters,
  // plus TH ER IN QU (2 letters each) and two wild cards. Total 55.
  var SINGLES = {
    E: 6, A: 3, O: 3, I: 3, N: 3, R: 3, T: 3, S: 3,
    L: 2, D: 2, U: 2, C: 2, H: 2,
    M: 1, P: 1, G: 1, B: 1, F: 1, W: 1, Y: 1,
    K: 1, V: 1, J: 1, X: 1, Z: 1
  };
  var DIGRAPHS = ["TH", "ER", "IN", "QU"];

  var app = document.getElementById("app");
  var live = document.getElementById("live");

  var cardSeq = 0;
  var seenDeal = new Set();
  var freshIds = [];
  var flipTimer = null;
  var tickTimer = null;
  var endTimer = null;
  var messageTimer = null;
  var splashTimer = null;
  var rejectTimer = null;
  var flipDue = 0;
  var wordSet = null;
  var wordLoad = null;

  var state = {
    settings: loadSettings(),
    phase: "setup",
    paused: false,
    busy: false,
    penalty: false,
    howTo: false,
    confirmEnd: false,
    deck: [],
    table: [],
    teams: [],
    selected: [],
    word: "",
    message: null,
    splash: null,
    shake: false,
    history: [],
    confetti: [],
    override: null,
    reject: null,
    checking: false
  };

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function clampVolume(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0.55;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return Math.round(n * 100) / 100;
  }

  function loadSettings() {
    var fallback = { teamCount: 4, minLength: 3, flipMode: "auto", flipSeconds: 5, musicOn: true, musicVolume: 0.55 };
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        teamCount: clampInt(raw.teamCount, 2, 6, fallback.teamCount),
        minLength: raw.minLength === 2 || raw.minLength === 4 ? raw.minLength : 3,
        flipMode: raw.flipMode === "manual" ? "manual" : "auto",
        flipSeconds: clampInt(raw.flipSeconds, 2, 10, fallback.flipSeconds),
        musicOn: raw.musicOn === false ? false : true,
        musicVolume: clampVolume(raw.musicVolume == null ? fallback.musicVolume : raw.musicVolume),
        spellCheck: raw.spellCheck === false ? false : true
      };
    } catch (err) {
      return fallback;
    }
  }

  function saveSettings() {
    try {
      var s = state.settings;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        teamCount: s.teamCount,
        minLength: s.minLength,
        flipMode: s.flipMode,
        flipSeconds: s.flipSeconds,
        musicOn: s.musicOn !== false,
        musicVolume: clampVolume(s.musicVolume),
        spellCheck: s.spellCheck !== false
      }));
    } catch (err) {
      /* Private mode and blocked storage still let the round run. */
    }
  }

  /* In-browser tune. No files. A pentatonic loop, bass, and soft drums. */
  var audioCtx = null;
  var musicMaster = null;
  var musicDuck = null;
  var musicTimer = null;
  var musicNoise = null;
  var musicNext = 0;
  var musicStep = 0;
  var musicLooping = false;
  var musicNodes = [];
  var fanfareStarted = false;
  var fanfarePending = false;
  var EIGHTH = 0.3;

  var PITCH = {
    D2: 73.42, E2: 82.41, G2: 98.0, A2: 110.0, B2: 123.47,
    C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99
  };

  /* 8 bars, 8 eighth notes. Rests keep the loop from chattering. */
  var MELODY = [
    "G4", "", "B4", "", "D5", "", "B4", "",
    "A4", "", "G4", "", "E4", "", "", "",
    "G4", "", "A4", "", "B4", "G4", "", "E4",
    "D4", "", "E4", "", "D4", "", "", "",
    "B4", "", "D5", "", "B4", "", "A4", "",
    "G4", "", "A4", "", "B4", "", "", "",
    "D5", "", "B4", "", "A4", "", "G4", "",
    "E4", "", "D4", "", "G4", "", "", ""
  ];
  var BASS_A = ["G2", "E2", "C3", "D3", "G2", "E2", "C3", "D3"];
  var BASS_B = ["D3", "B2", "G3", "A3", "D3", "B2", "G3", "A3"];

  function musicWanted() {
    return state.settings.musicOn !== false;
  }

  function ensureAudio() {
    if (audioCtx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      audioCtx = new AC();
    } catch (err) {
      return false;
    }
    musicMaster = audioCtx.createGain();
    musicDuck = audioCtx.createGain();
    musicDuck.gain.value = 1;
    musicMaster.connect(musicDuck);
    musicDuck.connect(audioCtx.destination);
    applyMusicVolume();
    return true;
  }

  function trackNode(node) {
    musicNodes.push(node);
    node.onended = function () {
      var i = musicNodes.indexOf(node);
      if (i >= 0) musicNodes.splice(i, 1);
    };
  }

  function silenceMusic() {
    if (!audioCtx) return;
    var now = audioCtx.currentTime;
    musicNodes.forEach(function (node) {
      try { node.stop(now); } catch (err) { /* already stopped */ }
    });
    musicNodes = [];
  }

  function stopMusicLoop() {
    musicLooping = false;
    if (musicTimer) window.clearInterval(musicTimer);
    musicTimer = null;
  }

  function applyMusicVolume() {
    if (!musicMaster || !audioCtx) return;
    var level = musicWanted() ? clampVolume(state.settings.musicVolume) : 0;
    musicMaster.gain.cancelScheduledValues(audioCtx.currentTime);
    musicMaster.gain.setTargetAtTime(Math.max(level, 0.0001), audioCtx.currentTime, 0.04);
    if (level === 0) {
      musicMaster.gain.setValueAtTime(0, audioCtx.currentTime + 0.12);
    }
  }

  function musicShouldDuck() {
    return state.phase === "play" && (
      state.selected.length > 0 || state.busy || state.penalty || !!state.splash
    );
  }

  function syncDuck() {
    if (!musicDuck || !audioCtx) return;
    var target = musicShouldDuck() ? 0.32 : 1;
    musicDuck.gain.cancelScheduledValues(audioCtx.currentTime);
    musicDuck.gain.setTargetAtTime(target, audioCtx.currentTime, 0.06);
  }

  function playTone(freq, time, dur, type, peak) {
    if (!freq || freq < 1) return;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain);
    gain.connect(musicMaster);
    osc.start(time);
    osc.stop(time + dur + 0.03);
    trackNode(osc);
  }

  function noiseBuffer() {
    if (musicNoise) return musicNoise;
    var length = Math.floor(audioCtx.sampleRate * 0.25);
    musicNoise = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    var data = musicNoise.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return musicNoise;
  }

  function playHat(time, dur, peak) {
    var src = audioCtx.createBufferSource();
    var filter = audioCtx.createBiquadFilter();
    var gain = audioCtx.createGain();
    src.buffer = noiseBuffer();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(6500, time);
    gain.gain.setValueAtTime(Math.max(peak, 0.0002), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(musicMaster);
    src.start(time);
    src.stop(time + dur + 0.02);
    trackNode(src);
  }

  function playKick(time) {
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(52, time + 0.12);
    gain.gain.setValueAtTime(0.34, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.connect(gain);
    gain.connect(musicMaster);
    osc.start(time);
    osc.stop(time + 0.2);
    trackNode(osc);
  }

  function playMusicStep(index, time) {
    var beat = index % 8;
    var bar = Math.floor(index / 8) % 8;
    var note = MELODY[index % MELODY.length];
    if (note) playTone(PITCH[note], time, beat % 2 === 0 ? 0.42 : 0.28, "triangle", 0.16);
    if (beat === 0) playTone(PITCH[BASS_A[bar]], time, 0.46, "sine", 0.2);
    if (beat === 4) playTone(PITCH[BASS_B[bar]], time, 0.34, "sine", 0.14);
    if (beat === 0) playKick(time);
    if (beat === 4) playHat(time, 0.12, 0.05);
    if (beat % 2 === 0) playHat(time, 0.05, 0.025);
  }

  function pumpMusic() {
    if (!musicLooping || !audioCtx) return;
    var horizon = audioCtx.currentTime + 0.22;
    while (musicNext < horizon) {
      playMusicStep(musicStep, musicNext);
      musicStep = (musicStep + 1) % MELODY.length;
      musicNext += EIGHTH;
    }
  }

  function startMusicLoop() {
    if (!audioCtx || !musicWanted() || state.phase !== "play" || state.paused) return;
    if (musicLooping) return;
    musicLooping = true;
    musicStep = 0;
    musicNext = audioCtx.currentTime + 0.08;
    pumpMusic();
    musicTimer = window.setInterval(pumpMusic, 60);
  }

  function playFanfare() {
    if (!ensureAudio() || !musicWanted()) return;
    if (fanfareStarted) return;
    if (audioCtx.state !== "running") {
      fanfarePending = true;
      var pending = audioCtx.resume();
      if (pending && pending.then) {
        pending.then(function () {
          if (fanfarePending && state.phase === "winner" && audioCtx.state === "running") {
            fanfarePending = false;
            playFanfare();
          }
        }).catch(function () { /* iPad waits for the next tap */ });
      }
      return;
    }
    fanfareStarted = true;
    fanfarePending = false;
    stopMusicLoop();
    silenceMusic();
    syncDuck();
    var t = audioCtx.currentTime + 0.06;
    var rising = ["C4", "E4", "G4", "C5", "E5", "G5"];
    for (var i = 0; i < rising.length; i++) {
      playTone(PITCH[rising[i]], t + i * 0.11, 0.34, "triangle", 0.15);
    }
    playTone(PITCH.C4, t + 0.72, 1.15, "sine", 0.12);
    playTone(PITCH.E4, t + 0.72, 1.15, "sine", 0.1);
    playTone(PITCH.G4, t + 0.72, 1.15, "sine", 0.1);
    playTone(PITCH.C5, t + 0.72, 1.35, "triangle", 0.16);
    playHat(t + 0.72, 0.35, 0.06);
  }

  function playBuzz() {
    if (!musicWanted() || state.paused) return;
    if (!ensureAudio()) return;
    var blip = function () {
      if (!audioCtx || audioCtx.state !== "running") return;
      var t = audioCtx.currentTime + 0.02;
      buzzAt(220, t, 0.13, 0.11);
      buzzAt(165, t + 0.15, 0.18, 0.09);
    };
    if (audioCtx.state === "suspended") {
      var pending = audioCtx.resume();
      if (pending && pending.then) pending.then(blip).catch(function () {});
    } else {
      blip();
    }
  }

  function buzzAt(freq, time, dur, peak) {
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain);
    gain.connect(musicMaster);
    osc.start(time);
    osc.stop(time + dur + 0.03);
  }

  function wakeAudio() {
    if (!musicWanted()) return;
    if (state.phase !== "play" && state.phase !== "winner") return;
    if (state.phase === "play" && state.paused) return;
    if (!ensureAudio()) return;
    if (audioCtx.state === "suspended") {
      var pending = audioCtx.resume();
      if (pending && pending.then) {
        pending.then(function () {
          if (fanfarePending) playFanfare();
        }).catch(function () {});
      }
    } else if (fanfarePending) {
      playFanfare();
    }
  }

  function syncMusic() {
    if (!audioCtx) return;
    applyMusicVolume();
    syncDuck();
    if (!musicWanted() || state.phase === "setup") {
      stopMusicLoop();
      silenceMusic();
      fanfarePending = false;
      return;
    }
    if (state.phase === "winner") {
      stopMusicLoop();
      if (!fanfareStarted) silenceMusic();
      return;
    }
    if (fanfareStarted) {
      silenceMusic();
      fanfareStarted = false;
      fanfarePending = false;
      stopMusicLoop();
    }
    if (state.paused) {
      if (audioCtx.state === "running") {
        var held = audioCtx.suspend();
        if (held && held.catch) held.catch(function () {});
      }
      return;
    }
    if (audioCtx.state === "suspended") {
      var pending = audioCtx.resume();
      if (pending && pending.catch) pending.catch(function () {});
    }
    startMusicLoop();
  }

  function beginRoundMusic() {
    fanfareStarted = false;
    fanfarePending = false;
    if (!musicWanted()) {
      if (audioCtx) {
        stopMusicLoop();
        silenceMusic();
        applyMusicVolume();
      }
      return;
    }
    if (!ensureAudio()) return;
    silenceMusic();
    stopMusicLoop();
    if (!state.paused && audioCtx.state === "suspended") {
      var pending = audioCtx.resume();
      if (pending && pending.catch) pending.catch(function () {});
    }
    syncMusic();
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function announce(text) {
    live.textContent = "";
    window.setTimeout(function () {
      live.textContent = text;
    }, 30);
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function buildDeck() {
    var cards = [];
    var face;
    var n;
    var i;
    cardSeq = 0;
    for (face in SINGLES) {
      if (!Object.prototype.hasOwnProperty.call(SINGLES, face)) continue;
      for (n = 0; n < SINGLES[face]; n++) cards.push(makeCard(face, "letter"));
    }
    for (i = 0; i < DIGRAPHS.length; i++) cards.push(makeCard(DIGRAPHS[i], "digraph"));
    cards.push(makeCard("?", "wild"));
    cards.push(makeCard("?", "wild"));
    return cards;
  }

  function makeCard(face, kind) {
    cardSeq += 1;
    return {
      id: "c" + cardSeq,
      face: face,
      kind: kind,
      letters: kind === "digraph" ? 2 : 1
    };
  }

  function teamDef(id) {
    for (var i = 0; i < TEAMS.length; i++) {
      if (TEAMS[i].id === id) return TEAMS[i];
    }
    return TEAMS[0];
  }

  function activeTeams() {
    return TEAMS.slice(0, state.settings.teamCount);
  }

  function findTeam(id) {
    for (var i = 0; i < state.teams.length; i++) {
      if (state.teams[i].id === id) return state.teams[i];
    }
    return null;
  }

  function selectedCards() {
    var cards = [];
    for (var i = 0; i < state.selected.length; i++) {
      for (var j = 0; j < state.table.length; j++) {
        if (state.table[j].id === state.selected[i]) {
          cards.push(state.table[j]);
          break;
        }
      }
    }
    return cards;
  }

  function letterCount(cards) {
    var n = 0;
    for (var i = 0; i < cards.length; i++) n += cards[i].letters;
    return n;
  }

  function spellOn() {
    return state.settings.spellCheck !== false;
  }

  function loadWordList() {
    if (wordSet) return Promise.resolve(wordSet);
    if (wordLoad) return wordLoad;
    wordLoad = fetch("words.txt").then(function (res) {
      if (!res.ok) throw new Error("word list");
      return res.text();
    }).then(function (text) {
      var set = new Set();
      var lines = text.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var w = lines[i].trim();
        if (/^[a-z]{2,}$/.test(w)) set.add(w);
      }
      wordSet = set;
      return set;
    }).catch(function (err) {
      wordLoad = null;
      throw err;
    });
    return wordLoad;
  }

  function cardPattern(cards) {
    var pattern = "";
    for (var i = 0; i < cards.length; i++) {
      pattern += cards[i].kind === "wild" ? "?" : cards[i].face.toUpperCase();
    }
    return pattern;
  }

  function lettersOnly(text) {
    return String(text || "").toUpperCase().replace(/[^A-Z]/g, "");
  }

  function typedMatchesPattern(typed, pattern) {
    if (!typed || typed.length !== pattern.length) return false;
    for (var i = 0; i < pattern.length; i++) {
      if (pattern.charAt(i) !== "?" && pattern.charAt(i) !== typed.charAt(i)) return false;
    }
    return true;
  }

  function resolvePattern(pattern) {
    var lower = pattern.toLowerCase();
    if (lower.indexOf("?") < 0) return wordSet.has(lower) ? lower : "";
    var idxs = [];
    var chars = lower.split("");
    for (var i = 0; i < chars.length; i++) {
      if (chars[i] === "?") idxs.push(i);
    }
    var alpha = "abcdefghijklmnopqrstuvwxyz";
    function walk(n) {
      if (n === idxs.length) {
        var w = chars.join("");
        return wordSet.has(w) ? w : "";
      }
      var pos = idxs[n];
      for (var k = 0; k < alpha.length; k++) {
        chars[pos] = alpha.charAt(k);
        var found = walk(n + 1);
        if (found) return found;
      }
      return "";
    }
    return walk(0);
  }

  function clearOverride() {
    state.override = null;
    state.reject = null;
    clearRejectTimer();
  }

  function clearRejectTimer() {
    if (rejectTimer) window.clearTimeout(rejectTimer);
    rejectTimer = null;
  }

  function tableLetters() {
    return letterCount(state.table);
  }

  function pushHistory() {
    var teams = [];
    for (var i = 0; i < state.teams.length; i++) {
      teams.push({ id: state.teams[i].id, cards: state.teams[i].cards.slice() });
    }
    state.history.push(JSON.stringify({
      deck: state.deck,
      table: state.table,
      teams: teams,
      selected: state.selected.slice(),
      word: state.word,
      phase: state.phase
    }));
    if (state.history.length > 60) state.history.shift();
  }

  function restore(raw) {
    var data = JSON.parse(raw);
    state.deck = data.deck;
    state.table = data.table;
    state.selected = data.selected;
    state.word = data.word;
    state.phase = data.phase;
    state.teams = data.teams.map(function (t) {
      var def = teamDef(t.id);
      return {
        id: def.id,
        name: def.name,
        bg: def.bg,
        fg: def.fg,
        splash: def.splash,
        cards: t.cards
      };
    });
    state.penalty = false;
    state.confirmEnd = false;
    state.splash = null;
    state.shake = false;
    state.paused = false;
    state.checking = false;
    clearOverride();
  }

  function clearFlipTimer() {
    if (flipTimer) window.clearTimeout(flipTimer);
    flipTimer = null;
    flipDue = 0;
  }

  function clearEndTimer() {
    if (endTimer) window.clearTimeout(endTimer);
    endTimer = null;
  }

  function clearSplashTimer() {
    if (splashTimer) window.clearTimeout(splashTimer);
    splashTimer = null;
  }

  function canFlip() {
    return state.phase === "play" &&
      !state.paused &&
      !state.busy &&
      !state.penalty &&
      !state.howTo &&
      !state.confirmEnd &&
      !state.splash &&
      state.deck.length > 0;
  }

  function scheduleFlip() {
    clearFlipTimer();
    if (state.phase !== "play" || state.settings.flipMode !== "auto") return;
    if (state.paused || state.busy || state.penalty || state.howTo || state.confirmEnd || state.splash) return;
    if (state.deck.length === 0) return;
    var delay = state.settings.flipSeconds * 1000;
    flipDue = Date.now() + delay;
    flipTimer = window.setTimeout(function () {
      if (!canFlip()) {
        scheduleFlip();
        return;
      }
      flipCard();
    }, delay);
  }

  function updateCountdown() {
    var el = document.querySelector("[data-countdown]");
    if (!el || state.phase !== "play") return;
    if (state.deck.length === 0) {
      el.innerHTML = "Deck empty";
      return;
    }
    if (state.settings.flipMode !== "auto") {
      el.textContent = state.paused ? "Paused" : "";
      return;
    }
    if (state.paused) {
      el.textContent = "Paused";
      return;
    }
    if (!flipDue) {
      el.textContent = "";
      return;
    }
    var secs = Math.max(0, Math.ceil((flipDue - Date.now()) / 1000));
    el.innerHTML = "Next in <b>" + secs + "</b>";
  }

  function rememberMessage(tone, text) {
    state.message = { tone: tone, text: text };
    if (messageTimer) window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(function () {
      if (state.message && state.message.text === text && !state.busy && state.phase === "play") {
        state.message = null;
        state.shake = false;
        render();
      }
    }, 3200);
  }

  function setMessage(tone, text) {
    rememberMessage(tone, text);
    announce(text);
    render();
  }

  function startGame() {
    saveSettings();
    seenDeal = new Set();
    clearEndTimer();
    clearSplashTimer();
    clearFlipTimer();
    state.teams = activeTeams().map(function (t) {
      return {
        id: t.id,
        name: t.name,
        bg: t.bg,
        fg: t.fg,
        splash: t.splash,
        cards: []
      };
    });
    state.deck = shuffle(buildDeck());
    state.table = [];
    state.selected = [];
    state.word = "";
    state.message = null;
    state.splash = null;
    state.shake = false;
    state.history = [];
    state.checking = false;
    clearOverride();
    state.penalty = false;
    state.howTo = false;
    state.confirmEnd = false;
    state.paused = false;
    state.busy = false;
    state.phase = "play";
    state.confetti = [];
    render();
    announce("New round. " + state.teams.length + " teams. Words need " + state.settings.minLength + " letters.");
    scheduleFlip();
    beginRoundMusic();
  }

  function flipCard() {
    if (!canFlip()) return;
    clearEndTimer();
    pushHistory();
    var card = state.deck.pop();
    state.table.push(card);
    state.message = null;
    if (state.deck.length === 0 && tableLetters() >= state.settings.minLength) {
      state.message = {
        tone: "info",
        text: "Deck is empty. Use these letters, or end the round."
      };
    }
    render();
    announce(card.kind === "wild" ? "Wild card" : "Letter " + card.face.split("").join(" "));
    if (state.deck.length === 0) considerEnd(900);
    else scheduleFlip();
  }

  function primeDeal(id) {
    var card = document.querySelector('.card[data-id="' + id + '"]');
    var deck = document.querySelector("[data-deck]");
    if (!card || !deck) return;
    var from = deck.getBoundingClientRect();
    var to = card.getBoundingClientRect();
    var dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    var dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    card.style.setProperty("--dx", dx + "px");
    card.style.setProperty("--dy", dy + "px");
    card.classList.add("is-dealing");
  }

  function toggleCard(id) {
    if (state.busy || state.splash || state.penalty || state.phase !== "play" || state.howTo || state.confirmEnd) return;
    var index = state.selected.indexOf(id);
    if (index >= 0) state.selected.splice(index, 1);
    else state.selected.push(id);
    state.shake = false;
    if (state.message && state.message.tone === "warn") state.message = null;
    clearOverride();
    render();
  }

  function clearSelection() {
    if (!state.selected.length || state.busy) return;
    state.selected = [];
    state.shake = false;
    if (state.message && state.message.tone === "warn") state.message = null;
    clearOverride();
    render();
  }

  function award(teamId) {
    if (state.busy || state.splash || state.checking || state.phase !== "play" || state.howTo || state.confirmEnd) return;
    if (state.penalty) {
      resolvePenalty(teamId);
      return;
    }
    var cards = selectedCards();
    var team = findTeam(teamId);
    if (!team) return;
    if (!cards.length) {
      if (state.override) return;
      setMessage("warn", "Tap the letters in the word first.");
      return;
    }
    var letters = letterCount(cards);
    var min = state.settings.minLength;
    if (letters < min) {
      var extra = "";
      var digraphs = cards.filter(function (c) { return c.kind === "digraph"; });
      if (digraphs.length) {
        extra = " " + digraphs.map(function (c) { return c.face; }).join(" and ") + " count as 2.";
      }
      if (cards.some(function (c) { return c.kind === "wild"; })) extra += " ? counts as 1.";
      state.shake = true;
      setMessage("warn", "Need " + min + " letters. You have " + letters + "." + extra);
      return;
    }
    var pattern = cardPattern(cards);
    var typed = lettersOnly(state.word);
    if (state.word.trim() && !typedMatchesPattern(typed, pattern)) {
      state.shake = true;
      setMessage("warn", "The typed word doesn't match those letters.");
      return;
    }
    if (!spellOn()) {
      commitAward(teamId, typed, false);
      return;
    }
    if (!wordSet) {
      state.checking = true;
      loadWordList().then(function () {
        state.checking = false;
        award(teamId);
      }).catch(function () {
        state.checking = false;
        rejectSpell(teamId, cards, typed || pattern);
        setMessage("warn", "The word list didn't load. Allow anyway if you are sure.");
      });
      return;
    }
    var resolved = typed || resolvePattern(pattern);
    if (resolved && wordSet.has(resolved.toLowerCase())) {
      commitAward(teamId, resolved.toUpperCase(), true);
      return;
    }
    rejectSpell(teamId, cards, (typed || pattern).toUpperCase());
  }

  function rejectSpell(teamId, cards, display) {
    var ids = [];
    for (var i = 0; i < cards.length; i++) {
      if (findOnTable(cards[i].id)) ids.push(cards[i].id);
    }
    if (!ids.length) return;
    state.override = { cardIds: ids, teamId: teamId, word: display };
    state.reject = { word: display };
    state.selected = [];
    state.word = "";
    state.shake = false;
    playBuzz();
    clearRejectTimer();
    rejectTimer = window.setTimeout(function () {
      state.reject = null;
      if (state.phase === "play") render();
    }, 4500);
    render();
    announce("Not a word. " + display);
  }

  function findOnTable(id) {
    for (var i = 0; i < state.table.length; i++) {
      if (state.table[i].id === id) return state.table[i];
    }
    return null;
  }

  function allowAnyway() {
    var pending = state.override;
    if (!pending || state.busy || state.splash || state.phase !== "play" || state.penalty) return;
    var cards = [];
    for (var i = 0; i < pending.cardIds.length; i++) {
      var card = findOnTable(pending.cardIds[i]);
      if (!card) {
        clearOverride();
        setMessage("warn", "Those cards are not all on the table anymore.");
        return;
      }
      cards.push(card);
    }
    state.selected = cards.map(function (c) { return c.id; });
    state.word = "";
    var teamId = pending.teamId;
    var shown = pending.word;
    clearOverride();
    commitAward(teamId, shown, false);
  }

  function commitAward(teamId, displayWord, checked) {
    if (state.busy || state.splash || state.phase !== "play" || state.howTo || state.confirmEnd) return;
    var cards = selectedCards();
    var team = findTeam(teamId);
    if (!team || !cards.length) return;
    var shown = displayWord ? String(displayWord).toUpperCase() : "";
    var specs = captureSpecs(cards, teamId);
    pushHistory();
    var ids = {};
    cards.forEach(function (c) { ids[c.id] = true; });
    state.table = state.table.filter(function (c) { return !ids[c.id]; });
    team.cards = team.cards.concat(cards);
    state.selected = [];
    state.word = "";
    state.shake = false;
    clearOverride();
    rememberMessage("good", team.name + " takes " + cards.length + (cards.length === 1 ? " card." : " cards."));
    state.splash = shown ? { word: shown, teamId: teamId, check: !!checked } : null;
    state.busy = true;
    clearFlipTimer();
    clearEndTimer();
    var flyers = spawnFlyers(specs);
    render();
    announce(state.message.text + (shown ? " Word " + shown : ""));
    animateFlyers(flyers).then(function () {
      state.busy = false;
      if (state.splash) {
        clearSplashTimer();
        splashTimer = window.setTimeout(function () {
          state.splash = null;
          finishTurn();
        }, 1700);
      } else {
        finishTurn();
      }
    });
  }

  function finishTurn() {
    if (state.phase !== "play") return;
    considerEnd(state.splash ? 400 : 1100);
    if (state.phase === "play") {
      scheduleFlip();
      render();
    }
  }

  function otherTeams(wrongId) {
    var ids = state.teams.map(function (t) { return t.id; });
    var start = ids.indexOf(wrongId);
    var list = [];
    for (var k = 1; k < ids.length; k++) list.push(state.teams[(start + k) % ids.length]);
    return list;
  }

  function resolvePenalty(wrongId) {
    var wrong = findTeam(wrongId);
    if (!wrong) return;
    var others = otherTeams(wrongId);
    var plans = [];
    var tableIndex = 0;
    var deckIndex = state.deck.length - 1;
    for (var i = 0; i < others.length; i++) {
      var card = null;
      var from = null;
      var rect = null;
      if (tableIndex < state.table.length) {
        card = state.table[tableIndex];
        tableIndex += 1;
        from = "table";
        var el = document.querySelector('.card[data-id="' + card.id + '"]');
        rect = el ? el.getBoundingClientRect() : null;
      } else if (deckIndex >= 0) {
        card = state.deck[deckIndex];
        deckIndex -= 1;
        from = "deck";
        var deckEl = document.querySelector("[data-deck]");
        rect = deckEl ? deckEl.getBoundingClientRect() : null;
      } else {
        break;
      }
      plans.push({ team: others[i], card: card, from: from, rect: rect });
    }
    if (!plans.length) {
      state.penalty = false;
      setMessage("warn", "No cards left to give out.");
      scheduleFlip();
      return;
    }
    pushHistory();
    var tableTake = 0;
    var deckTake = 0;
    plans.forEach(function (plan) {
      if (plan.from === "table") tableTake += 1;
      else deckTake += 1;
      plan.team.cards = plan.team.cards.concat([plan.card]);
    });
    state.table.splice(0, tableTake);
    if (deckTake) state.deck.splice(state.deck.length - deckTake, deckTake);
    var remain = {};
    state.table.forEach(function (c) { remain[c.id] = true; });
    state.selected = state.selected.filter(function (id) { return remain[id]; });
    state.penalty = false;
    state.busy = true;
    var names = plans.map(function (p) { return p.team.name; });
    rememberMessage("info", wrong.name + " guessed wrong. " + names.join(", ") + " each take a card.");
    var specs = plans.map(function (p) {
      return { rect: p.rect, face: p.card.face, kind: p.card.kind, teamId: p.team.id };
    });
    clearFlipTimer();
    clearEndTimer();
    var flyers = spawnFlyers(specs);
    render();
    announce(state.message.text);
    animateFlyers(flyers).then(function () {
      state.busy = false;
      finishTurn();
    });
  }

  function captureSpecs(cards, teamId) {
    return cards.map(function (card) {
      var el = document.querySelector('.card[data-id="' + card.id + '"]');
      return {
        rect: el ? el.getBoundingClientRect() : null,
        face: card.face,
        kind: card.kind,
        teamId: teamId
      };
    });
  }

  function spawnFlyers(specs) {
    var flyers = [];
    specs.forEach(function (spec, i) {
      if (!spec.rect) return;
      var flyer = document.createElement("div");
      flyer.className = "flyer" +
        (spec.kind === "digraph" ? " is-digraph" : "") +
        (spec.kind === "wild" ? " is-wild" : "");
      flyer.textContent = spec.face;
      var w = spec.kind === "digraph" ? 132 : 112;
      var h = 146;
      var left = spec.rect.left + spec.rect.width / 2 - w / 2;
      var top = spec.rect.top + spec.rect.height / 2 - h / 2;
      flyer.style.width = w + "px";
      flyer.style.height = h + "px";
      flyer.style.left = left + "px";
      flyer.style.top = top + "px";
      flyer.style.transitionDelay = (i * 60) + "ms";
      document.body.appendChild(flyer);
      flyers.push({ flyer: flyer, spec: spec, left: left, top: top, w: w, h: h });
    });
    return flyers;
  }

  function animateFlyers(flyers) {
    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          flyers.forEach(function (item) {
            var endEl = document.querySelector('[data-score="' + item.spec.teamId + '"]');
            if (!endEl) return;
            var end = endEl.getBoundingClientRect();
            var dx = (end.left + end.width / 2) - (item.left + item.w / 2);
            var dy = (end.top + end.height / 2) - (item.top + item.h / 2);
            item.flyer.style.transform = "translate(" + dx + "px, " + dy + "px) scale(0.22)";
            item.flyer.style.opacity = "0.05";
          });
        });
      });
      window.setTimeout(function () {
        flyers.forEach(function (item) {
          item.flyer.remove();
          var num = document.querySelector('[data-score="' + item.spec.teamId + '"] .score-num');
          if (num) {
            num.classList.remove("pop");
            void num.offsetWidth;
            num.classList.add("pop");
          }
        });
        resolve();
      }, 820 + flyers.length * 60);
    });
  }

  function considerEnd(delay) {
    if (state.phase !== "play") return;
    if (state.deck.length > 0) return;
    if (tableLetters() >= state.settings.minLength) {
      if (!state.message) {
        state.message = {
          tone: "info",
          text: "Deck is empty. Use these letters, or end the round."
        };
      }
      return;
    }
    clearEndTimer();
    endTimer = window.setTimeout(function () {
      endTimer = null;
      if (state.phase !== "play" || state.busy || state.penalty) return;
      if (state.deck.length === 0 && tableLetters() < state.settings.minLength) {
        enterWinner();
      }
    }, delay);
  }

  function enterWinner() {
    clearFlipTimer();
    clearEndTimer();
    clearSplashTimer();
    pushHistory();
    state.phase = "winner";
    state.penalty = false;
    state.confirmEnd = false;
    state.howTo = false;
    state.splash = null;
    state.paused = false;
    state.busy = false;
    state.confetti = makeConfetti();
    render();
    var winners = winnerTeams();
    announce(winners.length > 1 ? "It's a tie." : winners[0].name + " wins.");
    playFanfare();
  }

  function winnerTeams() {
    var best = 0;
    state.teams.forEach(function (t) {
      if (t.cards.length > best) best = t.cards.length;
    });
    return state.teams.filter(function (t) { return t.cards.length === best; });
  }

  function rankedTeams() {
    return state.teams.slice().sort(function (a, b) {
      return b.cards.length - a.cards.length;
    });
  }

  function makeConfetti() {
    var colors = state.teams.map(function (t) { return t.bg; }).concat(["#1C2430", "#F5C400"]);
    var bits = [];
    for (var i = 0; i < 36; i++) {
      bits.push({
        left: Math.round(Math.random() * 100),
        delay: (Math.random() * 1.4).toFixed(2),
        dur: (2.6 + Math.random() * 2.2).toFixed(2),
        size: Math.round(8 + Math.random() * 10),
        color: colors[i % colors.length]
      });
    }
    return bits;
  }

  function undo() {
    if (state.busy || !state.history.length) return;
    var stayPaused = state.paused && state.phase === "play";
    clearEndTimer();
    clearSplashTimer();
    var raw = state.history.pop();
    restore(raw);
    state.paused = stayPaused;
    state.message = { tone: "info", text: "Undid the last action." };
    render();
    announce("Undid the last action.");
    if (!state.paused) scheduleFlip();
  }

  function togglePause() {
    if (state.phase !== "play" || state.busy) return;
    state.paused = !state.paused;
    state.confirmEnd = false;
    if (state.paused) clearFlipTimer();
    render();
    announce(state.paused ? "Paused" : "Playing");
    if (!state.paused) scheduleFlip();
  }

  function playAgain() {
    startGame();
  }

  function statusModel() {
    if (state.message) return state.message;
    if (state.override && !state.selected.length && !state.penalty) {
      return {
        tone: "warn",
        text: state.override.word + " is not in the word list. Allow anyway if you are sure."
      };
    }
    var cards = selectedCards();
    var letters = letterCount(cards);
    var min = state.settings.minLength;
    if (!cards.length) {
      return {
        tone: "",
        text: "Tap the letters in the word, then tap that team. Need " + min + " letters."
      };
    }
    var names = cards.map(function (c, i) { return (i + 1) + " " + c.face; }).join("   ");
    var ready = letters >= min;
    return {
      tone: ready ? "good" : "",
      text: names + "  ·  " + letters + (letters === 1 ? " letter" : " letters") +
        (ready ? "  ·  tap a team" : "  ·  need " + min)
    };
  }

  function render() {
    var focusWord = document.activeElement && document.activeElement.getAttribute("data-role") === "word";
    var caret = focusWord ? document.activeElement.selectionStart : null;
    freshIds = [];
    document.body.classList.toggle("is-play", state.phase === "play");
    if (state.phase === "setup") app.innerHTML = renderSetup();
    else if (state.phase === "winner") app.innerHTML = renderWinner();
    else app.innerHTML = renderPlay();
    if (state.howTo) app.insertAdjacentHTML("beforeend", renderHowTo());
    if (state.confirmEnd) app.insertAdjacentHTML("beforeend", renderConfirmEnd());
    var dealing = freshIds.slice();
    freshIds = [];
    dealing.forEach(primeDeal);
    if (focusWord) {
      var input = app.querySelector("[data-role='word']");
      if (input) {
        input.focus();
        if (caret !== null) {
          var pos = Math.min(caret, input.value.length);
          input.setSelectionRange(pos, pos);
        }
      }
    }
    updateCountdown();
    syncMusic();
  }

  function renderSetup() {
    var s = state.settings;
    var preview = activeTeams().map(function (t) {
      return '<li style="background:' + t.bg + ';color:' + t.fg + '">' + esc(t.name) + "</li>";
    }).join("");
    var mins = [2, 3, 4].map(function (n) {
      var pressed = s.minLength === n ? "true" : "false";
      return '<button type="button" class="seg" data-action="set-min" data-value="' + n +
        '" data-testid="min-' + n + '" aria-pressed="' + pressed + '">' + n + "</button>";
    }).join("");
    var speed = "";
    if (s.flipMode === "auto") {
      speed =
        '<div class="speed">' +
          '<strong data-speed-label>' + s.flipSeconds + 's</strong>' +
          '<input type="range" min="2" max="10" step="1" value="' + s.flipSeconds +
            '" data-action="set-speed" data-testid="speed" aria-label="Seconds between letters">' +
          "<span>2–10 seconds</span>" +
        "</div>";
    }
    return (
      '<section class="setup" data-testid="setup">' +
        '<div class="hero">' +
          '<p class="eyebrow">Mr. Fung\'s class</p>' +
          "<h1>My Word</h1>" +
          '<p class="lede">Letters flip up. Call a word. Most cards wins.</p>' +
          '<div class="fan" aria-hidden="true">' +
            '<div class="demo-card tilt-l"><span>A</span></div>' +
            '<div class="demo-card tilt-c"><span class="demo-inner">' +
              '<span class="demo-front">TH</span><span class="demo-back"></span>' +
            "</span></div>" +
            '<div class="demo-card tilt-r"><span>?</span></div>' +
          "</div>" +
        "</div>" +
        '<div class="panel">' +
          "<div>" +
            '<p class="field-label">Teams</p>' +
            '<div class="stepper">' +
              '<button type="button" class="icon-btn" data-action="teams-dec" aria-label="Fewer teams">−</button>' +
              "<div><strong>" + s.teamCount + "</strong><span>teams</span></div>" +
              '<button type="button" class="icon-btn" data-action="teams-inc" aria-label="More teams">+</button>' +
            "</div>" +
            '<ul class="team-preview">' + preview + "</ul>" +
          "</div>" +
          "<div>" +
            '<p class="field-label">Shortest word</p>' +
            '<div class="seg-row" data-testid="min-length">' + mins + "</div>" +
          "</div>" +
          "<div>" +
            '<p class="field-label">Letters</p>' +
            '<div class="seg-row">' +
              '<button type="button" class="seg" data-action="set-mode" data-value="auto" data-testid="flip-auto" aria-pressed="' + (s.flipMode === "auto" ? "true" : "false") + '">Auto<small>timer</small></button>' +
              '<button type="button" class="seg" data-action="set-mode" data-value="manual" data-testid="flip-manual" aria-pressed="' + (s.flipMode === "manual" ? "true" : "false") + '">Manual<small>you flip</small></button>' +
            "</div>" +
            speed +
          "</div>" +
          "<div>" +
            '<p class="field-label">Spell check</p>' +
            '<div class="seg-row">' +
              '<button type="button" class="seg" data-action="set-spell" data-value="on" data-testid="spell-on" aria-pressed="' + (spellOn() ? "true" : "false") + '">On<small>real words</small></button>' +
              '<button type="button" class="seg" data-action="set-spell" data-value="off" data-testid="spell-off" aria-pressed="' + (spellOn() ? "false" : "true") + '">Off<small>you decide</small></button>' +
            "</div>" +
          "</div>" +
          '<button type="button" class="start" data-action="start" data-testid="start-game">Start the game</button>' +
          '<button type="button" class="linkish" data-action="how-to" data-testid="how-to">How to play</button>' +
        "</div>" +
      "</section>"
    );
  }

  function renderPlay() {
    var s = state.settings;
    var modeLabel = s.flipMode === "auto"
      ? "New letter every " + s.flipSeconds + "s"
      : "You flip the letters";
    var tools =
      '<button type="button" class="tool" data-action="undo" data-testid="undo"' +
        (state.history.length && !state.busy ? "" : " disabled") + ">Undo</button>" +
      '<button type="button" class="tool' + (state.paused ? " is-paused" : "") +
        '" data-action="pause" data-testid="pause">' + (state.paused ? "Resume" : "Pause") + "</button>" +
      '<button type="button" class="tool" data-action="how-to" data-testid="how-to-play">How to play</button>' +
      '<button type="button" class="tool end' + (state.deck.length === 0 ? " is-attention" : "") +
        '" data-action="end-round" data-testid="end-round">End round</button>';
    var scores = state.teams.map(function (t) {
      return (
        '<div class="score" role="listitem" data-score="' + t.id +
          '" style="--bg:' + t.bg + ";--fg:" + t.fg +
          '" aria-label="' + esc(t.name) + ", " + t.cards.length + ' cards">' +
          '<span class="score-name">' + esc(t.name) + "</span>" +
          '<span class="score-num" data-testid="score-' + t.id + '">' + t.cards.length + "</span>" +
          '<span class="score-unit">cards</span>' +
        "</div>"
      );
    }).join("");
    var deckEmpty = state.deck.length === 0;
    var nextLabel = deckEmpty ? "All flipped" : (s.flipMode === "manual" ? "Next letter" : "Flip now");
    var cardsHtml;
    if (!state.table.length) {
      cardsHtml = '<p class="empty-table">' + (
        state.paused
          ? "Paused. Resume when the class is ready."
          : (s.flipMode === "manual"
            ? "Press Next letter when everyone is ready."
            : "Get ready. The first letter is on its way.")
      ) + "</p>";
    } else {
      cardsHtml = state.table.map(function (card) {
        var order = state.selected.indexOf(card.id);
        var selected = order >= 0;
        var dealing = !seenDeal.has(card.id);
        if (dealing) {
          freshIds.push(card.id);
          seenDeal.add(card.id);
        }
        var note = card.kind === "digraph" ? "2 letters" : (card.kind === "wild" ? "any letter" : "");
        var label = (card.kind === "wild" ? "Wild card" : "Letter " + card.face) +
          (selected ? ", selected, order " + (order + 1) : ", not selected");
        return (
          '<button type="button" class="card kind-' + card.kind +
            (selected ? " is-selected" : "") +
            (state.shake && selected ? " is-shake" : "") +
            '" data-action="toggle-card" data-id="' + card.id +
            '" data-face="' + esc(card.face) +
            '" data-letters="' + card.letters +
            '" data-testid="card" aria-pressed="' + (selected ? "true" : "false") +
            '" aria-label="' + esc(label) + '">' +
            '<span class="card-inner">' +
              '<span class="card-face front">' +
                '<span class="glyph">' + esc(card.face) + "</span>" +
                (note ? '<span class="card-note">' + note + "</span>" : "") +
              "</span>" +
              '<span class="card-face back"></span>' +
            "</span>" +
            (selected ? '<span class="order">' + (order + 1) + "</span>" : "") +
          "</button>"
        );
      }).join("");
    }
    var banner = "";
    if (state.penalty) {
      banner =
        '<div class="penalty-banner" data-testid="penalty-banner">' +
          "<p>Not a real word. Tap the team that said it. Every other team takes one card.</p>" +
          '<button type="button" class="btn-quiet" data-action="cancel-penalty">Never mind</button>' +
        "</div>";
    }
    var splash = "";
    if (state.splash) {
      var splashTeam = findTeam(state.splash.teamId);
      var lenClass = state.splash.word.length > 10 ? " len-long" : (state.splash.word.length > 6 ? " len-mid" : "");
      splash =
        '<div class="splash" data-testid="splash" style="--bg:' + splashTeam.bg + ";--fg:" + splashTeam.fg +
          ";--splash:" + splashTeam.splash + '">' +
          '<p class="splash-kicker">' + esc(splashTeam.name) + "</p>" +
          '<p class="splash-word' + lenClass + '">' + esc(state.splash.word) + "</p>" +
          (state.splash.check ? '<p class="splash-check" data-testid="spell-ok">✓</p>' : "") +
        "</div>";
    }
    var reject = "";
    if (state.reject) {
      var rejectLen = state.reject.word.length > 10 ? " len-long" : (state.reject.word.length > 6 ? " len-mid" : "");
      reject =
        '<div class="reject" data-testid="reject" role="alert">' +
          '<p class="reject-title">Not a word</p>' +
          '<p class="reject-word' + rejectLen + '">' + esc(state.reject.word) + "</p>" +
          '<button type="button" class="allow-btn" data-action="allow-anyway" data-testid="allow-anyway">Allow anyway</button>' +
        "</div>";
    }
    var status = statusModel();
    var lettersNow = letterCount(selectedCards());
    var ready = !state.penalty && lettersNow >= s.minLength;
    var awards = state.teams.map(function (t) {
      var hint = state.penalty ? "guessed wrong" : "gets the cards";
      return (
        '<button type="button" class="award" data-action="award" data-team="' + t.id +
          '" data-testid="team-award" style="--bg:' + t.bg + ";--fg:" + t.fg + '">' +
          '<span class="award-name">' + esc(t.name) + "</span>" +
          '<span class="award-hint">' + hint + "</span>" +
        "</button>"
      );
    }).join("");
    var wordValue = esc(state.word);
    return (
      '<section class="play' + (state.paused ? " is-paused" : "") + (state.penalty ? " is-penalty" : "") +
        '" data-testid="play" style="--team-n:' + state.teams.length + '">' +
        '<header class="topbar">' +
          '<div class="brand"><h1>My Word</h1>' +
            '<p class="rules-pill">Words need ' + s.minLength + " letters · " + modeLabel + "</p></div>" +
          '<div class="top-actions">' + musicControlsHTML() + tools + "</div>" +
        "</header>" +
        '<div class="scoreboard" role="list" aria-label="Scores">' + scores + "</div>" +
        '<div class="table">' +
          '<div class="deck-col">' +
            '<div class="deck' + (deckEmpty ? " is-empty" : "") + '" data-deck data-testid="deck">' +
              '<div class="deck-layer"></div><div class="deck-layer"></div><div class="deck-layer"></div>' +
              '<div class="deck-count" data-testid="deck-count">' + state.deck.length + "</div>" +
            "</div>" +
            '<p class="deck-label">left</p>' +
            '<p class="countdown" data-countdown></p>' +
            '<button type="button" class="next-btn" data-action="flip" data-testid="next-card"' +
              (canFlip() ? "" : " disabled") + ">" + nextLabel + "</button>" +
            (s.flipMode === "manual" ? '<p class="space-hint">or space bar</p>' : "") +
          "</div>" +
          '<div class="felt">' +
            banner +
            '<div class="cards" data-testid="table">' + cardsHtml + "</div>" +
            splash +
            reject +
          "</div>" +
        "</div>" +
        '<footer class="dock">' +
          '<div class="dock-main">' +
            '<label class="word-label">Word' +
              '<input data-role="word" data-testid="word-input" maxlength="16" autocomplete="off" ' +
                'autocorrect="off" autocapitalize="characters" spellcheck="false" ' +
                'placeholder="Optional" value="' + wordValue + '"' +
                (state.penalty || state.busy ? " disabled" : "") + ">" +
            "</label>" +
            '<p class="status' + (status.tone ? " tone-" + status.tone : "") +
              '" data-status data-testid="status">' + esc(status.text) + "</p>" +
            '<div class="dock-tools">' +
              '<button type="button" class="btn-warn" data-action="not-a-word" data-testid="not-a-word"' +
                (state.penalty || state.busy || (state.table.length === 0 && state.deck.length === 0) ? " disabled" : "") +
                ">Not a word</button>" +
              '<button type="button" class="btn-quiet" data-action="clear-selection"' +
                (state.selected.length ? "" : " disabled") + ">Clear</button>" +
              (state.override
                ? '<button type="button" class="btn-quiet allow-dock" data-action="allow-anyway" data-testid="allow-anyway-dock">Allow anyway</button>'
                : "") +
            "</div>" +
          "</div>" +
          '<div class="team-actions' + (ready ? " is-ready" : "") + '">' + awards + "</div>" +
        "</footer>" +
      "</section>"
    );
  }

  function renderHowTo() {
    return (
      '<div class="modal-back">' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="howto-title">' +
          '<p class="eyebrow">For the class</p>' +
          '<h2 id="howto-title">How to play</h2>' +
          "<ol>" +
            "<li>Letters land in the middle, one at a time.</li>" +
            "<li>See a word? Call it out!</li>" +
            "<li>The teacher taps those letters, then taps your colour.</li>" +
            "<li>The cards go on your pile. Most cards wins.</li>" +
            "<li>TH, ER, IN, and QU count as two letters. ? can be any letter.</li>" +
            "<li>The word has to be long enough, and it has to be a real word. A green check means yes.</li>" +
            "<li>If those letters are not in the list, the cards stay. The teacher can tap Allow anyway.</li>" +
            "<li>Spell check can be turned off before the round.</li>" +
            "<li>For a penalty, tap Not a word. Every other team takes one card.</li>" +
          "</ol>" +
          "<p>Space bar flips the next letter. Undo takes back the last move. Music plays during the round.</p>" +
          '<div class="modal-actions">' +
            '<button type="button" class="start" data-action="close-modal" data-testid="close-how-to">Let\'s play</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderConfirmEnd() {
    return (
      '<div class="modal-back">' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="end-title">' +
          '<h2 id="end-title">End the round?</h2>' +
          "<p>We'll count the cards and show the winner. Undo brings you back if this was a mis-tap.</p>" +
          '<div class="modal-actions">' +
            '<button type="button" class="start" data-action="confirm-end" data-testid="confirm-end">Show the winner</button>' +
            '<button type="button" class="tool" data-action="cancel-end">Keep playing</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderWinner() {
    var winners = winnerTeams();
    var best = winners[0] ? winners[0].cards.length : 0;
    var title;
    var sub;
    var splash = "var(--ink)";
    if (winners.length > 1) {
      title = "It's a tie!";
      sub = winners.map(function (t) { return t.name; }).join(" and ") + " have " + best + " cards each.";
    } else if (winners[0]) {
      title = winners[0].name + " wins!";
      sub = best + (best === 1 ? " card" : " cards");
      splash = winners[0].splash;
    } else {
      title = "Round over";
      sub = "";
    }
    var rows = rankedTeams().map(function (t, i) {
      return (
        '<li style="--bg:' + t.bg + ";--fg:" + t.fg + '">' +
          '<span class="place">' + (i + 1) + "</span>" +
          '<span class="who">' + esc(t.name) + "</span>" +
          '<span class="tally" data-testid="final-' + t.id + '">' + t.cards.length + "</span>" +
        "</li>"
      );
    }).join("");
    var bits = state.confetti.map(function (bit) {
      return '<i style="left:' + bit.left + "%;background:" + bit.color +
        ";animation-delay:" + bit.delay + "s;animation-duration:" + bit.dur +
        "s;width:" + bit.size + "px;height:" + Math.round(bit.size * 0.62) + 'px"></i>';
    }).join("");
    return (
      '<section class="winner" data-testid="winner">' +
        '<div class="confetti" aria-hidden="true">' + bits + "</div>" +
        '<div class="winner-panel" style="--splash:' + splash + '">' +
          '<p class="eyebrow">Round over</p>' +
          "<h1 data-testid=\"winner-title\">" + esc(title) + "</h1>" +
          '<p class="winner-sub">' + esc(sub) + "</p>" +
          '<ol class="results">' + rows + "</ol>" +
          '<div class="winner-actions">' +
            musicControlsHTML() +
            '<button type="button" class="start" data-action="play-again" data-testid="play-again">Play again</button>' +
            '<button type="button" class="tool" data-action="change-setup">Change setup</button>' +
            '<button type="button" class="tool" data-action="undo" data-testid="undo-winner"' +
              (state.history.length ? "" : " disabled") + ">Undo</button>" +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function onClick(event) {
    var btn = event.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    var action = btn.getAttribute("data-action");
    var value = btn.getAttribute("data-value");
    if (action === "teams-dec") {
      state.settings.teamCount = clampInt(state.settings.teamCount - 1, 2, 6, 2);
      saveSettings();
      render();
    } else if (action === "teams-inc") {
      state.settings.teamCount = clampInt(state.settings.teamCount + 1, 2, 6, 6);
      saveSettings();
      render();
    } else if (action === "set-min") {
      state.settings.minLength = clampInt(value, 2, 4, 3);
      saveSettings();
      render();
    } else if (action === "set-mode") {
      state.settings.flipMode = value === "manual" ? "manual" : "auto";
      saveSettings();
      render();
    } else if (action === "set-spell") {
      state.settings.spellCheck = value !== "off";
      saveSettings();
      if (spellOn()) loadWordList().catch(function () {});
      render();
    } else if (action === "music-toggle") {
      state.settings.musicOn = !musicWanted();
      saveSettings();
      if (state.phase === "winner" && state.settings.musicOn) {
        fanfareStarted = false;
        fanfarePending = false;
      }
      render();
      if (state.phase === "play") beginRoundMusic();
      else if (state.phase === "winner" && state.settings.musicOn) playFanfare();
      else syncMusic();
    } else if (action === "start") {
      startGame();
    } else if (action === "how-to") {
      state.howTo = true;
      clearFlipTimer();
      render();
      var closeBtn = app.querySelector("[data-testid='close-how-to']");
      if (closeBtn) closeBtn.focus();
    } else if (action === "close-modal") {
      state.howTo = false;
      render();
      scheduleFlip();
    } else if (action === "flip") {
      flipCard();
    } else if (action === "toggle-card") {
      toggleCard(btn.getAttribute("data-id"));
    } else if (action === "clear-selection") {
      clearSelection();
    } else if (action === "award") {
      award(btn.getAttribute("data-team"));
    } else if (action === "not-a-word") {
      if (state.phase !== "play" || state.busy || state.splash) return;
      state.penalty = true;
      state.selected = [];
      state.shake = false;
      clearOverride();
      clearFlipTimer();
      render();
      announce("Tap the team that guessed wrong.");
    } else if (action === "allow-anyway") {
      allowAnyway();
    } else if (action === "cancel-penalty") {
      state.penalty = false;
      render();
      scheduleFlip();
    } else if (action === "undo") {
      undo();
    } else if (action === "pause") {
      togglePause();
    } else if (action === "end-round") {
      if (state.phase !== "play" || state.busy) return;
      state.confirmEnd = true;
      state.penalty = false;
      clearFlipTimer();
      render();
    } else if (action === "cancel-end") {
      state.confirmEnd = false;
      render();
      scheduleFlip();
    } else if (action === "confirm-end") {
      enterWinner();
    } else if (action === "play-again") {
      playAgain();
    } else if (action === "change-setup") {
      clearFlipTimer();
      clearEndTimer();
      clearSplashTimer();
      state.phase = "setup";
      state.paused = false;
      state.busy = false;
      state.howTo = false;
      state.confirmEnd = false;
      render();
    }
  }

  function onInput(event) {
    var target = event.target;
    if (target.getAttribute("data-role") === "word") {
      state.word = target.value;
      return;
    }
    if (target.getAttribute("data-action") === "set-speed") {
      state.settings.flipSeconds = clampInt(target.value, 2, 10, 5);
      saveSettings();
      var label = document.querySelector("[data-speed-label]");
      if (label) label.textContent = state.settings.flipSeconds + "s";
    }
    if (target.getAttribute("data-role") === "music-volume") {
      state.settings.musicVolume = clampVolume(Number(target.value) / 100);
      saveSettings();
      applyMusicVolume();
    }
  }

  function onKey(event) {
    if (event.key === "Escape") {
      if (state.howTo) {
        state.howTo = false;
        render();
        scheduleFlip();
      } else if (state.penalty) {
        state.penalty = false;
        render();
        scheduleFlip();
      } else if (state.confirmEnd) {
        state.confirmEnd = false;
        render();
        scheduleFlip();
      }
      return;
    }
    if (event.key === " " || event.code === "Space") {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (state.phase !== "play") return;
      event.preventDefault();
      flipCard();
    }
    if (event.key === "Enter" && document.activeElement && document.activeElement.getAttribute("data-role") === "word") {
      event.preventDefault();
      if (state.selected.length) {
        setMessage("info", "Now tap the team that called it.");
      }
    }
  }

  function musicControlsHTML() {
    var on = musicWanted();
    var vol = Math.round(clampVolume(state.settings.musicVolume) * 100);
    return (
      '<div class="music-ctl">' +
        '<button type="button" class="tool music-btn" data-action="music-toggle" data-testid="music-toggle" aria-pressed="' +
          (on ? "true" : "false") + '">' + (on ? "Music on" : "Music off") + "</button>" +
        '<label class="music-vol"><span class="sr-only">Volume</span>' +
          '<input type="range" min="0" max="100" step="1" value="' + vol +
          '" data-role="music-volume" data-testid="music-volume" aria-label="Music volume">' +
        "</label>" +
      "</div>"
    );
  }

  app.addEventListener("pointerdown", function () {
    wakeAudio();
  });
  app.addEventListener("click", function (event) {
    wakeAudio();
    if (event.target.classList && event.target.classList.contains("modal-back")) {
      if (state.howTo) {
        state.howTo = false;
        render();
        scheduleFlip();
      } else if (state.confirmEnd) {
        state.confirmEnd = false;
        render();
        scheduleFlip();
      }
      return;
    }
    onClick(event);
  });
  app.addEventListener("input", onInput);
  document.addEventListener("keydown", onKey);

  tickTimer = window.setInterval(updateCountdown, 250);

  var built = buildDeck();
  if (built.length !== 55) {
    console.warn("My Word deck should have 55 cards, built " + built.length);
  }

  if (new URLSearchParams(location.search).has("debug")) {
    window.myWordDebug = {
      dealNext: function (faces) {
        var top = [];
        faces.forEach(function (face) {
          var index = -1;
          for (var i = 0; i < state.deck.length; i++) {
            if (state.deck[i].face === face && top.indexOf(state.deck[i]) === -1) {
              index = i;
              break;
            }
          }
          if (index >= 0) top.push(state.deck.splice(index, 1)[0]);
        });
        for (var n = top.length - 1; n >= 0; n--) state.deck.push(top[n]);
      },
      state: state,
      audio: function () {
        return {
          state: audioCtx ? audioCtx.state : "none",
          looping: musicLooping,
          fanfare: fanfareStarted,
          ducked: !!(musicDuck && musicDuck.gain.value < 0.6),
          volume: state.settings.musicVolume,
          on: musicWanted()
        };
      },
      wordsReady: function () { return !!(wordSet && wordSet.size); },
      hasWord: function (w) { return !!(wordSet && wordSet.has(String(w).toLowerCase())); },
      wordCount: function () { return wordSet ? wordSet.size : 0; }
    };
  }

  if (spellOn()) loadWordList().catch(function () {});

  render();
})();
