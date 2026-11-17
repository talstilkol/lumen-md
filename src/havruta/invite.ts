/**
 * Inviting a partner to a study room (plan W12.H1): a link or a QR code,
 * no account. Like a shared note's link, the room's password travels only
 * in the URL fragment (`#havruta=<room>&password=<pw>`), which the browser
 * never sends to a server; the reference is not in the link at all — the
 * partner reads it from the encrypted room.
 */
import { encodeQr, qrPath } from "../lib/qr";
import { HAVRUTA_ROOM_PREFIX } from "./room";

const ROOM = /^havruta-[0-9a-f]{32}$/;

export function havrutaInviteLink(base: string, room: string, password: string): string {
  if (!ROOM.test(room)) throw new Error("not a study room");
  return `${base.replace(/#.*$/, "")}#havruta=${room}&password=${encodeURIComponent(password)}`;
}

/** The room and password of an invite link (or of the address bar's fragment), or null. */
export function readHavrutaInvite(urlOrHash: string): { room: string; password: string } | null {
  const hash = urlOrHash.includes("#") ? urlOrHash.slice(urlOrHash.indexOf("#")) : urlOrHash;
  const room = /[#&]havruta=([\w-]+)/.exec(hash)?.[1];
  const pw = /[#&]password=([^&]+)/.exec(hash)?.[1];
  if (!room || !ROOM.test(room) || !pw) return null;
  try {
    return { room, password: decodeURIComponent(pw) };
  } catch {
    return null;
  }
}

/** The invite as a QR code: an SVG path and its size (for the share dialog). */
export function havrutaInviteQr(link: string): { d: string; size: number } {
  const qr = encodeQr(link, "M");
  return { d: qrPath(qr), size: qr.size + 8 };
}

export const isHavrutaRoom = (name: string) => name.startsWith(HAVRUTA_ROOM_PREFIX) && ROOM.test(name);
