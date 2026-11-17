package com.lumen.editor;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.PersistableBundle;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The native half of src/privacy (plans W13.P1 and W13.P5), as the Capacitor
 * plugin {@code LumenPrivacy}:
 *
 * - setSecure: FLAG_SECURE on the window while a locked note or an unlocked
 *   encrypted vault is on screen (no screenshots, a blank task-switcher card);
 * - copySensitive / clearIfEquals: a secret copied with
 *   ClipDescription.EXTRA_IS_SENSITIVE (Android 13+: no clipboard preview, no
 *   keyboard suggestion), cleared later only if the clipboard still holds it.
 */
@CapacitorPlugin(name = "LumenPrivacy")
public class LumenPrivacyPlugin extends Plugin {
    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", false));
        getActivity().runOnUiThread(() -> {
            if (secure) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            JSObject ret = new JSObject();
            ret.put("secure", secure);
            call.resolve(ret);
        });
    }

    private ClipboardManager clipboard() {
        return (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
    }

    @PluginMethod
    public void copySensitive(PluginCall call) {
        String text = call.getString("text", "");
        ClipData clip = ClipData.newPlainText("Lumen", text);
        PersistableBundle extras = new PersistableBundle();
        if (Build.VERSION.SDK_INT >= 33) extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
        else extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
        clip.getDescription().setExtras(extras);
        clipboard().setPrimaryClip(clip);
        call.resolve();
    }

    @PluginMethod
    public void clearIfEquals(PluginCall call) {
        String text = call.getString("text", "");
        ClipboardManager cm = clipboard();
        boolean cleared = false;
        ClipData clip = cm.getPrimaryClip();
        if (clip != null && clip.getItemCount() > 0) {
            CharSequence now = clip.getItemAt(0).getText();
            if (now != null && now.toString().equals(text)) {
                if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                else cm.setPrimaryClip(ClipData.newPlainText("", ""));
                cleared = true;
            }
        }
        JSObject ret = new JSObject();
        ret.put("cleared", cleared);
        call.resolve(ret);
    }
}
