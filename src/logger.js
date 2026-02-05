export class Logger {
  constructor() {
    this.startMs = performance.now();

    this.noticeVisibleStartMs = null;
    this.noticeAccumulatedMs = 0;

    this.viewDetailsClicked = false;
    this.noticeReviewOpenedCount = 0;

    this.interactionCount = 0;
    this.demoInteractionCount = 0;

    this.cameraPermission = "unknown"; // granted | denied | not_supported | unknown

    // Lag monitoring (simple long-frame detection)
    this._rafId = null;
    this._lastFrameMs = null;
    this._longFrameCount = 0; // count frames > 200ms
  }

  addInteraction(opts = {}) {
    this.interactionCount += 1;
    if (opts && opts.demo) this.demoInteractionCount += 1;
  }

  markNoticeVisible() {
    if (this.noticeVisibleStartMs == null) {
      this.noticeVisibleStartMs = performance.now();
    }
  }

  markNoticeHidden() {
    if (this.noticeVisibleStartMs != null) {
      this.noticeAccumulatedMs += performance.now() - this.noticeVisibleStartMs;
      this.noticeVisibleStartMs = null;
    }
  }

  markDetailsViewed() {
    this.viewDetailsClicked = true;
  }

  markNoticeReviewOpened() {
    this.noticeReviewOpenedCount += 1;
  }

  markDemoVisible() {
    // reserved hook (no-op for now)
  }

  setCameraPermission(value) {
    this.cameraPermission = value;
  }

  startLagMonitor() {
    if (this._rafId) return;

    this._lastFrameMs = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = now - (this._lastFrameMs || now);
      this._lastFrameMs = now;

      if (delta > 200) this._longFrameCount += 1;

      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  stopLagMonitor() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastFrameMs = null;
  }

  getSummary(condition) {
    const now = performance.now();

    const noticeMs =
      this.noticeAccumulatedMs +
      (this.noticeVisibleStartMs ? now - this.noticeVisibleStartMs : 0);

    const deviceType = this._getDeviceType();
    const lagFlag = this._longFrameCount >= 3;

    return {
      type: "AR_PROTO_COMPLETE",
      payload: {
        condition_id: condition.condition_id,
        tp: condition.tp,
        id: condition.id,
        rt: condition.rt,

        device_type: deviceType,
        camera_permission: this.cameraPermission,

        time_on_prototype_ms: Math.round(now - this.startMs),
        time_on_notice_ms: Math.round(noticeMs),

        view_details_clicked: this.viewDetailsClicked,
        notice_review_opened_count: this.noticeReviewOpenedCount,
        interaction_count: this.interactionCount,

        lag_flag: lagFlag,
      },
    };
  }

  _getDeviceType() {
    const ua = (navigator.userAgent || "").toLowerCase();
    const isMobile =
      /mobi|android|iphone|ipod/.test(ua) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);

    // treat iPad as mobile/tablet
    const isTablet = /ipad/.test(ua);

    if (isTablet) return "tablet";
    return isMobile ? "mobile" : "desktop";
  }
}

