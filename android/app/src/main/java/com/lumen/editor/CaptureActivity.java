package com.lumen.editor;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;
import java.io.IOException;

/**
 * The native capture box (plan W11.P8 on Android, W10.C31): what the Quick
 * Settings tile opens. A dialog with one text field, over whatever is on the
 * screen; Save queues the line (CaptureQueue) and closes. The WebView does not
 * start, so typing begins at once; the line reaches inbox.md the next time
 * Lumen is in front. Layout direction follows the locale (RTL in Hebrew).
 */
public class CaptureActivity extends Activity {
    private EditText text;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_capture);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        text = findViewById(R.id.capture_text);
        Button save = findViewById(R.id.capture_save);
        Button cancel = findViewById(R.id.capture_cancel);
        save.setOnClickListener(this::save);
        cancel.setOnClickListener(v -> finish());
        text.requestFocus();
    }

    private void save(View v) {
        String source = getIntent() != null && getIntent().getStringExtra("source") != null ? getIntent().getStringExtra("source") : "tile";
        try {
            if (Captures.queue(this).addText(text.getText().toString(), "widget".equals(source) ? "widget" : "tile", null) != null) {
                Toast.makeText(this, R.string.capture_saved, Toast.LENGTH_SHORT).show();
            }
            finish();
        } catch (IOException e) {
            // Keep the text in the box: nothing typed is thrown away.
            Toast.makeText(this, R.string.capture_failed, Toast.LENGTH_LONG).show();
        }
    }
}
