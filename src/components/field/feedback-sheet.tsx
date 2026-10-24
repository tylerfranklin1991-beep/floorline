import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquarePlus, Lightbulb, Crown, ImagePlus, X } from "lucide-react";
import { useBackClose } from "@/lib/field/back";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_EMAIL,
  SUGGESTIONS_URL,
  PRIVACY_URL,
  APP_VERSION,
  openExternal,
  sendFeedback,
  type FeedbackCategory,
} from "@/lib/field/feedback";
import { pickImage } from "@/lib/field/media";
import { FREE_JOB_LIMIT, REDEEM_URL, PRODUCTS, buyPro, proPrices, restorePro } from "@/lib/field/pro";

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useBackClose(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="flex-1 text-2xl font-bold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-black/5">
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Preview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img src={url} alt="Screenshot to attach" className="h-28 rounded-xl border object-cover" /> : null;
}

export function FeedbackSheet({
  onClose,
  initial = "Feature suggestion",
}: {
  onClose: () => void;
  initial?: FeedbackCategory;
}) {
  const [cat, setCat] = useState<FeedbackCategory>(initial);
  const [text, setText] = useState("");
  const [shot, setShot] = useState<Blob | null>(null);
  return (
    <Panel title="Send feedback" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {FEEDBACK_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cat === c}
              onClick={() => setCat(c)}
              className={`h-11 rounded-full px-4 text-base ${cat === c ? "bg-black text-white" : "bg-black/5"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          aria-label="Your feedback"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={cat === "Feature suggestion" ? "What would make Floorline better for you?" : "What happened? What did you expect?"}
          className="w-full rounded-xl border border-black/15 p-3 text-lg"
        />
        <div className="flex items-center gap-3">
          {shot ? (
            <>
              <Preview blob={shot} />
              <button type="button" onClick={() => setShot(null)} className="h-11 rounded-xl bg-black/5 px-3">
                Remove
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={async () => setShot(await pickImage("gallery"))}
              className="flex h-12 items-center gap-2 rounded-xl bg-black/5 px-4 text-base"
            >
              <ImagePlus className="size-5" /> Add screenshot (optional)
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={!text.trim()}
          onClick={async () => {
            try {
              await sendFeedback(cat, text, shot ?? undefined);
              onClose();
            } catch {
              toast.error(`Couldn't open email. Write to ${FEEDBACK_EMAIL}`);
            }
          }}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#b4561d] text-xl font-bold text-white disabled:opacity-40"
        >
          <MessageSquarePlus /> Open in email app
        </button>
        <p className="text-sm text-black/50">
          Opens your email app addressed to {FEEDBACK_EMAIL}. Nothing is sent until you tap Send there.
        </p>
        <button
          type="button"
          onClick={() => openExternal(SUGGESTIONS_URL)}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-black/5 p-3 text-left"
        >
          <Lightbulb className="size-6 shrink-0" />
          <span>
            <span className="block text-lg font-semibold">Public suggestions board</span>
            <span className="block text-sm text-black/60">See and vote on ideas from other users.</span>
          </span>
        </button>
        <div className="flex justify-between text-sm text-black/40">
          <span>Floorline {APP_VERSION}</span>
          <button type="button" className="underline" onClick={() => openExternal(PRIVACY_URL)}>
            Privacy policy
          </button>
        </div>
      </div>
    </Panel>
  );
}

export function ProSheet({ onClose, reason }: { onClose: () => void; reason?: string }) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    proPrices().then(setPrices).catch(() => {});
  }, []);
  const buy = (p: (typeof PRODUCTS)[keyof typeof PRODUCTS]) => async () => {
    setBusy(true);
    try {
      if (await buyPro(p)) {
        toast.success("Floorline Pro unlocked. Thank you!");
        onClose();
      }
    } catch (e) {
      toast.error((e as Error).message || "Purchase failed");
    }
    setBusy(false);
  };
  const row = (p: (typeof PRODUCTS)[keyof typeof PRODUCTS], title: string, fallback: string, note: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={buy(p)}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-black/10 p-3 text-left disabled:opacity-50"
    >
      <span className="flex-1">
        <span className="block text-lg font-semibold">{title}</span>
        <span className="block text-sm text-black/60">{note}</span>
      </span>
      <span className="text-lg font-bold">{prices[p.id] ?? fallback}</span>
    </button>
  );
  return (
    <Panel title="Floorline Pro" onClose={onClose}>
      <div className="space-y-3">
        {reason && <p className="rounded-xl bg-[#f3dcc3] p-3 text-base text-[#8a3b12]">{reason}</p>}
        <div className="flex items-center gap-2 text-lg">
          <Crown className="text-[#b4561d]" /> Unlimited jobs, no PDF watermark, all future Pro tools.
        </div>
        <p className="text-sm text-black/60">Free keeps {FREE_JOB_LIMIT} jobs and adds a small watermark to PDFs.</p>
        {row(PRODUCTS.yearly, "Yearly", "$29.99/yr", "Best value, 7-day free trial")}
        {row(PRODUCTS.monthly, "Monthly", "$4.99/mo", "Cancel anytime in Google Play")}
        {row(PRODUCTS.lifetime, "Lifetime", "$59.99", "One payment")}
        <button
          type="button"
          onClick={async () => toast((await restorePro()) ? "Pro restored" : "No purchases found")}
          className="h-12 w-full rounded-xl bg-black/5 text-base"
        >
          Restore purchases
        </button>
        <button type="button" onClick={() => openExternal(REDEEM_URL)} className="h-12 w-full rounded-xl bg-black/5 text-base">
          Have a tester code? Redeem in Google Play
        </button>
      </div>
    </Panel>
  );
}
