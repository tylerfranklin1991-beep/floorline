import { Native, isNativeApp, toBase64 } from "./native";

/** ── Change these two before publishing ─────────────────────────────── */
export const FEEDBACK_EMAIL = "feedback@floorline.app"; // placeholder
export const SUGGESTIONS_URL = "https://github.com/tylerfranklin1991-beep/floorline/discussions"; // placeholder (repo must be public + Discussions on)
export const PRIVACY_URL = "https://tylerfranklin1991-beep.github.io/floorline/privacy.html"; // placeholder

export const APP_VERSION = "0.9.0-beta.1";

export const FEEDBACK_CATEGORIES = [
  "Bug / something broke",
  "Feature suggestion",
  "Measuring / accuracy",
  "Export / PDF",
  "Other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export function feedbackSubject(cat: FeedbackCategory): string {
  return `[Floorline ${APP_VERSION}] ${cat}`;
}

export function feedbackBody(cat: FeedbackCategory, text: string, ua = ""): string {
  return [
    text.trim(),
    "",
    "—",
    `Category: ${cat}`,
    `App: Floorline ${APP_VERSION}`,
    ua && `Device: ${ua}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Opens the user's mail app pre-filled; nothing is sent without them tapping Send. */
export async function sendFeedback(cat: FeedbackCategory, text: string, screenshot?: Blob) {
  const subject = feedbackSubject(cat);
  const body = feedbackBody(cat, text, navigator.userAgent);
  if (isNativeApp()) {
    await Native.sendEmail({
      to: FEEDBACK_EMAIL,
      subject,
      body,
      base64: screenshot ? await toBase64(screenshot) : undefined,
    });
    return;
  }
  window.location.href = mailtoUrl(FEEDBACK_EMAIL, subject, body + (screenshot ? "\n(Screenshot: please attach it to this email.)" : ""));
}

export async function openExternal(url: string) {
  if (isNativeApp()) await Native.openUrl({ url });
  else window.open(url, "_blank", "noopener");
}

const REVIEW_KEY = "floorline-review-asked";
/** Ask Google Play for the review card at most once, after a successful export. */
export async function maybeAskForReview(exportsDone: number) {
  if (!isNativeApp() || exportsDone < 3 || localStorage.getItem(REVIEW_KEY)) return;
  localStorage.setItem(REVIEW_KEY, "1");
  try {
    await Native.requestReview();
  } catch {
    /* Play Store missing or quota: ignore */
  }
}
