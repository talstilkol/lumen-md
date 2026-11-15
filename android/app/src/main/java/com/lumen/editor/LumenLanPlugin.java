package com.lumen.editor;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * LAN discovery on Android (plan W2.19 step 1, W10.E45): the native half of
 * src/sync/e2ee/lan/nativeDiscovery.ts, as the Capacitor plugin {@code LumenLan}.
 * NsdManager announces and finds {@code _lumen-lan._tcp} (multicast DNS / DNS-SD, the
 * desktop's src-tauri/lan-mdns speaks the same), and a ServerSocket serves the
 * LUMEN-LAN/1 rendezvous (LanRendezvous). Only the pairing code and its token
 * pass here. The link itself is WebRTC, made in the WebView (lan/link.ts).
 */
@CapacitorPlugin(name = "LumenLan")
public class LumenLanPlugin extends Plugin {
    private static final int IO_TIMEOUT_MS = 3000;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private NsdManager nsd;
    private NsdManager.RegistrationListener registration;
    private ServerSocket server;
    private LanRendezvous rendezvous;

    @Override
    public void load() {
        nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
    }

    @PluginMethod
    public void host(PluginCall call) {
        String offer = call.getString("offer");
        if (!LanRendezvous.isCode(offer)) {
            call.reject("bad");
            return;
        }
        stopHosting();
        try {
            server = new ServerSocket(0);
        } catch (Exception e) {
            call.reject("failed: " + e.getMessage());
            return;
        }
        rendezvous = new LanRendezvous(offer, System.currentTimeMillis());
        final ServerSocket s = server;
        final LanRendezvous r = rendezvous;
        final AtomicInteger open = new AtomicInteger();
        io.execute(() -> {
            while (!s.isClosed()) {
                try {
                    Socket c = s.accept();
                    if (!LanRendezvous.isLanAddress(c.getInetAddress()) || open.incrementAndGet() > LanRendezvous.MAX_CONNECTIONS) {
                        if (LanRendezvous.isLanAddress(c.getInetAddress())) open.decrementAndGet();
                        c.close();
                        continue;
                    }
                    io.execute(() -> {
                        try (Socket conn = c) {
                            conn.setSoTimeout(IO_TIMEOUT_MS);
                            String line = readLine(conn);
                            String reply = line == null ? "ERR bad" : r.handle(line, System.currentTimeMillis());
                            OutputStream out = conn.getOutputStream();
                            out.write((reply + "\n").getBytes(StandardCharsets.UTF_8));
                            out.flush();
                        } catch (Exception ignored) {
                            // why: a peer that drops or stalls gets nothing; the offer stays for the next one
                        } finally {
                            open.decrementAndGet();
                        }
                    });
                } catch (Exception e) {
                    return; // closed by stop()
                }
            }
        });
        final String label = LanRendezvous.instanceLabel();
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(label);
        info.setServiceType(LanRendezvous.SERVICE_TYPE);
        info.setPort(s.getLocalPort());
        registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo i) {}
            @Override public void onRegistrationFailed(NsdServiceInfo i, int code) {}
            @Override public void onServiceUnregistered(NsdServiceInfo i) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo i, int code) {}
        };
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration);
        JSObject ret = new JSObject();
        ret.put("name", label);
        call.resolve(ret);
    }

    @PluginMethod
    public void answer(PluginCall call) {
        JSObject ret = new JSObject();
        LanRendezvous r = rendezvous;
        if (r == null) {
            ret.put("answer", null);
        } else if (r.expired(System.currentTimeMillis())) {
            stopHosting();
            ret.put("expired", true);
            ret.put("answer", null);
        } else {
            String a = r.takeAnswer();
            ret.put("answer", a);
            if (a != null) stopHosting();
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopHosting();
        call.resolve();
    }

    private synchronized void stopHosting() {
        if (registration != null) {
            try {
                nsd.unregisterService(registration);
            } catch (Exception ignored) {
                // why: already unregistered
            }
            registration = null;
        }
        if (server != null) {
            try {
                server.close();
            } catch (Exception ignored) {
                // why: closing a closed socket
            }
            server = null;
        }
        rendezvous = null;
    }

    @PluginMethod
    public void browse(PluginCall call) {
        final int ms = Math.max(500, Math.min(10_000, call.getInt("ms", 2500)));
        final List<JSObject> found = new ArrayList<>();
        final ArrayDeque<NsdServiceInfo> toResolve = new ArrayDeque<>();
        final boolean[] resolving = { false };
        final Runnable[] next = new Runnable[1];
        // One resolve at a time: NsdManager refuses a second concurrent resolve before API 34.
        next[0] = () -> {
            NsdServiceInfo i;
            synchronized (toResolve) {
                if (resolving[0] || toResolve.isEmpty()) return;
                resolving[0] = true;
                i = toResolve.poll();
            }
            nsd.resolveService(i, new NsdManager.ResolveListener() {
                @Override
                public void onServiceResolved(NsdServiceInfo r) {
                    InetAddress host = r.getHost();
                    if (host != null && LanRendezvous.isLanAddress(host)) {
                        JSObject d = new JSObject();
                        d.put("name", r.getServiceName());
                        d.put("host", host.getHostAddress().replaceAll("%.*$", ""));
                        d.put("port", r.getPort());
                        synchronized (found) {
                            found.add(d);
                        }
                    }
                    done();
                }

                @Override
                public void onResolveFailed(NsdServiceInfo r, int code) {
                    done();
                }

                private void done() {
                    synchronized (toResolve) {
                        resolving[0] = false;
                    }
                    next[0].run();
                }
            });
        };
        final NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int code) {}
            @Override public void onStopDiscoveryFailed(String t, int code) {}
            @Override public void onDiscoveryStarted(String t) {}
            @Override public void onDiscoveryStopped(String t) {}
            @Override public void onServiceLost(NsdServiceInfo i) {}

            @Override
            public void onServiceFound(NsdServiceInfo i) {
                if (!i.getServiceName().matches("^Lumen-[A-Z0-9]{4}$")) return;
                synchronized (toResolve) {
                    toResolve.add(i);
                }
                next[0].run();
            }
        };
        nsd.discoverServices(LanRendezvous.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
        io.execute(() -> {
            try {
                Thread.sleep(ms);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            try {
                nsd.stopServiceDiscovery(listener);
            } catch (Exception ignored) {
                // why: discovery never started (no Wi-Fi)
            }
            JSArray devices = new JSArray();
            synchronized (found) {
                for (JSObject d : found) devices.put(d);
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void fetchOffer(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 0);
        io.execute(() -> {
            try {
                String reply = ask(host, port, LanRendezvous.PROTOCOL + " OFFER");
                String[] p = reply.split(" ", 3);
                if (p.length == 3 && "OK".equals(p[0]) && LanRendezvous.isCode(p[2])) {
                    JSObject ret = new JSObject();
                    ret.put("token", p[1]);
                    ret.put("offer", p[2]);
                    call.resolve(ret);
                } else call.reject(refused(reply));
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "failed");
            }
        });
    }

    @PluginMethod
    public void sendAnswer(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 0);
        String token = call.getString("token", "");
        String answer = call.getString("answer");
        if (!LanRendezvous.isCode(answer) || token.contains(" ")) {
            call.reject("bad");
            return;
        }
        io.execute(() -> {
            try {
                String reply = ask(host, port, LanRendezvous.PROTOCOL + " ANSWER " + token + " " + answer);
                if ("OK".equals(reply)) call.resolve();
                else call.reject(refused(reply));
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "failed");
            }
        });
    }

    /** "ERR used" → "used": the reason discovery.ts reads. */
    private static String refused(String reply) {
        return reply.startsWith("ERR ") ? reply.substring(4) : "failed";
    }

    private static String ask(String host, int port, String line) throws Exception {
        InetAddress addr = InetAddress.getByName(host);
        if (!LanRendezvous.isLanAddress(addr)) throw new Exception("not-lan");
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(addr, port), IO_TIMEOUT_MS);
            s.setSoTimeout(IO_TIMEOUT_MS);
            OutputStream out = s.getOutputStream();
            out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            String reply = readLine(s);
            if (reply == null) throw new Exception("failed");
            return reply;
        }
    }

    private static String readLine(Socket s) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8), 4096);
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1 && c != '\n') {
            if (sb.length() >= LanRendezvous.MAX_LINE) return null;
            sb.append((char) c);
        }
        return c == -1 && sb.length() == 0 ? null : sb.toString();
    }

    @Override
    protected void handleOnDestroy() {
        stopHosting();
        io.shutdownNow();
    }
}
