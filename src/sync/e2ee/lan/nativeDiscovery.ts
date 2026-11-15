/**
 * LAN discovery on the phone (plan W2.19 step 1, W10.E45): the mobile half of
 * the seam in ./discovery.ts. The desktop app answers the six `lan_discovery_*`
 * commands from Rust (src-tauri/lan-mdns). The iOS and Android apps answer the
 * same six from the Capacitor plugin `LumenLan`:
 *  - Android: android/…/LumenLanPlugin.java, with NsdManager and a ServerSocket.
 *  - iOS: ios/App/App/LanDiscovery.swift, with Network.framework (NWListener
 *    advertising Bonjour, NWBrowser, NWConnection).
 * The wire is the same everywhere: `_lumen-lan._tcp` over multicast DNS, a
 * `Lumen-XXXX` instance name, and the one-line LUMEN-LAN/1 rendezvous (OFFER /
 * ANSWER with a token). So a phone pairs with a desktop as well as with
 * another phone.
 *
 * This file only maps the commands onto the plugin's methods and back to the
 * shapes discovery.ts checks. Every address and code is still checked there.
 */
import type { Invoke } from "./discovery";

export interface LumenLanPlugin {
  host(o: { offer: string }): Promise<{ name: string }>;
  answer(): Promise<{ answer: string | null; expired?: boolean }>;
  stop(): Promise<void>;
  browse(o: { ms: number }): Promise<{ devices: Array<{ name: string; host: string; port: number }> }>;
  fetchOffer(o: { host: string; port: number }): Promise<{ token: string; offer: string }>;
  sendAnswer(o: { host: string; port: number; token: string; answer: string }): Promise<void>;
}

/** True in the iOS / Android app (Capacitor's native platform). */
export function nativeLanAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean } }).Capacitor;
  return !!c?.isNativePlatform?.() && (c.isPluginAvailable ? c.isPluginAvailable("LumenLan") : true);
}

/** The six desktop commands, answered by the plugin, in the desktop's shapes (Tauri's errors are strings; so are these). */
export function capacitorInvoke(plugin: LumenLanPlugin): Invoke {
  const call = async <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
    try {
      switch (cmd) {
        case "lan_discovery_host":
          return (await plugin.host({ offer: String(args.offer) })) as T;
        case "lan_discovery_answer": {
          const r = await plugin.answer();
          if (r.expired) throw new Error("expired");
          return (r.answer ?? null) as T;
        }
        case "lan_discovery_stop":
          await plugin.stop();
          return undefined as T;
        case "lan_discovery_browse":
          return (await plugin.browse({ ms: Number(args.ms) })).devices as T;
        case "lan_discovery_fetch_offer":
          return (await plugin.fetchOffer({ host: String(args.host), port: Number(args.port) })) as T;
        case "lan_discovery_send_answer":
          await plugin.sendAnswer({ host: String(args.host), port: Number(args.port), token: String(args.token), answer: String(args.answer) });
          return undefined as T;
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    } catch (e) {
      // Same as Tauri: the message is the reason ("used", "token", "not-lan", "expired", …).
      throw new Error(String((e as { message?: unknown })?.message ?? e));
    }
  };
  return call as Invoke;
}

/** The plugin, registered on first use. */
export async function lumenLanPlugin(): Promise<LumenLanPlugin> {
  return (await import("@capacitor/core")).registerPlugin<LumenLanPlugin>("LumenLan");
}
