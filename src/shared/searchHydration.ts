import type { SearchHydratePayload } from './ipcContract'
import type { SearchResultItem } from './models'

/** Applies a progressive search update using an exact, stable source URL key. */
export function applySearchHydration(
  results: readonly SearchResultItem[],
  item: SearchHydratePayload,
): SearchResultItem[] {
  return results.map((result) =>
    result.url === item.sourceUrl
      ? {
          ...result,
          ...item.patch,
          metadataState: item.metadataState,
          metadataErrorCode: item.errorCode,
        }
      : result,
  )
}
