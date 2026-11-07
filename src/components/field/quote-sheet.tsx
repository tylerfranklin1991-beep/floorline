import { useBackClose } from "@/lib/field/back";
import { jobSettings } from "@/lib/field/job";
import type { FieldProperty } from "@/lib/field/model";
import { shareQuotePdf } from "@/lib/field/quote-pdf";
import {
  lineAmount,
  loadBook,
  loadBusiness,
  money,
  pricesBlank,
  quoteTotals,
  refreshLines,
  saveBook,
  saveBusiness,
  takeQuoteNumber,
  freshQuote,
  parseQuote,
  validThrough,
  type BusinessProfile,
  type PriceBook,
  type QuoteLine,
  type SavedQuote,
} from "@/lib/field/quote";
import { useField } from "@/lib/field/store";
import { useState } from "react";
import { toast } from "sonner";
import { HelpMark } from "./tutorials-ui";

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold">{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-black/15 px-3 text-base"
      />
    </label>
  );
}

export function QuoteSheet({ property, onClose }: { property: FieldProperty; onClose: () => void }) {
  const change = useField((s) => s.change);
  useBackClose(true, onClose);
  const [book, setBook] = useState<PriceBook>(() => loadBook());
  const [business, setBusiness] = useState<BusinessProfile>(() => loadBusiness());
  const [showBiz, setShowBiz] = useState(false);
  const [quote, setQuote] = useState<SavedQuote>(() => {
    if (property.quote) return parseQuote(property.quote, property, loadBook());
    return freshQuote(property, loadBook(), takeQuoteNumber());
  });
  const [busy, setBusy] = useState(false);
  const totals = quoteTotals(quote);
  const blank = pricesBlank(book.rates);

  const writeBusiness = (next: BusinessProfile) => {
    setBusiness(next);
    saveBusiness(next);
  };
  const writeBook = (next: PriceBook) => {
    setBook(next);
    saveBook(next);
  };

  const setLine = (id: string, patch: Partial<QuoteLine>) => {
    setQuote((q) => {
      let lines = q.lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
      const edited = lines.find((l) => l.id === id);
      if (edited?.rateKey && patch.price != null) {
        const price = patch.price;
        lines = lines.map((l) => (l.rateKey === edited.rateKey ? { ...l, price } : l));
        writeBook({ ...book, rates: { ...book.rates, [edited.rateKey]: price } });
      }
      return { ...q, lines };
    });
  };

  const saveOnJob = () => {
    change((p) => ({
      ...p,
      address: quote.address,
      quote,
      job: { ...jobSettings(p.job), customer: quote.customer },
    }));
    writeBook({
      ...book,
      markupPct: quote.markupPct,
      taxPct: quote.taxPct,
      discount: quote.discount,
      depositPct: quote.depositPct,
      validDays: quote.validDays,
    });
  };

  const share = async () => {
    setBusy(true);
    try {
      saveOnJob();
      await shareQuotePdf({ ...property, address: quote.address }, quote, business);
      toast.success("Quote ready to share");
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") toast.error("Could not share the quote");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Customer quote"
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-2xl font-bold">Quote</h2>
          <HelpMark id="quote" />
          <button type="button" aria-label="Close" onClick={() => { saveOnJob(); onClose(); }} className="flex size-12 items-center justify-center rounded-full bg-black/5 text-2xl">
            ×
          </button>
        </div>

        {blank && (
          <p className="mb-3 rounded-2xl bg-[#fff8ec] p-3 text-sm">
            Your price list is empty. Type a price on each line — it is saved and used on the next quote. Nothing is filled in for you.
          </p>
        )}

        <button type="button" onClick={() => setShowBiz((v) => !v)} className="mb-3 flex h-12 w-full items-center gap-3 rounded-xl bg-black/5 px-3 text-left">
          <img src={business.logoDataUrl || "/brand/scg-icon.png"} alt="" className="size-9 rounded-md object-contain" />
          <span className="flex-1 font-semibold">{business.name || "Business"}</span>
          <span className="text-sm text-black/50">{showBiz ? "Hide" : "Business"}</span>
        </button>
        {showBiz && (
          <div className="mb-4 space-y-2 rounded-2xl border border-black/10 p-3">
            <p className="text-sm text-black/60">
              Started from SCG on surfacescg.com. Replace the name, phone, email, license and logo with yours. Saved on this phone.
            </p>
            <Field label="Business name" value={business.name} onChange={(v) => writeBusiness({ ...business, name: v })} />
            <Field label="Phone" value={business.phone} onChange={(v) => writeBusiness({ ...business, phone: v })} />
            <Field label="Email" value={business.email} onChange={(v) => writeBusiness({ ...business, email: v })} />
            <Field label="License" value={business.license} onChange={(v) => writeBusiness({ ...business, license: v })} />
            <label className="block text-sm font-semibold">
              Logo
              <input
                aria-label="Upload logo"
                type="file"
                accept="image/*"
                className="mt-1 block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => writeBusiness({ ...business, logoDataUrl: String(reader.result || "") });
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {business.logoDataUrl && (
              <button type="button" className="text-sm font-semibold text-[#8a3b12]" onClick={() => writeBusiness({ ...business, logoDataUrl: "" })}>
                Use the SCG logo
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Customer" value={quote.customer} onChange={(v) => setQuote({ ...quote, customer: v })} />
          <Field label="Quote number" value={quote.number} onChange={(v) => setQuote({ ...quote, number: v })} />
          <Field label="Address" value={quote.address} onChange={(v) => setQuote({ ...quote, address: v })} />
          <Field label="Date" type="date" value={quote.date} onChange={(v) => setQuote({ ...quote, date: v })} />
          <Field
            label="Valid for (days)"
            type="number"
            value={quote.validDays}
            onChange={(v) => setQuote({ ...quote, validDays: Number(v) || 0 })}
          />
          <p className="self-end pb-3 text-sm text-black/60">Valid through {validThrough(quote.date, quote.validDays)}</p>
        </div>

        <div className="mt-3 space-y-2">
          {quote.lines.map((l) => (
            <div key={l.id} className="rounded-xl border border-black/10 p-2">
              <div className="mb-1 flex items-start gap-2">
                {l.custom ? (
                  <input
                    aria-label="Line description"
                    value={l.label}
                    onChange={(e) => setLine(l.id, { label: e.target.value })}
                    className="h-10 flex-1 rounded-lg border border-black/15 px-2 text-sm font-semibold"
                  />
                ) : (
                  <p className="flex-1 text-sm font-semibold">{l.label}</p>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${l.label}`}
                  className="text-lg leading-none text-black/40"
                  onClick={() =>
                    setQuote((q) => ({
                      ...q,
                      lines: l.custom ? q.lines.filter((x) => x.id !== l.id) : q.lines.map((x) => (x.id === l.id ? { ...x, qty: 0 } : x)),
                    }))
                  }
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`${l.label} quantity`}
                  type="number"
                  value={l.qty}
                  onChange={(e) => setLine(l.id, { qty: Number(e.target.value) || 0 })}
                  className="h-11 w-24 rounded-lg border border-black/15 px-2"
                />
                <span className="w-12 text-xs text-black/50">{l.unit}</span>
                <input
                  aria-label={`${l.label} price`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={l.price || ""}
                  onChange={(e) => setLine(l.id, { price: Number(e.target.value) || 0 })}
                  className="h-11 w-24 rounded-lg border border-black/15 px-2"
                />
                <span className="ml-auto text-sm font-semibold">{money(lineAmount(l))}</span>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="h-11 w-full rounded-xl border border-dashed border-black/30 text-sm font-semibold"
            onClick={() =>
              setQuote((q) => ({
                ...q,
                lines: [
                  ...q.lines,
                  { id: `custom-${Date.now().toString(36)}`, label: "Custom item", qty: 1, unit: "ea", price: 0, custom: true },
                ],
              }))
            }
          >
            Add a line
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Markup %" type="number" value={quote.markupPct} onChange={(v) => setQuote({ ...quote, markupPct: Number(v) || 0 })} />
          <Field label="Tax %" type="number" value={quote.taxPct} onChange={(v) => setQuote({ ...quote, taxPct: Number(v) || 0 })} />
          <Field label="Discount $" type="number" value={quote.discount} onChange={(v) => setQuote({ ...quote, discount: Number(v) || 0 })} />
          <Field label="Deposit %" type="number" value={quote.depositPct} onChange={(v) => setQuote({ ...quote, depositPct: Number(v) || 0 })} />
        </div>
        <label className="mt-2 block text-sm">
          <span className="mb-1 block font-semibold">Terms and notes</span>
          <textarea
            aria-label="Terms and notes"
            value={quote.notes}
            onChange={(e) => setQuote({ ...quote, notes: e.target.value })}
            rows={3}
            className="w-full rounded-xl border border-black/15 p-3 text-base"
          />
        </label>
        <Field label="Accepted by" value={quote.signature} onChange={(v) => setQuote({ ...quote, signature: v })} />

        <div className="mt-3 space-y-1 text-sm">
          <Row k="Subtotal" v={money(totals.subtotal)} />
          {totals.markup > 0 && <Row k="Markup" v={money(totals.markup)} />}
          {totals.discount > 0 && <Row k="Discount" v={money(-totals.discount)} />}
          {totals.tax > 0 && <Row k="Tax" v={money(totals.tax)} />}
          <Row k="Total" v={money(totals.total)} strong />
          {totals.deposit > 0 && <Row k="Deposit" v={money(totals.deposit)} />}
          {totals.deposit > 0 && <Row k="Balance" v={money(totals.balance)} strong />}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="h-12 rounded-xl bg-black/5 text-sm font-semibold"
            onClick={() => setQuote((q) => ({ ...q, lines: refreshLines(property, q.lines, book.rates) }))}
          >
            Update from plan
          </button>
          <button type="button" className="h-12 rounded-xl bg-black text-sm font-bold text-white" disabled={busy} onClick={share}>
            {busy ? "Sharing…" : "Share PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-base font-bold" : ""}`}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
