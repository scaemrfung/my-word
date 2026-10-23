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
  var flipDue = 0;

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
    confetti: []
  };

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function loadSettings() {
    var fallback = { teamCount: 4, minLength: 3, flipMode: "auto", flipSeconds: 5 };
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        teamCount: clampInt(raw.teamCount, 2, 6, fallback.teamCount),
        minLength: raw.minLength === 2 || raw.minLength === 4 ? raw.minLength : 3,
        flipMode: raw.flipMode === "manual" ? "manual" : "auto",
        flipSeconds: clampInt(raw.flipSeconds, 2, 10, fallback.flipSeconds)
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
        flipSeconds: s.flipSeconds
      }));
    } catch (err) {
      /* Private mode and blocked storage still let the round run. */
    }
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
    render();
  }

  function clearSelection() {
    if (!state.selected.length || state.busy) return;
    state.selected = [];
    state.shake = false;
    if (state.message && state.message.tone === "warn") state.message = null;
    render();
  }

  function award(teamId) {
    if (state.busy || state.splash || state.phase !== "play" || state.howTo || state.confirmEnd) return;
    if (state.penalty) {
      resolvePenalty(teamId);
      return;
    }
    var cards = selectedCards();
    var team = findTeam(teamId);
    if (!team) return;
    if (!cards.length) {
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
    var typed = state.word.trim().replace(/\s+/g, " ").slice(0, 16);
    var specs = captureSpecs(cards, teamId);
    pushHistory();
    var ids = {};
    cards.forEach(function (c) { ids[c.id] = true; });
    state.table = state.table.filter(function (c) { return !ids[c.id]; });
    team.cards = team.cards.concat(cards);
    state.selected = [];
    state.word = "";
    state.shake = false;
    rememberMessage("good", team.name + " takes " + cards.length + (cards.length === 1 ? " card." : " cards."));
    state.splash = typed ? { word: typed.toUpperCase(), teamId: teamId } : null;
    state.busy = true;
    clearFlipTimer();
    clearEndTimer();
    var flyers = spawnFlyers(specs);
    render();
    announce(state.message.text + (typed ? " Word " + typed : ""));
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
          '<div class="top-actions">' + tools + "</div>" +
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
            "<li>The word has to be long enough.</li>" +
            "<li>Not a real word? Every other team takes one card.</li>" +
          "</ol>" +
          "<p>Space bar flips the next letter. Undo takes back the last move.</p>" +
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
      clearFlipTimer();
      render();
      announce("Tap the team that guessed wrong.");
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

  app.addEventListener("click", function (event) {
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
      state: state
    };
  }

  render();
})();
