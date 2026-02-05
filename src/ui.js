import { Logger } from "./logger.js";
import { CONDITIONS } from "./conditions.js";
import { sendCompletionMessage } from "./postmessage.js";

// Helper để inline markdown: chỉ convert **bold** -> <strong>bold</strong>
function renderInlineMarkdown(input = "") {
  return String(input).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

const SCREENS = {
  INTRO: "intro",
  NOTICE: "notice",
  DETAILS: "details",
  DEMO: "demo",
  EXIT: "exit",
};

export class AppUI {
  constructor({ root, condition }) {
    this.root = root;
    this.condition = condition;
    this.logger = new Logger();

    this.currentScreen = null;
    this.demoStartTime = null;
    // Thời điểm bắt đầu đếm 30s sau khi người dùng đã bật camera + chọn filter
    this.demoQualifyingStartTime = null;
    this.demoContinueEnabled = false;

    // Tối thiểu 30s tính từ sau khi đã bật camera và chọn filter
    this.demoMinMs = 30000;
    this.demoInteractionCountAtStart = 0;
    this.demoTimerInterval = null;

    this.cameraStream = null;
    this.usingCamera = false;

    // Trạng thái tương tác demo: đã bật camera / đã chọn style nào chưa
    this.hasUsedCamera = false;
    this.hasChosenStyle = false;

    // Filter state: track if filter is toggled on demo/camera
    this.isFilterMuted = false;
    this.currentStyleVariant = 0;

    // Debug flags: chỉ log một lần khi face tracking nhận diện được
    this._faceDebugLogged = false;
    this._loopDebugLogged = false;

    // Face tracking state (MediaPipe Face Landmarker)
    this.faceLandmarker = null;
    this.faceTrackingCanvas = null;
    this.faceTrackingCtx = null;
    this.faceTrackingLoopHandle = null;
    this._faceLibPromise = null;

    this.init();
  }

  init() {
    this.root.innerHTML = "";
    const intro = this.buildIntroScreen();
    const notice = this.buildNoticeScreen();
    const details = this.buildDetailsScreen();
    const demo = this.buildDemoScreen();
    const exit = this.buildExitScreen();

    this.root.append(intro, notice, details, demo, exit);

    this.toScreen(SCREENS.INTRO);
  }

  toScreen(screen) {
    const prev = this.currentScreen;

    // nếu rời màn demo thì tắt camera để không giữ webcam chạy nền
    if (prev === SCREENS.DEMO && screen !== SCREENS.DEMO) {
      this.stopCamera();

      // Nếu đang hiển thị overlay notice trong demo thì ẩn đi
      const inlineNotice = document.getElementById("demoNoticeOverlay");
      if (inlineNotice) {
        inlineNotice.remove();
      }
    }

    this.currentScreen = screen;
    const screens = this.root.querySelectorAll(".screen");
    screens.forEach((el) => {
      el.classList.toggle("active", el.dataset.screen === screen);
    });

    if (screen === SCREENS.NOTICE) {
      this.logger.markNoticeVisible();
    } else {
      this.logger.markNoticeHidden();
    }

    if (screen === SCREENS.DEMO) {
      this.onEnterDemo();
    } else if (screen === SCREENS.EXIT) {
      this.onEnterExit();
    }
  }

  buildIntroScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.INTRO;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Try this AR face filter preview";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "In social apps, AR face filters use the camera to track your face in real time. In this short demo, you can try the camera or explore a preview and continue.";

    const card = document.createElement("div");
    card.className = "card card-contrast";
    card.innerHTML =
      '<div class="notice-heading">What to expect</div>' +
      '<div class="notice-text">' +
      '<strong>Step 1:</strong> Read a short data notice about how data related to this demo may be handled.<br>' +
      '<strong>Step 2:</strong> Try a quick filter preview (camera is optional in this demo).<br>' +
      '<strong>Step 3:</strong> Return to the survey.' +
      '</div>' +
      '<div class="pill-row">' +
      '<span class="pill pill-accent">Short demo</span>' +
      '<span class="pill">In-browser</span>' +
      '<span class="pill">Camera available</span>' +
      "</div>";

    const reassurance = document.createElement("div");
    reassurance.className = "meta-text";
    reassurance.style.marginTop = "10px";
    reassurance.textContent = "You can return to the survey at any time.";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "Start demo (Step 1: data notice)";
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.NOTICE);
    });

    btnRow.appendChild(primary);

    el.append(title, subtitle, card, reassurance, btnRow);
    return el;
  }

  buildNoticeScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.NOTICE;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Data Notice (Step 1 of 3)";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "This short notice explains how information related to the AR face filter feature may be handled. You can view optional details if you'd like.";

    const card = document.createElement("div");
    card.className = "card card-contrast";
    const noticeHtml = `
      <div class="notice-heading">What this notice covers</div>
      <div class="notice-text">
        <strong>Camera (same in all versions):</strong> Raw camera video is used to render the effect in real time.
        <ul class="notice-factors" style="padding-left: 18px; margin: 12px 0 0 0; list-style: disc;">
          <li style="margin-bottom: 8px;"><span class="notice-line-label">(A – Third-party)</span> ${renderInlineMarkdown(this.condition.notice.tpSentence)}</li>
          <li style="margin-bottom: 8px;"><span class="notice-line-label">(B – Identifiability)</span> ${renderInlineMarkdown(this.condition.notice.idSentence)}</li>
          <li style="margin-bottom: 0;"><span class="notice-line-label">(C – Retention)</span> ${renderInlineMarkdown(this.condition.notice.rtSentence)}</li>
        </ul>
      </div>
    `;
    card.innerHTML = noticeHtml;

    const meta = document.createElement("div");
    meta.className = "meta-text";
    meta.style.marginTop = "8px";
    meta.innerHTML =
      "You'll be asked a few questions about this notice next.<br>This notice applies only to this short demo.";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const detailsLink = document.createElement("button");
    detailsLink.className = "btn btn-secondary";
    detailsLink.textContent = "View details";
    detailsLink.addEventListener("click", () => {
      this.logger.addInteraction();
      this.logger.markDetailsViewed();
      this.toScreen(SCREENS.DETAILS);
    });

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "I understand, continue";
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.DEMO);
    });

    btnRow.append(detailsLink, primary);

    el.append(title, subtitle, card, meta, btnRow);
    return el;
  }

  buildDetailsScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.DETAILS;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Details about camera and face data use";

    // Intentionally no step badge / subtitle here to keep this page minimal.

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="notice-text details-list" style="line-height: 1.6;">
        <div class="notice-subheading" style="font-weight: 600; margin-bottom: 8px;">
          Same in all versions
        </div>
        <ul style="padding-left: 18px; margin: 0 0 12px 0; list-style: disc;">
          <li style="margin-bottom: 12px;">
            <strong>How the camera is used (same in all versions):</strong><br>
            Raw camera video is processed in real time to render the effect. The raw camera video is not stored as part of this demo.
          </li>
          <li style="margin-bottom: 0;">
            <strong>What “usage and performance data” means (same in all versions):</strong><br>
            This may include which buttons you tap, how long you use the demo, and basic performance metrics (e.g., whether the effect runs smoothly). This does not include your raw camera video.
          </li>
        </ul>

        <div class="notice-subheading" style="font-weight: 600; margin: 4px 0 8px 0;">
          This version of the demo (varies by version)
        </div>

        <div class="details-factor" style="margin-bottom: 12px; padding-left: 4px; border-left: 3px solid rgba(0,0,0,0.12); margin-left: 4px;">
          <strong>A — Third-party (Varies by version)</strong><br>
          ${renderInlineMarkdown(this.condition.details.tpDetails)}
          <br>
          In other words: this refers to analytics and measurement data about how the filter is used (not the raw camera video).<br>
          ${
            this.condition.tp === "internal"
              ? "In this version: usage analytics are handled only within the app and are not shared outside the app."
              : "In this version: usage analytics are shared with third-party analytics and measurement partners."
          }
        </div>

        <div class="details-factor" style="margin-bottom: 12px; padding-left: 4px; border-left: 3px solid rgba(0,0,0,0.12); margin-left: 4px;">
          <strong>B — Identifiability (Varies by version)</strong><br>
          ${renderInlineMarkdown(this.condition.details.idDetails)}
          <br>
          A “biometric template” means a unique pattern (for example, from face, hand, or voice signals) that can be used to recognise a person.<br>
          ${
            this.condition.id === "low"
              ? "In this version: no unique biometric template is created."
              : "In this version: a biometric template may be generated and could be used to identify you, especially when combined with other information."
          }
        </div>

        <div class="details-factor" style="margin-bottom: 0; padding-left: 4px; border-left: 3px solid rgba(0,0,0,0.12); margin-left: 4px;">
          <strong>C — Retention (Varies by version)</strong><br>
          ${renderInlineMarkdown(this.condition.details.rtDetails)}
          <br>
          This refers to stored data such as usage and performance logs (not the raw camera video).<br>
          ${
            this.condition.rt === "immediate"
              ? "In this version: stored data related to this feature are deleted immediately after the demo ends."
              : "In this version: stored data related to this feature may be retained for up to 30 days unless you request deletion."
          }
        </div>
      </div>
    `;

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const back = document.createElement("button");
    back.className = "btn btn-secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.NOTICE);
    });

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "I understand, continue";
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.DEMO);
    });

    btnRow.append(back, primary);

    el.append(title, card, btnRow);
    return el;
  }

  buildDemoScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.DEMO;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Try the AR filter";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "Step 2 of 3: you can use your camera or just explore the filter on the demo video. Tap the buttons below to try different styles.";

    const demoShell = document.createElement("div");
    demoShell.className = "demo-shell";

    // Demo video frame
    const frame = document.createElement("div");
    frame.className = "demo-video-frame";
    frame.id = "demoFrame";

    // Placeholder (static demo image fallback)
    const placeholder = document.createElement("div");
    placeholder.className = "demo-placeholder";
    placeholder.id = "demoPlaceholder";

    const placeholderVideo = document.createElement("img");
    placeholderVideo.src =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 600'%3E%3Crect width='400' height='600' fill='%23e0f2fe'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='system-ui' font-size='16'%3EDemo preview%3C/text%3E%3C/svg%3E";
    placeholderVideo.alt = "Demo preview placeholder";
    placeholderVideo.style.cssText =
      "width:100%;height:100%;object-fit:cover;";
    placeholder.appendChild(placeholderVideo);

    // Real camera video
    const video = document.createElement("video");
    video.className = "demo-camera-video";
    video.id = "demoCameraVideo";
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.style.display = "none";

    // Canvas overlay for face tracking
    const overlay = document.createElement("canvas");
    overlay.className = "demo-camera-overlay-canvas";
    overlay.id = "demoCameraOverlayCanvas";
    overlay.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    overlay.style.display = "none";

    // Social UI overlay (Instagram/TikTok style)
    const socialUI = document.getElementById("social-ui-template");
    if (socialUI) {
      const clone = socialUI.content.cloneNode(true);
      frame.appendChild(clone);
    }

    // Grain overlay
    const grainTemplate = document.getElementById("grain-overlay-template");
    if (grainTemplate) {
      const grainClone = grainTemplate.content.cloneNode(true);
      frame.appendChild(grainClone);
    }

    frame.append(placeholder, video, overlay);
    demoShell.appendChild(frame);

    // Demo controls
    const controls = document.createElement("div");
    controls.className = "demo-controls";

    const controlsLeft = document.createElement("div");
    controlsLeft.className = "demo-controls-left";

    const chip = document.createElement("div");
    chip.className = "chip";
    chip.id = "demoStatusChip";
    chip.innerHTML = '<span class="chip-dot"></span><span>Camera off</span>';

    controlsLeft.appendChild(chip);
    controls.appendChild(controlsLeft);
    demoShell.appendChild(controls);

    // Button row
    const buttonRow = document.createElement("div");
    buttonRow.className = "demo-button-row";

    const cameraBtn = document.createElement("button");
    cameraBtn.className = "btn btn-secondary btn-small";
    cameraBtn.id = "demoCameraButton";
    cameraBtn.textContent = "Use my camera";
    cameraBtn.addEventListener("click", () => {
      this.logger.addInteraction({ demo: true });
      this.requestCamera();
    });

    const styleBtn = document.createElement("button");
    styleBtn.className = "btn btn-secondary btn-small";
    styleBtn.id = "demoStyleButton";
    styleBtn.textContent = "Switch style";
    styleBtn.addEventListener("click", () => {
      this.logger.addInteraction({ demo: true });
      this.cycleStyle();
    });

    const muteBtn = document.createElement("button");
    muteBtn.className = "btn btn-secondary btn-small";
    muteBtn.id = "demoMuteButton";
    muteBtn.textContent = "Soften effect";
    muteBtn.addEventListener("click", () => {
      this.logger.addInteraction({ demo: true });
      this.toggleFilterMute();
    });

    buttonRow.append(cameraBtn, styleBtn, muteBtn);
    demoShell.appendChild(buttonRow);

    // CTA text
    const ctaText = document.createElement("div");
    ctaText.className = "demo-cta-text";
    ctaText.id = "demoCtaText";
    ctaText.textContent =
      "Tap 'Use my camera' above to try the filter on yourself, or tap 'Switch style' to explore different effects on the demo preview.";
    demoShell.appendChild(ctaText);

    // Hint text
    const hint = document.createElement("div");
    hint.className = "demo-hint";
    hint.id = "demoHint";
    hint.style.display = "none";
    hint.textContent =
      "Please try the demo for at least 30 seconds (you may use your camera or explore styles on the preview). Then you can continue.";
    demoShell.appendChild(hint);

    el.appendChild(demoShell);

    // Notice badge link
    const noticeBadge = document.createElement("div");
    noticeBadge.style.cssText = "margin-top:10px;text-align:center;";
    const badgeLink = document.createElement("a");
    badgeLink.className = "badge-link";
    badgeLink.href = "#";
    badgeLink.textContent = "Review the privacy notice";
    // Keep the “link” feel but make it visible.
    badgeLink.style.cssText =
      "display:inline-block;color:#0b5ed7;text-decoration:underline;font-weight:600;padding:6px 10px;border-radius:10px;";
    badgeLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.logger.addInteraction({ demo: true });
      this.showInlineNotice();
    });
    noticeBadge.appendChild(badgeLink);
    el.appendChild(noticeBadge);

    // Continue button (gated)
    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "14px";

    const continueBtn = document.createElement("button");
    continueBtn.className = "btn btn-primary btn-disabled";
    continueBtn.id = "demoContinueButton";
    continueBtn.textContent = "Continue";
    continueBtn.disabled = true;
    continueBtn.addEventListener("click", () => {
      if (!this.demoContinueEnabled) return;
      this.logger.addInteraction({ demo: true });
      this.toScreen(SCREENS.EXIT);
    });

    btnRow.appendChild(continueBtn);
    el.appendChild(btnRow);

    return el;
  }

  buildExitScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.EXIT;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Demo complete — thank you!";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "Step 3 of 3: you have finished the AR filter demo. Please return to the survey to continue.";

    const card = document.createElement("div");
    card.className = "card card-contrast";
    card.innerHTML =
      '<div class="notice-text">Please return to the survey to continue.</div>';

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-secondary";
    backBtn.textContent = "Back to demo (optional)";
    backBtn.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.DEMO);
    });

    const finishBtn = document.createElement("button");
    finishBtn.className = "btn btn-primary";
    finishBtn.textContent = "Return to survey";
    finishBtn.addEventListener("click", () => {
      this.logger.addInteraction();
      this.finishAndSendData();
    });

    btnRow.append(backBtn, finishBtn);

    el.append(title, subtitle, card, btnRow);
    return el;
  }

  onEnterDemo() {
    this.demoStartTime = performance.now();
    this.demoInteractionCountAtStart = this.logger.interactionCount;
    this.logger.markDemoVisible();
    this.logger.startLagMonitor();

    // Reset demo state
    this.hasUsedCamera = false;
    this.hasChosenStyle = false;
    this.demoQualifyingStartTime = null;
    this.demoContinueEnabled = false;

    // Bắt đầu timer kiểm tra gating
    this.startDemoGatingTimer();
  }

  onEnterExit() {
    this.logger.stopLagMonitor();
    if (this.demoTimerInterval) {
      clearInterval(this.demoTimerInterval);
      this.demoTimerInterval = null;
    }
  }

  finishAndSendData() {
    const summary = this.logger.getSummary(this.condition);
    sendCompletionMessage(summary);
  }

  // Hiển thị lại notice overlay inline trong demo
  showInlineNotice() {
    this.logger.markNoticeReviewOpened();

    // Kiểm tra xem đã có overlay chưa
    let overlay = document.getElementById("demoNoticeOverlay");
    if (overlay) {
      // Đã có rồi thì chỉ cần hiện ra
      overlay.style.display = "flex";
      return;
    }

    // Tạo mới overlay
    overlay = document.createElement("div");
    overlay.id = "demoNoticeOverlay";
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15,23,42,0.85);
      backdrop-filter: blur(8px);
      z-index: 999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;

    const card = document.createElement("div");
    card.className = "card card-contrast";
    card.style.cssText = "max-width: 420px; width: 100%;";

    const heading = document.createElement("div");
    heading.className = "notice-heading";
    heading.textContent = "Privacy notice reminder";
    heading.style.marginBottom = "10px";

    const text = document.createElement("div");
    text.className = "notice-text";
    const aValue = this.condition.tp === "internal" ? "Internal" : "External";
    const bValue = this.condition.id === "low" ? "Low" : "High";
    const cValue = this.condition.rt === "immediate" ? "Immediate" : "Up to 30 days";
    // Full notice content (matches Page 2, read-only)
    const cameraLine =
      "Your camera feed is processed in real time to render the effect. The raw camera video for this effect is not stored.";
    text.innerHTML = `
      <div style="margin-bottom: 12px; line-height: 1.5;">
        <div style="font-weight: 700;">Camera (same in all versions)</div>
        <div>${cameraLine}</div>
      </div>
      <div style="margin-bottom: 12px; line-height: 1.5;">
        <div style="font-weight: 700;">A — Third-party (varies by version)</div>
        <div>${renderInlineMarkdown(this.condition.notice.tpSentence)}</div>
      </div>
      <div style="margin-bottom: 12px; line-height: 1.5;">
        <div style="font-weight: 700;">B — Identifiability (varies by version)</div>
        <div>${renderInlineMarkdown(this.condition.notice.idSentence)}</div>
      </div>
      <div style="margin-bottom: 0; line-height: 1.5;">
        <div style="font-weight: 700;">C — Retention (varies by version)</div>
        <div>${renderInlineMarkdown(this.condition.notice.rtSentence)}</div>
      </div>
    `;

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "14px";

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-primary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    btnRow.append(closeBtn);
    card.append(heading, text, btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // Bật timer kiểm tra điều kiện gating cho nút Continue
  startDemoGatingTimer() {
    if (this.demoTimerInterval) return;

    this.demoTimerInterval = setInterval(() => {
      this.updateDemoGatingState();
    }, 500);
  }

  // Kiểm tra và cập nhật trạng thái nút Continue
  updateDemoGatingState() {
    // Engagement gating (non-coercive): require ~30s in the demo after they start engaging
    // (camera OR switching styles). Do not force camera permission.
    const startedEngaging = this.hasUsedCamera || this.hasChosenStyle;

    // If they haven't engaged yet, don't start the countdown.
    if (!startedEngaging) {
      this.demoQualifyingStartTime = null;
      this.demoContinueEnabled = false;
      this.updateContinueButton(false, null);
      return;
    }

    // Start countdown at first engagement moment.
    if (!this.demoQualifyingStartTime) {
      this.demoQualifyingStartTime = performance.now();
    }

    const elapsed = performance.now() - this.demoQualifyingStartTime;
    const remainingMs = Math.max(0, this.demoMinMs - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const canContinue = remainingMs <= 0;

    this.demoContinueEnabled = canContinue;
    this.updateContinueButton(canContinue, remainingSec);
  }

  updateContinueButton(enabled, remainingSec = null) {
    const btn = document.getElementById("demoContinueButton");
    if (!btn) return;

    if (enabled) {
      btn.classList.remove("btn-disabled");
      btn.disabled = false;
      btn.textContent = "Continue";

      const hint = document.getElementById("demoHint");
      if (hint) hint.style.display = "none";
    } else {
      btn.classList.add("btn-disabled");
      btn.disabled = true;
      if (typeof remainingSec === "number") {
        btn.textContent = `Continue (in ${remainingSec}s)`;
      } else {
        btn.textContent = "Continue";
      }

      const hint = document.getElementById("demoHint");
      if (hint) {
        hint.style.display = "block";
        if (typeof remainingSec === "number") {
          hint.textContent = `Continue will unlock in ${remainingSec}s.`;
        } else {
          hint.textContent =
            "Please try the demo for at least 30 seconds (you may use your camera or explore styles on the preview). Then you can continue.";
        }
      }
    }
  }

  // Cycle qua các style overlay
  cycleStyle() {
    this.currentStyleVariant = (this.currentStyleVariant + 1) % 3;
    this.hasChosenStyle = true;
    this.updateDemoGatingState();

    const labels = ["Cat ears + blush", "Sunglasses + heart", "Crown + stars"];
    this.showStyleTag(labels[this.currentStyleVariant]);
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'cycle-style',hypothesisId:'H7',location:'src/ui.js:cycleStyle',message:'Style changed',data:{currentStyleVariant:this.currentStyleVariant,hasFaceLandmarker:!!this.faceLandmarker,usingCamera:this.usingCamera,hasCanvas:!!this.faceTrackingCanvas},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }

  // Bật/tắt filter mute (soften effect)
  toggleFilterMute() {
    this.isFilterMuted = !this.isFilterMuted;

    const video = document.getElementById("demoCameraVideo");
    const placeholder = document.getElementById("demoPlaceholder");
    const muteBtn = document.getElementById("demoMuteButton");

    if (this.isFilterMuted) {
      // Soften: thêm blur + giảm saturation
      if (video instanceof HTMLVideoElement) {
        video.style.filter =
          "brightness(1.1) saturate(1.2) contrast(1.05) blur(0.4px) sepia(0.1)";
      }
      if (placeholder) {
        placeholder.style.filter = "grayscale(0.15) saturate(0.8)";
      }
      if (muteBtn) muteBtn.textContent = "Restore effect";
    } else {
      // Restore: xóa filter
      if (video instanceof HTMLVideoElement) {
        video.style.filter = "none";
      }
      if (placeholder) {
        placeholder.style.filter = "none";
      }
      if (muteBtn) muteBtn.textContent = "Soften effect";
    }
  }

  // Hiển thị tag chỉ style hiện tại
  showStyleTag(label) {
    const frame = document.getElementById("demoFrame");
    if (!frame) return;

    let tag = frame.querySelector(".demo-style-tag");
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "demo-style-tag";
      tag.style.cssText =
        "position:absolute;top:14px;right:14px;z-index:30;background:rgba(255,255,255,0.92);padding:6px 12px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid rgba(148,163,184,0.6);";
      tag.style.color = "#22223b";
      tag.style.fontWeight = "500";
      tag.style.boxShadow = "0 2px 10px rgba(0,0,0,0.10)";
      tag.style.pointerEvents = "none";
      frame.appendChild(tag);
    }
    tag.textContent = label;
  }

  // stopCamera: stop all tracks, reset UI về trạng thái chưa bật camera
  stopCamera() {
    try {
      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {}
    this.cameraStream = null;
    this.usingCamera = false;

    const video = document.getElementById("demoCameraVideo");
    if (video instanceof HTMLVideoElement) {
      try {
        video.pause();
      } catch (e) {}
      video.srcObject = null;
      video.style.display = "none";
      video.style.filter = "none";
      video.style.transition = "filter 0.3s ease";
      // Keep mirror effect for consistency
      video.style.transform = "scaleX(-1)";
    }

    const overlay = document.getElementById("demoCameraOverlayCanvas");
    if (overlay) overlay.style.display = "none";

    // Dừng face tracking nếu đang chạy
    this.stopFaceTracking();

    const placeholder = document.getElementById("demoPlaceholder");
    if (placeholder) {
      placeholder.style.display = "flex";
      placeholder.style.filter = this.isFilterMuted
        ? "grayscale(0.15) saturate(0.8)"
        : "none";
    }

    const statusChip = document.getElementById("demoStatusChip");
    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot"></span><span>Camera off</span>';
    }

    const camBtn = document.getElementById("demoCameraButton");
    if (camBtn instanceof HTMLButtonElement) {
      camBtn.textContent = "Use my camera";
      camBtn.disabled = false;
    }
  }

  // Yêu cầu camera: bật/tắt robust, request camera, xử lý lỗi.
  async requestCamera() {
    // Nếu đang bật camera -> toggle OFF
    if (this.usingCamera) {
      this.logger.addInteraction({ demo: true });
      this.stopCamera();
      this.updateDemoGatingState();
      return;
    }

    const camBtn = document.getElementById("demoCameraButton");
    const statusChip = document.getElementById("demoStatusChip");

    // Set trạng thái requesting
    if (camBtn instanceof HTMLButtonElement) {
      camBtn.disabled = true;
      camBtn.textContent = "Requesting…";
    }
    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot chip-dot-warn"></span><span>Requesting camera…</span>';
    }

    // Check HTTPS context
    if (!window.isSecureContext) {
      this.logger.setCameraPermission("insecure_context");
      this.showCameraUnavailable(
        "Camera requires HTTPS (or localhost). Please open this demo via https:// or http://localhost."
      );
      if (camBtn instanceof HTMLButtonElement) {
        camBtn.disabled = false;
        camBtn.textContent = "Use my camera";
      }
      return;
    }

    // Check support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.logger.setCameraPermission("not_supported");
      this.showCameraUnavailable(
        "Your browser does not support camera access here."
      );
      if (camBtn instanceof HTMLButtonElement) {
        camBtn.disabled = false;
        camBtn.textContent = "Use my camera";
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false,
      });

      this.cameraStream = stream;
      this.logger.setCameraPermission("granted");

      await this.enableCameraView(stream);

      if (camBtn instanceof HTMLButtonElement) {
        camBtn.disabled = false;
        camBtn.textContent = "Stop camera";
      }

      this.updateDemoGatingState();
    } catch (err) {
      console.error("Camera error:", err);
      this.logger.setCameraPermission("denied");

      const name = err?.name || "";
      let msg =
        "We could not access your camera, so you are seeing a demo preview instead.";

      if (name === "NotAllowedError" || name === "SecurityError") {
        msg =
          "Camera permission was blocked. Please allow camera access for this site (lock icon in the address bar), then try again.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg =
          "No usable camera was found (or it is busy). Please close other apps using the camera (Teams/Zoom), then try again.";
      }

      this.showCameraUnavailable(msg);

      if (camBtn instanceof HTMLButtonElement) {
        camBtn.disabled = false;
        camBtn.textContent = "Use my camera";
      }
    }
  }

  // Kích hoạt camera view: chuẩn bị UI, bật video trực tiếp, set filter
  async enableCameraView(stream) {
    const video = document.getElementById("demoCameraVideo");
    const overlay = document.getElementById("demoCameraOverlayCanvas");
    const placeholder = document.getElementById("demoPlaceholder");
    const statusChip = document.getElementById("demoStatusChip");
    if (!(video instanceof HTMLVideoElement)) return;

    video.setAttribute("playsinline", "");
    video.muted = true;
    video.srcObject = stream;
    
    // Mirror video for selfie view
    video.style.transform = "scaleX(-1)";
    video.style.display = "none";

    // Apply filter
    video.style.filter = this.isFilterMuted
      ? "brightness(1.1) saturate(1.2) contrast(1.05) blur(0.4px) sepia(0.1)"
      : "none";
    video.style.transition = "filter 0.3s ease";

    if (placeholder) placeholder.style.display = "none";

    try {
      await video.play();
      video.style.display = "block";
    } catch (e) {
      console.warn("Autoplay failed:", e);
      this.showCameraUnavailable(
        "Camera was granted but video could not autoplay. Please tap the video area once, then try again."
      );
      video.style.display = "none";
    }

    // Mark camera as used
    this.hasUsedCamera = true;

    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot"></span><span>Live camera active</span>';
    }

    this.usingCamera = true;

    // Start face tracking
    try {
      await this.ensureFaceTracking(video, document.getElementById("demoFrame"));
    } catch (e) {
      console.warn("Face tracking init failed:", e);
    }
  }

  // Thông báo nếu camera bị lỗi hoặc không thể dùng
  showCameraUnavailable(message) {
    const statusChip = document.getElementById("demoStatusChip");
    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot chip-dot-warn"></span><span>Camera unavailable</span>';
    }
    const cta = document.getElementById("demoCtaText");
    if (cta) {
      cta.textContent =
        message +
        " This step needs camera access. Please adjust your settings or switch devices, then try again.";
    }
  }

  // === FACE TRACKING WITH MEDIAPIPE ===

  async ensureFaceTracking(videoEl, frameEl) {
    if (!videoEl || !frameEl) {
      console.error("❌ Missing video or frame element");
      return;
    }

    console.log("🎯 Starting face tracking initialization...");

    // Initialize Face Landmarker if not done
    if (!this.faceLandmarker) {
      console.log("📦 Loading MediaPipe Face Landmarker...");
      await this.initFaceLandmarker();
    }

    if (!this.faceLandmarker) {
      console.error("❌ Face Landmarker not available - overlay will not work");
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'ensure-face-tracking',hypothesisId:'H8',location:'src/ui.js:ensureFaceTracking',message:'FaceLandmarker not available',data:{hasFaceLandmarker:!!this.faceLandmarker,hasVideoEl:!!videoEl,hasFrameEl:!!frameEl},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
      return;
    }

    console.log("✅ Face Landmarker ready");

    // Setup canvas overlay
    let canvas = document.getElementById("demoCameraOverlayCanvas");
    if (!canvas) {
      console.log("🎨 Creating new canvas overlay");
      canvas = document.createElement("canvas");
      canvas.id = "demoCameraOverlayCanvas";
      canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
      frameEl.appendChild(canvas);
    }

    this.faceTrackingCanvas = canvas;
    this.faceTrackingCtx = canvas.getContext("2d");

    // CRITICAL: Wait for video metadata to be loaded
    if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      console.log("⏳ Waiting for video metadata...");
      await new Promise((resolve) => {
        if (videoEl.readyState >= 2) {
          resolve();
        } else {
          videoEl.addEventListener("loadedmetadata", resolve, { once: true });
        }
      });
    }

    console.log("📹 Video dimensions:", videoEl.videoWidth, "x", videoEl.videoHeight);

    // Match canvas size to video display size
    const updateCanvasSize = () => {
      const rect = frameEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        console.log("📐 Canvas sized:", canvas.width, "x", canvas.height);
      } else {
        console.warn("⚠️ Frame has zero size, using fallback");
        canvas.width = 640;
        canvas.height = 480;
      }
    };
    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    canvas.style.display = "block";
    console.log("👁️ Canvas overlay is now visible");

    // VISUAL TEST: Draw a test rectangle to confirm canvas is working
    const testCtx = canvas.getContext("2d");
    if (testCtx) {
      testCtx.fillStyle = "rgba(255, 0, 0, 0.3)";
      testCtx.fillRect(10, 10, 100, 100);
      testCtx.fillStyle = "white";
      testCtx.font = "14px Arial";
      testCtx.fillText("Canvas Active", 20, 50);
      console.log("🎨 Test rectangle drawn on canvas");
      
      // Clear after 2 seconds
      setTimeout(() => {
        testCtx.clearRect(0, 0, canvas.width, canvas.height);
      }, 2000);
    }

    // Start tracking loop
    this.startFaceTrackingLoop(videoEl, canvas);
    console.log("🔄 Face tracking loop started");
  }

  async initFaceLandmarker() {
    if (this._faceLibPromise) return this._faceLibPromise;

    this._faceLibPromise = (async () => {
      try {
        console.log("📥 Importing MediaPipe from CDN...");
        // FIXED: Use correct import path - try multiple approaches
        let FaceLandmarker, FilesetResolver;
        
        // Wait for pre-load if in progress
        if (window.__visionReady === false) {
          // Wait for pre-load to complete or fail
          await new Promise((resolve) => {
            const checkReady = setInterval(() => {
              if (window.__visionReady !== false) {
                clearInterval(checkReady);
                resolve();
              }
            }, 50);
            // Timeout after 5 seconds
            setTimeout(() => {
              clearInterval(checkReady);
              resolve();
            }, 5000);
          });
        }

        // Check if already loaded via script tag
        if (window.FaceLandmarker && window.FilesetResolver) {
          FaceLandmarker = window.FaceLandmarker;
          FilesetResolver = window.FilesetResolver;
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-landmarker-init',hypothesisId:'H4',location:'src/ui.js:initFaceLandmarker',message:'Using pre-loaded MediaPipe from window',data:{hasFaceLandmarker:!!window.FaceLandmarker,hasFilesetResolver:!!window.FilesetResolver},timestamp:Date.now()})}).catch(()=>{});
          // #endregion agent log
        } else {
          // Try dynamic import - use the correct CDN path
          try {
            // Try the standard bundle path - use unpkg as alternative
            let visionModule;
            try {
              visionModule = await import(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js"
              );
            } catch (e1) {
              // Try unpkg as fallback
              try {
                visionModule = await import(
                  "https://unpkg.com/@mediapipe/tasks-vision@0.10.0/vision_bundle.js"
                );
              } catch (e2) {
                // Try without .js extension
                visionModule = await import(
                  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0"
                );
              }
            }
            FaceLandmarker = visionModule.FaceLandmarker || visionModule.default?.FaceLandmarker;
            FilesetResolver = visionModule.FilesetResolver || visionModule.default?.FilesetResolver;
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-landmarker-init',hypothesisId:'H5',location:'src/ui.js:initFaceLandmarker',message:'Dynamic import of vision_bundle.js succeeded',data:{hasFaceLandmarker:!!FaceLandmarker,hasFilesetResolver:!!FilesetResolver},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log
          } catch (importError1) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-landmarker-init',hypothesisId:'H3',location:'src/ui.js:initFaceLandmarker',message:'vision_bundle.js import failed, trying alternative',data:{error:String(importError1),url:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js'},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log
            
            // Fallback: try loading via script tag
            await this._loadMediaPipeViaScript();
            if (window.FaceLandmarker && window.FilesetResolver) {
              FaceLandmarker = window.FaceLandmarker;
              FilesetResolver = window.FilesetResolver;
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-landmarker-init',hypothesisId:'H6',location:'src/ui.js:initFaceLandmarker',message:'Script tag fallback succeeded',data:{hasFaceLandmarker:!!FaceLandmarker,hasFilesetResolver:!!FilesetResolver},timestamp:Date.now()})}).catch(()=>{});
              // #endregion agent log
            } else {
              throw new Error("Could not load MediaPipe: vision_bundle.js not found and script tag approach failed");
            }
          }
        }

        if (!FaceLandmarker || !FilesetResolver) {
          throw new Error("FaceLandmarker or FilesetResolver not available");
        }

        // Try CDN WASM first, fallback to local
        let vision;
        try {
          console.log("📥 Loading WASM from CDN...");
          vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
          );
          console.log("✅ CDN WASM loaded");
        } catch (wasmError) {
          console.warn("⚠️ CDN WASM failed, trying local:", wasmError);
          vision = await FilesetResolver.forVisionTasks(
            `${window.location.origin}/wasm`
          );
          console.log("✅ Local WASM loaded");
        }

        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        console.log("✅ Face Landmarker initialized successfully");
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-landmarker-init',hypothesisId:'H1',location:'src/ui.js:initFaceLandmarker',message:'FaceLandmarker initialized successfully',data:{},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
      } catch (e) {
        console.error("❌ Failed to init Face Landmarker:", e);
        console.warn("⚠️ Face tracking will not be available");
        this.faceLandmarker = null;
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-landmarker-init',hypothesisId:'H2',location:'src/ui.js:initFaceLandmarker',message:'FaceLandmarker init failed',data:{error:String(e),stack:e?.stack},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
      }
    })();

    return this._faceLibPromise;
  }

  // Helper to load MediaPipe via script tag as fallback
  _loadMediaPipeViaScript() {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.FaceLandmarker && window.FilesetResolver) {
        resolve();
        return;
      }

      // Check if script already exists
      const existingScript = document.querySelector('script[src*="vision_bundle"]');
      if (existingScript) {
        // Wait for it to load
        existingScript.addEventListener('load', resolve);
        existingScript.addEventListener('error', reject);
        return;
      }

      // Create and load script
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js';
      script.onload = () => {
        // Wait a bit for globals to be set
        setTimeout(() => {
          if (window.FaceLandmarker && window.FilesetResolver) {
            resolve();
          } else {
            reject(new Error("MediaPipe loaded but globals not available"));
          }
        }, 100);
      };
      script.onerror = () => reject(new Error("Failed to load vision_bundle.js script"));
      document.head.appendChild(script);
    });
  }

  startFaceTrackingLoop(video, canvas) {
    if (this.faceTrackingLoopHandle) {
      cancelAnimationFrame(this.faceTrackingLoopHandle);
    }

    const ctx = this.faceTrackingCtx;
    if (!ctx) {
      console.error("❌ No canvas context available");
      return;
    }

    console.log("🎬 Face tracking loop starting with video:", video.videoWidth, "x", video.videoHeight);

    // Tracking state
    let lastBox = null;
    let lastFacePoints = null;
    let noDetectionCount = 0;
    let frameCount = 0;
    
    // FIXED: Reduce smoothing for more responsive tracking
    const smoothingFactor = 0.6; // Reduced from 0.75-0.85
    const landmarkSmoothingFactor = 0.65;
    // FIXED: Reduce max frames to hold overlay when face lost
    const maxNoDetectionFrames = 10; // Reduced from 20-40

    const loop = () => {
      this.faceTrackingLoopHandle = requestAnimationFrame(loop);

      if (!video.videoWidth || !video.videoHeight || video.paused) {
        // #region agent log
        if (!this._loopDebugLogged) {
          this._loopDebugLogged = true;
          fetch('http://127.0.0.1:7243/ingest/7e4fd9ac-02f5-4cc9-9133-2c5edfde8585',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'face-tracking-loop',hypothesisId:'H9',location:'src/ui.js:startFaceTrackingLoop',message:'Video not ready',data:{videoWidth:video.videoWidth,videoHeight:video.videoHeight,paused:video.paused,hasFaceLandmarker:!!this.faceLandmarker},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion agent log
        return;
      }
      
      // Reset debug flag when video is ready
      this._loopDebugLogged = false;

      frameCount++;

      // Clear previous frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        const nowMs = performance.now();
        const result = this.faceLandmarker.detectForVideo(video, nowMs);

        const landmarks = result?.faceLandmarks?.[0];
        if (landmarks && landmarks.length) {
          // Log first successful detection
          if (frameCount === 1) {
            console.log("🎉 First face detected! Landmarks:", landmarks.length);
          }
          // Calculate bounding box from landmarks (normalized 0-1)
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          
          for (const p of landmarks) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }

          // FIXED: Proper coordinate mapping accounting for video display
          // Get actual video display dimensions
          const videoRect = video.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          
          // Calculate scale factors
          const scaleX = canvasRect.width / video.videoWidth;
          const scaleY = canvasRect.height / video.videoHeight;
          
          // Use actual video resolution for mapping
          const padding = 0.08;
          const rawX = (minX - padding) * video.videoWidth * scaleX;
          const rawY = (minY - padding) * video.videoHeight * scaleY;
          const rawW = (maxX - minX + 2 * padding) * video.videoWidth * scaleX;
          const rawH = (maxY - minY + 2 * padding) * video.videoHeight * scaleY;

          // Apply smoothing
          let box;
          if (lastBox) {
            box = {
              x: lastBox.x * smoothingFactor + rawX * (1 - smoothingFactor),
              y: lastBox.y * smoothingFactor + rawY * (1 - smoothingFactor),
              w: lastBox.w * smoothingFactor + rawW * (1 - smoothingFactor),
              h: lastBox.h * smoothingFactor + rawH * (1 - smoothingFactor),
            };
          } else {
            box = { x: rawX, y: rawY, w: rawW, h: rawH };
            console.log("📦 Initial box:", box);
          }
          lastBox = box;
          noDetectionCount = 0;

          // Calculate face feature points from bounding box proportions
          const boxCenterX = (minX + maxX) / 2;
          const boxTop = minY;
          const boxHeight = maxY - minY;
          const boxWidth = maxX - minX;
          
          // Feature points in normalized coordinates
          const rawForeheadTop = { x: boxCenterX, y: boxTop + boxHeight * 0.05 };
          const eyeY = boxTop + boxHeight * 0.35;
          
          // FIXED: Correct eye positions (no swap needed in normalized space)
          const rawLeftEye = { x: boxCenterX - boxWidth * 0.18, y: eyeY };
          const rawRightEye = { x: boxCenterX + boxWidth * 0.18, y: eyeY };
          
          const cheekY = boxTop + boxHeight * 0.60;
          const rawLeftCheek = { x: boxCenterX - boxWidth * 0.22, y: cheekY };
          const rawRightCheek = { x: boxCenterX + boxWidth * 0.22, y: cheekY };
          
          // Apply smoothing to feature points
          let foreheadTop, leftEye, rightEye, leftCheek, rightCheek;
          
          if (lastFacePoints) {
            const smooth = (last, raw, factor) => ({
              x: last.x * factor + raw.x * (1 - factor),
              y: last.y * factor + raw.y * (1 - factor),
            });
            
            foreheadTop = smooth(lastFacePoints.foreheadTop, rawForeheadTop, landmarkSmoothingFactor);
            leftEye = smooth(lastFacePoints.leftEye, rawLeftEye, landmarkSmoothingFactor);
            rightEye = smooth(lastFacePoints.rightEye, rawRightEye, landmarkSmoothingFactor);
            leftCheek = smooth(lastFacePoints.leftCheek, rawLeftCheek, landmarkSmoothingFactor);
            rightCheek = smooth(lastFacePoints.rightCheek, rawRightCheek, landmarkSmoothingFactor);
          } else {
            foreheadTop = rawForeheadTop;
            leftEye = rawLeftEye;
            rightEye = rawRightEye;
            leftCheek = rawLeftCheek;
            rightCheek = rawRightCheek;
          }
          
          lastFacePoints = { foreheadTop, leftEye, rightEye, leftCheek, rightCheek };
          
          const facePoints = { foreheadTop, leftEye, rightEye, leftCheek, rightCheek };

          // Draw overlay
          this._drawFaceOverlayForStyle(ctx, canvas, box, landmarks, facePoints, video);

          if (!this._faceDebugLogged) {
            this._faceDebugLogged = true;
            console.log("✅ Drawing overlay - Style:", this.currentStyleVariant, "Box:", box);
          }
        } else {
          // No face detected
          noDetectionCount++;
          
          // Log occasional "no face" events
          if (frameCount % 30 === 0 && noDetectionCount > 0) {
            console.log("⚠️ No face detected for", noDetectionCount, "frames");
          }
          
          // Keep last overlay for a few frames to reduce flicker
          if (lastBox && lastFacePoints && noDetectionCount < maxNoDetectionFrames) {
            const alpha = 1 - (noDetectionCount / maxNoDetectionFrames);
            ctx.globalAlpha = alpha;
            this._drawFaceOverlayForStyle(ctx, canvas, lastBox, null, lastFacePoints, video);
            ctx.globalAlpha = 1;
          } else {
            // Clear tracking state
            lastBox = null;
            lastFacePoints = null;
            noDetectionCount = 0;
          }
          
          this._faceDebugLogged = false;
        }
      } catch (e) {
        console.error("❌ Face tracking error:", e);
      }
    };

    this.faceTrackingLoopHandle = requestAnimationFrame(loop);
    console.log("✅ Tracking loop started");
  }

  stopFaceTracking() {
    if (this.faceTrackingLoopHandle) {
      cancelAnimationFrame(this.faceTrackingLoopHandle);
      this.faceTrackingLoopHandle = null;
    }
    if (this.faceTrackingCtx && this.faceTrackingCanvas) {
      this.faceTrackingCtx.clearRect(
        0,
        0,
        this.faceTrackingCanvas.width,
        this.faceTrackingCanvas.height
      );
    }
    this._faceDebugLogged = false;
  }

  // FIXED: Complete rewrite of overlay drawing with proper mirroring
  _drawFaceOverlayForStyle(ctx, canvas, box, landmarks, facePoints = null, video = null) {
    const { x, y, w, h } = box;
    
    // Debug: Log canvas and box info (only once per style change)
    if (!this._overlayDrawDebugLogged) {
      this._overlayDrawDebugLogged = true;
      console.log("🎨 Overlay drawing started:", {
        canvasSize: { width: canvas.width, height: canvas.height },
        box: { x, y, w, h },
        style: this.currentStyleVariant,
        videoSize: video ? { width: video.videoWidth, height: video.videoHeight } : null,
        hasFacePoints: !!facePoints,
        facePointsKeys: facePoints ? Object.keys(facePoints) : null
      });
    }
    
    ctx.save();
    
    // FIXED: Single consistent mirroring approach
    // Since video is already mirrored with scaleX(-1), we need to mirror our drawing too
    // Map normalized point to canvas coordinates WITH mirroring
    const mapPoint = (p, videoEl) => {
      if (!p) return null;
      
      // Get scale factors
      const scaleX = canvas.width / (videoEl?.videoWidth || 1280);
      const scaleY = canvas.height / (videoEl?.videoHeight || 720);
      
      // Map normalized to pixel, then mirror X
      const pixelX = p.x * (videoEl?.videoWidth || 1280) * scaleX;
      const pixelY = p.y * (videoEl?.videoHeight || 720) * scaleY;
      
      return {
        x: canvas.width - pixelX, // Mirror X coordinate
        y: pixelY,
      };
    };

    // FIXED: Box center calculation after mirroring
    const mirroredX = canvas.width - x - w;
    const cx = mirroredX + w / 2;
    const top = y;

    switch (this.currentStyleVariant) {
      // Style 0: cat ears + blush
      case 0: {
        const earW = w * 0.22;
        const earH = h * 0.25;
        
        let leftEarX, rightEarX, earY;
        
        if (facePoints && facePoints.foreheadTop) {
          const forehead = mapPoint(facePoints.foreheadTop, video);
          if (forehead) {
            earY = forehead.y - earH * 0.4;
            
            // Calculate ear distance based on eye positions
            let eyeDistance = w * 0.28;
            if (facePoints.leftEye && facePoints.rightEye) {
              const leftEyePt = mapPoint(facePoints.leftEye, video);
              const rightEyePt = mapPoint(facePoints.rightEye, video);
              if (leftEyePt && rightEyePt) {
                eyeDistance = Math.abs(rightEyePt.x - leftEyePt.x) * 0.5;
              }
            }
            
            // FIXED: After mirroring, positions are correct
            leftEarX = forehead.x - eyeDistance;
            rightEarX = forehead.x + eyeDistance;
          } else {
            // Fallback
            const earYOffset = earH * 0.6;
            leftEarX = cx - w * 0.28;
            rightEarX = cx + w * 0.28;
            earY = top - earYOffset;
          }
        } else {
          // Fallback
          const earYOffset = earH * 0.6;
          leftEarX = cx - w * 0.28;
          rightEarX = cx + w * 0.28;
          earY = top - earYOffset;
        }

        // Draw ears
        const drawEar = (ex) => {
          const grad = ctx.createLinearGradient(ex, earY - earH, ex, earY);
          grad.addColorStop(0, "#f97316");
          grad.addColorStop(1, "#ec4899");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(ex, earY - earH);
          ctx.lineTo(ex - earW / 2, earY);
          ctx.lineTo(ex + earW / 2, earY);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(248,250,252,0.9)";
          ctx.lineWidth = 2;
          ctx.stroke();
        };

        ctx.shadowColor = "rgba(249,115,22,0.8)";
        ctx.shadowBlur = 18;
        
        // Debug log for ear positions (only once per style change)
        if (!this._overlayDrawDebugLogged) {
          console.log("🎨 Drawing cat ears at:", { leftEarX, rightEarX, earY, earW, earH, canvasSize: { w: canvas.width, h: canvas.height } });
        }
        
        drawEar(leftEarX);
        drawEar(rightEarX);

        // Blush
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(248,113,113,0.55)";
        const cheekR = h * 0.055;
        
        if (facePoints && facePoints.leftCheek && facePoints.rightCheek) {
          const leftCheekPt = mapPoint(facePoints.leftCheek, video);
          const rightCheekPt = mapPoint(facePoints.rightCheek, video);
          
          if (leftCheekPt && rightCheekPt) {
            ctx.beginPath();
            ctx.ellipse(leftCheekPt.x, leftCheekPt.y, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(rightCheekPt.x, rightCheekPt.y, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
            ctx.fill();
          } else {
            // Fallback
            const cheekY = y + h * 0.65;
            const cheekOffsetX = w * 0.22;
            [cx - cheekOffsetX, cx + cheekOffsetX].forEach((px) => {
              ctx.beginPath();
              ctx.ellipse(px, cheekY, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
              ctx.fill();
            });
          }
        } else {
          // Fallback
          const cheekY = y + h * 0.65;
          const cheekOffsetX = w * 0.22;
          [cx - cheekOffsetX, cx + cheekOffsetX].forEach((px) => {
            ctx.beginPath();
            ctx.ellipse(px, cheekY, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
            ctx.fill();
          });
        }

        break;
      }

      // Style 1: sunglasses + heart
      case 1: {
        let glassY, glassH, glassW, glassX;
        
        if (facePoints && facePoints.leftEye && facePoints.rightEye) {
          const leftEyePt = mapPoint(facePoints.leftEye, video);
          const rightEyePt = mapPoint(facePoints.rightEye, video);
          
          if (leftEyePt && rightEyePt) {
            const eyeCenterY = (leftEyePt.y + rightEyePt.y) / 2;
            const eyeDistance = Math.abs(leftEyePt.x - rightEyePt.x);
            glassY = eyeCenterY - h * 0.08;
            glassH = h * 0.22;
            glassW = eyeDistance * 1.4;
            glassX = (leftEyePt.x + rightEyePt.x) / 2 - glassW / 2;
          } else {
            // Fallback
            glassY = y + h * 0.38;
            glassH = h * 0.22;
            glassW = w * 0.7;
            glassX = cx - glassW / 2;
          }
        } else {
          // Fallback
          glassY = y + h * 0.38;
          glassH = h * 0.22;
          glassW = w * 0.7;
          glassX = cx - glassW / 2;
        }

        // Draw sunglasses frame
        ctx.fillStyle = "rgba(15,23,42,0.76)";
        ctx.strokeStyle = "rgba(148,163,184,0.9)";
        ctx.lineWidth = 3;
        const r = 14;
        
        ctx.beginPath();
        ctx.moveTo(glassX + r, glassY);
        ctx.lineTo(glassX + glassW - r, glassY);
        ctx.quadraticCurveTo(glassX + glassW, glassY, glassX + glassW, glassY + r);
        ctx.lineTo(glassX + glassW, glassY + glassH - r);
        ctx.quadraticCurveTo(glassX + glassW, glassY + glassH, glassX + glassW - r, glassY + glassH);
        ctx.lineTo(glassX + r, glassY + glassH);
        ctx.quadraticCurveTo(glassX, glassY + glassH, glassX, glassY + glassH - r);
        ctx.lineTo(glassX, glassY + r);
        ctx.quadraticCurveTo(glassX, glassY, glassX + r, glassY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Center divider
        ctx.strokeStyle = "rgba(209,213,219,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, glassY + 6);
        ctx.lineTo(cx, glassY + glassH - 6);
        ctx.stroke();

        // Heart sticker
        const heartX = cx + w * 0.3;
        const heartY = y + h * 0.7;
        const heartSize = w * 0.12;
        
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.moveTo(heartX, heartY + heartSize * 0.3);
        ctx.bezierCurveTo(
          heartX, heartY,
          heartX - heartSize * 0.5, heartY - heartSize * 0.3,
          heartX, heartY - heartSize
        );
        ctx.bezierCurveTo(
          heartX + heartSize * 0.5, heartY - heartSize * 0.3,
          heartX, heartY,
          heartX, heartY + heartSize * 0.3
        );
        ctx.fill();

        break;
      }

      // Style 2: crown + stars
      case 2: {
        // Crown position
        let crownX, crownY, crownW, crownH;
        
        if (facePoints && facePoints.foreheadTop) {
          const forehead = mapPoint(facePoints.foreheadTop, video);
          if (forehead) {
            crownW = w * 0.55;
            crownH = h * 0.18;
            crownX = forehead.x - crownW / 2;
            crownY = forehead.y - crownH - h * 0.05;
          } else {
            // Fallback
            crownW = w * 0.55;
            crownH = h * 0.18;
            crownX = cx - crownW / 2;
            crownY = top - crownH - h * 0.1;
          }
        } else {
          // Fallback
          crownW = w * 0.55;
          crownH = h * 0.18;
          crownX = cx - crownW / 2;
          crownY = top - crownH - h * 0.1;
        }

        // Draw crown
        const grad = ctx.createLinearGradient(crownX, crownY, crownX, crownY + crownH);
        grad.addColorStop(0, "#fbbf24");
        grad.addColorStop(1, "#f59e0b");
        ctx.fillStyle = grad;
        
        ctx.beginPath();
        ctx.moveTo(crownX, crownY + crownH);
        ctx.lineTo(crownX + crownW * 0.2, crownY + crownH * 0.3);
        ctx.lineTo(crownX + crownW * 0.35, crownY + crownH);
        ctx.lineTo(crownX + crownW * 0.5, crownY);
        ctx.lineTo(crownX + crownW * 0.65, crownY + crownH);
        ctx.lineTo(crownX + crownW * 0.8, crownY + crownH * 0.3);
        ctx.lineTo(crownX + crownW, crownY + crownH);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = "rgba(254,243,199,0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Stars
        ctx.fillStyle = "#fbbf24";
        const drawStar = (sx, sy, size) => {
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const r = i % 2 === 0 ? size : size * 0.4;
            const px = sx + r * Math.cos(angle);
            const py = sy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        };

        drawStar(cx - w * 0.35, y + h * 0.3, w * 0.08);
        drawStar(cx + w * 0.35, y + h * 0.3, w * 0.08);
        drawStar(cx, y + h * 0.7, w * 0.06);

        break;
      }
    }

    ctx.restore();
  }
}
