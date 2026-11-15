package com.lumen.editor;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;

/**
 * The capture queue on Android (plans W11.P8, W11.P10): what the share sheet
 * and the Quick Settings tile capture waits here until the WebView adds it to
 * inbox.md (src/mobile/captureQueue.ts, the same JSON shape as iOS's
 * CaptureQueue.swift).
 *
 * <p>Every capture is its own JSON file in the app's private files folder. It
 * is written to a temporary name and moved into place atomically, so a kill
 * during the write leaves only a {@code .tmp} file that is never listed, and
 * two writers can't drop each other's capture (no shared list is rewritten).
 * A shared file is copied in first; its JSON, written last, is the commit
 * point.
 *
 * <p>Plain Java (java.io only: java.nio.file needs API 26 and the app supports
 * 24), so it is compiled and its tests run without the Android SDK
 * (tools/native-check, CaptureQueueTest).
 */
public final class CaptureQueue {
    public static final int MAX_TEXT = 8192;
    public static final int MAX_ITEMS = 500;
    public static final long MAX_FILE_BYTES = 25L * 1024 * 1024;

    private final File dir;
    private final File files;

    public CaptureQueue(File dir) {
        this.dir = dir;
        this.files = new File(dir, "files");
    }

    private void ensure() throws IOException {
        if (!files.isDirectory() && !files.mkdirs() && !files.isDirectory()) throw new IOException("cannot create " + files);
    }

    /**
     * Write bytes to {@code dest} through a temporary file, flushed to disk,
     * then renamed: rename(2) within one folder is atomic, so {@code dest} is
     * either absent or complete.
     */
    static void writeAtomic(File dest, byte[] data) throws IOException {
        File tmp = new File(dest.getParentFile(), dest.getName() + "." + UUID.randomUUID() + ".tmp");
        try {
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data);
                out.getFD().sync();
            }
            if (!tmp.renameTo(dest)) throw new IOException("cannot move " + tmp + " to " + dest);
        } finally {
            if (tmp.exists() && !tmp.delete()) tmp.deleteOnExit();
        }
    }

    static byte[] readAll(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            return buf.toByteArray();
        }
    }

    private static String now() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    private static boolean isWebUrl(String s) {
        return (s.startsWith("https://") || s.startsWith("http://")) && s.length() > 8 && s.chars().noneMatch(Character::isWhitespace);
    }

    /** Add one capture; the queue's file name sorts by time. Returns the capture as written. */
    public Map<String, String> add(Map<String, String> capture) throws IOException {
        ensure();
        if (list().size() >= MAX_ITEMS) throw new IOException("the capture queue is full");
        Map<String, String> c = new LinkedHashMap<>(capture);
        String text = c.getOrDefault("text", "");
        if (text.length() > MAX_TEXT) c.put("text", text.substring(0, MAX_TEXT));
        String name = String.format(Locale.ROOT, "%013d-%s.json", System.currentTimeMillis(), c.get("id"));
        writeAtomic(new File(dir, name), toJson(c).getBytes(StandardCharsets.UTF_8));
        return c;
    }

    private static Map<String, String> base(String kind, String text, String source, String app) {
        Map<String, String> c = new LinkedHashMap<>();
        c.put("id", UUID.randomUUID().toString().toUpperCase());
        c.put("kind", kind);
        c.put("text", text == null ? "" : text.trim());
        c.put("at", now());
        c.put("source", source);
        if (app != null && !app.isEmpty()) c.put("app", app);
        return c;
    }

    /** Text, or a link when the text is only a web address. Null when there is nothing to add. */
    public Map<String, String> addText(String text, String source, String app) throws IOException {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) return null;
        if (isWebUrl(t)) return addLink(t, "", source, app);
        return add(base("text", t, source, app));
    }

    public Map<String, String> addLink(String url, String title, String source, String app) throws IOException {
        if (!isWebUrl(url)) throw new IOException("not a web link");
        Map<String, String> c = base("url", title, source, app);
        c.put("url", url);
        return add(c);
    }

    /** Copy a shared image or PDF in, then commit its capture. The copy is removed if the commit fails. */
    public Map<String, String> addFile(InputStream in, String kind, String mime, String name, String caption, String source, String app) throws IOException {
        if (!"image".equals(kind) && !"pdf".equals(kind)) throw new IOException("not an image or a PDF");
        ensure();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[64 * 1024];
        for (int n; (n = in.read(chunk)) > 0; ) {
            buf.write(chunk, 0, n);
            if (buf.size() > MAX_FILE_BYTES) throw new IOException("the file is larger than 25 MB");
        }
        Map<String, String> c = base(kind, caption, source, app);
        String ext = extension(name, mime, kind);
        String stored = c.get("id") + "." + ext;
        File dest = new File(files, stored);
        writeAtomic(dest, buf.toByteArray());
        c.put("file", stored);
        if (mime != null) c.put("mime", mime);
        if (name != null && !name.isEmpty()) c.put("name", name);
        try {
            return add(c);
        } catch (IOException e) {
            if (!dest.delete()) dest.deleteOnExit();
            throw e;
        }
    }

    static String extension(String name, String mime, String kind) {
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1) {
                String e = name.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (e.matches("[a-z0-9]{1,8}")) return e;
            }
        }
        if ("application/pdf".equals(mime) || "pdf".equals(kind)) return "pdf";
        if ("image/png".equals(mime)) return "png";
        if ("image/webp".equals(mime)) return "webp";
        if ("image/heic".equals(mime)) return "heic";
        return "jpg";
    }

    /** Every complete capture, oldest first. Temporary and unreadable files are skipped (and kept). */
    public List<Map<String, String>> list() {
        List<Map<String, String>> out = new ArrayList<>();
        String[] names = dir.list();
        if (names == null) return out;
        Arrays.sort(names);
        for (String n : names) {
            if (!n.endsWith(".json")) continue;
            try {
                Map<String, String> c = parseJson(new String(readAll(new File(dir, n)), StandardCharsets.UTF_8));
                if (c.containsKey("id")) out.add(c);
            } catch (IOException | IllegalArgumentException e) {
                // a file this version can't read stays for a later one
            }
        }
        return out;
    }

    /** A queued file's bytes, by its stored name (no folders). */
    public byte[] fileData(String stored) throws IOException {
        if (stored == null || stored.isEmpty() || stored.contains("/") || stored.contains("\\") || stored.contains("..")) throw new IOException("bad file name");
        return readAll(new File(files, stored));
    }

    /** Remove captures the WebView has added (and journaled): the JSON, then its file. */
    public void remove(Collection<String> ids) {
        Set<String> drop = new HashSet<>(ids);
        String[] names = dir.list();
        if (names == null) return;
        for (String n : names) {
            if (!n.endsWith(".json")) continue;
            File f = new File(dir, n);
            try {
                Map<String, String> c = parseJson(new String(readAll(f), StandardCharsets.UTF_8));
                if (!drop.contains(c.get("id"))) continue;
                if (!f.delete()) continue;
                String stored = c.get("file");
                if (stored != null && !stored.contains("/") && !stored.contains("..")) {
                    File data = new File(files, stored);
                    if (data.exists() && !data.delete()) data.deleteOnExit();
                }
            } catch (IOException | IllegalArgumentException e) {
                // leave it
            }
        }
    }

    // ── A flat JSON object of strings: all the queue needs ──────────────

    public static String toJson(Map<String, String> m) {
        StringBuilder b = new StringBuilder("{");
        for (Map.Entry<String, String> e : m.entrySet()) {
            if (b.length() > 1) b.append(',');
            quote(b, e.getKey());
            b.append(':');
            quote(b, e.getValue());
        }
        return b.append('}').toString();
    }

    private static void quote(StringBuilder b, String s) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (ch < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) ch));
                    else b.append(ch);
            }
        }
        b.append('"');
    }

    /** Parse what {@link #toJson} writes (and any flat JSON object of strings). */
    public static Map<String, String> parseJson(String s) {
        Map<String, String> m = new LinkedHashMap<>();
        int[] i = {skip(s, 0)};
        expect(s, i, '{');
        if (peek(s, i) == '}') return m;
        while (true) {
            String k = str(s, i);
            expect(s, i, ':');
            m.put(k, str(s, i));
            char c = next(s, i);
            if (c == '}') break;
            if (c != ',') throw new IllegalArgumentException("',' expected");
        }
        return m;
    }

    private static int skip(String s, int i) {
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        return i;
    }

    private static char peek(String s, int[] i) {
        i[0] = skip(s, i[0]);
        if (i[0] >= s.length()) throw new IllegalArgumentException("unexpected end");
        return s.charAt(i[0]);
    }

    private static char next(String s, int[] i) {
        char c = peek(s, i);
        i[0]++;
        return c;
    }

    private static void expect(String s, int[] i, char want) {
        if (next(s, i) != want) throw new IllegalArgumentException("'" + want + "' expected");
    }

    private static String str(String s, int[] i) {
        expect(s, i, '"');
        StringBuilder b = new StringBuilder();
        while (true) {
            if (i[0] >= s.length()) throw new IllegalArgumentException("unterminated string");
            char c = s.charAt(i[0]++);
            if (c == '"') return b.toString();
            if (c != '\\') {
                b.append(c);
                continue;
            }
            if (i[0] >= s.length()) throw new IllegalArgumentException("bad escape");
            char e = s.charAt(i[0]++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 'r': b.append('\r'); break;
                case 't': b.append('\t'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u':
                    if (i[0] + 4 > s.length()) throw new IllegalArgumentException("bad escape");
                    b.append((char) Integer.parseInt(s.substring(i[0], i[0] + 4), 16));
                    i[0] += 4;
                    break;
                default: b.append(e);
            }
        }
    }
}
