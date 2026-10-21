import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '../core/logger';
import { paths } from '../core/paths';

export const CatalogRecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  category: z.enum(['Application', 'Storage', 'AI & ML', 'Database', 'Tools', 'Web']),
  description: z.string(),
  icon: z.string().default('Boxes'),
  runtime: z.enum(['node', 'python', 'go', 'static', 'native']),
  source: z
    .object({
      type: z.enum(['git', 'archive', 'binary']),
      url: z.string().optional(),
      sha256: z.string().optional(),
    })
    .optional(),
  spec: z.object({
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    buildCommand: z.string().optional(),
    startCommand: z.string().optional(),
    healthPath: z.string().default('/'),
    maxMemoryMb: z.number().default(512),
  }),
  defaultPort: z.number(),
  defaultSubdomain: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  docs: z.string().optional(),
  badge: z.string().optional(),
  isPackaged: z.boolean().default(false),
});

export type CatalogRecipe = z.infer<typeof CatalogRecipeSchema>;

export class CatalogManager {
  private catalogDir: string;
  private recipesCache: Map<string, CatalogRecipe> = new Map();

  constructor(customCatalogDir?: string) {
    this.catalogDir = customCatalogDir || path.resolve(process.cwd(), 'catalog');
    this.reload();
  }

  /**
   * Reload all JSON recipes from catalog/ directory with strict Zod validation
   */
  public reload(): void {
    this.recipesCache.clear();

    if (!fs.existsSync(this.catalogDir)) {
      try {
        fs.mkdirSync(this.catalogDir, { recursive: true });
      } catch {}
      return;
    }

    const files = fs.readdirSync(this.catalogDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const fullPath = path.join(this.catalogDir, file);
        try {
          const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          const validated = CatalogRecipeSchema.parse(raw);
          this.recipesCache.set(validated.id, validated);
        } catch (err: any) {
          logger.warn('catalog-manager', `Invalid recipe in ${file}: ${err.message}`);
        }
      }
    }

    logger.info('catalog-manager', `Loaded ${this.recipesCache.size} validated catalog recipes from ${this.catalogDir}`);
  }

  /**
   * Get all available catalog recipes
   */
  public getRecipes(): CatalogRecipe[] {
    if (this.recipesCache.size === 0) {
      this.reload();
    }
    return Array.from(this.recipesCache.values());
  }

  /**
   * Get recipe by id
   */
  public getRecipe(id: string): CatalogRecipe | undefined {
    return this.recipesCache.get(id);
  }
}

export const catalogManager = new CatalogManager();
