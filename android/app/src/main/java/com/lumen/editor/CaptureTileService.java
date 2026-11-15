package com.lumen.editor;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * The Quick Settings tile (W10.C31, plan W11.P10): "Capture" in the pull-down
 * shade, also from the lock screen. A tap opens the native capture box
 * (CaptureActivity) — not the WebView — and collapses the shade.
 */
public class CaptureTileService extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(Tile.STATE_INACTIVE);
        tile.updateTile();
    }

    @Override
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    public void onClick() {
        super.onClick();
        Intent open = new Intent(this, CaptureActivity.class).putExtra("source", "tile").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Runnable go = () -> {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            } else {
                startActivityAndCollapse(open);
            }
        };
        // On the lock screen, ask to unlock first: the box writes to the app's private files.
        if (isLocked()) unlockAndRun(go);
        else go.run();
    }
}
