/** Default Q/A form loaded by field app (admin can edit via dashboard) */
export const DEFAULT_QUESTIONS = [
  {
    id: "respondent_name",
    label: "Respondent full name",
    type: "text",
    required: true,
    speak: "What is the respondent full name?",
  },
  {
    id: "district",
    label: "District",
    type: "text",
    required: true,
    speak: "Which district?",
  },
  {
    id: "constituency",
    label: "Assembly constituency",
    type: "text",
    required: true,
    speak: "Which assembly constituency?",
  },
  {
    id: "gender",
    label: "Gender",
    type: "choice",
    options: ["Male", "Female", "Other"],
    required: true,
    speak: "Gender of the respondent?",
  },
  {
    id: "caste",
    label: "Caste category",
    type: "choice",
    options: ["BC", "SC", "ST", "OC", "Minority", "Other"],
    required: false,
    speak: "Caste category?",
  },
  {
    id: "age",
    label: "Age group",
    type: "choice",
    options: ["18-25", "26-35", "36-45", "46-60", "60+"],
    required: false,
    speak: "Age group?",
  },
  {
    id: "winning_party",
    label: "Who will win here?",
    type: "choice",
    options: ["Congress", "BJP", "BRS", "Others", "Undecided"],
    required: true,
    speak: "According to them who will win?",
  },
  {
    id: "pm_preference",
    label: "Preferred PM",
    type: "choice",
    options: ["Narendra Modi", "Rahul Gandhi", "Other", "Undecided"],
    required: false,
    speak: "Preferred Prime Minister?",
  },
  {
    id: "performance",
    label: "Government performance",
    type: "choice",
    options: ["Excellent", "Good", "Average", "Poor", "Very Poor"],
    required: false,
    speak: "How is government performance?",
  },
  {
    id: "issues",
    label: "Top issues (comma separated)",
    type: "text",
    required: false,
    speak: "What are the main issues?",
  },
  {
    id: "notes",
    label: "Notes",
    type: "text",
    required: false,
    speak: "Any extra notes?",
  },
];



export const PII_KEYS = new Set([
  "aadhaar", "aadhaarnumber", "aadhaar_no", "aadhaarno",
  "phone", "phonenumber", "phoneno", "mobile", "mobileno",
  "respondentphone", "respondentmobile",
]);

/** Remove Aadhaar / phone answers before persisting a submission. */
export function stripPii(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    const key = k.toLowerCase().replace(/[\s_\-().]/g, "");
    if (PII_KEYS.has(key)) continue;
    out[k] = v;
  }
  return out;
}

