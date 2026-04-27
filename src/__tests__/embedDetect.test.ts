/**
 * Tests for `detectEmbed` — the regex pipeline used by both EmbedBlock
 * (renderer) and the source-editor's hint extension.
 *
 * Each platform is tested with the exact iconic URL referenced from the
 * Welcome.md tour, plus at least one negative example (so we don't
 * over-eagerly flag random URLs as embeddable).
 */

import { describe, it, expect } from "vitest";
import { detectEmbed } from "../data/embedDetect";

describe("detectEmbed — iconic public URLs from Welcome.md", () => {
  const cases: { name: string; url: string; platform: string }[] = [
    {
      name: "YouTube · Rick Astley — Never Gonna Give You Up",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      platform: "YouTube",
    },
    {
      name: "Vimeo · 'Move' by Rick Mereki",
      url: "https://vimeo.com/22439234",
      platform: "Vimeo",
    },
    {
      name: "Loom · product walkthrough",
      url: "https://www.loom.com/share/c43a642f815f4378b6f80a889bb73d8d",
      platform: "Loom",
    },
    {
      name: "Spotify · Bohemian Rhapsody",
      url: "https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb",
      platform: "Spotify",
    },
    {
      name: "SoundCloud · Forss / Flickermood",
      url: "https://soundcloud.com/forss/flickermood",
      platform: "SoundCloud",
    },
    {
      name: "CodePen · Hakim El Hattab",
      url: "https://codepen.io/hakimel/pen/BKyJpM",
      platform: "CodePen",
    },
    {
      name: "CodeSandbox · new",
      url: "https://codesandbox.io/s/new",
      platform: "CodeSandbox",
    },
    {
      name: "Figma Community · iOS 18 UI Kit",
      url: "https://www.figma.com/community/file/1394965242715869180",
      platform: "Figma",
    },
    {
      name: "Google Maps · Eiffel Tower",
      url: "https://www.google.com/maps/place/Eiffel+Tower",
      platform: "Google Maps",
    },
    {
      name: "OpenStreetMap · Times Square",
      url: "https://www.openstreetmap.org/#map=18/40.7580/-73.9855",
      platform: "OpenStreetMap",
    },
    {
      name: "Twitter · Elon Musk 'the bird is freed'",
      url: "https://twitter.com/elonmusk/status/1585841080431321088",
      platform: "X / Twitter",
    },
    {
      name: "Twitter · Jack's first tweet",
      url: "https://twitter.com/jack/status/20",
      platform: "X / Twitter",
    },
    {
      name: "X.com · same URL on the new domain",
      url: "https://x.com/elonmusk/status/1585841080431321088",
      platform: "X / Twitter",
    },
    {
      name: "Facebook · NASA post",
      url: "https://www.facebook.com/NASA/posts/10168891891030772",
      platform: "Facebook",
    },
    {
      name: "Instagram · world_record_egg",
      url: "https://www.instagram.com/p/BsOGulcndj-/",
      platform: "Instagram",
    },
    {
      name: "TikTok · Bella Poarch — M to the B",
      url: "https://www.tiktok.com/@bellapoarch/video/6862153058223197445",
      platform: "TikTok",
    },
    {
      name: "Reddit · Bill Gates IAmA",
      url: "https://www.reddit.com/r/IAmA/comments/6byns4/i_am_bill_gates_cochair_of_the_bill_melinda_gates/",
      platform: "Reddit",
    },
    {
      name: "LinkedIn · Reid Hoffman post (regular post URL)",
      url: "https://www.linkedin.com/posts/reidhoffman_the-future-of-work-activity-7050231856721895424-Cf2T",
      platform: "LinkedIn",
    },
    {
      name: "LinkedIn · embed-share URL form",
      url: "https://www.linkedin.com/embed/feed/update/urn:li:share:7050231856721895424",
      platform: "LinkedIn",
    },
    {
      name: "GitHub Gist · octocat sample",
      url: "https://gist.github.com/octocat/6cad326836d38bd3a7ae",
      platform: "GitHub Gist",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(detectEmbed(c.url)).toBe(c.platform);
    });
  }
});

describe("detectEmbed — negative cases", () => {
  it("returns null for a plain example URL", () => {
    expect(detectEmbed("https://example.com/foo")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(detectEmbed("")).toBeNull();
  });

  it("returns null for a YouTube channel URL (not a watchable video)", () => {
    expect(detectEmbed("https://www.youtube.com/@SomeChannel")).toBeNull();
  });

  it("returns null for a Twitter profile URL (no /status/ID)", () => {
    expect(detectEmbed("https://twitter.com/elonmusk")).toBeNull();
  });

  it("returns null for a Reddit subreddit URL (no /comments/)", () => {
    expect(detectEmbed("https://www.reddit.com/r/programming")).toBeNull();
  });

  it("returns null for a bare LinkedIn profile (no /posts/ or /embed/)", () => {
    expect(detectEmbed("https://www.linkedin.com/in/reidhoffman")).toBeNull();
  });

  it("trims whitespace before matching", () => {
    expect(detectEmbed("  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ")).toBe(
      "YouTube",
    );
  });
});
