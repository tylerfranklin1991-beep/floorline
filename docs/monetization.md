# Monetization plan: Floorline Pro

## Recommendation
**Freemium with one Pro unlock**, sold three ways. The app stays free to install, which makes Play ranking and the closed test easier. A paid-upfront app can't be switched to free later and vice versa costs nothing, but upfront pricing kills installs.

| Tier | What you get | Price (suggested, USD) |
|---|---|---|
| Free | Up to **2 jobs** saved at once. PDFs carry a small "Made with Floorline Free" footer. Every capture tool included. | $0 |
| Pro monthly | Unlimited jobs, clean PDFs, future Pro tools | **$4.99 / month** |
| Pro yearly | Same | **$29.99 / year**, 7-day free trial (default pick) |
| Pro lifetime | Same, one payment | **$59.99** |

Why: field users decide fast, and two free jobs is enough to prove value on a real house. The watermark makes free PDFs unprofessional to send to a client without crippling testing. Google's service fee is 15% on the first $1M/year for enrolled developers (enrol in the 15% tier in Play Console) and 15% on subscriptions.

## Product IDs to create (Play Console → Monetize with Play → Products)
| Product ID | Type | Setup |
|---|---|---|
| `floorline_pro_monthly` | Subscription | Base plan ID `monthly`, auto-renewing, 1 month, $4.99. Mark it **backwards compatible**. |
| `floorline_pro_yearly` | Subscription | Base plan ID `yearly`, auto-renewing, 1 year, $29.99. Offer: free trial 7 days, eligibility "new customers". |
| `floorline_pro_lifetime` | One-time product | Buy option, non-consumable (the app never consumes it), $59.99 |
| `floorline_pro_tester` | One-time product | **Testers only. Not shown in the app.** It must be **Active** with a buy option (Play requirement for promo codes). Set the same price as lifetime ($59.99) so nobody gains by buying it. It's granted only via 24 promo codes. |

All IDs live in `src/lib/field/pro.ts` (`PRODUCTS`, `TESTER_PRODUCT`).

## Tester-only free lifetime Pro (capped at 24)
- There is **no** free-tier unlock, debug switch or code check in the app. Pro = owning one of the four products above, as reported by Google Play.
- Testers get Pro **only** by redeeming one of **exactly 24 one-time promo codes** for `floorline_pro_tester`. Each code works once, so at most 24 free Pro accounts can ever exist from this promotion.
- The app re-checks purchases at launch and every time it returns to the foreground, and acknowledges them. That's the "In-app Promotions" integration Play requires, and it means a code redeemed in the Play Store unlocks Pro the next time the app opens.

### Create exactly 24 promo codes
1. Create and **activate** `floorline_pro_tester` (above). The app must be uploaded to a track (closed testing is fine) before products can be created.
2. Play Console → **Monetize with Play → Promo codes → Create promo code**, and accept the Promo codes Terms of Service.
3. Name: `Closed test testers 2026Q4`. Start: today. End: up to 1 year out.
4. Promotion type: **One-time product**. Product: `floorline_pro_tester`.
5. Code type: **One-time use codes**. Number of codes: **24**. (Don't use "custom code": for subscriptions it needs a 2,000+ redemption limit, and a shared code can leak.)
6. Status **On**, then **Create**. After a few seconds, **download the CSV** with the 24 codes.
7. Send each tester **one** code privately (one row per tester; keep a sheet of code → tester email). Redeem link: `https://play.google.com/redeem?code=CODE`, or in the app: Pro → "Have a tester code? Redeem in Google Play".
8. Notes: you can't change the count after creating a promotion. The quarterly limit is 500 one-time-product codes per app, and unused codes are lost at the end of the quarter, so create them in the quarter you'll send them. Redeeming requires the tester's Play account in a supported country.

## Turning billing on
- `BILLING_ENABLED = false` in `src/lib/field/pro.ts` → **everything unlocked**. That's the 0.9.0-beta.1 setting, so testing isn't blocked.
- To test billing on a Play-installed build without a new build: `localStorage.setItem("floorline-billing","on")` via chrome://inspect works on **debug** builds only. Release builds disable WebView debugging, so for release flip the constant.
- Ship `0.9.0-beta.2` with `BILLING_ENABLED = true` once the products above are active. Add your own Google account under **Settings → License testing** to make test purchases without being charged.
- Billing only works in builds **installed from Google Play** with the same package id (com.tylerfranklin.floorline). The side-loaded "Floorline Beta" debug build can't buy.
- Hardening later: purchases are verified only on the device. Before real revenue matters, add server-side verification through the Play Developer API and RTDN.
