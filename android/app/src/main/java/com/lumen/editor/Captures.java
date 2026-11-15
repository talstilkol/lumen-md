package com.lumen.editor;

import android.content.Context;
import java.io.File;

/** Where the app keeps its capture queue: its private files folder (plan W11.P10). */
final class Captures {
    private Captures() {}

    static CaptureQueue queue(Context context) {
        return new CaptureQueue(new File(context.getFilesDir(), "captures"));
    }
}
