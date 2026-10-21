package com.tylerfranklin.floorline.beta2;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ArScanPlugin.class);
        registerPlugin(FloorlineNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
