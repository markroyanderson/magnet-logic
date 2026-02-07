(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const levelSelect = document.getElementById("levelSelect");
  const btnUndo = document.getElementById("btnUndo");
  const btnReset = document.getElementById("btnReset");
  const metaEl = document.getElementById("meta");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");

  // Colors (match CSS)
  const NAVY = "#0b1b3a";
  const BG = "#bfe6ff";

  // Level symbols:
  // # wall
  // . empty
  // M magnet start
  // o disc
  // * target (outline circle)
  //
  // IMPORTANT RULE:
  // targets count MUST equal total pieces (magnet + discs).
  // That guarantees magnet must cover a target too.
  const LEVELS = [
    { name: "1", map: [
      "###########",
      "#..*...*..#",
      "#..o......#",
      "#.....M...#",
      "#......o..#",
      "#..*......#",
      "###########"
    ]}, // 2 discs + 1 magnet = 3 targets (***)

    { name: "2", map: [
      "###########",
      "#..*..*...#",
      "#..o#.....#",
      "#...#M..o.#",
      "#...#.....#",
      "#..*......#",
      "###########"
    ]}, // 2 discs + magnet = 3 targets

    { name: "3", map: [
      "#############",
      "#..*.....*..#",
      "#..o..#..o..#",
      "#.....#.....#",
      "#.....#..M..#",
      "#..*.........#",
      "#############"
    ]}, // 2 discs + magnet = 3 targets

    { name: "4", map: [
      "#############",
      "#..*..#..*..#",
      "#..o..#..o..#",
      "#.....#.....#",
      "#..M..#.....#",
      "#.....#..*..#",
      "#############"
    ]}, // 2 discs + magnet = 3 targets

    { name: "5", map: [
      "###############",
      "#..*.....*....#",
      "#..o..#..o..#.#",
      "#.....#.....#.#",
      "#..o..#..M..#.#",
      "#..*..........#",
      "###############"
    ]}, // 3 discs + magnet = 4 targets (****)

    { name: "6", map: [
      "###############",
      "#..*..#..*....#",
      "#..o..#..o..#.#",
      "#.....#.....#.#",
      "#..M..#..o..#.#",
      "#..*..........#",
      "###############"
    ]}, // 3 discs + magnet = 4 targets

    { name: "7", map: [
      "#################",
      "#..*.....*......#",
      "#.#####.#####.###",
      "#..o..#..o..#...#",
      "#..#..#..#..#...#",
      "#..#..M..#..o..*#",
      "#..#.....#......#",
      "#..*............#",
      "#################"
    ]}, // 3 discs + magnet = 4 targets

    { name: "8", map: [
      "#################",
      "#..*..#.....#..*#",
      "#..o..#..o..#..o#",
      "#.....#..#..#...#",
      "###.###..#..###.#",
      "#...#....M....#.#",
      "#o..#..o..#..o#.#",
      "#*..#.....#..*..#",
      "#################"
    ]} // 6 discs + magnet = 7 targets (*******)
  ];

  // Populate level select
  LEVELS.forEach((lvl, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Level ${lvl.name}`;
    levelSelect.appendChild(opt);
  });

  const keyOf = (x, y) => `${x},${y}`;
  const parseKey = (k) => k.split(",").map(n => parseInt(n, 10));

  function normalizeMap(lines) {
    const w = Math.max(...lines.map(s => s.length));
    return lines.map(s => s.padEnd(w, "#"));
  }

  // --- Audio (retro beeps) ---
  let audio = { ctx: null, unlocked: false };

  function ensureAudio() {
    try {
      if (!audio.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio.ctx = new AC();
      }
      if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
      audio.unlocked = true;
    } catch {
      audio.unlocked = false;
    }
  }

  function beep({ freq = 440, dur = 0.07, type = "square", gain = 0.06 } = {}) {
    if (!audio.ctx || !audio.unlocked) return;
    try {
      const t0 = audio.ctx.currentTime;
      const o = audio.ctx.createOscillator();
      const g = audio.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      o.connect(g);
      g.connect(audio.ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch {}
  }

  const sfx = {
    pick()  { beep({ freq: 620, dur: 0.05, type: "square", gain: 0.05 }); },
    place() { beep({ freq: 420, dur: 0.06, type: "square", gain: 0.06 }); },
    push()  { beep({ freq: 240, dur: 0.07, type: "square", gain: 0.06 }); },
    win() {
      beep({ freq: 660, dur: 0.09, type: "square", gain: 0.06 });
      setTimeout(() => beep({ freq: 990, dur: 0.10, type: "triangle", gain: 0.06 }), 90);
    },
    blocked(){ beep({ freq: 140, dur: 0.06, type: "square", gain: 0.05 }); }
  };

  // --- localStorage safe ---
  function safeGetItem(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSetItem(k, v) { try { localStorage.setItem(k, v); } catch {} }

  // --- State ---
  // state = { w,h, walls:Set, targets:Set, magnet:{x,y}, discs:Set, won:bool, moves:int }
  let state = null;
  let history = [];
  let selected = false; // magnet picked up?
  let currentLevelIndex = 0;

  // Layout
  let tile = 48;
  let originX = 0, originY = 0;

  // Timer
  let started = false;
  let startTimeMs = 0;
  let elapsedMs = 0;
  let rafTimer = 0;

  function bestKey(i) { return `magnet_logic_best_time_${i}`; }

  function setTimer(seconds) {
    timeEl.textContent = seconds.toFixed(2);
  }
  function stopTimerLoop() {
    if (rafTimer) cancelAnimationFrame(rafTimer);
    rafTimer = 0;
  }
  function resetTimer() {
    started = false;
    startTimeMs = 0;
    elapsedMs = 0;
    setTimer(0);
    stopTimerLoop();
    rafTimer = requestAnimationFrame(tickTimer);
  }
  function startTimerIfNeeded() {
    if (started) return;
    started = true;
    startTimeMs = performance.now();
  }
  function tickTimer() {
    if (started && state && !state.won) {
      elapsedMs = performance.now() - startTimeMs;
      setTimer(elapsedMs / 1000);
    }
    rafTimer = requestAnimationFrame(tickTimer);
  }

  function loadBest() {
    const v = safeGetItem(bestKey(currentLevelIndex));
    if (!v) { bestEl.textContent = "—"; return; }
    const n = Number(v);
    bestEl.textContent = Number.isFinite(n) ? `${n.toFixed(2)}s` : "—";
  }
  function saveBestIfBetter(seconds) {
    const k = bestKey(currentLevelIndex);
    const prev = Number(safeGetItem(k));
    if (!Number.isFinite(prev) || seconds < prev) {
      safeSetItem(k, String(seconds));
      bestEl.textContent = `${seconds.toFixed(2)}s`;
    }
  }

  function cloneState(s) {
    return {
      w: s.w, h: s.h,
      walls: new Set(s.walls),
      targets: new Set(s.targets),
      magnet: { ...s.magnet },
      discs: new Set(s.discs),
      won: !!s.won,
      moves: s.moves | 0
    };
  }

  function loadLevel(index) {
    currentLevelIndex = index;
    history = [];
    selected = false;

    const lvl = LEVELS[index];
    const lines = normalizeMap(lvl.map);
    const h = lines.length;
    const w = Math.max(...lines.map(s => s.length));

    const walls = new Set();
    const targets = new Set();
    const discs = new Set();
    let magnet = { x: 1, y: 1 };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = lines[y][x] || "#";
        const k = keyOf(x, y);
        if (c === "#") walls.add(k);
        if (c === "*") targets.add(k);
        if (c === "o") discs.add(k);
        if (c === "M") magnet = { x, y };
      }
    }

    // Validate rule: targets = discs + magnet (1)
    // If not, still run, but the design rule is meant to hold.
    state = { w, h, walls, targets, magnet, discs, won: false, moves: 0 };

    fitBoardToCanvas();
    resetTimer();
    loadBest();
    render();
  }

  function resetLevel() {
    loadLevel(currentLevelIndex);
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    state = prev;
    selected = false;
    render();
  }

  // --- Rules ---
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < state.w && y < state.h; }
  function isWall(x, y) { return state.walls.has(keyOf(x, y)); }
  function isDisc(x, y) { return state.discs.has(keyOf(x, y)); }
  function isMagnet(x, y) { return state.magnet.x === x && state.magnet.y === y; }

  function isEmptyFloor(x, y) {
    if (!inBounds(x, y)) return false;
    if (isWall(x, y)) return false;
    if (isDisc(x, y)) return false;
    if (isMagnet(x, y)) return false;
    return true;
  }

  // Targets are "covered" if a disc OR the magnet occupies them.
  function isTargetCoveredKey(tk) {
    if (state.discs.has(tk)) return true;
    const [tx, ty] = parseKey(tk);
    return state.magnet.x === tx && state.magnet.y === ty;
  }

  function coveredCount() {
    let n = 0;
    for (const tk of state.targets) if (isTargetCoveredKey(tk)) n++;
    return n;
  }

  function checkWin() {
    if (state.targets.size === 0) return false;
    return coveredCount() === state.targets.size;
  }

  // Push discs away in 4 directions from magnet (one step, farthest-first per ray).
  function pushDiscsFrom(mx, my) {
    let movedAny = false;
    const dirs = [
      { dx: 0, dy: -1 }, // up
      { dx: 0, dy: 1 },  // down
      { dx: -1, dy: 0 }, // left
      { dx: 1, dy: 0 }   // right
    ];

    for (const { dx, dy } of dirs) {
      const ray = [];
      let x = mx + dx;
      let y = my + dy;

      while (inBounds(x, y) && !isWall(x, y)) {
        if (isDisc(x, y)) ray.push({ x, y });
        x += dx;
        y += dy;
      }

      // farthest-first so pushing doesn't overwrite nearer discs
      for (let i = ray.length - 1; i >= 0; i--) {
        const d = ray[i];
        const nx = d.x + dx;
        const ny = d.y + dy;

        if (isEmptyFloor(nx, ny)) {
          state.discs.delete(keyOf(d.x, d.y));
          state.discs.add(keyOf(nx, ny));
          movedAny = true;
        }
      }
    }
    return movedAny;
  }

  function pushHistory() {
    history.push(cloneState(state));
    if (history.length > 200) history.shift();
  }

  function placeMagnet(x, y) {
    if (state.won) return;
    if (!isEmptyFloor(x, y)) { sfx.blocked(); return; }

    pushHistory();
    state.magnet = { x, y };
    state.moves += 1;

    const moved = pushDiscsFrom(x, y);
    sfx.place();
    if (moved) sfx.push();

    state.won = checkWin();
    if (state.won) {
      sfx.win();
      const secs = elapsedMs / 1000;
      saveBestIfBetter(secs);
    }
  }

  // --- Input ---
  function fitBoardToCanvas() {
    const pad = 42;
    const usableW = canvas.width - pad * 2;
    const usableH = canvas.height - pad * 2 - 40;

    const tileW = Math.floor(usableW / state.w);
    const tileH = Math.floor(usableH / state.h);
    tile = Math.max(28, Math.min(tileW, tileH));

    originX = Math.floor((canvas.width - tile * state.w) / 2);
    originY = Math.floor((canvas.height - tile * state.h) / 2) + 12;
  }

  function pxToCell(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = (clientX - r.left) / r.width * canvas.width;
    const sy = (clientY - r.top) / r.height * canvas.height;

    const x = Math.floor((sx - originX) / tile);
    const y = Math.floor((sy - originY) / tile);
    if (!inBounds(x, y)) return null;

    const gx = originX + x * tile;
    const gy = originY + y * tile;
    if (sx < gx || sx > gx + tile || sy < gy || sy > gy + tile) return null;

    return { x, y };
  }

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    startTimerIfNeeded();

    const cell = pxToCell(e.clientX, e.clientY);
    if (!cell) return;

    // Tap magnet toggles selection
    if (isMagnet(cell.x, cell.y)) {
      selected = !selected;
      sfx.pick();
      render();
      return;
    }

    // If magnet selected, place it
    if (selected) {
      placeMagnet(cell.x, cell.y);
      selected = false;
      render();
      return;
    }
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "Escape") { selected = false; render(); }
    if (k === "r" || k === "R") { ensureAudio(); resetLevel(); }
    if (k === "z" || k === "Z") { ensureAudio(); undo(); render(); }
  });

  btnUndo.addEventListener("click", () => { ensureAudio(); undo(); render(); });
  btnReset.addEventListener("click", () => { ensureAudio(); resetLevel(); });
  levelSelect.addEventListener("change", () => loadLevel(parseInt(levelSelect.value, 10)));

  // --- Rendering ---
  function cellToPx(x, y) {
    return { x: originX + x * tile, y: originY + y * tile };
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    if (!state) return;

    // background solid
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const covered = coveredCount();
    const total = state.targets.size;
    metaEl.textContent = `Targets: ${covered}/${total} • Moves: ${state.moves}${selected ? " • Magnet: PICKED" : ""}`;

    // draw tiles (subtle grid)
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const k = keyOf(x, y);
        const { x: px, y: py } = cellToPx(x, y);

        // floor
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        roundRect(px + 2, py + 2, tile - 4, tile - 4, 10);
        ctx.fill();

        // walls
        if (state.walls.has(k)) {
          ctx.fillStyle = NAVY;
          roundRect(px + 2, py + 2, tile - 4, tile - 4, 10);
          ctx.fill();
          continue;
        }

        // target circles (navy outlines)
        if (state.targets.has(k)) {
          const isCovered = isTargetCoveredKey(k);
          ctx.strokeStyle = NAVY;
          ctx.lineWidth = Math.max(2, Math.floor(tile * 0.08));
          ctx.beginPath();
          ctx.arc(px + tile / 2, py + tile / 2, tile * 0.26, 0, Math.PI * 2);
          ctx.stroke();

          // subtle indicator when covered (still keeping outline style)
          if (isCovered) {
            ctx.fillStyle = NAVY;
            ctx.beginPath();
            ctx.arc(px + tile / 2, py + tile / 2, tile * 0.10, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // discs (solid navy circles)
    for (const dk of state.discs) {
      const [x, y] = parseKey(dk);
      const { x: px, y: py } = cellToPx(x, y);

      ctx.fillStyle = NAVY;
      ctx.beginPath();
      ctx.arc(px + tile / 2, py + tile / 2, tile * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    // magnet (solid navy rounded square)
    {
      const { x, y } = state.magnet;
      const { x: px, y: py } = cellToPx(x, y);

      ctx.fillStyle = NAVY;
      roundRect(px + 6, py + 6, tile - 12, tile - 12, 12);
      ctx.fill();

      // small notch mark (still navy, but “reads” as magnet)
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.font = `900 ${Math.floor(tile * 0.46)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("∩", px + tile / 2, py + tile / 2 + 1);
      ctx.textBaseline = "alphabetic";
    }

    // win overlay (minimal, high contrast)
    if (state.won) {
      ctx.fillStyle = "rgba(11,27,58,0.75)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.font = "900 56px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.fillText("Solved", canvas.width / 2, canvas.height / 2 - 10);

      ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("Choose another level (top right).", canvas.width / 2, canvas.height / 2 + 30);
    }
  }

  window.addEventListener("resize", () => {
    if (!state) return;
    fitBoardToCanvas();
    render();
  });

  // Start
  levelSelect.value = "0";
  loadLevel(0);
})();
