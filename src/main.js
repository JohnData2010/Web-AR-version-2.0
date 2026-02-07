import { getConditionFromParams } from "./conditions.js";
import { initPostMessageOrigin, sendMessage } from "./postmessage.js";
import { AppUI } from "./ui.js";

function init() {
  initPostMessageOrigin();

  const params = new URLSearchParams(window.location.search);
  const debug = params.get("debug") === "1";

  const { condition, validation } = getConditionFromParams(
    window.location.search
  );

  // Audit message: single source of truth is `cond` (1..8).
  // This helps Qualtrics (parent) record the exact condition shown.
  const condParamRaw = params.get("cond");
  const condParam = condParamRaw ? Number(condParamRaw) : null;
  sendMessage({
    type: "AR_PROTO_AUDIT",
    payload: {
      condition_id: condition.condition_id,
      tp: condition.tp,
      id: condition.id,
      rt: condition.rt,

      url_search: window.location.search || "",
      cond_param_present: condParamRaw != null,
      cond_param_value: Number.isFinite(condParam) ? condParam : null,

      validation_ok: validation.valid,
      validation_mismatches: validation.mismatches || [],

      ts_ms: Date.now(),
    },
  });

  const headerStatus = document.getElementById("headerStatus");
  if (headerStatus) {
    headerStatus.textContent = `C${condition.condition_id}`;
    headerStatus.title = `Condition ${condition.condition_id}`;
    headerStatus.style.display = "inline-flex";

    if (debug) {
      const ok = validation.valid;
      headerStatus.setAttribute("aria-hidden", "false");
      headerStatus.setAttribute("role", "note");
      headerStatus.classList.add("condition-badge-debug");
      headerStatus.textContent = ok
        ? `Cond ${condition.condition_id}`
        : `Cond ${condition.condition_id} ⚠`;
      headerStatus.style.color = ok ? "#065f46" : "#92400e";
      headerStatus.style.borderColor = ok
        ? "rgba(34, 197, 94, 0.45)"
        : "rgba(245, 158, 11, 0.55)";
      headerStatus.style.background = ok
        ? "rgba(34, 197, 94, 0.12)"
        : "rgba(245, 158, 11, 0.12)";
      headerStatus.title = ok
        ? `Condition ${condition.condition_id}`
        : `Condition ${condition.condition_id} (param mismatch: ${validation.mismatches.join(
            ", "
          )})`;
    } else {
      headerStatus.setAttribute("aria-hidden", "true");
      headerStatus.classList.remove("condition-badge-debug");
      headerStatus.style.color = "";
      headerStatus.style.borderColor = "";
      headerStatus.style.background = "";
    }
  }

  const appBody = document.getElementById("appBody");
  if (!appBody) return;

  // eslint-disable-next-line no-new
  new AppUI({ root: appBody, condition, debug });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
