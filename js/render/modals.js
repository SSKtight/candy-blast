// 模态层：暂停面板、结束卡片、一次性提示气泡。焦点陷阱 + Esc。
export function createModals(rootEl) {
  let current = null; // {mask, onKey, previouslyFocused}

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function closeCurrent() {
    if (!current) return;
    document.removeEventListener("keydown", current.onKey, true);
    current.mask.remove();
    current.previouslyFocused?.focus?.();
    current = null;
  }

  function open(card, { escHandler, maskHandler, maskClass } = {}) {
    closeCurrent();
    const previouslyFocused = document.activeElement;
    const mask = el("div", `g-modal-mask${maskClass ? ` ${maskClass}` : ""}`);
    mask.appendChild(card);
    rootEl.appendChild(mask);

    // 点击遮罩空白区（非卡片）触发关闭
    if (maskHandler) {
      mask.addEventListener("click", (e) => {
        if (e.target === mask) maskHandler();
      });
    }

    const focusables = () =>
      [...card.querySelectorAll("button:not([disabled])")];

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        escHandler?.();
        return;
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    current = { mask, onKey, previouslyFocused };
    requestAnimationFrame(() => focusables()[0]?.focus());
  }

  function makeBtn(text, cls, onClick) {
    const b = el("button", `g-modal-btn ${cls ?? ""}`.trim(), text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function showPause({ onResume, onRestart, onQuit, onReplayGuide }) {
    const card = el("div", "g-modal-card");
    card.appendChild(el("h2", "g-modal-title", "暂停中"));
    card.appendChild(makeBtn("继续", "", () => {
      closeCurrent();
      onResume?.();
    }));
    card.appendChild(makeBtn("重新开始", "g-secondary", () => {
      closeCurrent();
      onRestart?.();
    }));
    card.appendChild(makeBtn("返回登录", "g-text", () => {
      closeCurrent();
      onQuit?.();
    }));
    if (onReplayGuide) {
      card.appendChild(makeBtn("重新观看引导", "g-replay-guide", () => {
        closeCurrent();
        onReplayGuide();
      }));
    }
    open(card, {
      escHandler: () => {
        closeCurrent();
        onResume?.();
      },
    });
  }

  function hidePause() {
    closeCurrent();
  }

  // 结算海报卡：环内仅分数（居中）；普通态粉紫进度环（score/highScore），
  // 新纪录态满金环 + 金光晕 + 彩纸一轮；遮罩为 60% 纯黑（g-modal-veil）。
  function showGameOver({
    score, highScore, placedCount, clearedLines, isRecord, beatBy, onRestart, onQuit,
  }) {
    const SVGNS = "http://www.w3.org/2000/svg";
    const R = 67;
    const CIRC = 2 * Math.PI * R; // ≈420.97
    const ANIM_MS = 1000; // 数字滚动 + 环增长的入场时长
    const easeOutCubic = (t) => 1 - (1 - t) ** 3;
    const progress = isRecord || highScore <= 0 ? 1 : Math.min(1, score / highScore);
    const targetOffset = CIRC * (1 - progress);

    const card = el("div", `g-rc-card${isRecord ? " is-record" : ""}`);

    // 彩纸：仅新纪录态，动画只播放一轮（forwards 停在卡片外，被 overflow 裁掉）
    if (isRecord) {
      const conf = el("div", "g-rc-confetti");
      const colors = ["#ff6b9d", "#ffd43b", "#51cf66", "#4dabf7", "#c44dff"];
      const lefts = [14, 30, 48, 66, 82];
      colors.forEach((bg, i) => {
        const p = el("i");
        p.style.left = `${lefts[i]}%`;
        p.style.background = bg;
        p.style.animationDuration = `${2.4 + (i % 3) * 0.3}s`;
        p.style.animationDelay = `${-(i * 0.35)}s`;
        conf.appendChild(p);
      });
      card.appendChild(conf);
    }

    const inner = el("div", "g-rc-inner");
    inner.appendChild(el("div", "g-rc-kicker", "本局结束"));

    // 进度环（SVG 旋转 -90° 由 CSS 处理）
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "g-rc-ring");
    svg.setAttribute("viewBox", "0 0 158 158");
    svg.setAttribute("width", "158");
    svg.setAttribute("height", "158");
    const track = document.createElementNS(SVGNS, "circle");
    [["cx", "79"], ["cy", "79"], ["r", String(R)], ["fill", "none"], ["stroke-width", "9.5"]]
      .forEach(([k, v]) => track.setAttribute(k, v));
    const prog = document.createElementNS(SVGNS, "circle");
    [["cx", "79"], ["cy", "79"], ["r", String(R)], ["fill", "none"], ["stroke-width", "9.5"],
      ["stroke-linecap", "round"], ["stroke-dasharray", CIRC.toFixed(2)],
      ["stroke-dashoffset", CIRC.toFixed(2)]]
      .forEach(([k, v]) => prog.setAttribute(k, v));
    if (!isRecord) {
      const defs = document.createElementNS(SVGNS, "defs");
      const grad = document.createElementNS(SVGNS, "linearGradient");
      grad.setAttribute("id", "g-rc-grad");
      grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
      grad.setAttribute("x2", "1"); grad.setAttribute("y2", "1");
      const s1 = document.createElementNS(SVGNS, "stop");
      s1.setAttribute("offset", "0"); s1.setAttribute("stop-color", "#ff8ab4");
      const s2 = document.createElementNS(SVGNS, "stop");
      s2.setAttribute("offset", "1"); s2.setAttribute("stop-color", "#c44dff");
      grad.appendChild(s1); grad.appendChild(s2);
      defs.appendChild(grad);
      svg.appendChild(defs);
      prog.setAttribute("stroke", "url(#g-rc-grad)");
    } else {
      prog.setAttribute("stroke", "#ffd84d");
    }
    svg.appendChild(track);
    svg.appendChild(prog);

    const center = el("div", "g-rc-center");
    const numEl = el("span", "g-rc-num", "0"); // 入场动画从 0 滚到 score
    center.appendChild(numEl);

    const ringWrap = el("div", "g-rc-ringwrap");
    ringWrap.appendChild(svg);
    ringWrap.appendChild(center);
    inner.appendChild(ringWrap);

    // 分差/超越行
    const gap = el("div", "g-rc-gap");
    if (isRecord) {
      gap.appendChild(el("span", "g-rc-rec", "👑 新纪录！"));
      gap.append("超越历史最高分 ");
      gap.appendChild(el("b", "", String(beatBy ?? 0)));
      gap.append(" 分");
    } else {
      gap.append("🏆 最高 ");
      gap.appendChild(el("b", "", String(highScore)));
      gap.append(" · 还差 ");
      gap.appendChild(el("b", "", String(Math.max(0, highScore - score))));
      gap.append(" 分");
    }
    inner.appendChild(gap);

    // 三格数据
    const iconOf = (kind) => {
      const sp = el("span", "g-rc-ic");
      if (kind === "blocks") {
        sp.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3" width="8" height="8" rx="2.5" fill="#ffc969"/><rect x="13" y="3" width="8" height="8" rx="2.5" fill="#ffd45e"/><rect x="3" y="13" width="8" height="8" rx="2.5" fill="#ffa04d"/><rect x="13" y="13" width="8" height="8" rx="2.5" fill="#ff922b"/></svg>';
      } else if (kind === "grid") {
        sp.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3.6" width="18" height="3.3" rx="1.6" fill="#a5d8fc"/><rect x="3" y="10.35" width="18" height="3.3" rx="1.6" fill="#7cc8fb"/><rect x="3" y="17.1" width="18" height="3.3" rx="1.6" fill="#4dabf7"/><rect x="14.4" y="3" width="3.3" height="18" rx="1.6" fill="#2f9be8" opacity=".92"/></svg>';
      } else {
        sp.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 3h12v3a6 6 0 0 1-12 0V3z" fill="#ffd43b"/><path d="M6 4H3.5v1.5A3.5 3.5 0 0 0 6 9M18 4h2.5v1.5A3.5 3.5 0 0 1 18 9" fill="none" stroke="#f0ae2e" stroke-width="1.6"/><rect x="10.5" y="12.5" width="3" height="4" rx="1" fill="#f0ae2e"/><rect x="7" y="18" width="10" height="3" rx="1.5" fill="#f0ae2e"/></svg>';
      }
      return sp;
    };
    const grid = el("div", "g-rc-grid");
    const stat = (kind, val, label) => {
      const st = el("div", "g-rc-stat");
      st.appendChild(iconOf(kind));
      st.appendChild(el("b", "", String(val)));
      st.appendChild(el("span", "", label));
      grid.appendChild(st);
    };
    stat("blocks", placedCount, "放置方块");
    stat("grid", clearedLines, "消除行列");
    stat("trophy", highScore, "历史最高");
    inner.appendChild(grid);

    inner.appendChild(makeBtn("再来一局", "g-rc-btn", () => {
      closeCurrent();
      onRestart?.();
    }));
    const quit = el("button", "g-rc-ghost", "返回登录");
    quit.type = "button";
    quit.addEventListener("click", () => {
      closeCurrent();
      onQuit?.();
    });
    inner.appendChild(quit);

    card.appendChild(inner);
    open(card, { maskClass: "g-modal-veil" });

    // 入场时间轴（单一 rAF，数字与环严格同步）：
    // 0→ANIM_MS 数字 0→score、环自顶部顺时针长到目标；结束后分差行淡入、彩纸加冕。
    const t0 = performance.now();
    let finished = false;
    let safety = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      if (!card.isConnected) return;
      numEl.textContent = String(score);
      prog.setAttribute("stroke-dashoffset", targetOffset.toFixed(2));
      gap.classList.add("g-rc-gap-show");
      if (isRecord) card.classList.add("g-rc-celebrate");
    };
    const tick = (now) => {
      if (!card.isConnected) { clearTimeout(safety); return; } // 弹窗已关闭
      const t = Math.min(1, (now - t0) / ANIM_MS);
      const p = easeOutCubic(t);
      numEl.textContent = String(Math.round(score * p));
      prog.setAttribute("stroke-dashoffset", (CIRC * (1 - progress * p)).toFixed(2));
      if (t < 1) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
    // 兜底：标签页后台 rAF 被挂起等场景，到时强制落终态（与 tick 的 finish 幂等）
    safety = setTimeout(finish, ANIM_MS + 100);
  }

  // 一次性提示气泡；点击按钮 resolve（当前已无调用方，保留备复用）
  function showTip(text) {
    return new Promise((resolve) => {
      const card = el("div", "g-modal-card g-tip-card");
      card.appendChild(el("p", "g-tip-text", text));
      card.appendChild(makeBtn("知道啦", "", () => {
        closeCurrent();
        resolve();
      }));
      open(card, {
        escHandler: () => {
          closeCurrent();
          resolve();
        },
      });
    });
  }

  // 非阻塞轻提示条：自动浮现、到时自动消失，不拦截操作、无需点击关闭
  function showToast(text, ms = 2500) {
    const t = el("div", "g-toast", text);
    rootEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 400);
    }, ms);
  }

  // 自定义确认弹窗（是/否），返回 Promise<boolean>
  function showConfirm({ title, text, confirmText = "是", cancelText = "否" }) {
    return new Promise((resolve) => {
      const card = el("div", "g-modal-card");
      if (title) card.appendChild(el("h2", "g-modal-title", title));
      if (text) card.appendChild(el("p", "g-confirm-text", text));
      card.appendChild(makeBtn(confirmText, "", () => {
        closeCurrent();
        resolve(true);
      }));
      card.appendChild(makeBtn(cancelText, "g-secondary", () => {
        closeCurrent();
        resolve(false);
      }));
      open(card, {
        escHandler: () => {
          closeCurrent();
          resolve(false);
        },
      });
    });
  }
  // 设置面板：音效/BGM 开关、重新观看引导、返回登录页、关闭、版本号
  // 打开设置即视为暂停；关闭（关闭按钮/遮罩/Esc）即恢复游戏。
  function showSettings({ sfxOn, musicOn, version, onSfx, onMusic, onQuit, onReplayGuide, onClose }) {
    const card = el("div", "g-modal-card g-settings-card");
    card.appendChild(el("h2", "g-modal-title", "设置"));

    const list = el("div", "g-settings-list");

    // 音效开关
    const sfxRow = el("div", "g-settings-row");
    sfxRow.appendChild(el("span", "g-settings-label", "音效"));
    const sfxSw = makeSwitch(sfxOn, "音效开关", (on) => {
      onSfx?.(on);
    });
    sfxRow.appendChild(sfxSw.el);
    list.appendChild(sfxRow);

    // BGM 开关
    const musicRow = el("div", "g-settings-row");
    musicRow.appendChild(el("span", "g-settings-label", "背景音乐"));
    const musicSw = makeSwitch(musicOn, "背景音乐开关", (on) => {
      onMusic?.(on);
    });
    musicRow.appendChild(musicSw.el);
    list.appendChild(musicRow);

    card.appendChild(list);

    // 重新观看引导
    card.appendChild(makeBtn("重新观看引导", "g-secondary", () => {
      closeCurrent();
      onReplayGuide?.();
    }));

    // 返回登录页
    card.appendChild(makeBtn("返回登录页", "g-secondary g-settings-quit", () => {
      onQuit?.();
    }));

    // 关闭（继续游戏）
    card.appendChild(makeBtn("关闭", "", () => {
      closeCurrent();
      onClose?.();
    }));

    // 版本号
    card.appendChild(el("div", "g-settings-version", `版本 ${version}`));

    open(card, {
      escHandler: () => {
        closeCurrent();
        onClose?.();
      },
      maskHandler: () => {
        closeCurrent();
        onClose?.();
      },
    });
  }

  // 糖果风开关：role=switch，返回 { el, setOn }
  function makeSwitch(on, ariaLabel, onChange) {
    const btn = el("button", "g-switch", "");
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(!!on));
    btn.setAttribute("aria-label", ariaLabel);
    const thumb = el("span", "g-switch-thumb", "");
    btn.appendChild(thumb);
    let state = !!on;
    btn.addEventListener("click", () => {
      state = !state;
      btn.setAttribute("aria-checked", String(state));
      onChange?.(state);
    });
    return {
      el: btn,
      setOn(v) {
        state = !!v;
        btn.setAttribute("aria-checked", String(state));
      },
    };
  }

  return { showPause, hidePause, showGameOver, showTip, showToast, showSettings, showConfirm, close: closeCurrent };
}
