import { structured, type RelatedAIConfig } from '../../supabase/functions/_shared/related-ai.ts';
import type { RelatedInput } from '../../supabase/functions/_shared/related-contract.ts';
import { THEMES_INSTRUCTIONS, THEMES_SCHEMA, validateThemeGroups, type KnownTheme } from './themes-contract.ts';
export async function analyzeThemes(origin: RelatedInput, candidates: RelatedInput[], knownThemes: KnownTheme[], config: RelatedAIConfig, fetcher: typeof fetch = fetch) {
  if (candidates.length < 2) return [];
  return validateThemeGroups(await structured(THEMES_INSTRUCTIONS, { origin, candidates, knownThemes }, THEMES_SCHEMA, 'note_themes', config, fetcher, 4800),origin,candidates,knownThemes);
}

import { COLLECTION_THEMES_INSTRUCTIONS, COLLECTION_THEMES_SCHEMA, validateCollectionThemes } from './themes-contract.ts';
export async function analyzeThemeCollection(collection: RelatedInput[], focusIds: string[], knownThemes: KnownTheme[], config: RelatedAIConfig, fetcher: typeof fetch = fetch) {
  if(collection.length<3)return [];
  if(collection.length>48 || focusIds.length>32 || !focusIds.length || focusIds.some(id=>!collection.some(n=>n.id===id)))throw new Error('invalid_collection');
  return validateCollectionThemes(await structured(COLLECTION_THEMES_INSTRUCTIONS,{collection,focus_ids:focusIds,knownThemes},COLLECTION_THEMES_SCHEMA,'collection_themes',config,fetcher,10000,45000),collection,focusIds,knownThemes);
}
