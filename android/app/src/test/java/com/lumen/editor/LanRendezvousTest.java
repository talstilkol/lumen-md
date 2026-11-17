package com.lumen.editor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import org.junit.Test;

/**
 * W10.E45 (plan W2.19): the Android rendezvous holds the desktop's rules,
 * case for case with src-tauri/lan-mdns/src/lib.rs's tests
 * (the_local_network_rule_matches_address_ts,
 * the_rendezvous_hands_the_offer_out_once_and_takes_one_answer_for_its_token,
 * codes_and_tokens), so a phone and a desktop accept and refuse the same peers
 * and lines. Pure Java: runs under `./gradlew test` and with plain javac + JUnit 4.
 */
public class LanRendezvousTest {
    private static final String OFFER = "lumen-lan:1:zOFFERabc_-123";
    private static final String ANSWER = "lumen-lan:1:zANSWERdef_-456";

    private static InetAddress ip(String s) throws Exception {
        return InetAddress.getByName(s); // a literal: no lookup
    }

    @Test
    public void theLocalNetworkRuleMatchesAddressTsAndTheRustHost() throws Exception {
        for (String ok : new String[] {"10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.3.4", "127.0.0.1", "::1", "fe80::1", "fd12::1", "::ffff:192.168.1.2"}) {
            assertTrue(ok, LanRendezvous.isLanAddress(ip(ok)));
        }
        // 100.64/10 (carrier-grade NAT) and fec0::/10 (old site-local) are refused, as on the desktop.
        for (String no : new String[] {"8.8.8.8", "172.32.0.1", "172.15.0.1", "192.0.2.2", "100.64.0.1", "100.127.255.254", "2001:db8::1", "::ffff:8.8.8.8", "fec0::1", "0.0.0.0", "::"}) {
            assertFalse(no, LanRendezvous.isLanAddress(ip(no)));
        }
        assertFalse(LanRendezvous.isLanAddress(null));
    }

    @Test
    public void theOfferGoesOutOnceAndOneAnswerIsTakenForItsToken() {
        LanRendezvous r = new LanRendezvous(OFFER, 0);
        String t = r.token;
        assertEquals("OK " + t + " " + OFFER, r.handle("LUMEN-LAN/1 OFFER\n", 1));
        assertEquals("ERR token", r.handle("LUMEN-LAN/1 ANSWER wrong " + ANSWER, 1));
        assertEquals("ERR bad", r.handle("LUMEN-LAN/1 ANSWER " + t + " not-a-code", 1));
        assertEquals("ERR bad", r.handle("LUMEN-LAN/2 ANSWER " + t + " " + ANSWER, 1));
        assertEquals("ERR bad", r.handle("LUMEN-LAN/1 ANSWER " + t + " " + ANSWER + " extra", 1));
        assertEquals("ERR bad", r.handle("LUMEN-LAN/1 OFFER ", 1));
        assertEquals("ERR bad", r.handle("", 1));
        assertEquals("OK", r.handle("LUMEN-LAN/1 ANSWER " + t + " " + ANSWER + "\r\n", 1));
        // Used up: no second answer, and the offer is no longer handed out, even after the answer was taken.
        assertEquals(ANSWER, r.takeAnswer());
        assertNull(r.takeAnswer());
        assertEquals("ERR used", r.handle("LUMEN-LAN/1 ANSWER " + t + " " + ANSWER, 1));
        assertEquals("ERR used", r.handle("LUMEN-LAN/1 OFFER", 1));
    }

    @Test
    public void anOfferLapsesAfterFiveMinutes() {
        LanRendezvous r = new LanRendezvous(OFFER, 1_000);
        assertEquals(5 * 60 * 1000, LanRendezvous.OFFER_TTL_MS);
        assertFalse(r.expired(1_000 + LanRendezvous.OFFER_TTL_MS));
        assertTrue(r.expired(1_001 + LanRendezvous.OFFER_TTL_MS));
        assertEquals("ERR used", r.handle("LUMEN-LAN/1 OFFER", 1_001 + LanRendezvous.OFFER_TTL_MS));
        assertEquals("ERR used", r.handle("LUMEN-LAN/1 ANSWER " + r.token + " " + ANSWER, 1_001 + LanRendezvous.OFFER_TTL_MS));
    }

    @Test
    public void codesTokensAndTheInstanceLabel() {
        assertTrue(LanRendezvous.isCode(OFFER));
        assertFalse(LanRendezvous.isCode("lumen-lan:1:"));
        assertFalse(LanRendezvous.isCode("lumen-lan:1:z abc"));
        assertFalse(LanRendezvous.isCode("lumen-lan:2:zabc"));
        assertFalse(LanRendezvous.isCode(null));
        StringBuilder big = new StringBuilder("lumen-lan:1:z");
        for (int i = 0; i < LanRendezvous.MAX_LINE; i++) big.append('a');
        assertFalse(LanRendezvous.isCode(big.toString()));
        LanRendezvous a = new LanRendezvous(OFFER, 0), b = new LanRendezvous(OFFER, 0);
        assertEquals(32, a.token.length());
        assertTrue(a.token.matches("[0-9a-f]{32}"));
        assertNotEquals(a.token, b.token);
        String l = LanRendezvous.instanceLabel();
        assertTrue(l, l.matches("Lumen-[A-Z2-9]{4}"));
        assertEquals("_lumen-lan._tcp", LanRendezvous.SERVICE_TYPE);
        assertEquals("LUMEN-LAN/1", LanRendezvous.PROTOCOL);
    }
}
