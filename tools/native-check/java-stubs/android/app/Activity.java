package android.app;
import android.content.Intent;
import android.os.Bundle;
public class Activity extends android.content.Context {
  public static final int RESULT_OK = -1, RESULT_CANCELED = 0;
  public String getPackageName() { return null; }
  protected void onCreate(Bundle savedInstanceState) {}
  protected void onNewIntent(Intent intent) {}
  public Intent getIntent() { return null; }
  public void setContentView(int layoutResID) {}
  public <T extends android.view.View> T findViewById(int id) { return null; }
  public android.view.Window getWindow() { return null; }
  public void finish() {}
  public android.net.Uri getReferrer() { return null; }
}
