package com.tylerfranklin.floorline.beta;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FloorlineNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
