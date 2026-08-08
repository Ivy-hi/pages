import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const plog = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/plog" }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			lang: z.enum(["en", "zh-CN"]).default("en"),
			cover: image(),
			coverAlt: z.string(),
			draft: z.boolean().default(false),
		}),
});

export const collections = { plog };
