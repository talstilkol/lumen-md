package com.lumen.editor;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.json.JSONException;

/**
 * The native half of src/mobile/nativeActions.ts (plan W3.4), as the
 * Capacitor plugin {@code LumenNative}: forwards lumen:// links from the
 * home-screen widget and App Shortcuts to the WebView, and hands over the
 * capture queue (CaptureQueue: the share sheet and the Quick Settings tile,
 * plan W11.P10), which src/mobile/captureQueue.ts drains into inbox.md.
 */
@CapacitorPlugin(name = "LumenNative")
public class LumenNativePlugin extends Plugin {
    private String launchUrl;

    @Override
    public void load() {
        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        launchUrl = urlOf(intent);
    }

    private static String urlOf(Intent intent) {
        if (intent == null) return null;
        Uri data = intent.getData();
        String url = data != null ? data.toString() : null;
        return LumenActions.isAction(url) ? LumenActions.stamped(url, System.currentTimeMillis()) : null;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String url = urlOf(intent);
        if (url == null) return;
        JSObject ev = new JSObject();
        ev.put("url", url);
        notifyListeners("url", ev);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("resume", new JSObject());
    }

    /** Plan W13.M1: the WebView says whether an overlay is open, so back closes it before it leaves the app. */
    @PluginMethod
    public void setBackState(PluginCall call) {
        boolean overlay = Boolean.TRUE.equals(call.getBoolean("overlay", false));
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).setBackState(overlay);
        call.resolve();
    }

    @PluginMethod
    public void getLaunchUrl(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("url", launchUrl);
        launchUrl = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void pendingCaptures(PluginCall call) {
        JSArray items = new JSArray();
        for (Map<String, String> c : Captures.queue(getContext()).list()) {
            JSObject o = new JSObject();
            for (Map.Entry<String, String> e : c.entrySet()) o.put(e.getKey(), e.getValue());
            items.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    @PluginMethod
    public void removeCaptures(PluginCall call) {
        JSArray ids = call.getArray("ids");
        List<String> list = new ArrayList<>();
        try {
            for (int i = 0; ids != null && i < ids.length(); i++) list.add(ids.getString(i));
        } catch (JSONException e) {
            call.reject("ids must be strings", e);
            return;
        }
        Captures.queue(getContext()).remove(list);
        call.resolve();
    }

    /** A queued image or PDF, base64 ({@code file} is the stored name from pendingCaptures). */
    @PluginMethod
    public void captureFile(PluginCall call) {
        try {
            byte[] data = Captures.queue(getContext()).fileData(call.getString("file"));
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("no such capture file", e);
        }
    }
}
