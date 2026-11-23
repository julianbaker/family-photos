import { authenticate } from '#lib/utils/auth.ts';
import { searchAssets, type AssetResponseDto } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: photos of a group of people: any of them, or all of them together
export const load = (async ({ url }) => {
  await authenticate(url);
  const ids = (url.searchParams.get('people') ?? '').split(',').filter(Boolean);
  const together = url.searchParams.get('mode') === 'together';
  const title = url.searchParams.get('title') || (together ? 'Photos together' : 'Photos');

  const search = async (personIds: string[]) => {
    const { assets } = await searchAssets({ metadataSearchDto: { personIds, size: 1000, withExif: false } });
    return assets.items;
  };

  let assets: AssetResponseDto[] = [];
  if (ids.length > 0) {
    if (together) {
      assets = await search(ids);
    } else {
      const unique = new Map<string, AssetResponseDto>();
      for (const items of await Promise.all(ids.map((id) => search([id])))) {
        for (const asset of items) {
          unique.set(asset.id, asset);
        }
      }
      assets = [...unique.values()].sort((a, b) => b.localDateTime.localeCompare(a.localDateTime));
    }
  }

  return { assets, meta: { title } };
}) satisfies PageLoad;
