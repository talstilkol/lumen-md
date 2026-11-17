package com.lumen.editor;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * The LUMEN-LAN/1 rendezvous (plan W2.19, W10.E45), as the desktop's
 * src-tauri/lan-mdns speaks it, so a phone and a desktop pair either way:
 *
 *   → LUMEN-LAN/1 OFFER                   ← OK &lt;token&gt; &lt;offer code&gt;     | ERR used
 *   → LUMEN-LAN/1 ANSWER &lt;token&gt; &lt;code&gt;   ← OK                          | ERR token | ERR used | ERR bad
 *
 * One pairing at a time. The first good answer uses the offer up, and the
 * offer lapses after five minutes. Pure (no Android API), so it holds the
 * same rules as the Rust side line for line.
 */
final class LanRendezvous {
    static final String PROTOCOL = "LUMEN-LAN/1";
    static final String SERVICE_TYPE = "_lumen-lan._tcp";
    static final String CODE_PREFIX = "lumen-lan:1:";
    static final int MAX_LINE = 64 * 1024;
    static final long OFFER_TTL_MS = 5 * 60 * 1000;
    static final int MAX_CONNECTIONS = 8;
    private static final String ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
    private static final SecureRandom RNG = new SecureRandom();

    final String token;
    private final String offer;
    private final long started;
    private String answer;
    private boolean used;

    LanRendezvous(String offer, long now) {
        this.offer = offer;
        this.started = now;
        byte[] b = new byte[16];
        RNG.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        this.token = sb.toString();
    }

    static boolean isCode(String s) {
        if (s == null || !s.startsWith(CODE_PREFIX) || s.length() >= 60_000) return false;
        String rest = s.substring(CODE_PREFIX.length());
        return !rest.isEmpty() && rest.matches("[A-Za-z0-9_-]+");
    }

    /** "Lumen-" and four letters or digits: nothing about the user or the vault. */
    static String instanceLabel() {
        StringBuilder sb = new StringBuilder("Lumen-");
        for (int i = 0; i < 4; i++) sb.append(ALPHABET.charAt(RNG.nextInt(ALPHABET.length())));
        return sb.toString();
    }

    /**
     * Private, link-local or loopback: the only peers the rendezvous talks to.
     * The same rule as src/sync/e2ee/lan/address.ts and src-tauri/lan-mdns
     * (net::is_lan_ip): IPv4 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8;
     * IPv6 ::1, fe80::/10, fc00::/7; an IPv4-mapped address by its IPv4 rule
     * (Java hands those over as Inet4Address). Carrier-grade NAT (100.64/10)
     * is refused, as on the desktop: it is a carrier's network, not the
     * user's. So is IPv6 site-local (fec0::/10, deprecated), which Java's
     * isSiteLocalAddress would let through.
     */
    static boolean isLanAddress(InetAddress a) {
        if (a == null || a.isAnyLocalAddress()) return false;
        if (a.isLoopbackAddress()) return true;
        byte[] b = a.getAddress();
        if (a instanceof Inet4Address) {
            int x = b[0] & 0xff, y = b[1] & 0xff;
            return x == 10 || x == 127 || (x == 172 && y >= 16 && y <= 31) || (x == 192 && y == 168) || (x == 169 && y == 254);
        }
        if (a instanceof Inet6Address) {
            if ((b[0] & 0xff) == 0xfe && (b[1] & 0xc0) == 0x80) return true; // fe80::/10
            return (b[0] & 0xfe) == 0xfc; // fc00::/7
        }
        return false;
    }

    synchronized boolean expired(long now) {
        return now - started > OFFER_TTL_MS;
    }

    synchronized String takeAnswer() {
        String a = answer;
        answer = null;
        return a;
    }

    /** One request line → its reply line (without the newline). */
    synchronized String handle(String line, long now) {
        String l = line.replaceAll("[\r\n]+$", "");
        String[] p = l.split(" ", -1);
        if (p.length == 0 || !PROTOCOL.equals(p[0])) return "ERR bad";
        if (p.length == 2 && "OFFER".equals(p[1])) return used || expired(now) ? "ERR used" : "OK " + token + " " + offer;
        if (p.length == 4 && "ANSWER".equals(p[1])) {
            if (used || expired(now)) return "ERR used";
            if (!MessageDigest.isEqual(p[2].getBytes(), token.getBytes())) return "ERR token";
            if (!isCode(p[3])) return "ERR bad";
            answer = p[3];
            used = true;
            return "OK";
        }
        return "ERR bad";
    }
}
