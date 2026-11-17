/**
 * Which embeds are audio or video (plan W12.F8). Its own module so the
 * Markdown pipeline (renderer/remarkObsidian.ts, on the startup path) can
 * test a target without loading the WebVTT code (./webvtt).
 */
export const MEDIA_EXT = /\.(m4a|mp3|wav|ogg|oga|opus|flac|aac|webm|mp4|m4v|mov|ogv|mkv)$/i;
/** Shown as a video; `.webm` stays audio, since that is what the app records (a <audio> plays it either way). */
export const VIDEO_EXT = /\.(mp4|m4v|mov|ogv|mkv)$/i;
