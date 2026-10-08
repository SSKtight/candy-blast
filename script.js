// ===== AB 测试：埋点与分流（实验设计见 docs/experiments/2026-10-04-login-consent-ab-test.md）=====
const AB_VARIANT = window.__AB_VARIANT__ || "v0";

function getDevice() {
  return window.matchMedia("(max-width: 480px)").matches ? "mobile" : "desktop";
}

// 事件上报：console + localStorage 缓冲（上限 200 条），接入分析工具时替换此函数实现
function track(event, props = {}) {
  const payload = { event, variant: AB_VARIANT, ts: Date.now(), ...props };
  console.debug("[AB]", payload);
  try {
    const buf = JSON.parse(localStorage.getItem("ab_events") || "[]");
    buf.push(payload);
    while (buf.length > 200) buf.shift();
    localStorage.setItem("ab_events", JSON.stringify(buf));
  } catch (e) {
    /* 存储不可用时仅保留 console */
  }
}

// page_view_login（每次页面加载一条）
track("page_view_login", {
  is_new_user: (() => {
    try {
      if (localStorage.getItem("ab_seen")) return false;
      localStorage.setItem("ab_seen", "1");
      return true;
    } catch (e) {
      return true;
    }
  })(),
  device: getDevice(),
  // R2 回访记忆：存在记住账号记录即视为回访已记住用户（键值由 doLogin 成功路径维护）
  is_returning_remembered: (() => {
    try {
      return !!localStorage.getItem("candyblast_remember_user");
    } catch (e) {
      return false;
    }
  })(),
});

// ===== 密码可见性切换 =====
const pwdToggle = document.getElementById("pwdToggle");
const passwordInput = document.getElementById("password");
const eyeOpen = pwdToggle.querySelector(".eye-open");
const eyeClosed = pwdToggle.querySelector(".eye-closed");

pwdToggle.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  eyeOpen.style.display = isPassword ? "none" : "block";
  eyeClosed.style.display = isPassword ? "block" : "none";
  pwdToggle.setAttribute("aria-label", isPassword ? "隐藏密码" : "显示密码");
});

// ===== 登录表单提交 =====
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const usernameInput = document.getElementById("username");
const agreementCheckbox = document.getElementById("agreement");
const rememberCheckbox = document.getElementById("remember");

// ===== 记住我：仅记住账号（不存密码明文）=====
const REMEMBER_KEY = "candyblast_remember_user";
(function restoreRememberedUser() {
  let saved = null;
  try {
    saved = localStorage.getItem(REMEMBER_KEY);
  } catch (e) {
    saved = null;
  }
  if (saved) {
    usernameInput.value = saved;
    rememberCheckbox.checked = true;
    // R2 回访记忆：恢复历史明确同意状态（直接设属性，不触发 consent_checked 埋点）
    agreementCheckbox.checked = true;
    // 账号已带出，焦点直接放到密码框方便输入
    setTimeout(() => passwordInput.focus(), 0);
  }
})();

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();

  // AB: 登录尝试计数（会话内序号）
  let attemptSeq;
  try {
    attemptSeq = (parseInt(sessionStorage.getItem("ab_attempt_seq") || "0", 10) || 0) + 1;
    sessionStorage.setItem("ab_attempt_seq", String(attemptSeq));
  } catch (err) {
    attemptSeq = 1;
  }
  track("login_attempt", { attempt_seq: attemptSeq });

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  // 校验账号
  if (!username) {
    shakeInput(usernameInput);
    showToast("请输入账号");
    return;
  }

  // 校验密码
  if (!password) {
    shakeInput(passwordInput);
    showToast("请输入密码");
    return;
  }

  // V2：未勾选协议 → 一步确认弹窗（中断变一步）
  if (AB_VARIANT === "v2" && !agreementCheckbox.checked) {
    openConsentModal();
    return;
  }

  // V0/V1：未勾选协议 → Toast + 抖动（对照交互）
  if (!agreementCheckbox.checked) {
    shakeButton(loginBtn);
    showToast("请先阅读并同意用户协议和隐私政策");
    return;
  }

  doLogin(attemptSeq);
});

// ===== AB: 登录成功路径 =====
function doLogin(attemptSeq) {
  const remember = rememberCheckbox.checked;
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  // 记住我：勾选则持久化账号，取消勾选则清掉旧记录（不存密码）
  try {
    if (remember) localStorage.setItem(REMEMBER_KEY, username);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch (e) {
    /* 存储不可用时忽略，不影响登录 */
  }
  track("login_success", { attempt_seq: attemptSeq });
  showToast(`登录成功！${remember ? "已记住账号" : ""}`, "success");
  console.log("登录信息:", { username, password, remember });
  // 登录态仅存会话（与 game.html 的鉴权检查对应，键名见 js/config.js authSessionKey）
  setTimeout(() => {
    try {
      sessionStorage.setItem("candyblast_auth", "1");
    } catch (e) {
      /* 存储不可用时仍尝试跳转，由游戏页兜底 */
    }
    location.href = "game.html";
  }, 600);
}

function currentAttemptSeq() {
  try {
    return parseInt(sessionStorage.getItem("ab_attempt_seq") || "1", 10) || 1;
  } catch (e) {
    return 1;
  }
}

// ===== AB: 协议主动勾选（V0/V1 直接勾选，V2 弹窗确认后也会走到这里）=====
agreementCheckbox.addEventListener("change", () => {
  if (agreementCheckbox.checked) track("consent_checked");
  // R1（修订）：取消协议时联动取消记住我；记住我本身始终可选（勾选时另有协议确认弹窗）
  if (!agreementCheckbox.checked) rememberCheckbox.checked = false;
});

// R1（修订）：协议未勾选时也允许勾选记住我——同步弹出已阅读协议确认框
rememberCheckbox.addEventListener("change", () => {
  if (rememberCheckbox.checked && !agreementCheckbox.checked) {
    openRememberConsentModal();
  }
});

// ===== AB: V2 一步确认弹窗 =====
const consentModal = document.getElementById("consentModal");
const consentAcceptBtn = document.getElementById("consentAcceptBtn");
const consentModalClose = document.getElementById("consentModalClose");

function openConsentModal() {
  track("consent_modal_shown");
  consentModal.classList.add("open");
}

function closeConsentModal() {
  consentModal.classList.remove("open");
}

consentAcceptBtn.addEventListener("click", () => {
  // 弹窗打开期间输入可能被修改，复验
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  if (!username) {
    closeConsentModal();
    shakeInput(usernameInput);
    showToast("请输入账号");
    return;
  }
  if (!password) {
    closeConsentModal();
    shakeInput(passwordInput);
    showToast("请输入密码");
    return;
  }
  // 显式同意：用户主动点击，满足合规红线（禁止默认勾选/隐式同意）
  agreementCheckbox.checked = true;
  track("consent_checked");
  track("consent_modal_accepted");
  closeConsentModal();
  doLogin(currentAttemptSeq());
});

consentModalClose.addEventListener("click", closeConsentModal);
consentModal.querySelector(".ab-modal-mask").addEventListener("click", closeConsentModal);

// ===== R1（修订）: 勾选记住我时的协议确认弹窗 =====
const rememberConsentModal = document.getElementById("rememberConsentModal");
const rememberConsentAccept = document.getElementById("rememberConsentAccept");
const rememberConsentCancel = document.getElementById("rememberConsentCancel");
const rememberConsentClose = document.getElementById("rememberConsentClose");

function openRememberConsentModal() {
  track("remember_consent_prompt");
  rememberConsentModal.classList.add("open");
}

function dismissRememberConsent() {
  // 取消/关闭：回退记住我勾选，协议不动
  rememberCheckbox.checked = false;
  track("remember_consent_dismissed");
  rememberConsentModal.classList.remove("open");
}

rememberConsentAccept.addEventListener("click", () => {
  // 同意：协议勾选（直接设属性不触发 change，显式补埋点），记住我维持勾选
  agreementCheckbox.checked = true;
  track("consent_checked");
  track("remember_consent_confirmed");
  rememberConsentModal.classList.remove("open");
});

rememberConsentCancel.addEventListener("click", dismissRememberConsent);
rememberConsentClose.addEventListener("click", dismissRememberConsent);
rememberConsentModal.querySelector(".ab-modal-mask").addEventListener("click", dismissRememberConsent);

// ===== 输入框抖动 =====
function shakeInput(input) {
  input.style.animation = "none";
  // 强制重排
  void input.offsetWidth;
  input.style.animation = "shake 0.4s ease-in-out";
  input.focus();
}

// ===== 按钮抖动 =====
function shakeButton(btn) {
  btn.classList.remove("shake");
  void btn.offsetWidth;
  btn.classList.add("shake");
}

// ===== Toast 提示 =====
function showToast(message, type = "error") {
  // 移除已存在的 toast
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 30px;
    left: 50%;
    transform: translateX(-50%) translateY(-20px);
    background: ${type === "success" ? "#51cf66" : "#ff6b6b"};
    color: #fff;
    padding: 12px 24px;
    border-radius: 12px;
    font-size: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 9999;
    opacity: 0;
    transition: all 0.3s ease;
    white-space: nowrap;
  `;
  document.body.appendChild(toast);

  // 显示
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  // 自动消失
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-20px)";
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ===== 第三方登录 =====
document.querySelectorAll(".social-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const platform = btn.classList.contains("wechat")
      ? "微信"
      : btn.classList.contains("qq")
      ? "QQ"
      : "Apple";
    track("third_party_click", { provider: platform });
    showToast(`${platform}登录功能开发中...`, "success");
  });
});

// ===== 注册 / 忘记密码 =====
document.querySelector(".register-link").addEventListener("click", () => {
  showToast("注册功能开发中...", "success");
});

document.querySelector(".forgot-link").addEventListener("click", () => {
  showToast("密码找回功能开发中...", "success");
});

// ===== 用户协议 / 隐私政策（底部链接 + V2 弹窗内链接）=====
document.querySelectorAll(".agreement-text a, .ab-modal-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    track("agreement_link_click");
    showToast(`${link.textContent} 内容加载中...`, "success");
  });
});
