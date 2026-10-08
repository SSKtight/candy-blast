// HUD：分数/最高分、充能条。（连击徽章已从 HUD 移除，连击只保留音效/震动/飘字）
import { CONFIG } from "../config.js";

export function createHudView() {
  const scoreEl = document.getElementById("score");
  const highEl = document.getElementById("high-score");
  const energyBar = document.getElementById("energy-bar");
  const crown = document.getElementById("energy-crown");
  const btnSfx = document.getElementById("btn-sfx");
  const btnMusic = document.getElementById("btn-music");

  let scoreShown = 0;
  let scoreToken = 0;

  function render(state) {
    scoreToken++;
    scoreShown = state.score;
    scoreEl.textContent = String(state.score);
  }

  // 300ms 数字滚动
  function animateScore(target) {
    const token = ++scoreToken;
    const from = scoreShown;
    const start = performance.now();
    const dur = CONFIG.anim.scoreRollMs;
    function step(now) {
      if (token !== scoreToken) return;
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) * (1 - t);
      const v = Math.round(from + (target - from) * eased);
      scoreEl.textContent = String(v);
      if (t < 1) requestAnimationFrame(step);
      else scoreShown = target;
    }
    requestAnimationFrame(step);
  }

  function setHigh(n) {
    highEl.textContent = String(n);
  }

  function setEnergy(energy, maxPulse = false) {
    const pct = Math.max(0, Math.min(100, (energy / CONFIG.energy.max) * 100));
    energyBar.style.width = `${pct}%`;
    // 渐变锚定轨道全长：background-size = (100/pct)%，填充越满右端橙黄越显现
    energyBar.style.backgroundSize = pct > 0 ? `${10000 / pct}% 100%` : "100% 100%";
    energyBar.classList.toggle("g-full", maxPulse);
    crown.hidden = energy < CONFIG.energy.max;
  }

  function setToggle(btn, on) {
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(on));
    btn.style.opacity = on ? "" : "0.45";
  }

  function setSfx(on) {
    setToggle(btnSfx, on);
  }
  function setMusic(on) {
    setToggle(btnMusic, on);
  }

  // T13 会加滚动与更多类型；这里提供基础飘字
  function floatText(anchorEl, text, cls = "") {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const tip = document.createElement("div");
    tip.className = `g-float-text ${cls}`.trim();
    tip.textContent = text;
    tip.style.left = `${rect.left + rect.width / 2}px`;
    tip.style.top = `${rect.top}px`;
    document.body.appendChild(tip);
    tip.addEventListener("animationend", () => tip.remove());
  }

  return {
    render,
    animateScore,
    setHigh,
    setEnergy,
    setSfx,
    setMusic,
    floatText,
  };
}
