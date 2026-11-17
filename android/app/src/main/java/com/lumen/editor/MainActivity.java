package com.lumen.editor;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * Plan W13.M1: back on Android 16 (predictive back, enableOnBackInvokedCallback).
     * The callback is enabled only while back belongs to the app — an overlay is open
     * (the WebView says so through LumenNative.setBackState), or the WebView has a page
     * to go back to — so otherwise the system plays its back-to-home animation and
     * leaves the app.
     */
    private boolean overlayOpen = false;

    private final OnBackPressedCallback back = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            if (overlayOpen) {
                // The WebView closes its top overlay (as Escape would) and reports the new state.
                if (bridge != null) bridge.triggerWindowJSEvent("lumenBack");
                return;
            }
            WebView wv = bridge != null ? bridge.getWebView() : null;
            if (wv != null && wv.canGoBack()) {
                wv.goBack();
                wv.postDelayed(MainActivity.this::refreshBack, 300);
                return;
            }
            setEnabled(false);
            getOnBackPressedDispatcher().onBackPressed();
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plan W3.4: the app's own plugin (widgets, App Shortcuts), registered before the bridge starts.
        registerPlugin(LumenNativePlugin.class);
        // Plan 4.20 (W10.C14): the vault in a folder the user picks (Storage Access Framework).
        registerPlugin(LumenVaultFolderPlugin.class);
        // Plan W2.19 (W10.E45): LAN discovery for pairing without a code.
        registerPlugin(LumenLanPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, back);
    }

    @Override
    public void onResume() {
        super.onResume();
        refreshBack();
    }

    /** From LumenNative.setBackState: is an overlay open in the WebView? */
    void setBackState(boolean overlay) {
        runOnUiThread(() -> {
            overlayOpen = overlay;
            refreshBack();
        });
    }

    /** Enabled only while back stays in the app. */
    void refreshBack() {
        WebView wv = bridge != null ? bridge.getWebView() : null;
        back.setEnabled(overlayOpen || (wv != null && wv.canGoBack()));
    }
}
