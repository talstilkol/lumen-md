package com.lumen.editor;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plan W3.4: the app's own plugin (widgets, App Shortcuts), registered before the bridge starts.
        registerPlugin(LumenNativePlugin.class);
        // Plan 4.20 (W10.C14): the vault in a folder the user picks (Storage Access Framework).
        registerPlugin(LumenVaultFolderPlugin.class);
        // Plan W2.19 (W10.E45): LAN discovery for pairing without a code.
        registerPlugin(LumenLanPlugin.class);
        // Plans W13.P1 / W13.P5: FLAG_SECURE for locked notes, and secrets copied as sensitive and cleared.
        registerPlugin(LumenPrivacyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
