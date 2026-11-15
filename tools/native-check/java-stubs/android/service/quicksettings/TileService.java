package android.service.quicksettings;
import android.app.PendingIntent;
import android.content.Intent;
public class TileService extends android.app.Service {
  public void onStartListening() {}
  public void onStopListening() {}
  public void onClick() {}
  public final Tile getQsTile() { return null; }
  /** @deprecated API 34: use the PendingIntent overload. */
  @Deprecated public final void startActivityAndCollapse(Intent intent) {}
  public final void startActivityAndCollapse(PendingIntent pendingIntent) {}
  public final boolean isLocked() { return false; }
  public final void unlockAndRun(Runnable runnable) {}
}
