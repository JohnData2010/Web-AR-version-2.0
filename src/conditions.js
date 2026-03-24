// All condition text for the 2×2×4 design.
// A (Third-party): A1 = internal, A2 = external
// B (Identifiability): fixed as low in this prototype (UI no longer varies it)
// C (Retention): C1 = immediate, C2 = three (3) years
// D (Access permission bundle – 4 levels):
//   D1 = Limited access × Biometric only
//        - Only this time: Camera
//        - Only this time: Microphone
//        - No Photo Library
//   D2 = Broader access × Biometric only
//        - While using: Camera
//        - While using: Microphone
//        - No Photo Library
//   D3 = Limited access × Biometric + Personal
//        - Only this time: Camera
//        - Only this time: Microphone
//        - Selected only: Photo Library
//   D4 = Broader access × Biometric + Personal
//        - While using: Camera
//        - While using: Microphone
//        - Allow all: Photo Library

const A1 =
  "Usage analytics about your face filter interactions are handled only within the app. They are not shared with third-party organisations.";
const A2 =
  "Usage analytics about your face filter interactions are shared with third-party analytics and measurement partners.";
const B1 =
  "The app uses information only to run the filter. It does not create a unique biometric template (e.g., face/hand/voice) that could identify you.";
const C1 =
  "Any stored data related to this feature is deleted immediately after the demo ends.";
const C2 =
  "Any stored data related to this feature may be retained for up to three (3) years unless you request deletion.";

export const CONDITIONS = {
  1: {
    condition_id: 1,
    tp: "internal",
    id: "low",
    rt: "immediate",
    access_bundle: "D1",
    scope: "only",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C1 },
  },
  2: {
    condition_id: 2,
    tp: "internal",
    id: "low",
    rt: "stored",
    access_bundle: "D1",
    scope: "only",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C2 },
  },
  3: {
    condition_id: 3,
    tp: "external",
    id: "low",
    rt: "immediate",
    access_bundle: "D1",
    scope: "only",
    photo: "none",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C1 },
  },
  4: {
    condition_id: 4,
    tp: "external",
    id: "low",
    rt: "stored",
    access_bundle: "D1",
    scope: "only",
    photo: "none",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C2 },
  },
  5: {
    condition_id: 5,
    tp: "internal",
    id: "low",
    rt: "immediate",
    access_bundle: "D2",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C1 },
  },
  6: {
    condition_id: 6,
    tp: "internal",
    id: "low",
    rt: "stored",
    access_bundle: "D2",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C2 },
  },
  7: {
    condition_id: 7,
    tp: "external",
    id: "low",
    rt: "immediate",
    access_bundle: "D2",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C1 },
  },
  8: {
    condition_id: 8,
    tp: "external",
    id: "low",
    rt: "stored",
    access_bundle: "D2",
    scope: "while",
    photo: "none",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C2 },
  },
  9: {
    condition_id: 9,
    tp: "internal",
    id: "low",
    rt: "immediate",
    access_bundle: "D3",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C1 },
  },
  10: {
    condition_id: 10,
    tp: "internal",
    id: "low",
    rt: "stored",
    access_bundle: "D3",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C2 },
  },
  11: {
    condition_id: 11,
    tp: "external",
    id: "low",
    rt: "immediate",
    access_bundle: "D3",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C1 },
  },
  12: {
    condition_id: 12,
    tp: "external",
    id: "low",
    rt: "stored",
    access_bundle: "D3",
    scope: "only",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C2 },
  },
  13: {
    condition_id: 13,
    tp: "internal",
    id: "low",
    rt: "immediate",
    access_bundle: "D4",
    scope: "while",
    photo: "library",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C1 },
  },
  14: {
    condition_id: 14,
    tp: "internal",
    id: "low",
    rt: "stored",
    access_bundle: "D4",
    scope: "while",
    photo: "library",
    notice: { tpSentence: A1, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A1, idDetails: B1, rtDetails: C2 },
  },
  15: {
    condition_id: 15,
    tp: "external",
    id: "low",
    rt: "immediate",
    access_bundle: "D4",
    scope: "while",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C1 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C1 },
  },
  16: {
    condition_id: 16,
    tp: "external",
    id: "low",
    rt: "stored",
    access_bundle: "D4",
    scope: "while",
    photo: "library",
    notice: { tpSentence: A2, idSentence: B1, rtSentence: C2 },
    details: { tpDetails: A2, idDetails: B1, rtDetails: C2 },
  },
};

export function getConditionFromParams(search) {
  const params = new URLSearchParams(search || "");
  const condStr = params.get("cond");
  const condNum = condStr ? Number(condStr) : null;
  const hasCondParam = condStr != null && condStr !== "";
  const chosenId = hasCondParam && condNum >= 1 && condNum <= 16
    ? condNum
    : Math.floor(Math.random() * 16) + 1;
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
