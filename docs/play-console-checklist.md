# Google Play Console checklist: Floorline (personal account)

Policy checked Oct 23, 2026, against Play Console Help "App testing requirements for new personal developer accounts":
- Personal accounts created after Nov 13, 2023 must run a **closed test with ≥12 testers opted in continuously for ≥14 days** before they can apply for production.
- **Open testing only becomes available after production access is granted.** So the "open beta" comes after the closed test.
- Internal-testing users don't count toward the 12.
- Testers who opt out and rejoin restart their 14 days.
- Other requirements in force: new apps must target **API 36** (this build does), and billing must use **Play Billing Library 8+** (this build uses 9.1.0).

Legend: 🧑 = only Tyler can do it · ✅ = already done in the repo/build

## A. Account (🧑)
1. 🧑 Go to play.google.com/console, sign in with the Google account that will own the app, and choose **Personal** account.
2. 🧑 Pay the **$25** one-time fee and complete **identity verification** (government ID, legal name, address). Verify your **phone and email** as prompted. This can take a few days.
3. 🧑 Android developer verification: confirm the account is verified and **register the package name `com.tylerfranklin.floorline`** if Play Console asks.
4. 🧑 To sell Pro: **Settings → Payments profile** (create a merchant account: bank and tax info). Enrol in the **15% service fee tier** (Settings → Developer account → Service fee programs). Note: Play may show the address of personal accounts that monetize publicly on the listing. Check the notice in Play Console before you set up payments.

## B. Create the app
5. 🧑 **Create app**: name "Floorline", default language en-US, **App** (not game), **Free**, accept the declarations.
   - ⚠️ Free vs paid can't be changed from paid back to free later. Choose **Free**, because the plan uses in-app purchases.
6. 🧑 **Play App Signing**: keep the default (Google generates and holds the **app signing key**). The key at `/home/box/floorline-release/floorline-upload.jks` is your **upload key**.
   - Upload-key certificate SHA-256: `AC:BF:EF:CC:F9:43:AA:67:3B:C5:8D:01:AB:C1:B7:0A:1C:1C:CB:2B:EA:4F:48:3A:A1:C5:86:79:48:78:0D:0B`
   - 🧑 **Back up the .jks and keystore.properties somewhere safe off the box** (password manager or encrypted drive). If you lose the upload key, Google can reset it, but that takes a support request.

## C. App content (Policy → App content). Answers are in this folder
7. 🧑 Privacy policy URL: host `privacy-policy.html` first.
   - ✅ It's also committed as `docs/privacy.html`.
   - 🧑 Turn on GitHub Pages for the repo (Settings → Pages → branch, `/docs`), or use any website.
   - 🧑 Replace the placeholder email `feedback@floorline.app` with a real inbox. Change it in `src/lib/field/feedback.ts` as well.
8. 🧑 Ads: **No**. App access: **All functionality available without special access**. Target audience: **18+**.
9. 🧑 **Content rating**: copy from `content-rating.md`.
10. 🧑 **Data safety**: copy from `data-safety.md`.
11. 🧑 Government / financial / health / news declarations: **No**. Advertising ID: **No**.

## D. Store listing (Grow → Store presence → Main store listing)
12. 🧑 Paste from `store-listing.md`: short and full description.
    - Upload `graphics/icon-512.png` and `graphics/feature-graphic-1024x500.png`.
    - Upload phone screenshots `screenshots/01..06` (1080×1920). `00-home` is optional.
13. 🧑 Category **Productivity**. Contact email. Website optional.

## E. Closed test (capped at 24 testers)
14. 🧑 **Test and release → Testing → Closed testing → Create track** (e.g. "Field beta").
15. 🧑 Testers: choose **Email lists** (not a Google Group, which anyone with the link could join). Create a list "Floorline testers" with **at most 24 Gmail/Google accounts**. Add no others.
    - To stay ≥12 continuously, recruit about 14–16 reliable people. Hard stop at 24.
    - Only listed emails can use the opt-in link, so the cap holds even if the link leaks. Never switch the track to Google Groups or "anyone".
16. 🧑 Feedback URL or email for testers: use the suggestions-board URL.
17. 🧑 **Create release** on that track.
    - Upload `build/floorline-0.9.0-beta.1.aab` (versionCode 12).
    - Upload `build/mapping-0.9.0-beta.1.txt` under App bundle explorer → Downloads → ReTrace mapping (deobfuscated crash traces).
    - Release notes are in store-listing.md.
18. 🧑 Send to review (closed tracks get a light review, usually hours to a few days). Then copy the **opt-in link** and send it to each tester.
19. 🧑 **Pro for testers**:
    - Create the products, then the **24 one-time promo codes** for `floorline_pro_tester` (steps in `monetization.md`).
    - Send one code per tester and keep a code→tester sheet. Testers redeem at play.google.com/redeem.
    - Codes only take effect once a build with `BILLING_ENABLED = true` ships (planned 0.9.0-beta.2). Until then everyone has everything unlocked anyway.
20. 🧑 Keep testers **opted in for 14 straight days**. Ask them to actually use it (open it on several days, export a PDF, send feedback). Google asks about engagement when you apply.
21. 🧑 Day 15 or later: **Dashboard → Apply for production**. Answer the three sections: closed test, app, readiness. Mention the feedback you received and what you fixed.

## F. After production access
22. 🧑 Then either promote to **Open testing** (the public "open beta": anyone can join from the listing, with private feedback) or go to **Production** directly.
    - Testers already holding promo-code Pro keep it.
    - No new free Pro accounts are created beyond the 24 codes.
23. 🧑 Pricing per country: Monetize → Products. Set USD and let Play convert, or round local prices by hand.

## Things already done in code (✅)
- ✅ Package `com.tylerfranklin.floorline`, app name "Floorline", versionName 0.9.0-beta.1, versionCode 12, target and compile SDK 36, minify and resource shrinking on.
- ✅ Signed release AAB and APK, signed with the upload key.
- ✅ Debug builds stay `com.tylerfranklin.floorline.beta` "Floorline Beta", so they install side by side.
- ✅ Feedback form:
  - Category, text and optional screenshot, sent through the user's email app.
  - Reachable from the home header, the Export sheet, and the "Suggest a feature" action on the toast after an export.
  - Includes a public suggestions board link and a privacy link.
- ✅ Play In-App Review prompt: at most once, after the 3rd successful export.
- ✅ Play Billing (PBL 9.1.0) plugin, Pro paywall, free limits (2 jobs, PDF watermark) behind `BILLING_ENABLED=false`.
- ✅ The READ_MEDIA_IMAGES/VIDEO and AD_ID permissions are removed (the app uses the Photo Picker), which avoids the Photo & Video Permissions declaration.

## Before you upload: change these placeholders
- `src/lib/field/feedback.ts`: `FEEDBACK_EMAIL`, `SUGGESTIONS_URL`, `PRIVACY_URL`
  - For GitHub Discussions: make the repo public, or create a separate public "floorline-feedback" repo, then Settings → Features → Discussions.
- The email in `privacy-policy.*` and `store-listing.md`.
- Rebuild after changing them (see README.md).
