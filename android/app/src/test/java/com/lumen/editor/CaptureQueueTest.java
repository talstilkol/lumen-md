package com.lumen.editor;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * Plans W11.P8 / W11.P10: the Android capture queue. A kill while writing
 * loses no capture that was already queued and lists nothing half-written;
 * two writers at once keep both; 100 shares keep their source.
 * Runs with ./gradlew test, and offline with tools/native-check/test-android.sh.
 */
public class CaptureQueueTest {
    private File dir;
    private CaptureQueue q;

    @Before
    public void setUp() throws IOException {
        dir = new File(System.getProperty("java.io.tmpdir"), "lumen-captures-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        q = new CaptureQueue(dir);
    }

    @After
    public void tearDown() {
        delete(dir);
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        assertTrue(f.delete() || !f.exists());
    }

    @Test
    public void textAndLinksKeepTheirSourceAndApp() throws IOException {
        q.addText("  שלום מהשיתוף  ", "share", "com.whatsapp");
        q.addText("https://example.org/a?b=1", "share", "com.android.chrome");
        q.addLink("https://example.org/page", "כותרת", "share", null);
        assertNull(q.addText("   ", "share", null));
        List<Map<String, String>> l = q.list();
        assertEquals(3, l.size());
        assertEquals("text", l.get(0).get("kind"));
        assertEquals("שלום מהשיתוף", l.get(0).get("text"));
        assertEquals("com.whatsapp", l.get(0).get("app"));
        assertEquals("url", l.get(1).get("kind"));
        assertEquals("https://example.org/a?b=1", l.get(1).get("url"));
        assertEquals("כותרת", l.get(2).get("text"));
        for (Map<String, String> c : l) {
            assertEquals("share", c.get("source"));
            assertTrue(c.get("at"), c.get("at").matches("\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z"));
        }
    }

    @Test
    public void aKillWhileWritingListsNothingHalfWrittenAndLosesNothingQueued() throws IOException {
        q.addText("before the kill", "tile", null);
        // A writer killed mid-write leaves its temporary file, cut short, and never renamed.
        String id = UUID.randomUUID().toString();
        try (FileOutputStream out = new FileOutputStream(new File(dir, String.format("%013d-%s.json.%s.tmp", System.currentTimeMillis(), id, UUID.randomUUID())))) {
            out.write("{\"id\":\"".concat(id).concat("\",\"kind\":\"te").getBytes(StandardCharsets.UTF_8));
        }
        // A file copied in, killed before its JSON (the commit point) was written.
        File files = new File(dir, "files");
        try (FileOutputStream out = new FileOutputStream(new File(files, "ORPHAN.pdf"))) {
            out.write(new byte[] {'%', 'P', 'D', 'F'});
        }
        List<Map<String, String>> l = q.list();
        assertEquals(1, l.size());
        assertEquals("before the kill", l.get(0).get("text"));
        // The queue still works after the kill.
        q.addText("after the kill", "tile", null);
        assertEquals(2, q.list().size());
    }

    @Test
    public void aFailedCommitRemovesTheCopiedFile() throws IOException {
        for (int i = 0; i < CaptureQueue.MAX_ITEMS; i++) q.add(Collections.singletonMap("id", "F" + i));
        try {
            q.addFile(new ByteArrayInputStream(new byte[] {1, 2, 3}), "image", "image/png", "a.png", "", "share", null);
            fail("a full queue takes no more");
        } catch (IOException expected) {
            // the queue is full
        }
        String[] left = new File(dir, "files").list();
        assertEquals(0, left == null ? 0 : left.length);
    }

    @Test
    public void twoWritersAtOnceKeepEveryCapture() throws InterruptedException {
        List<Thread> threads = new ArrayList<>();
        List<Throwable> errors = Collections.synchronizedList(new ArrayList<>());
        for (int t = 0; t < 2; t++) {
            final int w = t;
            Thread th = new Thread(() -> {
                try {
                    for (int i = 0; i < 100; i++) q.addText("writer " + w + " #" + i, w == 0 ? "share" : "tile", null);
                } catch (IOException e) {
                    errors.add(e);
                }
            });
            threads.add(th);
            th.start();
        }
        for (Thread th : threads) th.join();
        assertTrue(errors.toString(), errors.isEmpty());
        assertEquals(200, q.list().size());
    }

    @Test
    public void hundredSharesWithTheirSourceThenRemoved() throws IOException {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            Map<String, String> c;
            switch (i % 4) {
                case 0: c = q.addText("טקסט " + i, "share", "org.telegram.messenger"); break;
                case 1: c = q.addLink("https://example.org/p/" + i, "דף " + i, "share", "com.android.chrome"); break;
                case 2: c = q.addFile(new ByteArrayInputStream(new byte[] {(byte) 0xff, (byte) 0xd8, (byte) i}), "image", "image/jpeg", "IMG_" + i + ".jpg", "", "share", "com.google.android.apps.photos"); break;
                default: c = q.addFile(new ByteArrayInputStream(("%PDF-1.7 " + i).getBytes(StandardCharsets.UTF_8)), "pdf", "application/pdf", "doc " + i + ".pdf", "מסמך", "share", null);
            }
            ids.add(c.get("id"));
        }
        List<Map<String, String>> l = q.list();
        assertEquals(100, l.size());
        int files = 0;
        for (Map<String, String> c : l) {
            assertEquals("share", c.get("source"));
            if (c.containsKey("file")) {
                files++;
                byte[] data = q.fileData(c.get("file"));
                assertTrue(data.length > 2);
                assertTrue(c.get("name"), c.get("name").startsWith("IMG_") || c.get("name").startsWith("doc "));
            }
        }
        assertEquals(50, files);
        q.remove(ids.subList(0, 60));
        assertEquals(40, q.list().size());
        q.remove(ids);
        assertEquals(0, q.list().size());
        String[] left = new File(dir, "files").list();
        assertEquals(0, left == null ? 0 : left.length);
    }

    @Test
    public void fileNamesWithAPathAreRefused() {
        for (String bad : new String[] {"../x", "a/b.jpg", "", "..\\x"}) {
            try {
                q.fileData(bad);
                fail(bad);
            } catch (IOException expected) {
                // refused
            }
        }
    }

    @Test
    public void jsonRoundTripsHebrewQuotesAndControlCharacters() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("id", "1");
        m.put("text", "שורה \"ציטוט\"\nשנייה\t\\ \u0001");
        assertEquals(m, CaptureQueue.parseJson(CaptureQueue.toJson(m)));
        assertEquals("{\"a\":\"\\u0001\"}", CaptureQueue.toJson(Collections.singletonMap("a", "\u0001")));
        assertEquals("x\u00e9", CaptureQueue.parseJson("{ \"a\" : \"x\\u00e9\" }").get("a"));
    }

    @Test
    public void aFileLargerThan25MbIsRefusedAndNothingIsQueued() {
        InputStream huge = new InputStream() {
            long left = CaptureQueue.MAX_FILE_BYTES + 1;

            @Override
            public int read() {
                return left-- > 0 ? 0 : -1;
            }

            @Override
            public int read(byte[] b, int off, int len) {
                if (left <= 0) return -1;
                int n = (int) Math.min(len, left);
                left -= n;
                return n;
            }
        };
        try {
            q.addFile(huge, "pdf", "application/pdf", "big.pdf", "", "share", null);
            fail("too big");
        } catch (IOException expected) {
            // refused
        }
        assertFalse(q.list().iterator().hasNext());
    }
}
