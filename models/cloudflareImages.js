// Fetches the list of uploaded photos from Cloudflare Images for the
// archive page. Uses Node's built-in fetch (Node 18+) - no extra
// dependency required.
//
// Required in .env:
//   CLOUDFLARE_ACCOUNT_ID          - your Cloudflare account ID
//   CLOUDFLARE_IMAGES_API_TOKEN    - API token scoped to Images:Read
//   CLOUDFLARE_IMAGES_VARIANT      - optional, defaults to "public" (used for grid thumbnails)
//   CLOUDFLARE_IMAGES_FULL_VARIANT - optional, defaults to "original" (used for the click-to-view lightbox)

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PER_PAGE = 100;

let cache = { images: null, fetchedAt: 0 };

function getConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
  const variant = process.env.CLOUDFLARE_IMAGES_VARIANT || 'public';
  const fullVariant = process.env.CLOUDFLARE_IMAGES_FULL_VARIANT || 'original';

  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare Images is not configured. Set CLOUDFLARE_ACCOUNT_ID and ' +
      'CLOUDFLARE_IMAGES_API_TOKEN in .env.'
    );
  }

  return { accountId, apiToken, variant, fullVariant };
}

function pickVariantUrl(variants, variantName) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  return variants.find((url) => url.endsWith(`/${variantName}`)) || null;
}

async function fetchImagesPage(accountId, apiToken, page) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?page=${page}&per_page=${PER_PAGE}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Cloudflare Images request failed (${response.status}): ${body}`);
  }

  const data = await response.json();

  if (!data.success) {
    const message = (data.errors || []).map((e) => e.message).join(', ') || 'Unknown error';
    throw new Error(`Cloudflare Images API error: ${message}`);
  }

  return data.result.images || [];
}

// Returns [{ id, filename, url }, ...] for every image uploaded to
// Cloudflare Images, using the configured variant for the delivery URL.
// Results are cached in-memory for CACHE_TTL_MS to avoid hitting
// Cloudflare's API (and rate limits) on every page load.
async function listArchiveImages({ forceRefresh = false } = {}) {
  if (!forceRefresh && cache.images && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.images;
  }

  const { accountId, apiToken, variant, fullVariant } = getConfig();

  const images = [];
  let page = 1;

  // Cloudflare returns up to 100 images per page - keep paging until a
  // short page tells us we've reached the end.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pageImages = await fetchImagesPage(accountId, apiToken, page);
    images.push(...pageImages);

    if (pageImages.length < PER_PAGE) break;
    page += 1;
  }

  const result = images.map((image) => {
    const url = pickVariantUrl(image.variants, variant) ||
      (Array.isArray(image.variants) ? image.variants[0] : null);

    // Prefer the "original" (uncropped) variant for the lightbox. Fall back
    // to the thumbnail URL if that variant isn't available on this account.
    const fullUrl = pickVariantUrl(image.variants, fullVariant) || url;

    return {
      id: image.id,
      filename: image.filename,
      url,
      fullUrl,
    };
  }).filter((image) => Boolean(image.url));

  cache = { images: result, fetchedAt: Date.now() };
  return result;
}

module.exports = { listArchiveImages };
