package com.lumen.editor;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Voice capture from Quick Settings (plan W1.13, W3.4, W10.C31): a tile that
 * opens Lumen already recording a voice note into the inbox. It hands the
 * app the same action link as the widget and the App Shortcut
 * ({@link LumenActions#VOICE}, stamped with the time it was tapped); the
 * WebView maps it to the capture box in voice mode (src/mobile/nativeActions.ts),
 * the native twin of the PWA's /?capture=voice. Nothing is recorded until
 * the app is open and the capture box shows the recording.
 */
public class VoiceTileService extends TileService {
    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(Tile.STATE_INACTIVE);
        tile.setLabel(getString(R.string.tile_voice));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(getString(R.string.tile_voice_subtitle));
        tile.updateTile();
    }

    @Override
    public void onClick() {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(LumenActions.stamped(LumenActions.VOICE, System.currentTimeMillis())), this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Android 14 removed the Intent overload for apps that target it: a PendingIntent there.
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            startActivityAndCollapse(open);
        }
    }
}
