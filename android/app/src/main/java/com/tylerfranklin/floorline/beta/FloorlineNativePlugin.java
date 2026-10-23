package com.tylerfranklin.floorline.beta;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Asks for the Android CAMERA runtime permission before the page calls
 * getUserMedia, so the WebView's own permission request is granted straight
 * away instead of racing a system dialog (which pauses the activity).
 */
@CapacitorPlugin(name = "FloorlineNative", permissions = { @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera") })
public class FloorlineNativePlugin extends Plugin {

    @PluginMethod
    public void ensure(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            resolve(call, true);
        } else {
            requestPermissionForAlias("camera", call, "onResult");
        }
    }

    @PermissionCallback
    private void onResult(PluginCall call) {
        resolve(call, getPermissionState("camera") == PermissionState.GRANTED);
    }

    /**
     * Exports: blob-URL downloads and window.open() do nothing inside the
     * Android WebView, so files are written to the cache and handed to the
     * system share sheet (Drive, Gmail, Files, Messages...).
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "floorline-export");
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("base64");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Can't create cache dir");
            File out = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, name);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't share the file: " + e.getMessage(), e);
        }
    }

    /**
     * On-device OCR (Google ML Kit Text Recognition v2, bundled Latin model:
     * no network, no API key). Input: base64 JPEG/PNG. Output: text lines
     * with pixel bounding boxes, plus the image size.
     */
    @PluginMethod
    public void recognizeText(PluginCall call) {
        String data = call.getString("base64");
        if (data == null) {
            call.reject("No image");
            return;
        }
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            call.reject("Bad image", e);
            return;
        }
        if (bmp == null) {
            call.reject("Bad image");
            return;
        }
        final int w = bmp.getWidth();
        final int h = bmp.getHeight();
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            .process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(result -> {
                JSArray lines = new JSArray();
                int b = 0;
                for (Text.TextBlock block : result.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        Rect r = line.getBoundingBox();
                        if (r == null) continue;
                        JSObject o = new JSObject();
                        o.put("text", line.getText());
                        o.put("block", b);
                        o.put("x", r.left);
                        o.put("y", r.top);
                        o.put("w", r.width());
                        o.put("h", r.height());
                        lines.put(o);
                    }
                    b++;
                }
                JSObject out = new JSObject();
                out.put("width", w);
                out.put("height", h);
                out.put("lines", lines);
                call.resolve(out);
            })
            .addOnFailureListener(e -> call.reject("Text recognition failed: " + e.getMessage(), e));
    }

    private void resolve(PluginCall call, boolean granted) {
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }
}
