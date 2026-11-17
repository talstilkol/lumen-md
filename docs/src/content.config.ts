import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // W13.D1 / W13.D2 (scripts/lib/docsMeta.mjs): the Diátaxis kind of every page,
      // and the plan tasks a feature page documents (or why it has none).
      extend: z.object({
        type: z.enum(["tutorial", "how-to", "reference", "explanation"]).optional(),
        tasks: z.array(z.string()).optional(),
        untracked: z.string().optional(),
      }),
    }),
  }),
};
