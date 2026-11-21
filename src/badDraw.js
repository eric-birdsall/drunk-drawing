import {
  BAD_DRAW as C,
  DRAW_PHASE as PHASE,
  createDrift,
  createInkWidth,
  roundResult,
} from "../shared/badDraw.js";
import { createWordPicker, wordsAt } from "../shared/badDrawWords.js";
import { createDrawingCanvas, replayDrawing } from "./badDrawCanvas.js";
import { drawCover } from "./cover.js";
import { createGallery } from "./gallery.js";
import { createMusic } from "./music.js";
import "./badDraw.css";
import "./pwa.js";

// Medium is the shared default. Easy is a steady sway with a little room for mistakes;
// Hard wanders far and fast, hiccups harder, and gives less time and fewer fixes.
const PRESETS = {
  easy: {
    amplitude: 20,
    frequency: 1.7,
    lean: 0.35,
    ramp: 1.5,
    // A gentler pace than the 8 s default: 45 s / 11 s ≈ 4 hiccups.
    hiccupEvery: 11_000,
    hiccupSize: 36,
    duration: 45_000,
    undo: 2,
    clear: 1,
    urgentSeconds: 10,
    note: "Steady sway, 4 hiccups, 45 seconds, 2 undos",
  },
  medium: {
    note: "Big lurches, 4 hiccups, 30 seconds, 1 undo",
  },
  hard: {
    amplitude: 42,
    frequency: 2.8,
    lean: 0.5,
    ramp: 2,
    hiccupSize: 70,
    duration: 15_000,
    undo: 0,
    clear: 1,
    urgentSeconds: 5,
    note: "Blackout wobble, 2 hiccups, 15 seconds, no undos",
  },
};
const RULES = {
  live: "Pick a drawer. Sketch the secret word while everyone else guesses aloud. No talking or writing letters.",
  reveal:
    "Pick a drawer. Sketch the secret word while nobody watches, then pass it to your team. They get the same time to guess.",
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Temporary controls. All slider values use the same units as the game.
const DEV_SLIDERS = [
  {
    key: "amplitude",
    label: "Drift distance",
    min: 0,
    max: 150,
    step: 1,
    unit: " px",
  },
  {
    key: "frequency",
    label: "Drift speed",
    min: 0,
    max: 8,
    step: 0.1,
    unit: "",
  },
  {
    key: "lean",
    label: "Slow lean",
    min: 0,
    max: 1,
    step: 0.05,
    unit: "",
  },
  {
    key: "ramp",
    label: "Drunker by the end",
    min: 1,
    max: 3,
    step: 0.05,
    unit: "×",
  },
  {
    key: "hiccupEvery",
    label: "Hiccup every",
    min: 0,
    max: 30000,
    step: 1000,
    unit: " s",
    format: (value) => (value ? `${value / 1000} s` : "off"),
  },
  {
    key: "hiccupSize",
    label: "Hiccup size",
    min: 0,
    max: 150,
    step: 1,
    unit: " px",
  },
  {
    key: "strokeWidth",
    label: "Ink width",
    min: 1,
    max: 30,
    step: 1,
    unit: " px",
  },
  {
    key: "inkSwell",
    label: "Ink swell size",
    min: 1,
    max: 4,
    step: 0.1,
    unit: "×",
  },
  {
    key: "inkSwells",
    label: "Ink swells per round",
    min: 1,
    max: 8,
    step: 1,
    unit: "",
  },
  {
    key: "duration",
    label: "Round length",
    min: 10000,
    max: 180000,
    step: 5000,
    unit: " s",
  },
];

const root = document.querySelector(".bad-draw");
const tuning = { ...C };
// Hard words are hidden for now; add "hard" here to bring them back.
const pickWord = createWordPicker({ words: wordsAt(["easy", "medium"]) });

const get = (key) => root.querySelector(`[data-${key}]`);
const intro = root.querySelector(".bad-draw-intro");

// Version and last-commit date, injected by vite.config.js.
{
  const { version, commit, date } = __BUILD__;
  const day = new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  get("build").textContent = `Version ${version} · Last updated ${day}`;
  if (commit) get("build").title = `Commit ${commit}`;
}
const play = root.querySelector(".bad-draw-play");
const canvas = play.querySelector("canvas");
const cursor = play.querySelector(".bad-draw-cursor");
const sheet = play.querySelector(".bad-draw-sheet");
const ink = createDrawingCanvas(canvas);
const listen = (target, name, handler) =>
  target.addEventListener(name, handler);
const space = play.querySelector(".paper-space");
// The paper's shape in game units, chosen at the start of each round to fill
// the free space. Its height stays fixed so the drift feels the same.
let paper = { width: C.width, height: C.height };
const center = () => ({ x: paper.width / 2, y: paper.height / 2 });

function fitPaper(newRound) {
  const { width, height } = space.getBoundingClientRect();
  if (!width || !height) return;
  if (newRound) {
    const aspect = clamp(width / height, 0.3, 4);
    paper = { width: Math.round(C.height * aspect), height: C.height };
  }
  // Fill the space; if it changes shape mid-round, fit inside it instead.
  const scale = Math.min(width / paper.width, height / paper.height);
  sheet.style.width = `${Math.floor(paper.width * scale)}px`;
  sheet.style.height = `${Math.floor(paper.height * scale)}px`;
}
const resize = new ResizeObserver(() => {
  if (phase === PHASE.PLAYING) fitPaper(false);
  ink.resize();
});
let phase, word, swapLeft, peeked, deadline, roundDuration, undoLeft, clearLeft, lastSecond;
let pointerId, revealId, intended;
let drift, inkWidth, roundStart, lastHiccup;
const hic = play.querySelector(".bad-draw-hic");
const meter = play.querySelector(".drunk-meter");
const DRUNK_WORDS = [
  [0.9, "Wasted"],
  [0.7, "Drunk"],
  [0.45, "Buzzed"],
  [0.2, "Tipsy"],
  [0, "Sober"],
];

const resultCard = root.querySelector(".result-card");
const snapshot = resultCard.querySelector("img");
const replayCanvas = resultCard.querySelector(".bad-draw-replay");
// The finished round, kept so the results card can play it back.
let lastRound, stopReplay;

function endReplay() {
  stopReplay?.();
  stopReplay = undefined;
  replayCanvas.hidden = true;
  get("replay").textContent = "Replay";
}

function replay() {
  if (phase !== PHASE.RESULTS || !lastRound?.log.length) return;
  endReplay();
  replayCanvas.hidden = false;
  get("replay").textContent = "Replay again";
  stopReplay = replayDrawing(replayCanvas, lastRound.log, lastRound.paper, {
    onDone() {
      stopReplay = undefined;
      replayCanvas.hidden = true;
    },
  });
}
const difficultyButtons = get("difficulty").querySelectorAll("button");
let difficulty = "medium";
// Live: the team guesses while the drawer draws. Reveal: the drawer draws
// alone, the drawing is covered, and the team taps Reveal to start guessing.
let mode = "live";
// Within a round: "draw", then in Reveal mode "pass" and "guess".
let stage;
const cover = get("cover");
const settings = document.querySelector(".bad-draw-dev");
const devControls = settings.querySelector(".bad-draw-dev-controls");
// Live unless Reveal Mode is switched on in Settings (this visit only).
const revealToggle = settings.querySelector("[data-reveal-mode]");
listen(revealToggle, "change", () => {
  mode = revealToggle.checked ? "reveal" : "live";
  get("description").textContent = RULES[mode];
});
devControls.innerHTML = DEV_SLIDERS.map(
  ({ key, label, min, max, step }) => `
  <div class="bad-draw-dev-row">
    <label for="tune-${key}">${label}</label>
    <output for="tune-${key}"></output>
    <input type="range" id="tune-${key}" min="${min}" max="${max}" step="${step}">
  </div>
`,
).join("");

const controls = DEV_SLIDERS.map(({ key, unit, format }) => {
  const input = settings.querySelector(`#tune-${key}`);
  const output = input.previousElementSibling;
  function update() {
    tuning[key] = input.valueAsNumber;
    output.value = format
      ? format(tuning[key])
      : (key === "duration" ? tuning[key] / 1000 : tuning[key]) + unit;
  }
  listen(input, "input", update);
  return (defaults) => {
    input.value = defaults[key];
    update();
  };
});

function resetTuning() {
  const { note, ...defaults } = { ...C, ...PRESETS[difficulty] };
  Object.assign(tuning, defaults);
  controls.forEach((reset) => reset(defaults));
  get("difficulty-note").textContent = note;
}

difficultyButtons.forEach((button) =>
  listen(button, "click", () => {
    difficulty = button.value;
    difficultyButtons.forEach((other) =>
      other.setAttribute("aria-checked", String(other === button)),
    );
    resetTuning();
  }),
);
listen(settings.querySelector("[data-dev-reset]"), "click", resetTuning);

// Theme: dark unless the group picked light. Remembered on this device.
const themeToggle = get("theme-toggle");
function setTheme(theme, save) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "light" ? "#e8e5d9" : "#161b1a";
  const label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
  if (save) {
    try {
      localStorage.setItem("drunk-drawing-theme", theme);
    } catch {}
    // The paper follows the theme, so repaint what's already drawn on it.
    drawCover(get("preview"));
    ink.restyle();
    gallery.restyle();
  }
}
listen(themeToggle, "click", () =>
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light", true),
);
setTheme(document.documentElement.dataset.theme || "dark", false);
// Tuning happens on the main menu only, never mid-round.
listen(get("settings"), "click", () => settings.showModal());
listen(settings, "click", (event) => {
  if (event.target === settings) settings.close();
});
resetTuning();

const galleryButtons = root.querySelectorAll("[data-gallery-open]");
const menuGallery = get("setup").parentElement.querySelector("[data-gallery-open]");
function updateGalleryButtons() {
  for (const button of galleryButtons)
    button.querySelector("span").textContent = gallery.size;
  // On the menu, only between rounds and once there is something to see.
  menuGallery.hidden = phase !== PHASE.READY || !gallery.size;
}
const gallery = createGallery(document.querySelector(".gallery"), {
  onChange: updateGalleryButtons,
});
galleryButtons.forEach((button) => listen(button, "click", gallery.open));

let audio;
const music = createMusic();
function unlockAudio() {
  if (!window.AudioContext) return;
  audio ||= new AudioContext();
  audio.resume().catch(() => {});
  music.connect(audio);
}
// Browsers only allow sound after a tap, so the menu music starts on the first one.
document.addEventListener("click", unlockAudio, true);
document.addEventListener("keydown", unlockAudio, true);

// Mute silences the music and the sound effects. Remembered on this device.
const muteToggle = get("mute-toggle");
let muted = false;
function setMuted(value, save) {
  muted = value;
  music.setMuted(muted);
  muteToggle.setAttribute("aria-pressed", String(muted));
  const label = muted ? "Unmute sound" : "Mute sound";
  muteToggle.setAttribute("aria-label", label);
  muteToggle.title = label;
  if (save) {
    try {
      localStorage.setItem("drunk-drawing-muted", muted ? "1" : "0");
    } catch {}
  }
}
listen(muteToggle, "click", () => setMuted(!muted, true));
try {
  setMuted(localStorage.getItem("drunk-drawing-muted") === "1", false);
} catch {
  setMuted(false, false);
}

function sound(frequency, duration = 0.12, delay = 0) {
  if (muted || audio?.state !== "running") return;
  const now = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.027, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

// The masthead hides while drawing, so its Back, Mute and theme buttons move
// into the round's top bar for the round.
const masthead = root.querySelector(".masthead");
const mastheadButtons = root.querySelector(".masthead-buttons");
const roundBar = play.querySelector(".round-bar");
function setPlaying(on) {
  root.classList.toggle("playing", on);
  (on ? roundBar : masthead).append(mastheadButtons);
}

function ready() {
  phase = PHASE.READY;
  endReplay();
  lastRound = undefined;
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  stopDrawing();
  hideWord();
  snapshot.removeAttribute("src");
  resultCard.hidden = play.hidden = true;
  setPlaying(false);
  intro.hidden = false;
  get("setup").hidden = get("settings").hidden = get("next").hidden = false;
  get("build").hidden = false;
  get("peek").hidden = get("swap").hidden = true;
  get("heading").textContent = "Ready to draw?";
  get("description").textContent = RULES[mode];
  cover.hidden = true;
  get("next").textContent = "Continue";
  // The main menu is the first screen, so there is nothing to go back to.
  get("back").hidden = true;
  updateGalleryButtons();  music.play();
}

function showWord() {
  const visible = phase === PHASE.REVEAL && revealId !== undefined;
  const secret = get("word");
  if (secret.hidden === visible) {
    secret.textContent = visible ? word : "";
    secret.hidden = !visible;
  }
  get("next").disabled = visible;
  if (visible) peeked = true;
  // One swap per round, only after the drawer has seen the word.
  get("swap").disabled = visible || !peeked || !swapLeft;
}

function hideWord() {
  const id = revealId;
  revealId = undefined;
  if (id !== undefined && get("peek").hasPointerCapture(id))
    get("peek").releasePointerCapture(id);
  showWord();
}

/** The word-peek screen. A new round draws a fresh word; coming Back from
 * the paper keeps the word and any swap already used. */
function reveal(newWord = true) {
  if (newWord) {
    word = pickWord();
    swapLeft = 1;
    peeked = false;
  }
  phase = PHASE.REVEAL;
  get("setup").hidden = get("settings").hidden = get("build").hidden = true;
  get("heading").textContent = "Guessers, look away!";
  get("description").textContent =
    "Drawer, hold to peek. Let go before you start the clock.";
  get("peek").hidden = false;
  get("swap").hidden = false;
  get("swap").disabled = true;
  get("next").textContent = "Start drawing";
  get("back").hidden = false;
  updateGalleryButtons();
}

function go() {
  if (phase === PHASE.READY) {
    unlockAudio();
    reveal();
  } else if (phase === PHASE.REVEAL && !get("next").disabled) {
    phase = PHASE.PLAYING;
    stage = "draw";
    music.stop();
    hideWord();
    const now = performance.now();
    roundDuration = tuning.duration;
    deadline = now + roundDuration;
    lastSecond = undefined;
    undoLeft = tuning.undo;
    clearLeft = tuning.clear;
    intro.hidden = true;
    play.hidden = false;
    setPlaying(true);
    fitPaper(true);
    intended = center();
    ink.resize();
    const seed = Math.floor(Math.random() * 0x100000000);
    drift = createDrift(seed, tuning, roundDuration);
    inkWidth = createInkWidth(seed, tuning, roundDuration);
    roundStart = now;
    lastHiccup = undefined;
    hic.classList.remove("pop");
    sheet.classList.remove("jolt");
    meter.classList.remove("jolt");
    updateMeter(now);
    ink.reset(drift, now, paper);
    cursor.hidden = true;
    cover.hidden = true;
    showStage();
    updateTools();
    updateClock(now);
    sound(380);
    sound(560, 0.16, 0.08);
  }
}

/** Show the footer for this stage of the round. */
function showStage() {
  const drawing = stage === "draw";
  get("undo").hidden = get("clear").hidden = !drawing;
  get("done").hidden = !(drawing && mode === "reveal");
  get("correct").hidden = drawing ? mode === "reveal" : stage !== "guess";
  get("hint").textContent = drawing
    ? "Drag your finger to draw"
    : stage === "pass"
      ? "Pass it to your team"
      : "Guess what it is!";
}

/** Reveal mode: the drawer is done, so cover the paper for the hand-off. */
function handOff() {
  if (phase !== PHASE.PLAYING || stage !== "draw") return;
  stage = "pass";
  stopDrawing();
  cursor.hidden = true;
  hic.classList.remove("pop");
  get("cover-title").textContent =
    performance.now() >= deadline ? "Time’s up, drawer!" : "Done!";
  cover.hidden = false;
  // The guessing clock waits, full, until the team taps Reveal.
  deadline = performance.now() + roundDuration;
  lastSecond = undefined;
  updateClock(performance.now());
  showStage();
  sound(420, 0.14);
  sound(330, 0.18, 0.1);
}

/** Reveal mode: show the drawing and start the team's clock. */
function showDrawing() {
  if (phase !== PHASE.PLAYING || stage !== "pass") return;
  stage = "guess";
  cover.hidden = true;
  const now = performance.now();
  deadline = now + roundDuration;
  lastSecond = undefined;
  updateClock(now);
  showStage();
  sound(380);
  sound(560, 0.16, 0.08);
}

/** The clock ran out: the drawer hands off in Reveal mode, else the round ends. */
function timeUp(now) {
  if (mode === "reveal" && stage === "draw") handOff();
  else finish(false, now);
}

function finish(correct, now = performance.now()) {
  if (phase !== PHASE.PLAYING) return;
  if (mode === "reveal" && stage !== "guess") return;
  const result = roundResult(correct, deadline, now, roundDuration);
  phase = PHASE.RESULTS;
  stopDrawing();
  play.hidden = true;
  setPlaying(false);
  snapshot.src = canvas.toDataURL();
  endReplay();
  lastRound = { log: ink.log, paper: { ...paper } };
  get("replay").hidden = !lastRound.log.length;
  gallery.add(canvas, { word, ...result });
  sound(result.success ? 540 : 230, 0.18);
  if (result.success) sound(760, 0.2, 0.11);
  get("answer").textContent = word;
  get("outcome").textContent = result.success ? "They got it!" : "Time’s up!";
  get("score").textContent = result.score;
  get("remaining").textContent = `${(result.remaining / 1000).toFixed(1)}s`;
  resultCard.hidden = false;
}

function updateClock(now) {
  const second = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (second === lastSecond) return;
  lastSecond = second;
  get("time").textContent =
    `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`;
  get("time").parentElement.classList.toggle(
    "urgent",
    second <= tuning.urgentSeconds,
  );
  if (second > 0 && second <= tuning.urgentSeconds) sound(310, 0.07);
}

function updateTools() {
  for (const [action, left] of [
    ["undo", undoLeft],
    ["clear", clearLeft],
  ]) {
    get(action).querySelector("span").textContent = left;
    get(action).disabled = !left || !ink.hasInk;
  }
}

function stopDrawing() {
  const id = pointerId;
  pointerId = undefined;
  if (id !== undefined && canvas.hasPointerCapture(id))
    canvas.releasePointerCapture(id);
  ink.end();
}

function tool(action) {
  if (phase !== PHASE.PLAYING || stage !== "draw") return;
  if (performance.now() >= deadline) return timeUp(performance.now());
  if (!ink.hasInk || (action === "undo" ? !undoLeft : !clearLeft)) return;
  stopDrawing();
  if (action === "undo") undoLeft--;
  else clearLeft--;
  ink[action]();
  updateTools();
  sound(action === "undo" ? 360 : 280, 0.08);
}

function moveCursor(x, y) {
  intended = { x, y };
  cursor.hidden = false;
  cursor.style.left = `${(100 * x) / paper.width}%`;
  cursor.style.top = `${(100 * y) / paper.height}%`;
}

function pointerPoint(event, rect) {
  // Let the aim leave the paper by as far as the ink can drift back onto it.
  const reach = tuning.amplitude * Math.max(1, tuning.ramp);
  return {
    x: clamp(
      ((event.clientX - rect.left) * paper.width) / rect.width,
      -reach,
      paper.width + reach,
    ),
    y: clamp(
      ((event.clientY - rect.top) * paper.height) / rect.height,
      -reach,
      paper.height + reach,
    ),
  };
}

listen(canvas, "pointerdown", (event) => {
  if (phase !== PHASE.PLAYING || stage !== "draw" || pointerId !== undefined)
    return;
  const now = performance.now();
  if (now >= deadline) return timeUp(now);
  event.preventDefault();
  const { x, y } = pointerPoint(event, canvas.getBoundingClientRect());
  moveCursor(x, y);
  pointerId = event.pointerId;
  canvas.setPointerCapture(pointerId);
  // The ink swells and thins a few times over the round.
  ink.begin(x, y, now, inkWidth);
  updateTools();
});

listen(canvas, "pointermove", (event) => {
  if (phase !== PHASE.PLAYING || event.pointerId !== pointerId) return;
  const now = performance.now();
  if (now >= deadline) return timeUp(now);
  const rect = canvas.getBoundingClientRect();
  for (const sample of event.getCoalescedEvents?.() || []) {
    const p = pointerPoint(sample, rect);
    ink.advance(p.x, p.y, Math.min(now, sample.timeStamp || now));
  }
  const { x, y } = pointerPoint(event, rect);
  moveCursor(x, y);
  ink.advance(x, y, now);
});

listen(canvas, "pointerup", (event) => {
  if (event.pointerId !== pointerId) return;
  const now = performance.now();
  if (now >= deadline) return timeUp(now);
  const { x, y } = pointerPoint(event, canvas.getBoundingClientRect());
  ink.advance(x, y, now);
  stopDrawing();
  cursor.hidden = true;
});
for (const name of ["pointercancel", "lostpointercapture"]) {
  listen(canvas, name, (event) => {
    if (event.pointerId !== pointerId) return;
    stopDrawing();
    cursor.hidden = true;
  });
}

listen(get("peek"), "pointerdown", (event) => {
  if (phase !== PHASE.REVEAL || revealId !== undefined) return;
  event.preventDefault();
  revealId = event.pointerId;
  get("peek").setPointerCapture(revealId);
  showWord();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  listen(get("peek"), name, (event) => {
    if (event.pointerId !== revealId) return;
    revealId = undefined;
    showWord();
  });
}
// The drawer may trade the word once; the first word is gone for good.
listen(get("swap"), "click", () => {
  if (phase !== PHASE.REVEAL || !swapLeft || revealId !== undefined) return;
  swapLeft = 0;
  peeked = false;
  word = pickWord();
  get("description").textContent =
    "New word! Hold to peek. No going back to the old one.";
  showWord();
});
// A long press on the peek button must not open a callout or select text.
listen(get("peek"), "contextmenu", (event) => event.preventDefault());

function suspendInput() {
  stopDrawing();
  hideWord();
  cursor.hidden = true;
}
listen(window, "blur", suspendInput);
listen(document, "visibilitychange", () => {
  if (document.hidden) suspendInput();
});

/** Pop a "hic!" beside the pen, on the side the ink is jolted toward. */
function showHiccup({ angle }) {
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  const x = clamp(intended.x + dx * 60, paper.width * 0.06, paper.width * 0.94);
  const y = clamp(intended.y + dy * 60, paper.height * 0.1, paper.height * 0.9);
  hic.style.left = `${(100 * x) / paper.width}%`;
  hic.style.top = `${(100 * y) / paper.height}%`;
  hic.style.setProperty("--tilt", `${Math.round(dx * 14)}deg`);
  sheet.style.setProperty("--jx", `${(dx * 6).toFixed(1)}px`);
  sheet.style.setProperty("--jy", `${(dy * 6).toFixed(1)}px`);
  meter.style.setProperty("--wobble", `${dx < 0 ? -7 : 7}deg`);
  // Restart the animations even if the last one hasn't finished.
  for (const el of [hic, sheet, meter]) el.classList.remove("pop", "jolt");
  void hic.offsetWidth;
  hic.classList.add("pop");
  sheet.classList.add("jolt");
  meter.classList.add("jolt");
}

/** Fill the glass as the round goes on: the fuller it gets, the drunker. */
function updateMeter(now) {
  const drunk = clamp((now - roundStart) / roundDuration, 0, 1);
  meter.style.setProperty("--level", drunk.toFixed(4));
  const word = DRUNK_WORDS.find(([from]) => drunk >= from)[1];
  if (get("drunk").textContent !== word) {
    get("drunk").textContent = word;
    meter.setAttribute("aria-label", `Drunk meter: ${word}`);
  }
}

function tick(now) {
  // While the tablet is passed, the guessing clock waits.
  if (phase === PHASE.PLAYING && stage !== "pass") {
    if (now >= deadline) timeUp(now);
    if (phase === PHASE.PLAYING && stage !== "pass") updateClock(now);
  }
  if (phase === PHASE.PLAYING && stage === "draw") {
    updateMeter(now);
    const hiccup = drift.hiccup(now - roundStart);
    if (hiccup && hiccup.id !== lastHiccup) {
      lastHiccup = hiccup.id;
      showHiccup(hiccup);
    }
  }
  // Keep sampling the drift while the finger rests in place.
  if (pointerId !== undefined) ink.advance(intended.x, intended.y, now);
  requestAnimationFrame(tick);
}

get("next").onclick = go;
get("again").onclick = ready;
get("correct").onclick = () => finish(true);
get("done").onclick = handOff;
get("show").onclick = showDrawing;
get("replay").onclick = replay;
// The logo always goes home, from any screen, dropping a round in progress.
get("home").onclick = ready;
// Back goes one screen: drawing returns to the word peek (same word, round
// dropped); the word peek and the results card return to the main menu, since
// a finished round can't be resumed.
get("back").onclick = () => {
  if (phase !== PHASE.PLAYING) return ready();
  stopDrawing();
  cursor.hidden = cover.hidden = true;
  hic.classList.remove("pop");
  play.hidden = true;
  setPlaying(false);
  intro.hidden = false;
  reveal(false);
  music.play();
};
get("undo").onclick = () => tool("undo");
get("clear").onclick = () => tool("clear");
resize.observe(space);
resize.observe(canvas);
drawCover(get("preview"));
ready();
requestAnimationFrame(tick);
