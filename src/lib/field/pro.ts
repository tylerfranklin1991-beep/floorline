import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Billing, isNativeApp, type BillingProduct } from "./native";

/**
 * Monetization feature flag. OFF = everything unlocked (testing / beta).
 * Turn on for the paid launch, or at runtime for testing with
 * localStorage.setItem("floorline-billing", "on").
 */
export const BILLING_ENABLED = false;

export const FREE_JOB_LIMIT = 2;

/** Create these exact IDs in Play Console → Monetize. */
export const PRODUCTS = {
  monthly: { id: "floorline_pro_monthly", type: "subs" },
  yearly: { id: "floorline_pro_yearly", type: "subs" },
  lifetime: { id: "floorline_pro_lifetime", type: "inapp" },
} as const satisfies Record<string, BillingProduct>;

/**
 * Closed-test testers (max 24) get lifetime Pro ONLY via 24 one-time Play promo
 * codes for this product. It is never shown or sold in the app; there is no
 * code/flag/backdoor unlock. Codes are redeemed in the Play Store, and the app
 * picks the purchase up on launch / resume ("In-app Promotions").
 */
export const TESTER_PRODUCT = { id: "floorline_pro_tester", type: "inapp" } as const satisfies BillingProduct;
export const TESTER_CAP = 24;
export const REDEEM_URL = "https://play.google.com/redeem";

const ALL_IDS: string[] = [...Object.values(PRODUCTS), TESTER_PRODUCT].map((p) => p.id);

export function billingOn(): boolean {
  if (BILLING_ENABLED) return true;
  try {
    return localStorage.getItem("floorline-billing") === "on";
  } catch {
    return false;
  }
}

type ProState = { owned: string[]; setOwned: (ids: string[]) => void };
export const usePro = create<ProState>()(
  persist(
    (set) => ({ owned: [], setOwned: (ids) => set({ owned: ids.filter((i) => ALL_IDS.includes(i)) }) }),
    { name: "floorline-pro-v1", storage: createJSONStorage(() => localStorage) },
  ),
);

export function entitled(owned: string[], flag = billingOn()): boolean {
  return !flag || owned.some((i) => ALL_IDS.includes(i));
}
export const isPro = () => entitled(usePro.getState().owned);
export const canCreateJob = (jobs: number, pro = isPro()) => pro || jobs < FREE_JOB_LIMIT;
export const watermarkPdf = () => !isPro();

export async function buyPro(p: BillingProduct): Promise<boolean> {
  if (!isNativeApp()) throw new Error("Purchases need the Play Store app");
  const r = await Billing.buy(p);
  if (r.ok) await restorePro();
  return r.ok;
}

export async function restorePro(): Promise<boolean> {
  if (!isNativeApp() || !billingOn()) return isPro();
  const { owned } = await Billing.owned();
  usePro.getState().setOwned(owned);
  return isPro();
}

export async function proPrices(): Promise<Record<string, string>> {
  if (!isNativeApp()) return {};
  const { items } = await Billing.getProducts({ products: Object.values(PRODUCTS) });
  return Object.fromEntries(items.map((i) => [i.id, i.price]));
}
