// All condition text for the 2×2×2 design (+ photo-access variation).
// A (Third-party): A1 = internal, A2 = external
// B (Identifiability): B1 = low, B2 = high
// C (Retention): C1 = immediate, C2 = 30 days

const A1 =
  "Usage analytics about your face filter interactions are handled only within the app. They are not shared with third-party organisations.";
const A2 =
  "Usage analytics about your face filter interactions are shared with third-party analytics and measurement partners.";
const B1 =
  "The app uses information only to run the filter. It does not create a unique biometric template (e.g., face/hand/voice) that could identify you.";
const B2 =
  "The app may generate a unique biometric template (e.g., a face/hand template or voiceprint) and this could be used to identify you, especially when combined with other information.";
const C1 =
  "Any stored data related to this feature is deleted immediately after the demo ends.";
const C2 =
  "Any stored data related to this feature may be retained for up to 30 days unless you request deletion.";

export const CONDITIONS = {
  1: {
    condition_id: 1,
    tp: "internal",
    id: "low",
    rt: "immediate",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C1 },
  },
  2: {
    condition_id: 2,
    tp: "internal",
    id: "low",
    rt: "stored",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C2 },
  },
  3: {
    condition_id: 3,
    tp: "internal",
    id: "high",
    rt: "immediate",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B2, rtSentence: C1 },
    details: { tpDetails: A1, idDetails: B2, rtDetails: C1 },
  },
  4: {
    condition_id: 4,
    tp: "internal",
    id: "high",
    rt: "stored",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B2, rtSentence: C2 },
    details: { tpDetails: A1, idDetails: B2, rtDetails: C2 },
  },
  5: {
    condition_id: 5,
    tp: "external",
    id: "low",
    rt: "immediate",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C1 },
  },
  6: {
    condition_id: 6,
    tp: "external",
    id: "low",
    rt: "stored",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C2 },
  },
  7: {
    condition_id: 7,
    tp: "external",
    id: "high",
    rt: "immediate",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B2, rtSentence: C1 },
    details: { tpDetails: A2, idDetails: B2, rtDetails: C1 },
  },
  8: {
    condition_id: 8,
    tp: "external",
    id: "high",
    rt: "stored",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B2, rtSentence: C2 },
    details: { tpDetails: A2, idDetails: B2, rtDetails: C2 },
  },
};

export function getConditionFromParams(search) {
  const params = new URLSearchParams(search || "");
  const condStr = params.get("cond");
  const condNum = condStr ? Number(condStr) : null;
  const hasCondParam = condStr != null && condStr !== "";
  const chosenId = hasCondParam && condNum >= 1 && condNum <= 8
    ? condNum
    : Math.floor(Math.random() * 8) + 1;
  let base = CONDITIONS[chosenId] || CONDITIONS[1];

  const tp = params.get("tp");
  const id = params.get("id");
  const rt = params.get("rt");

  // Simple validation hook: if provided, they should match the condition.
  const validation = {
    valid: true,
    mismatches: [],
  };

  if (tp && tp !== base.tp) {
    validation.valid = false;
    validation.mismatches.push("tp");
  }
  if (id && id !== base.id) {
    validation.valid = false;
    validation.mismatches.push("id");
  }
  if (rt && rt !== base.rt) {
    validation.valid = false;
    validation.mismatches.push("rt");
  }

  return { condition: base, validation };
}
