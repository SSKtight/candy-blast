// Web Audio 合成：14 音效 + 8 小节五声音阶 BGM + 振动。
// 单 AudioContext 懒建；任何不支持/异常全部静默降级，振动逻辑不受影响。
import { CONFIG } from "../config.js";

// 五声音阶（C D E G A），midi 音符号 → 频率
const SC = { C: 0, D: 2, E: 4, G: 7, A: 9 };
const PENT_NAMES = ["C", "D", "E", "G", "A"];
// deg 可为任意非负五声级（≥5 进八度），oct 为额外八度偏移；基准 C5
function pent(deg, oct = 0) {
  const d = ((deg % 5) + 5) % 5;
  const semi = 12 * (5 + oct + Math.floor(deg / 5)) + SC[PENT_NAMES[d]];
  return 440 * 2 ** ((semi - 69) / 12);
}
// 绝对音名：noteFreq("C", 4) = C4
function noteFreq(name, oct) {
  return 440 * 2 ** ((12 * (oct + 1) + SC[name] - 69) / 12);
}

// 8 小节 × 8 个八分音；-1 = 休止，0..4 = 五声级，数字串在下方旋律表里
// 五声音阶上行：C D E G A
const MELODY = [
  // bar 1
  0, -1, 2, -1, 4, -1, 2, -1,
  // bar 2
  4, -1, 4, -1, 2, -1, 1, -1,
  // bar 3
  0, -1, 1, -1, 2, -1, 4, -1,
  // bar 4（高八度）
  4 + 5, -1, 5, -1, 4, -1, 4, -1,
  // bar 5
  2, -1, 4, -1, 4, -1, 4, -1,
  // bar 6
  2, -1, 1, -1, 0, -1, 1, -1,
  // bar 7
  4, -1, 4, -1, 4, -1, 2, -1,
  // bar 8
  1, -1, 0, -1, -1, -1, -1, -1,
];
// 每小节根音（低音盒，第 0 拍与第 4 个八分音）
const BASS = ["C", "G", "A", "E", "C", "A", "G", "C"];

// 优先级：消除 > 放置 > UI
const PRIORITY = {
  singleClear: 3, multiClear: 3, combo: 3, premium: 3, recordFanfare: 3, gameOver: 3,
  pickup: 2, hover: 2, place: 2, placeFail: 2, reroll: 2,
  uiTap: 1, toggle: 1, tutorialWelcome: 1,
};

const SFX_BUS_GAIN = 0.5;
const MUSIC_BUS_GAIN = 10 ** (-18 / 20); // -18dB
const BPM = 118;
const EIGHTH = 60 / BPM / 2;

export function createSound(store) {
  let ctx = null;
  let sfxBus = null;
  let musicBus = null;
  let schedulerId = 0;
  let nextStepTime = 0;
  let step = 0;
  let bgmStarted = false;

  let sfxOn = !!store.sfxOn;
  let musicOn = !!store.musicOn;
  let paused = false;
  let duckUntil = 0;

  const voices = []; // { priority, hardStop }

  function supported() {
    return !!ctx;
  }

  function initContext() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      sfxBus = ctx.createGain();
      sfxBus.gain.value = SFX_BUS_GAIN;
      sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicOn ? MUSIC_BUS_GAIN : 0;
      musicBus.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  // ---------- 发声槽（8 槽优先级抢占） ----------
  function registerVoice(priority, hardStop) {
    if (voices.length >= 8) {
      let victim = 0;
      for (let i = 1; i < voices.length; i++) {
        if (voices[i].priority < voices[victim].priority) victim = i;
      }
      try { voices[victim].hardStop(); } catch { /* noop */ }
      voices.splice(victim, 1);
    }
    const v = { priority, hardStop };
    voices.push(v);
    return () => {
      const i = voices.indexOf(v);
      if (i >= 0) voices.splice(i, 1);
    };
  }

  // 单个音：振荡器 + 包络；slideTo 支持滑音
  function tone({
    freq, end = freq, type = "triangle", t0 = 0, dur = 0.12,
    peak = 0.3, attack = 0.008, bus = "sfx", priority = 1,
  }) {
    if (!supported()) return;
    const time = t0 || ctx.currentTime + 0.01;
    const out = bus === "music" ? musicBus : sfxBus;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (end !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + dur + 0.03);
    const unregister = registerVoice(priority, () => {
      try { osc.stop(time); } catch { /* noop */ }
    });
    osc.onended = unregister;
  }

  function chord(notes, opts) {
    for (const f of notes) tone({ ...opts, freq: f });
  }

  function seq(items, bus = "sfx") {
    // items: [{f,e,type,dur,peak,dt}]，dt 相对起点
    if (!supported()) return;
    const t0 = ctx.currentTime + 0.01;
    for (const it of items) {
      tone({
        freq: it.f, end: it.e ?? it.f, type: it.type ?? "triangle",
        t0: t0 + (it.dt ?? 0), dur: it.dur ?? 0.12, peak: it.peak ?? 0.28,
        attack: it.attack ?? 0.008, bus, priority: it.priority ?? 1,
      });
    }
  }

  // ---------- BGM（高音音乐盒/钟琴：明亮泛音、快速衰减、无沉闷低音） ----------
  function musicBoxStep(time) {
    const idx = step % MELODY.length;
    const deg = MELODY[idx];
    if (deg >= 0) {
      // 整体升高八度到 C6 区，叮咚感清脆
      const oct = (deg >= 5 ? 1 : 0) + 1;
      const d = deg % 5;
      const f = pent(d, oct);
      // 基音：三角波，短起音 + 略长余韵（音乐盒共鸣）
      tone({ freq: f, type: "triangle", t0: time, dur: 0.26, peak: 0.2, bus: "music", attack: 0.004 });
      // 2 倍频泛音：亮
      tone({ freq: f * 2, type: "sine", t0: time, dur: 0.16, peak: 0.085, bus: "music", attack: 0.003 });
      // ~3 倍频金属泛音：钟琴般的清脆光泽
      tone({ freq: f * 3.01, type: "sine", t0: time, dur: 0.1, peak: 0.028, bus: "music", attack: 0.003 });
    }
    // 每小节强拍：高音区轻“叮”代替原低音盒（C5 区，短促低音量）
    if (idx % 8 === 0 || idx % 8 === 4) {
      const bar = Math.floor(idx / 8);
      const bf = noteFreq(BASS[bar], 5);
      tone({ freq: bf, type: "triangle", t0: time, dur: 0.14, peak: 0.055, bus: "music", attack: 0.004 });
      tone({ freq: bf * 2, type: "sine", t0: time, dur: 0.08, peak: 0.02, bus: "music", attack: 0.003 });
    }
    step++;
  }

  function schedulerTick() {
    if (!ctx) return;
    while (nextStepTime < ctx.currentTime + 0.3) {
      musicBoxStep(nextStepTime);
      nextStepTime += EIGHTH;
    }
  }

  function startBgm() {
    if (!supported() || bgmStarted) return;
    bgmStarted = true;
    step = 0;
    nextStepTime = ctx.currentTime + 0.1;
    schedulerId = window.setInterval(schedulerTick, 100);
  }

  function applyMusicGain(ms = 0.12) {
    if (!supported()) return;
    const target = !musicOn ? 0 : paused ? MUSIC_BUS_GAIN * 0.4 : MUSIC_BUS_GAIN;
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), now);
    musicBus.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + ms);
  }

  // 关键音效闪避：0.5s 内压到 60% 再恢复
  function duck() {
    if (!supported() || !musicOn) return;
    const now = ctx.currentTime;
    duckUntil = now + 0.5;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), now);
    musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_GAIN * 0.6, now + 0.08);
    musicBus.gain.linearRampToValueAtTime(
      paused ? MUSIC_BUS_GAIN * 0.4 : MUSIC_BUS_GAIN,
      now + 0.5
    );
  }

  // ---------- 14 音效配方 ----------
  const P = PRIORITY;
  const SYNTHS = {
    pickup() {
      tone({ freq: pent(2, 1), end: pent(4, 1), type: "triangle", dur: 0.08, peak: 0.22, priority: P.pickup });
    },
    hover() {
      tone({ freq: pent(4, 1), type: "sine", dur: 0.05, peak: 0.06, attack: 0.004, priority: P.hover });
    },
    place() {
      seq([
        { f: pent(0, 0), e: pent(0, 0) * 0.8, type: "triangle", dur: 0.1, peak: 0.3, dt: 0 },
        { f: pent(4, 0), type: "sine", dur: 0.08, peak: 0.12, dt: 0.03 },
      ]);
    },
    placeFail() {
      tone({ freq: 150, end: 95, type: "sawtooth", dur: 0.13, peak: 0.16, priority: P.placeFail });
    },
    singleClear() {
      seq([
        { f: pent(4, 1), type: "triangle", dur: 0.1, peak: 0.3, dt: 0, priority: P.singleClear },
        { f: pent(0, 2), type: "triangle", dur: 0.16, peak: 0.3, dt: 0.07, priority: P.singleClear },
      ]);
      duck();
    },
    multiClear(ctxv = {}) {
      const n = Math.min(6, Math.max(2, ctxv.lineCount ?? 2) + 1);
      const items = [];
      for (let i = 0; i < n; i++) {
        items.push({ f: pent(i, 1), type: "triangle", dur: 0.12, peak: 0.28, dt: i * 0.06, priority: P.multiClear });
      }
      seq(items);
      duck();
    },
    combo(ctxv = {}) {
      const idx = Math.min(4, Math.max(0, (ctxv.combo ?? 1) - 1));
      seq([
        { f: pent(idx, 1), type: "triangle", dur: 0.1, peak: 0.26, dt: 0, priority: P.combo },
        { f: pent(idx, 1) * 2, type: "sine", dur: 0.12, peak: 0.1, dt: 0.02, priority: P.combo },
      ]);
      duck();
    },
    premium() {
      seq([
        { f: pent(0, 1), type: "triangle", dur: 0.1, peak: 0.26, dt: 0, priority: P.premium },
        { f: pent(2, 1), dur: 0.1, peak: 0.26, dt: 0.08, priority: P.premium },
        { f: pent(4, 1), dur: 0.14, peak: 0.28, dt: 0.16, priority: P.premium },
        { f: pent(2, 2), type: "sine", dur: 0.2, peak: 0.1, dt: 0.18, priority: P.premium },
      ]);
      duck();
    },
    reroll() {
      seq([
        { f: 392, end: 330, type: "square", dur: 0.06, peak: 0.1, dt: 0, priority: P.reroll },
        { f: 330, end: 294, type: "square", dur: 0.06, peak: 0.1, dt: 0.06, priority: P.reroll },
        { f: 440, end: 523, type: "square", dur: 0.09, peak: 0.1, dt: 0.12, priority: P.reroll },
      ]);
    },
    gameOver() {
      seq([
        { f: pent(0, 1), type: "triangle", dur: 0.22, peak: 0.26, dt: 0, priority: P.gameOver },
        { f: pent(4, 0), dur: 0.22, peak: 0.26, dt: 0.22, priority: P.gameOver },
        { f: pent(2, 0), dur: 0.22, peak: 0.26, dt: 0.44, priority: P.gameOver },
        { f: pent(0, 0), dur: 0.4, peak: 0.26, dt: 0.66, priority: P.gameOver },
      ]);
      duck();
    },
    uiTap() {
      tone({ freq: 620, type: "square", dur: 0.045, peak: 0.08, attack: 0.003, priority: P.uiTap });
    },
    recordFanfare() {
      const fan = [
        { f: pent(0, 1), type: "triangle", dur: 0.14, peak: 0.28, dt: 0, priority: P.recordFanfare },
        { f: pent(2, 1), dur: 0.14, peak: 0.28, dt: 0.13, priority: P.recordFanfare },
        { f: pent(4, 1), dur: 0.14, peak: 0.28, dt: 0.26, priority: P.recordFanfare },
        { f: pent(0, 2), dur: 0.3, peak: 0.3, dt: 0.39, priority: P.recordFanfare },
      ];
      seq(fan);
      // 末音叠三音
      const tEnd = ctx.currentTime + 0.39;
      chord([pent(2, 1), pent(4, 1)], { t0: tEnd, dur: 0.3, peak: 0.12, priority: P.recordFanfare });
      duck();
    },
    tutorialWelcome() {
      seq([
        { f: pent(0, 1), type: "sine", dur: 0.14, peak: 0.2, dt: 0, priority: P.tutorialWelcome },
        { f: pent(4, 1), type: "sine", dur: 0.14, peak: 0.2, dt: 0.14, priority: P.tutorialWelcome },
        { f: pent(0, 2), type: "triangle", dur: 0.24, peak: 0.22, dt: 0.28, priority: P.tutorialWelcome },
      ]);
    },
    toggle() {
      seq([
        { f: 520, type: "square", dur: 0.04, peak: 0.09, dt: 0, priority: P.toggle },
        { f: 720, type: "square", dur: 0.05, peak: 0.09, dt: 0.045, priority: P.toggle },
      ]);
    },
  };

  function unlock() {
    if (!initContext()) return;
    try {
      if (ctx.state === "suspended") void ctx.resume();
    } catch { /* noop */ }
    startBgm();
  }

  function play(name, ctxv) {
    if (!supported() || !sfxOn) return;
    const fn = SYNTHS[name];
    if (!fn) return;
    try {
      fn(ctxv);
    } catch {
      /* 合成失败静默 */
    }
  }

  function setSfxOn(on) {
    sfxOn = !!on;
  }

  function setMusicOn(on) {
    musicOn = !!on;
    if (supported() && ctx.state === "running") applyMusicGain(0.15);
    else if (supported()) applyMusicGain(0.0);
  }

  function setPaused(on) {
    paused = !!on;
    applyMusicGain(0.2);
  }

  function suspend() {
    if (!supported()) return;
    try { void ctx.suspend(); } catch { /* noop */ }
  }

  function resume() {
    if (!supported()) return;
    try {
      if (ctx.state === "suspended") void ctx.resume();
    } catch { /* noop */ }
  }

  // 振动：受音效开关控制，仅在支持时调用
  function vibrate(name) {
    if (!sfxOn) return;
    const pattern = CONFIG.haptics[name];
    if (!pattern) return;
    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
    } catch { /* noop */ }
  }

  // 验收/调试观测口（非功能入口）
  function _debug() {
    return {
      ctxState: ctx ? ctx.state : null,
      sfxOn,
      musicOn,
      paused,
      bgmStarted,
      voices: voices.length,
      musicGain: musicBus ? musicBus.gain.value : null,
      sfxGain: sfxBus ? sfxBus.gain.value : null,
    };
  }

  return { unlock, play, setSfxOn, setMusicOn, setPaused, suspend, resume, vibrate, _debug };
}
