import { describe, it, expect } from 'vitest';
import { catalogManager, CatalogRecipeSchema } from '../../src/daemon/deploy/catalog';

describe('Phase 4 - Item 4.9: Declarative App Catalog & Recipes', () => {
  it('loads all catalog recipes and validates against Zod schema', () => {
    catalogManager.reload();
    const recipes = catalogManager.getRecipes();

    expect(recipes.length).toBeGreaterThanOrEqual(8);

    for (const recipe of recipes) {
      // Validate schema
      const parsed = CatalogRecipeSchema.safeParse(recipe);
      expect(parsed.success).toBe(true);
      expect(recipe.id).toBeTruthy();
      expect(recipe.name).toBeTruthy();
      expect(recipe.defaultPort).toBeGreaterThan(0);
      expect(recipe.defaultSubdomain).toBeTruthy();
      expect(recipe.spec).toBeDefined();
    }
  });

  it('retrieves individual recipes by ID', () => {
    const express = catalogManager.getRecipe('node-express');
    expect(express).toBeDefined();
    expect(express?.runtime).toBe('node');
    expect(express?.category).toBe('Application');
    expect(express?.spec.buildCommand).toBe('npm install --production');

    const fastapi = catalogManager.getRecipe('python-fastapi');
    expect(fastapi).toBeDefined();
    expect(fastapi?.runtime).toBe('python');
    expect(fastapi?.category).toBe('Application');

    const goWeb = catalogManager.getRecipe('go-web');
    expect(goWeb).toBeDefined();
    expect(goWeb?.runtime).toBe('go');

    const redis = catalogManager.getRecipe('redis');
    expect(redis).toBeDefined();
    expect(redis?.category).toBe('Database');
  });

  it('rejects malformed recipes invalidating Zod requirements', () => {
    const invalid = {
      id: '',
      name: 'Bad Recipe',
      category: 'NotACategory',
    };

    const res = CatalogRecipeSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });
});
