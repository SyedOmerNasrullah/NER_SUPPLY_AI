/**
 * The `/supply?line=…` URL contract, in one place.
 *
 * Four features link into Supply Intelligence at a specific district-and-category pair, so the
 * identifier is a composite: `<districtId>:<category>`. That raises the obvious question — what
 * happens if a district id ever contains a colon?
 *
 * The answer has three parts, and they are what make this safe rather than lucky:
 *
 *  1. **Nothing resolves it by parsing.** Supply Intelligence matches the query value against
 *     ids the app itself built, by string equality. A value that does not match — unknown,
 *     truncated, hand-edited, hostile — matches nothing and the page falls back to the tightest
 *     line. There is no substring extraction to confuse and no lookup to poison.
 *
 *  2. **When it IS parsed, it splits on the LAST colon.** `SupplyCategory` is the closed union
 *     `'medicine' | 'food' | 'fuel'`, so the suffix is colon-free by type. Splitting from the
 *     right is therefore correct for *any* district id, colons included, and the recovered
 *     category is validated against the union rather than trusted.
 *
 *  3. **The invariant is asserted, not assumed.** `District.id` is a UUID today (contract §1,
 *     `uuid` primary keys), which cannot contain a colon. Phase 6 could reasonably swap that for
 *     a slug, so `assertLinkableId` fails loudly in development the moment an id arrives that
 *     would make a link ambiguous — at the point the link is built, not three screens later.
 *
 * Together: the encoding stays readable in the address bar, and no colon anywhere can produce a
 * wrong district or a wrong category. See CONTRACT_DELTAS.md D24.
 */

import type { SupplyCategory } from '@/domain/types';

const CATEGORY_VALUES: readonly SupplyCategory[] = ['medicine', 'food', 'fuel'];

/**
 * Development-only guard on the one property the composite key depends on.
 *
 * Deliberately a console warning rather than a throw: a colon in an id degrades a deep link,
 * it does not corrupt data, and taking down a live operations console over a cosmetic
 * navigation defect would be the worse failure. Stripped from production by the bundler.
 */
function assertLinkableId(districtId: string): void {
  if (import.meta.env.DEV && districtId.includes(':')) {
    console.warn(
      `[supplyLink] District id "${districtId}" contains ":". Supply deep links assume the ` +
        `category is the final colon-separated segment. Parsing still resolves correctly, but ` +
        `review CONTRACT_DELTAS.md D24 before shipping ids in this shape.`,
    );
  }
}

/** The composite identity of one supply line. Also its React key and its URL value. */
export function supplyLineId(districtId: string, category: SupplyCategory): string {
  assertLinkableId(districtId);
  return `${districtId}:${category}`;
}

/** A ready-to-navigate path for a district's supply line. */
export function supplyLinePath(districtId: string, category: SupplyCategory): string {
  return `/supply?line=${encodeURIComponent(supplyLineId(districtId, category))}`;
}

/**
 * The inverse, splitting from the right so a colon in the district id cannot mislead it.
 * Returns undefined for anything that is not a well-formed line id.
 */
export function parseSupplyLineId(
  value: string | null | undefined,
): { districtId: string; category: SupplyCategory } | undefined {
  if (!value) return undefined;

  const cut = value.lastIndexOf(':');
  if (cut <= 0 || cut === value.length - 1) return undefined;

  const category = value.slice(cut + 1) as SupplyCategory;
  if (!CATEGORY_VALUES.includes(category)) return undefined;

  return { districtId: value.slice(0, cut), category };
}
