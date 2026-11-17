#!/usr/bin/env node
/**
 * A REAL diarization error rate (plan W10.B7, audit W2.7). The unit test
 * src/__tests__/diarize.test.ts runs the pipeline on stand-in networks
 * (fakeOrt) over audio built to match them, so its number only shows the
 * post-processing recovers the labels it was given. A DER needs real speech,
 * a real model and a human reference.
 *
 *   node scripts/eval/der.mjs --audio clip.wav --ref clip.rttm          run pyannote 3.1, then score
 *   node scripts/eval/der.mjs --hyp lumen.rttm --ref clip.rttm          score a hypothesis you already have
 *        [--collar 0.25] [--json]
 *
 * Public clips with human RTTM: VoxConverse dev/test (CC BY 4.0,
 * github.com/joonson/voxconverse; audio from robots.ox.ac.uk/~vgg/data/voxconverse)
 * or the AMI corpus (CC BY 4.0, groups.inf.ed.ac.uk/ami). Hebrew: the five
 * golden recordings of scripts/meetings/der.mjs once they exist.
 *
 * Running pyannote needs Python with pyannote.audio 3.1 and a Hugging Face
 * token that accepted pyannote/speaker-diarization-3.1's terms (HF_TOKEN).
 * Without them the script says DER is NOT measured and exits 3.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { der, parseRttm } from "../lib/der.mjs";

const PY = `
import sys
from pyannote.audio import Pipeline
import os
p = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=os.environ.get("HF_TOKEN"))
d = p(sys.argv[1])
with open(sys.argv[2], "w") as f:
    d.write_rttm(f)
`;

export function score(refText, hypText, collar = 0.25) {
  const r = der(parseRttm(refText), parseRttm(hypText), { collar });
  return { der: Math.round(r.der * 10000) / 10000, ...r };
}

function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const ref = opt("--ref");
  const collar = Number(opt("--collar") ?? 0.25);
  const json = argv.includes("--json");
  if (!ref || !existsSync(ref)) {
    console.error("usage: der.mjs (--audio clip.wav | --hyp hyp.rttm) --ref clip.rttm [--collar 0.25] [--json]");
    return 1;
  }
  let hyp = opt("--hyp");
  if (!hyp) {
    const audio = opt("--audio");
    if (!audio || !existsSync(audio)) {
      console.error("give --audio (to run pyannote) or --hyp (an RTTM to score)");
      return 1;
    }
    const dir = mkdtempSync(join(tmpdir(), "der-"));
    const script = join(dir, "run.py");
    hyp = join(dir, "hyp.rttm");
    writeFileSync(script, PY);
    const r = spawnSync(process.env.PYTHON ?? "python3", [script, audio, hyp], { encoding: "utf8", env: process.env });
    if (r.status !== 0 || !existsSync(hyp)) {
      const why = (r.error?.message ?? r.stderr ?? "").split("\n").filter(Boolean).slice(-1)[0] ?? "unknown error";
      console.log(json ? JSON.stringify({ status: "not-measured", reason: why }) : `DER NOT measured: pyannote did not run (${why}). Needs Python + pyannote.audio 3.1 and HF_TOKEN.`);
      return 3;
    }
  }
  const s = score(readFileSync(ref, "utf8"), readFileSync(hyp, "utf8"), collar);
  if (json) console.log(JSON.stringify({ status: "measured", collar, ...s }));
  else console.log(`DER ${(s.der * 100).toFixed(2)}% (collar ${collar}s; ref ${ref}, hyp ${hyp})`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
