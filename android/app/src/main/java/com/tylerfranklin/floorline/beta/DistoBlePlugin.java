package com.tylerfranklin.floorline.beta;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.UUID;

/**
 * BLE central for a Leica DISTO (D2 and the same GATT profile).
 *
 * Service 3ab10100-f831-4395-b29d-570977d5bf94.
 * Distance …0101 and the 20-byte basic packet …010d are forwarded as raw bytes;
 * the web layer parses them. Display unit …0102 and model …010c are forwarded too.
 * Link loss retries in the background and does not touch the floor-plan document.
 */
@CapacitorPlugin(
    name = "DistoBle",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN }, alias = "bluetoothScan"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetoothConnect"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location"),
    }
)
public class DistoBlePlugin extends Plugin {

    private static final UUID SERVICE = UUID.fromString("3ab10100-f831-4395-b29d-570977d5bf94");
    private static final UUID DISTANCE = UUID.fromString("3ab10101-f831-4395-b29d-570977d5bf94");
    private static final UUID UNIT = UUID.fromString("3ab10102-f831-4395-b29d-570977d5bf94");
    private static final UUID MODEL = UUID.fromString("3ab1010c-f831-4395-b29d-570977d5bf94");
    private static final UUID BASIC = UUID.fromString("3ab1010d-f831-4395-b29d-570977d5bf94");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Runnable> ops = new ArrayDeque<>();
    private boolean busy = false;
    private BluetoothGatt gatt;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private boolean userDisconnect = false;
    private int reconnects = 0;
    private String activeAddress;
    private String activeName;

    @PluginMethod
    public void ensurePermissions(PluginCall call) {
        if (granted()) {
            resolveGranted(call, true);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(new String[] { "bluetoothScan", "bluetoothConnect" }, call, "onPerms");
        } else {
            requestPermissionForAlias("location", call, "onPerms");
        }
    }

    @PermissionCallback
    private void onPerms(PluginCall call) {
        resolveGranted(call, granted());
    }

    @PluginMethod
    @SuppressLint("MissingPermission")
    public void startScan(PluginCall call) {
        if (!granted()) {
            call.reject("Bluetooth permission is needed to scan for a DISTO.");
            return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Turn Bluetooth on, then try again.");
            return;
        }
        stopScanInternal();
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("Bluetooth scanning isn't available.");
            return;
        }
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                consider(result);
            }

            @Override
            public void onBatchScanResults(java.util.List<ScanResult> results) {
                for (ScanResult result : results) consider(result);
            }

            @Override
            public void onScanFailed(int errorCode) {
                emitStatus("disconnected", activeName, activeAddress, "Scan failed (" + errorCode + ").");
            }
        };
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            scanner.startScan(null, settings, scanCallback);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission was denied.");
            return;
        }
        emitStatus("scanning", activeName, activeAddress, null);
        int gen = scanGen;
        main.postDelayed(() -> {
            if (gen == scanGen) stopScanInternal();
        }, 20_000);
        call.resolve();
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        stopScanInternal();
        call.resolve();
    }

    @PluginMethod
    @SuppressLint("MissingPermission")
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("No device");
            return;
        }
        if (!granted()) {
            call.reject("Bluetooth permission is needed to connect.");
            return;
        }
        userDisconnect = false;
        reconnects = 0;
        activeAddress = address;
        String hinted = call.getString("name");
        if (hinted != null && !hinted.isEmpty()) activeName = hinted;
        stopScanInternal();
        emitStatus("connecting", activeName, activeAddress, null);
        connectAddress(address);
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        userDisconnect = true;
        reconnects = 0;
        closeGatt();
        emitStatus("disconnected", activeName, activeAddress, null);
        call.resolve();
    }

    @PluginMethod
    public void forget(PluginCall call) {
        userDisconnect = true;
        prefs().edit().remove("address").remove("name").apply();
        activeAddress = null;
        activeName = null;
        closeGatt();
        emitStatus("off", null, null, null);
        call.resolve();
    }

    @PluginMethod
    public void remembered(PluginCall call) {
        JSObject o = new JSObject();
        o.put("address", prefs().getString("address", null));
        o.put("name", prefs().getString("name", null));
        call.resolve(o);
    }

    private void resolveGranted(PluginCall call, boolean ok) {
        JSObject o = new JSObject();
        o.put("granted", ok);
        call.resolve(o);
    }

    private boolean granted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bluetoothScan") == PermissionState.GRANTED
                && getPermissionState("bluetoothConnect") == PermissionState.GRANTED;
        }
        return getPermissionState("location") == PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("floorline_disto", Context.MODE_PRIVATE);
    }

    @SuppressLint("MissingPermission")
    private void connectAddress(String address) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            emitStatus("disconnected", activeName, address, "Bluetooth is off.");
            return;
        }
        closeGatt();
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device.getName() != null) activeName = device.getName();
            gatt = device.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } catch (IllegalArgumentException e) {
            emitStatus("disconnected", activeName, address, "That Bluetooth address isn't valid.");
        } catch (SecurityException e) {
            emitStatus("disconnected", activeName, address, "Bluetooth permission was denied.");
        }
    }

    private void closeGatt() {
        ops.clear();
        busy = false;
        BluetoothGatt current = gatt;
        gatt = null;
        if (current != null) {
            try {
                current.disconnect();
            } catch (SecurityException ignored) {
                /* already gone */
            }
            current.close();
        }
    }

    private int scanGen = 0;

    @SuppressLint("MissingPermission")
    private void stopScanInternal() {
        scanGen += 1;
        if (scanner != null && scanCallback != null) {
            try {
                scanner.stopScan(scanCallback);
            } catch (SecurityException ignored) {
                /* permission revoked mid-scan */
            }
        }
        scanCallback = null;
    }

    private void consider(ScanResult result) {
        if (result == null || result.getDevice() == null) return;
        String name = result.getDevice().getName();
        if (name == null && result.getScanRecord() != null) name = result.getScanRecord().getDeviceName();
        boolean service = false;
        if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
            for (android.os.ParcelUuid uuid : result.getScanRecord().getServiceUuids()) {
                if (SERVICE.equals(uuid.getUuid())) service = true;
            }
        }
        if (!service && !nameLooksLikeDisto(name)) return;
        String shown = name == null || name.isEmpty() ? "DISTO" : name;
        JSObject o = new JSObject();
        o.put("id", result.getDevice().getAddress());
        o.put("name", shown);
        o.put("rssi", result.getRssi());
        notifyListeners("device", o);
    }

    private static boolean nameLooksLikeDisto(String name) {
        if (name == null) return false;
        String n = name.toLowerCase(Locale.US);
        if (n.contains("disto") || n.contains("leica")) return true;
        return n.matches(".*\\bd2\\b.*");
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                reconnects = 0;
                try {
                    g.discoverServices();
                } catch (SecurityException e) {
                    emitStatus("disconnected", activeName, activeAddress, "Bluetooth permission was denied.");
                }
                return;
            }
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                ops.clear();
                busy = false;
                if (gatt == g) {
                    g.close();
                    gatt = null;
                }
                if (userDisconnect) {
                    emitStatus("disconnected", activeName, activeAddress, null);
                } else {
                    scheduleReconnect();
                }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                emitStatus("disconnected", activeName, activeAddress, "Couldn't read the DISTO services.");
                return;
            }
            BluetoothGattService svc = g.getService(SERVICE);
            if (svc == null) {
                emitStatus("disconnected", activeName, activeAddress, "That device doesn't speak the DISTO protocol.");
                userDisconnect = true;
                closeGatt();
                return;
            }
            prefs().edit().putString("address", activeAddress).putString("name", activeName == null ? "DISTO" : activeName).apply();
            BluetoothGattCharacteristic distance = svc.getCharacteristic(DISTANCE);
            BluetoothGattCharacteristic basic = svc.getCharacteristic(BASIC);
            BluetoothGattCharacteristic unit = svc.getCharacteristic(UNIT);
            BluetoothGattCharacteristic model = svc.getCharacteristic(MODEL);
            if (distance != null) enableNotify(g, distance);
            else if (basic != null) enableNotify(g, basic);
            else {
                emitStatus("disconnected", activeName, activeAddress, "DISTO has no distance measurement.");
                return;
            }
            if (unit != null) enableNotify(g, unit);
            if (model != null) readChar(g, model);
            if (unit != null) readChar(g, unit);
            emitStatus("connected", activeName, activeAddress, null);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value) {
            forward(ch, value);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch) {
            forward(ch, ch.getValue());
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) forward(ch, value);
            opDone();
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic ch, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) forward(ch, ch.getValue());
            opDone();
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            opDone();
        }
    };

    private void scheduleReconnect() {
        if (activeAddress == null || reconnects >= 5) {
            emitStatus("disconnected", activeName, activeAddress, "DISTO disconnected. Tap Connect laser to try again.");
            return;
        }
        reconnects += 1;
        emitStatus("reconnecting", activeName, activeAddress, null);
        long delay = Math.min(8_000L, 500L << (reconnects - 1));
        String address = activeAddress;
        main.postDelayed(() -> {
            if (!userDisconnect && address.equals(activeAddress)) connectAddress(address);
        }, delay);
    }

    @SuppressLint("MissingPermission")
    private void enableNotify(BluetoothGatt g, BluetoothGattCharacteristic ch) {
        enqueue(() -> {
            BluetoothGattDescriptor descriptor = ch.getDescriptor(CCCD);
            boolean armed = g.setCharacteristicNotification(ch, true);
            if (!armed || descriptor == null) {
                opDone();
                return;
            }
            int props = ch.getProperties();
            byte[] value = (props & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
            boolean started;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                started = g.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS;
            } else {
                descriptor.setValue(value);
                started = g.writeDescriptor(descriptor);
            }
            if (!started) opDone();
        });
    }

    @SuppressLint("MissingPermission")
    private void readChar(BluetoothGatt g, BluetoothGattCharacteristic ch) {
        enqueue(() -> {
            boolean started = g.readCharacteristic(ch);
            if (!started) opDone();
        });
    }

    private void enqueue(Runnable runnable) {
        main.post(() -> {
            ops.add(runnable);
            pump();
        });
    }

    private void pump() {
        if (busy) return;
        Runnable next = ops.poll();
        if (next == null) return;
        busy = true;
        try {
            next.run();
        } catch (SecurityException e) {
            busy = false;
            emitStatus("disconnected", activeName, activeAddress, "Bluetooth permission was denied.");
        }
    }

    private void opDone() {
        main.post(() -> {
            busy = false;
            pump();
        });
    }

    private void forward(BluetoothGattCharacteristic ch, byte[] value) {
        if (value == null || value.length == 0) return;
        String kind = "distance";
        UUID uuid = ch.getUuid();
        if (UNIT.equals(uuid)) kind = "unit";
        else if (BASIC.equals(uuid)) kind = "basic";
        else if (MODEL.equals(uuid)) kind = "model";
        else if (!DISTANCE.equals(uuid)) return;
        JSArray bytes = new JSArray();
        for (byte b : value) bytes.put(b & 0xff);
        JSObject o = new JSObject();
        o.put("kind", kind);
        o.put("bytes", bytes);
        notifyListeners("bytes", o);
    }

    private void emitStatus(String state, String name, String address, String error) {
        JSObject o = new JSObject();
        o.put("state", state);
        if (name != null) o.put("name", name);
        if (address != null) o.put("address", address);
        if (error != null) o.put("error", error);
        main.post(() -> notifyListeners("status", o));
    }
}
