import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default('The Allyfolio team'),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    lang: z.enum(['en', 'zh-CN']).default('en'),
  }),
});

export const collections = { blog };
