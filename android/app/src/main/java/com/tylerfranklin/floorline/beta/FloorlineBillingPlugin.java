package com.tylerfranklin.floorline.beta;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing scaffold (PBL 9). Products are created in Play Console:
 *   floorline_pro_monthly / floorline_pro_yearly (subscriptions, base plans "monthly"/"yearly")
 *   floorline_pro_lifetime (one-time, non-consumable)
 * The web layer (src/lib/field/pro.ts) only calls this when billing is enabled.
 * NOTE: entitlement is checked on-device only; add server-side verification
 * (Play Developer API) before relying on it for revenue.
 */
@CapacitorPlugin(name = "FloorlineBilling")
public class FloorlineBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient client;
    private PluginCall pendingBuy;

    private void connect(Runnable then, PluginCall call) {
        if (client == null) {
            client = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
        }
        if (client.isReady()) {
            then.run();
            return;
        }
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) then.run();
                else call.reject("Billing unavailable (" + r.getResponseCode() + ")");
            }

            @Override
            public void onBillingServiceDisconnected() {}
        });
    }

    /** {products:[{id,type:"subs"|"inapp"}]} -> {items:[{id,title,price,offerToken?}]} */
    @PluginMethod
    public void getProducts(PluginCall call) {
        connect(() -> {
            List<QueryProductDetailsParams.Product> list = new ArrayList<>();
            JSArray arr = call.getArray("products", new JSArray());
            try {
                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject o = arr.getJSONObject(i);
                    list.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(o.getString("id"))
                        .setProductType("subs".equals(o.optString("type")) ? BillingClient.ProductType.SUBS : BillingClient.ProductType.INAPP)
                        .build());
                }
            } catch (Exception e) {
                call.reject("Bad products");
                return;
            }
            client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(list).build(), (r, res) -> {
                JSArray out = new JSArray();
                for (ProductDetails d : res.getProductDetailsList()) {
                    JSObject j = new JSObject();
                    j.put("id", d.getProductId());
                    j.put("title", d.getName());
                    if (d.getOneTimePurchaseOfferDetails() != null) {
                        j.put("price", d.getOneTimePurchaseOfferDetails().getFormattedPrice());
                    } else if (d.getSubscriptionOfferDetails() != null && !d.getSubscriptionOfferDetails().isEmpty()) {
                        ProductDetails.SubscriptionOfferDetails off = d.getSubscriptionOfferDetails().get(0);
                        j.put("offerToken", off.getOfferToken());
                        List<ProductDetails.PricingPhase> ph = off.getPricingPhases().getPricingPhaseList();
                        j.put("price", ph.get(ph.size() - 1).getFormattedPrice());
                    }
                    out.put(j);
                }
                JSObject ret = new JSObject();
                ret.put("items", out);
                call.resolve(ret);
            });
        }, call);
    }

    /** {id, type} -> resolves {ok:true} after purchase is acknowledged. */
    @PluginMethod
    public void buy(PluginCall call) {
        String id = call.getString("id");
        boolean subs = "subs".equals(call.getString("type"));
        connect(() -> {
            QueryProductDetailsParams.Product p = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(subs ? BillingClient.ProductType.SUBS : BillingClient.ProductType.INAPP)
                .build();
            client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(p)).build(), (r, res) -> {
                if (res.getProductDetailsList().isEmpty()) {
                    call.reject("Product not found: " + id);
                    return;
                }
                ProductDetails d = res.getProductDetailsList().get(0);
                BillingFlowParams.ProductDetailsParams.Builder pp = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d);
                if (subs && d.getSubscriptionOfferDetails() != null && !d.getSubscriptionOfferDetails().isEmpty()) {
                    pp.setOfferToken(d.getSubscriptionOfferDetails().get(0).getOfferToken());
                }
                pendingBuy = call;
                getActivity().runOnUiThread(() -> client.launchBillingFlow(getActivity(),
                    BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(pp.build())).build()));
            });
        }, call);
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        PluginCall call = pendingBuy;
        pendingBuy = null;
        if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) acknowledge(p);
            if (call != null) {
                JSObject ok = new JSObject();
                ok.put("ok", true);
                call.resolve(ok);
            }
        } else if (call != null) {
            JSObject no = new JSObject();
            no.put("ok", false);
            no.put("cancelled", r.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED);
            call.resolve(no);
        }
    }

    private void acknowledge(Purchase p) {
        if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED && !p.isAcknowledged()) {
            client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), x -> {});
        }
    }

    /** -> {owned:[productId...]} across subs + one-time (restore purchases). */
    @PluginMethod
    public void owned(PluginCall call) {
        connect(() -> {
            JSArray out = new JSArray();
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(), (r1, subs) -> {
                collect(subs, out);
                client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(), (r2, inapp) -> {
                    collect(inapp, out);
                    JSObject ret = new JSObject();
                    ret.put("owned", out);
                    call.resolve(ret);
                });
            });
        }, call);
    }

    private void collect(List<Purchase> list, JSArray out) {
        for (Purchase p : list) {
            if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
            acknowledge(p);
            for (String id : p.getProducts()) out.put(id);
        }
    }
}
