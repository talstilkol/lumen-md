package com.lumen.editor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.widget.Toast;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * "Share → Lumen" (plan W11.P10): ACTION_SEND and ACTION_SEND_MULTIPLE with
 * text, a link, images or PDFs. Each item is queued (CaptureQueue) with where
 * it came from: {@code source: "share"} and the sharing app's package when
 * Android says (the referrer). The WebView adds them to inbox.md when Lumen is
 * next in front; a chat message (WhatsApp, Telegram) goes through
 * chatShareText there, so it keeps its app, author and time.
 *
 * <p>No WebView starts: the activity has no layout, says "Saved" and closes.
 */
public class ShareActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int saved = 0;
        int failed = 0;
        Intent intent = getIntent();
        if (intent != null) {
            String app = referrer();
            CaptureQueue q = Captures.queue(this);
            String type = intent.getType() != null ? intent.getType() : "";
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            List<Uri> streams = streams(intent);
            for (Uri uri : streams) {
                try {
                    if (saveFile(q, uri, type, subject, app)) saved++;
                } catch (IOException | SecurityException e) {
                    failed++;
                }
            }
            if (text != null && !text.trim().isEmpty()) {
                try {
                    String t = text.trim();
                    // Chrome shares "title" as the subject and the page's address as the text.
                    if (subject != null && !subject.trim().isEmpty() && t.matches("https?://\\S+")) q.addLink(t, subject, "share", app);
                    else q.addText(t, "share", app);
                    saved++;
                } catch (IOException e) {
                    failed++;
                }
            }
        }
        Toast.makeText(this, failed > 0 ? R.string.share_failed : saved > 0 ? R.string.share_saved : R.string.share_nothing, Toast.LENGTH_SHORT).show();
        finish();
    }

    /** The sharing app's package, when Android passes it (android-app://com.example). */
    private String referrer() {
        Uri r = getReferrer();
        if (r == null || !"android-app".equals(r.getScheme())) return null;
        String host = r.getHost();
        return host != null && host.matches("[A-Za-z0-9_.]{1,200}") ? host : null;
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> streams(Intent intent) {
        List<Uri> out = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> many = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class) : intent.<Uri>getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) out.addAll(many);
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri one = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.<Uri>getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) out.add(one);
        }
        return out;
    }

    /** An image or PDF shared by content:// URI, copied into the queue. Anything else is not saved. */
    private boolean saveFile(CaptureQueue q, Uri uri, String intentType, String caption, String app) throws IOException {
        if (!"content".equals(uri.getScheme())) return false; // a file:// path from another app is not ours to read
        ContentResolver cr = getContentResolver();
        String mime = cr.getType(uri);
        if (mime == null) mime = intentType;
        String kind = mime.startsWith("image/") ? "image" : "application/pdf".equals(mime) ? "pdf" : null;
        if (kind == null) return false;
        String name = null;
        try (Cursor c = cr.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
        }
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) throw new IOException("cannot open " + uri);
            q.addFile(in, kind, mime, name, caption == null ? "" : caption, "share", app);
        }
        return true;
    }
}
