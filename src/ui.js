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
  PERMISSIONS: "permissions",
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

    // Soften effect tích hợp sẵn trong mỗi feature (không còn nút bật/tắt)
    this.isFilterMuted = true;
    this.currentStyleVariant = 0;

    // Face tracking state (MediaPipe Face Landmarker)
    this.faceLandmarker = null;
    this.faceTrackingCanvas = null;
    this.faceTrackingCtx = null;
    this.faceTrackingLoopHandle = null;
    this._faceLibPromise = null;

    // Microphone state (for Blow Balloon style)
    this.micStream = null;
    this.micEnabled = false;
    this.audioCtx = null;
    this.micAnalyser = null;
    this.micScriptProcessor = null;
    this.micDataFloat = null;
    this.micLevel = 0;
    this.micBaseline = 0;
    this._baselineFrames = 0;

    // Balloon game state (style 1)
    this.balloon = { value: 0, popped: false, popTimer: 0 };

    // Spark Pop (style 2): sparkles bắn từ miệng khi hả miệng
    this.dreamyBlushParticles = [];

    this.init();
  }

  // Open system photo picker and remember selected image for AR overlays
  openPhotoPicker() {
    if (!this._photoInput) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        this.showPhotoInFrame(url);
      });
      document.body.appendChild(input);
      this._photoInput = input;
    }
    this._photoInput.value = "";
    this._photoInput.click();
  }

  showPhotoInFrame(url) {
    // Ảnh cho AR overlay “Memory Frame”
    if (!this.memoryFrameImage) {
      this.memoryFrameImage = new Image();
      this.memoryFrameImage.crossOrigin = "anonymous";
    }
    this.memoryFrameImage.src = url;
  }

  init() {
    this.root.innerHTML = "";
    const intro = this.buildIntroScreen();
    const notice = this.buildNoticeScreen();
    const permissions = this.buildPermissionsScreen();
    const details = this.buildDetailsScreen();
    const demo = this.buildDemoScreen();
    const exit = this.buildExitScreen();

    this.root.append(intro, notice, permissions, details, demo, exit);

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
    title.textContent = "Introduction";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle screen-subtitle-intro";
    subtitle.textContent =
      "In this short demo, you will try an AR face filter similar to those used in social media apps before answering the survey questions.";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "Start demo";
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.NOTICE);
    });

    btnRow.appendChild(primary);

    el.append(title, subtitle, btnRow);
    return el;
  }

  buildNoticeScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.NOTICE;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "App Privacy Notice";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle screen-subtitle-intro";
    subtitle.textContent =
      "This short notice explains how data related to the AR face filter feature may be handled. For more information, tap 'View details'.";

    const card = document.createElement("div");
    card.className = "card card-contrast";
    const hasPhoto = this.condition.photo === "library";
    const noticeHtml = `
      <div class="notice-text">
        <p><strong>What information do we access?</strong></p>
        <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 16px 0; list-style: disc;">
          <li style="margin-bottom: 4px;"><strong>Camera:</strong> Used to let you take photos and videos in the app.</li>
          <li style="margin-bottom: 4px;"><strong>Microphone:</strong> Used to record audio.</li>
          ${
            hasPhoto
              ? '<li style="margin-bottom: 0;"><strong>Photo Library:</strong> Used to let you access, upload, or save content.</li>'
              : ""
          }
        </ul>

        <p><strong>How do we share information with third parties?</strong></p>
        <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 16px 0; list-style: disc;">
          <li style="margin-bottom: 0;">${renderInlineMarkdown(this.condition.notice.tpSentence)}</li>
        </ul>

        <p><strong>How long do we keep your information?</strong></p>
        <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 0 0; list-style: disc;">
          <li style="margin-bottom: 0;">${renderInlineMarkdown(this.condition.notice.rtSentence)}</li>
        </ul>
      </div>
    `;
    card.innerHTML = noticeHtml;

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
      this.toScreen(SCREENS.PERMISSIONS);
    });

    btnRow.append(detailsLink, primary);

    el.append(title, subtitle, card, btnRow);
    return el;
  }

  buildPermissionsScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.PERMISSIONS;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "App permissions for this demo";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "For this study, the demo app has a fixed set of permissions. You can stop access at any time using the controls on the next screen.";

    const card = document.createElement("div");
    card.className = "card";
    const hasPhoto = this.condition.photo === "library";
    const scope = this.condition.scope || "while";

    const listItems = [
      "<li>Camera</li>",
      "<li>Microphone</li>",
      hasPhoto ? "<li>Photo Library</li>" : "",
    ]
      .filter(Boolean)
      .join("");

    let scopeLine;
    if (scope === "only") {
      scopeLine =
        'Camera and microphone access is granted <strong>only this time</strong>. If you open the demo again later, your device will ask for permission again (similar to "Only this time" in mobile apps).';
    } else {
      scopeLine =
        'Camera and microphone access stays on <strong>while you are using this demo</strong>. When you close this page, access stops (similar to "Allow while using the app" in mobile apps).';
    }

    let photoScopeLine = "";
    if (hasPhoto) {
      if (scope === "only") {
        photoScopeLine =
          '<p style="margin-top:6px;">For the photo library, this version is like choosing <strong>"Selected photos only"</strong>: the app can only use the specific photo(s) you pick in this demo.</p>';
      } else {
        photoScopeLine =
          '<p style="margin-top:6px;">For the photo library, this version is like choosing <strong>"Allow all photos"</strong>: the app can use your library for this demo until you change this in your device settings.</p>';
      }
    }

    card.innerHTML = `
      <div class="notice-heading">Permissions in this version</div>
      <div class="notice-text">
        <p>In this version of the demo, the app may access:</p>
        <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 0 0; list-style: disc;">
          ${listItems}
        </ul>
        <p style="margin-top:12px;"><strong>How long is access active?</strong></p>
        <p>${scopeLine}</p>
        ${photoScopeLine}
      </div>
    `;

    const meta = document.createElement("div");
    meta.className = "meta-text";
    meta.style.marginTop = "8px";
    meta.textContent = "";

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
    primary.textContent = "Continue to demo";
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.DEMO);
    });

    btnRow.append(back, primary);
    el.append(title, subtitle, card, meta, btnRow);
    return el;
  }

  buildDetailsScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.DETAILS;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "More details about this privacy notice";

    // Intentionally no step badge / subtitle here to keep this page minimal.

    const card = document.createElement("div");
    card.className = "details-content";
    card.innerHTML = `
  <div class="details-group">
    <div class="details-row">
      <div class="details-title">Usage analytics</div>
      <div class="details-text">
        <p>
          "Usage analytics" means basic data about how the demo is used and whether it runs smoothly.
        </p>
        For example, it may include:
        <ul class="details-bullets">
          <li>which buttons you tap, which style you select, and how long you spend in the demo.</li>
          <li>basic performance signals (e.g., whether the effect loads, delays, or errors).</li>
        </ul>
      </div>
    </div>
  </div>

  <div class="details-group" style="margin-top: 12px;">
    <div class="details-row">
      <div class="details-title">Third-party sharing</div>
      <div class="details-text">
        <p>
          "Third-party" means an organisation outside the app (for example, an analytics or measurement partner).
          If sharing happens, it refers to usage analytics about how the feature is used - not the camera video.
        </p>
      </div>
    </div>

    <div class="details-row">
      <div class="details-title">Data retention</div>
      <div class="details-text">
        <p>
          "Retention" means how long stored feature data (including usage logs) is kept before it is deleted.
        </p>
      </div>
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
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 600'%3E%3Crect width='400' height='600' fill='%23e0f2fe'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='system-ui' font-size='16'%3EDemo%3C/text%3E%3C/svg%3E";
    placeholderVideo.alt = "Demo placeholder";
    placeholderVideo.style.cssText =
      "width:100%;height:100%;object-fit:cover;";
    placeholder.appendChild(placeholderVideo);
    if (this.isFilterMuted) {
      placeholder.style.filter = "grayscale(0.15) saturate(0.8)";
    }

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

    // Photo library trigger icon inside frame (like social apps)
    if (this.condition.photo === "library") {
      const photoIcon = document.createElement("button");
      photoIcon.type = "button";
      photoIcon.className = "demo-photo-icon";
      photoIcon.title = "Open photo library";
      photoIcon.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5.5 17.5 10 13l3 3 2.5-2.5L18.5 17.5"/></svg>';
      photoIcon.addEventListener("click", () => {
        this.logger.addInteraction({ demo: true });
        this.openPhotoPicker();
      });
      frame.appendChild(photoIcon);
    }
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

    const micChip = document.createElement("div");
    micChip.className = "chip";
    micChip.id = "demoMicStatusChip";
    micChip.innerHTML = '<span class="chip-dot chip-dot-off"></span><span>Mic off</span>';
    micChip.style.display = "none";

    controlsLeft.appendChild(chip);
    controlsLeft.appendChild(micChip);
    controls.appendChild(controlsLeft);
    demoShell.appendChild(controls);

    // Button row
    const buttonRow = document.createElement("div");
    buttonRow.className = "demo-button-row";

    // Camera now auto-requests permission on first entry to demo; here we only show Stop camera.
    const cameraBtn = document.createElement("button");
    cameraBtn.className = "btn btn-secondary btn-small";
    cameraBtn.id = "demoCameraButton";
    cameraBtn.textContent = "Stop camera";
    cameraBtn.disabled = true;
    cameraBtn.addEventListener("click", () => {
      this.logger.addInteraction({ demo: true });
      this.stopCamera();
    });

    const styleBtn = document.createElement("button");
    styleBtn.className = "btn btn-secondary btn-small";
    styleBtn.id = "demoStyleButton";
    styleBtn.textContent = "Switch filter";
    styleBtn.addEventListener("click", () => {
      this.logger.addInteraction({ demo: true });
      this.cycleStyle();
    });

    const micBtn = document.createElement("button");
    micBtn.className = "btn btn-secondary btn-small";
    micBtn.id = "demoMicButton";
    micBtn.textContent = "Stop mic";
    micBtn.style.display = "none";
    micBtn.disabled = true;
    micBtn.addEventListener("click", async () => {
      this.logger.addInteraction({ demo: true });
      this.stopMicrophone();
    });

    // Order: Stop camera → Stop mic → Switch filter
    buttonRow.append(cameraBtn, micBtn, styleBtn);
    demoShell.appendChild(buttonRow);

    // CTA text
    const ctaText = document.createElement("div");
    ctaText.className = "demo-cta-text";
    ctaText.id = "demoCtaText";
    ctaText.textContent = "";
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

    // Bật camera lần đầu trong demo với prompt 3 lựa chọn (scope fixed by condition)
    if (!this.usingCamera && !this._demoCameraPrompted) {
      this._demoCameraPrompted = true;
      this.showPermissionPrompt("camera", () => this.requestCamera());
    }
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
    heading.textContent = "App Privacy Notice";
    heading.style.marginBottom = "10px";

    const text = document.createElement("div");
    text.className = "notice-text";
    const hasPhoto = this.condition.photo === "library";
    // Same structure as main App Privacy Notice
    text.innerHTML = `
      <p><strong>What information do we access?</strong></p>
      <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 16px 0; list-style: disc;">
        <li style="margin-bottom: 4px;"><strong>Camera:</strong> Used to let you take photos and videos in the app.</li>
        <li style="margin-bottom: 4px;"><strong>Microphone:</strong> Used to record audio.</li>
        ${
          hasPhoto
            ? '<li style="margin-bottom: 0;"><strong>Photo Library:</strong> Used to let you access, upload, or save content.</li>'
            : ""
        }
      </ul>
      <p><strong>How do we share information with third parties?</strong></p>
      <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 16px 0; list-style: disc;">
        <li style="margin-bottom: 0;">${renderInlineMarkdown(this.condition.notice.tpSentence)}</li>
      </ul>
      <p><strong>How long do we keep your information?</strong></p>
      <ul class="notice-factors" style="padding-left: 18px; margin: 8px 0 0 0; list-style: disc;">
        <li style="margin-bottom: 0;">${renderInlineMarkdown(this.condition.notice.rtSentence)}</li>
      </ul>
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

  // Simple in-app permission prompt styled like mobile OS dialogs
  showPermissionPrompt(kind, onAllow) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15,23,42,0.55);
      backdrop-filter: blur(6px);
      z-index: 999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;

    const card = document.createElement("div");
    card.style.cssText = `
      max-width: 320px;
      width: 100%;
      border-radius: 16px;
      background: #f9fafb;
      box-shadow: 0 18px 45px rgba(15,23,42,0.45);
      padding: 16px 16px 10px;
      font-family: -apple-system, system-ui, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    `;

    const title = document.createElement("div");
    title.style.cssText =
      "font-size:14px;font-weight:600;color:#111827;text-align:center;margin-bottom:8px;";
    const appName = "Face-Filter Demo";
    if (kind === "camera") {
      title.textContent = `Allow “${appName}” to access your camera?`;
    } else if (kind === "microphone") {
      title.textContent = `Allow “${appName}” to access your microphone?`;
    } else {
      title.textContent = `Allow “${appName}” to access this feature?`;
    }

    const message = document.createElement("div");
    message.style.cssText =
      "font-size:12px;color:#4b5563;line-height:1.5;text-align:center;margin:0 4px 12px;";
    if (kind === "camera") {
      message.textContent =
        "The demo uses your camera so the AR filter can follow your face in real time, similar to social apps.";
    } else if (kind === "microphone") {
      message.textContent =
        "The demo uses your microphone to react to sound for the “Blow Balloon” effect.";
    } else if (kind === "photos") {
      message.textContent =
        "The demo can use a photo from your library so you can try the AR filter on an existing picture.";
    } else {
      message.textContent =
        "The demo needs this permission to run the AR effect correctly.";
    }

    const buttonsCol = document.createElement("div");
    buttonsCol.style.cssText =
      "display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(148,163,184,0.5);padding-top:10px;";

    const makeBtn = (label, styleCss, onClick, enabled = true) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.cssText =
        "width:100%;border-radius:12px;padding:7px 0;font-size:13px;font-weight:500;" +
        (enabled ? "cursor:pointer;" : "cursor:default;opacity:0.55;") +
        styleCss;
      if (enabled) {
        btn.addEventListener("click", onClick);
      } else {
        btn.setAttribute("aria-disabled", "true");
        btn.disabled = true;
      }
      return btn;
    };

    // Labels theo loại permission (camera/mic vs photo library)
    const isPhotos = kind === "photos";
    const denyLabel = "Don't Allow";
    const secondaryLabel = isPhotos ? "Allow all" : "Only this time";
    const primaryLabel = isPhotos ? "Select photos and videos" : "While using the app";

    const scope = this.condition.scope || "while";
    const enableWhile = isPhotos || scope === "while";
    const enableOnlyThis = isPhotos || scope === "only";

    const denyBtn = makeBtn(
      denyLabel,
      "border:1px solid rgba(148,163,184,0.7);background:#e5e7eb;color:#111827;",
      () => {
        document.body.removeChild(overlay);
      },
      isPhotos // với camera/mic: Don't Allow chỉ để tượng trưng, không click
    );

    const secondaryBtn = makeBtn(
      secondaryLabel,
      "border:1px solid rgba(79,70,229,0.9);background:#eef2ff;color:#312e81;",
      async () => {
        document.body.removeChild(overlay);
        try {
          await onAllow();
        } catch (err) {
          console.error("Permission action failed", err);
        }
      },
      enableOnlyThis
    );

    const primaryBtn = makeBtn(
      primaryLabel,
      "border:none;background:#2563eb;color:#ffffff;font-weight:600;",
      async () => {
        document.body.removeChild(overlay);
        try {
          await onAllow();
        } catch (err) {
          console.error("Permission action failed", err);
        }
      },
      enableWhile
    );

    // Android-style: primary (blue) on top, secondary, rồi Don't Allow
    buttonsCol.append(primaryBtn, secondaryBtn, denyBtn);
    card.append(title, message, buttonsCol);
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
    // Engagement gating (non-coercive): require ~30s in the demo after camera is enabled.
    // Only camera use starts the countdown; "Switch filter" does not.
    const startedEngaging = this.hasUsedCamera;

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
            "The demo will unlock Continue after about 30 seconds of camera use.";
        }
      }
    }
  }

  // Cycle qua các style overlay (0–3: Cat ears, Blow Balloon, Spark Pop, Memory Frame)
  cycleStyle() {
    this.currentStyleVariant = (this.currentStyleVariant + 1) % 4;
    this.hasChosenStyle = true;
    this.updateDemoGatingState();

    const labels = ["Cat ears", "Blow Balloon", "Spark Pop", "Memory Frame"];
    this.showStyleTag(labels[this.currentStyleVariant]);

    const micBtn = document.getElementById("demoMicButton");
    if (micBtn) {
      micBtn.style.display = this.currentStyleVariant === 1 ? "inline-flex" : "none";
    }
    const micChip = document.getElementById("demoMicStatusChip");
    if (micChip) {
      micChip.style.display = this.currentStyleVariant === 1 ? "inline-flex" : "none";
      micChip.innerHTML = this.micEnabled
        ? '<span class="chip-dot"></span><span>Live mic active</span>'
        : '<span class="chip-dot chip-dot-off"></span><span>Mic off</span>';
    }

    // Khi chuyển sang Blow Balloon lần đầu, hiện prompt 3 lựa chọn cho microphone (scope fixed by condition)
    if (this.currentStyleVariant === 1 && !this.micEnabled && !this._demoMicPrompted) {
      this._demoMicPrompted = true;
      this.showPermissionPrompt("microphone", () => this.startMicrophone());
    }
  }

  // Cập nhật tên feature hiện tại (chỉ một khung .filter-name từ template, không tạo khung mới)
  showStyleTag(label) {
    const frame = document.getElementById("demoFrame");
    if (!frame) return;

    const filterNameEl = frame.querySelector(".filter-name");
    if (filterNameEl) {
      filterNameEl.textContent = label;
      const oldTag = frame.querySelector(".demo-style-tag");
      if (oldTag) oldTag.remove();
      return;
    }

    // Fallback nếu không có template .filter-name: tạo tag tạm
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

    this.stopMicrophone();

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
        '<span class="chip-dot chip-dot-off"></span><span>Camera off</span>';
    }

    const camBtn = document.getElementById("demoCameraButton");
    if (camBtn instanceof HTMLButtonElement) {
      camBtn.textContent = "Stop camera";
      camBtn.disabled = true;
    }
  }

  async toggleMicrophone() {
    if (this.micEnabled) {
      this.stopMicrophone();
      return;
    }
    await this.startMicrophone();
  }

  async startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Microphone is not supported in this browser.");
      return;
    }
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      const silentGain = this.audioCtx.createGain();
      silentGain.gain.value = 0;

      if (typeof this.audioCtx.createScriptProcessor === "function") {
        const bufferSize = 4096;
        this.micScriptProcessor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);
        this.micScriptProcessor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
          const rms = Math.sqrt(sum / input.length);
          if (this._baselineFrames < 10) {
            this.micBaseline = (this.micBaseline * this._baselineFrames + rms) / (this._baselineFrames + 1);
            this._baselineFrames++;
          } else if (rms < this.micBaseline + 0.025) {
            this.micBaseline = this.micBaseline * 0.98 + rms * 0.02;
          }
          let raw = Math.max(0, rms - (this.micBaseline + 0.005));
          if (raw < 0.002 && rms > 0.001) raw = rms * 0.5;
          const normalized = Math.min(1, raw / 0.06);
          let level = this.micLevel * 0.75 + normalized * 0.25;
          if (this.micLevel < 0.01 && rms > 0.002) level = Math.min(1, rms / 0.018);
          this.micLevel = level;
        };
        source.connect(this.micScriptProcessor);
        this.micScriptProcessor.connect(silentGain);
      } else {
        this.micAnalyser = this.audioCtx.createAnalyser();
        this.micAnalyser.fftSize = 1024;
        this.micDataFloat = new Float32Array(this.micAnalyser.fftSize);
        source.connect(this.micAnalyser);
        this.micAnalyser.connect(silentGain);
      }
      silentGain.connect(this.audioCtx.destination);
      this.micEnabled = true;
      this.micLevel = 0;
      this.micBaseline = 0;
      this._baselineFrames = 0;
      const micBtn = document.getElementById("demoMicButton");
      if (micBtn instanceof HTMLButtonElement) {
        micBtn.textContent = "Stop mic";
        micBtn.disabled = false;
      }
      const micChip = document.getElementById("demoMicStatusChip");
      if (micChip) micChip.innerHTML = '<span class="chip-dot"></span><span>Live mic active</span>';
    } catch (e) {
      console.error("Microphone error:", e);
      alert("Could not access microphone. Please allow microphone access.");
    }
  }

  stopMicrophone() {
    try {
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    this.micStream = null;
    this.micEnabled = false;
    try {
      if (this.micScriptProcessor) {
        this.micScriptProcessor.disconnect();
        this.micScriptProcessor = null;
      }
      this.audioCtx?.close?.();
    } catch (e) {}
    this.audioCtx = null;
    this.micAnalyser = null;
    this.micDataFloat = null;
    const micBtn = document.getElementById("demoMicButton");
    if (micBtn instanceof HTMLButtonElement) {
      micBtn.textContent = "Stop mic";
      micBtn.disabled = true;
    }
    const micChip = document.getElementById("demoMicStatusChip");
    if (micChip) micChip.innerHTML = '<span class="chip-dot chip-dot-off"></span><span>Mic off</span>';
  }

  updateMicLevel() {
    if (!this.micEnabled) {
      this.micLevel = this.micLevel * 0.9;
      return this.micLevel;
    }
    if (this.micScriptProcessor) return this.micLevel;
    if (this.audioCtx?.state === "suspended") this.audioCtx.resume().catch(() => {});
    if (!this.micAnalyser || !this.micDataFloat) return this.micLevel;
    this.micAnalyser.getFloatTimeDomainData(this.micDataFloat);
    let sum = 0;
    for (let i = 0; i < this.micDataFloat.length; i++) sum += this.micDataFloat[i] * this.micDataFloat[i];
    const rms = Math.sqrt(sum / this.micDataFloat.length);
    if (this._baselineFrames < 10) {
      this.micBaseline = (this.micBaseline * this._baselineFrames + rms) / (this._baselineFrames + 1);
      this._baselineFrames++;
    } else if (rms < this.micBaseline + 0.02) {
      this.micBaseline = this.micBaseline * 0.98 + rms * 0.02;
    }
    let raw = Math.max(0, rms - (this.micBaseline + 0.005));
    if (raw < 0.002 && rms > 0.001) raw = rms * 0.5;
    const normalized = Math.min(1, raw / 0.06);
    let level = this.micLevel * 0.75 + normalized * 0.25;
    if (this.micLevel < 0.01 && rms > 0.002) level = Math.min(1, rms / 0.018);
    this.micLevel = level;
    return this.micLevel;
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
        camBtn.disabled = true;
        camBtn.textContent = "Stop camera";
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
        camBtn.disabled = true;
        camBtn.textContent = "Stop camera";
      }
      return;
    }

    try {
      // Không yêu cầu width/height để tránh camera crop/zoom (FOV tự nhiên) trên cả web và mobile
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" } },
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
        "We could not access your camera, so you are seeing the demo without your camera.";

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
        camBtn.textContent = "Stop camera";
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
          } catch (importError1) {
            // Fallback: try loading via script tag
            await this._loadMediaPipeViaScript();
            if (window.FaceLandmarker && window.FilesetResolver) {
              FaceLandmarker = window.FaceLandmarker;
              FilesetResolver = window.FilesetResolver;
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
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        console.log("✅ Face Landmarker initialized successfully");
      } catch (e) {
        console.error("❌ Failed to init Face Landmarker:", e);
        console.warn("⚠️ Face tracking will not be available");
        this.faceLandmarker = null;
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

  // Cover transform: video dùng object-fit: cover nên cần scale + offset crop để map đúng
  _getCoverTransform(videoW, videoH, canvasW, canvasH) {
    const scale = Math.max(canvasW / videoW, canvasH / videoH);
    const drawW = videoW * scale;
    const drawH = videoH * scale;
    const offsetX = (drawW - canvasW) / 2;
    const offsetY = (drawH - canvasH) / 2;
    return { scale, drawW, drawH, offsetX, offsetY };
  }

  _mapNormalizedToCanvasCover(p, videoW, videoH, canvasW, canvasH, mirror = true) {
    const { scale, offsetX, offsetY } = this._getCoverTransform(videoW, videoH, canvasW, canvasH);
    const x = (p.x * videoW) * scale - offsetX;
    const y = (p.y * videoH) * scale - offsetY;
    return mirror ? { x: canvasW - x, y } : { x, y };
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
    
    // Smoothing nhẹ hơn: nhạy hơn, giống social app (0.25–0.35 / 0.30–0.45)
    const smoothingFactor = 0.3;
    const landmarkSmoothingFactor = 0.38;
    // FIXED: Reduce max frames to hold overlay when face lost
    const maxNoDetectionFrames = 10; // Reduced from 20-40

    const loop = () => {
      this.faceTrackingLoopHandle = requestAnimationFrame(loop);

      if (!video.videoWidth || !video.videoHeight || video.paused) return;

      frameCount++;

      this.updateMicLevel();

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

          // Map bbox theo cover (video object-fit: cover) — scale + offset crop
          const canvasW = canvas.width;
          const canvasH = canvas.height;
          const vW = video.videoWidth;
          const vH = video.videoHeight;
          const pad = 0.08;
          const p1 = { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad) };
          const p2 = { x: Math.min(1, maxX + pad), y: Math.min(1, maxY + pad) };
          const t1 = this._mapNormalizedToCanvasCover(p1, vW, vH, canvasW, canvasH, false);
          const t2 = this._mapNormalizedToCanvasCover(p2, vW, vH, canvasW, canvasH, false);
          const rawX = Math.min(t1.x, t2.x);
          const rawY = Math.min(t1.y, t2.y);
          const rawW = Math.abs(t2.x - t1.x);
          const rawH = Math.abs(t2.y - t1.y);

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

          // Face feature points từ landmark thật (MediaPipe 468), fallback từ box
          const boxCenterX = (minX + maxX) / 2;
          const boxCenterY = (minY + maxY) / 2;
          const boxTop = minY;
          const boxHeight = maxY - minY;
          const boxWidth = maxX - minX;
          const fallbackCenter = { x: boxCenterX, y: boxCenterY };
          const pick = (i, fallback) =>
            landmarks[i] != null
              ? { x: landmarks[i].x, y: landmarks[i].y }
              : fallback;

          const rawForeheadTop = pick(10, { x: boxCenterX, y: boxTop + boxHeight * 0.08 });
          const rawLeftEye = pick(33, { x: boxCenterX - boxWidth * 0.18, y: boxTop + boxHeight * 0.42 });
          const rawRightEye = pick(263, { x: boxCenterX + boxWidth * 0.18, y: boxTop + boxHeight * 0.42 });
          const rawLeftCheek = pick(234, { x: boxCenterX - boxWidth * 0.25, y: boxTop + boxHeight * 0.6 });
          const rawRightCheek = pick(454, { x: boxCenterX + boxWidth * 0.25, y: boxTop + boxHeight * 0.6 });
          const rawNoseTip = pick(1, fallbackCenter);
          const rawMouth = pick(13, { x: boxCenterX, y: boxTop + boxHeight * 0.68 });

          let foreheadTop, leftEye, rightEye, leftCheek, rightCheek, noseTip, mouth;
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
            noseTip = smooth(lastFacePoints.noseTip || rawNoseTip, rawNoseTip, landmarkSmoothingFactor);
            mouth = smooth(lastFacePoints.mouth || rawMouth, rawMouth, landmarkSmoothingFactor);
          } else {
            foreheadTop = rawForeheadTop;
            leftEye = rawLeftEye;
            rightEye = rawRightEye;
            leftCheek = rawLeftCheek;
            rightCheek = rawRightCheek;
            noseTip = rawNoseTip;
            mouth = rawMouth;
          }
          lastFacePoints = { foreheadTop, leftEye, rightEye, leftCheek, rightCheek, noseTip, mouth };
          const facePoints = { foreheadTop, leftEye, rightEye, leftCheek, rightCheek, noseTip, mouth };

          // Draw overlay
          this._drawFaceOverlayForStyle(ctx, canvas, box, landmarks, facePoints, video);
        } else {
          noDetectionCount++;
          // Keep last overlay for a few frames to reduce flicker
          if (lastBox && lastFacePoints && noDetectionCount < maxNoDetectionFrames) {
            const alpha = 1 - (noDetectionCount / maxNoDetectionFrames);
            ctx.globalAlpha = alpha;
            this._drawFaceOverlayForStyle(ctx, canvas, lastBox, null, lastFacePoints, video);
            ctx.globalAlpha = 1;
          } else {
            lastBox = null;
            lastFacePoints = null;
            noDetectionCount = 0;
          }
        }
      } catch (e) {
        console.error("❌ Face tracking error:", e);
      }
    };

    this.faceTrackingLoopHandle = requestAnimationFrame(loop);
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
  }

  _drawFaceOverlayForStyle(ctx, canvas, box, landmarks, facePoints = null, video = null) {
    const { x, y, w, h } = box;
    ctx.save();
    
    // Map normalized point to canvas: cover transform + mirror (video selfie đang lật)
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const vW = video?.videoWidth || 720;
    const vH = video?.videoHeight || 1280;
    const mapPoint = (p, videoEl) => {
      if (!p) return null;
      return this._mapNormalizedToCanvasCover(p, vW, vH, canvasW, canvasH, true);
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

      // Style 1: Blow Balloon (mic volume)
      case 1: {
        const blow = this.updateMicLevel();

        if (!this.balloon.popped) {
          const TH = 0.08;
          const inflate = blow > TH ? (blow * 0.055) : -0.002;
          this.balloon.value = Math.max(0, Math.min(1, this.balloon.value + inflate));
          if (this.balloon.value >= 1) {
            this.balloon.popped = true;
            this.balloon.popTimer = 18;
          }
        } else {
          this.balloon.popTimer -= 1;
          if (this.balloon.popTimer <= 0) {
            this.balloon.popped = false;
            this.balloon.value = 0.15;
          }
        }

        let mouthPt = null;
        if (facePoints?.mouth) mouthPt = mapPoint(facePoints.mouth, video);
        if (!mouthPt && facePoints?.noseTip) {
          const nose = mapPoint(facePoints.noseTip, video);
          mouthPt = nose ? { x: nose.x, y: nose.y + h * 0.18 } : null;
        }
        if (!mouthPt) mouthPt = { x: cx, y: y + h * 0.65 };

        const baseR = h * 0.06;
        const maxR = h * 0.24;
        const rBalloon = baseR + (maxR - baseR) * this.balloon.value;

        ctx.strokeStyle = "rgba(15,23,42,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mouthPt.x, mouthPt.y + rBalloon * 0.9);
        ctx.lineTo(mouthPt.x, mouthPt.y + rBalloon * 2.2);
        ctx.stroke();

        if (!this.balloon.popped) {
          ctx.fillStyle = "rgba(236,72,153,0.70)";
          ctx.beginPath();
          ctx.ellipse(mouthPt.x, mouthPt.y, rBalloon * 0.85, rBalloon, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath();
          ctx.ellipse(mouthPt.x - rBalloon * 0.25, mouthPt.y - rBalloon * 0.25, rBalloon * 0.18, rBalloon * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(15,23,42,0.65)";
          ctx.font = "600 12px system-ui";
          ctx.textAlign = "center";
          const balloonHint = this.micEnabled ? "Blow to inflate!" : "Enable mic to play";
          ctx.fillText(balloonHint, mouthPt.x, mouthPt.y + rBalloon + 18);
        } else {
          ctx.strokeStyle = "rgba(236,72,153,0.85)";
          ctx.lineWidth = 3;
          const popR = rBalloon * 1.2;
          ctx.beginPath();
          ctx.arc(mouthPt.x, mouthPt.y, popR, 0, Math.PI * 2);
          ctx.stroke();
        }

        break;
      }

      // Style 2: Spark Pop (open mouth → sparkles burst)
      case 2: {
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const lmPt = (i) => (landmarks && landmarks[i] ? mapPoint(landmarks[i], video) : null);

        const lEye = lmPt(33);
        const rEye = lmPt(263);
        const upperLip = lmPt(13);
        const lowerLip = lmPt(14);

        const leftCheekPt = facePoints?.leftCheek ? mapPoint(facePoints.leftCheek, video) : null;
        const rightCheekPt = facePoints?.rightCheek ? mapPoint(facePoints.rightCheek, video) : null;
        const mouthCenter = facePoints?.mouth ? mapPoint(facePoints.mouth, video) : null;

        const cheekR = h * 0.08;
        const drawCheekGlow = (cxCheek, cyCheek) => {
          const grad = ctx.createRadialGradient(cxCheek, cyCheek, 0, cxCheek, cyCheek, cheekR);
          grad.addColorStop(0, "rgba(255,182,193,0.5)");
          grad.addColorStop(0.5, "rgba(236,72,153,0.25)");
          grad.addColorStop(1, "rgba(248,113,113,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(cxCheek, cyCheek, cheekR * 1.2, cheekR, 0, 0, Math.PI * 2);
          ctx.fill();
        };
        const drawSmallSparkle = (sx, sy, size, rot) => {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.35, -size * 0.35);
          ctx.lineTo(size, 0);
          ctx.lineTo(size * 0.35, size * 0.35);
          ctx.lineTo(0, size);
          ctx.lineTo(-size * 0.35, size * 0.35);
          ctx.lineTo(-size, 0);
          ctx.lineTo(-size * 0.35, -size * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };
        const cheekSparkleR = w * 0.018;
        const rotT = performance.now() * 0.001;
        if (leftCheekPt && rightCheekPt) {
          drawCheekGlow(leftCheekPt.x, leftCheekPt.y);
          drawCheekGlow(rightCheekPt.x, rightCheekPt.y);
          ctx.fillStyle = "rgba(236,72,153,0.75)";
          ctx.globalAlpha = 0.9;
          drawSmallSparkle(leftCheekPt.x, leftCheekPt.y, cheekSparkleR, rotT);
          drawSmallSparkle(rightCheekPt.x, rightCheekPt.y, cheekSparkleR, rotT * 1.1);
          ctx.globalAlpha = 1;
        } else {
          const cheekY = y + h * 0.65;
          const cheekOffsetX = w * 0.22;
          [cx - cheekOffsetX, cx + cheekOffsetX].forEach((px) => {
            drawCheekGlow(px, cheekY);
            ctx.fillStyle = "rgba(236,72,153,0.75)";
            ctx.globalAlpha = 0.9;
            drawSmallSparkle(px, cheekY, cheekSparkleR, rotT);
            ctx.globalAlpha = 1;
          });
        }

        let mouthNorm = 0;
        if (upperLip && lowerLip) {
          const gap = dist(upperLip, lowerLip);
          const eyeDist = lEye && rEye ? dist(lEye, rEye) : w * 0.25;
          mouthNorm = clamp01((gap / eyeDist - 0.06) / 0.18);
        }

        const base = mouthCenter || { x: cx, y: y + h * 0.62 };
        const speed = 1.8 + mouthNorm * 2;
        const maxLife = 55;

        if (mouthNorm > 0.1 && this.dreamyBlushParticles.length < 100) {
          const n = Math.floor(2 + mouthNorm * 4);
          for (let i = 0; i < n; i++) {
            const angle = Math.random() * Math.PI * 2;
            this.dreamyBlushParticles.push({
              x: base.x,
              y: base.y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 0.5,
              life: 0,
              maxLife,
              size: w * (0.012 + Math.random() * 0.015),
            });
          }
        }

        const drawSparkle = (sx, sy, size, rot) => {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.35, -size * 0.35);
          ctx.lineTo(size, 0);
          ctx.lineTo(size * 0.35, size * 0.35);
          ctx.lineTo(0, size);
          ctx.lineTo(-size * 0.35, size * 0.35);
          ctx.lineTo(-size, 0);
          ctx.lineTo(-size * 0.35, -size * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };

        const kept = [];
        const t = performance.now() / 1000;
        ctx.fillStyle = "rgba(236,72,153,0.9)";
        for (const p of this.dreamyBlushParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.life += 1;
          if (p.life > p.maxLife) continue;
          const fade = 1 - p.life / p.maxLife;
          const s = p.size * fade;
          if (s < 0.5) continue;
          ctx.save();
          ctx.globalAlpha = fade;
          drawSparkle(p.x, p.y, s, t + p.life * 0.1);
          ctx.restore();
          kept.push(p);
        }
        this.dreamyBlushParticles = kept;

        if (mouthNorm < 0.12) {
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = "rgba(17,24,39,0.6)";
          ctx.textAlign = "center";
          ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.fillText("Open your mouth", base.x, base.y + h * 0.18);
          ctx.restore();
        }

        break;
      }

      // Style 3: Memory Frame (photo from library follows your face)
      case 3: {
        const img = this.memoryFrameImage;
        if (!img || !img.complete) {
          // Hint nếu chưa chọn ảnh
          ctx.fillStyle = "rgba(15,23,42,0.75)";
          ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.textAlign = "center";
          ctx.fillText("Choose a photo from your library", canvasW / 2, canvasH * 0.1);
          break;
        }

        const lmPt = (i) => (landmarks && landmarks[i] ? mapPoint(landmarks[i], video) : null);
        const cheek = facePoints?.rightCheek
          ? mapPoint(facePoints.rightCheek, video)
          : lmPt(93); // fallback: cheek landmark
        const forehead = facePoints?.foreheadTop
          ? mapPoint(facePoints.foreheadTop, video)
          : lmPt(10);

        if (!cheek || !forehead) {
          break;
        }

        const faceHeight = Math.abs(cheek.y - forehead.y) * 2;
        const frameH = faceHeight * 0.6;
        const frameW = frameH * 0.75;

        const offsetX = w * 0.35;
        const px = Math.min(canvasW - frameW * 0.6, cheek.x + offsetX);
        const py = cheek.y - frameH * 0.5;

        // Khung ảnh
        ctx.save();
        ctx.shadowColor = "rgba(15,23,42,0.4)";
        ctx.shadowBlur = 18;
        const r = 14;
        ctx.beginPath();
        ctx.moveTo(px + r, py);
        ctx.lineTo(px + frameW - r, py);
        ctx.quadraticCurveTo(px + frameW, py, px + frameW, py + r);
        ctx.lineTo(px + frameW, py + frameH - r);
        ctx.quadraticCurveTo(px + frameW, py + frameH, px + frameW - r, py + frameH);
        ctx.lineTo(px + r, py + frameH);
        ctx.quadraticCurveTo(px, py + frameH, px, py + frameH - r);
        ctx.lineTo(px, py + r);
        ctx.quadraticCurveTo(px, py, px + r, py);
        ctx.closePath();
        ctx.fillStyle = "rgba(15,23,42,0.85)";
        ctx.fill();
        ctx.shadowBlur = 0;

        // Ảnh bên trong
        ctx.save();
        ctx.clip();
        ctx.drawImage(img, px, py, frameW, frameH);
        ctx.restore();

        // Caption nhỏ
        ctx.fillStyle = "rgba(248,250,252,0.92)";
        ctx.font = "600 10px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textAlign = "center";
        ctx.fillText("Memory Frame", px + frameW / 2, py + frameH + 14);

        ctx.restore();
        return;
      }
    }

    ctx.restore();
  }
}
