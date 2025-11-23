#!/usr/bin/env node

/**
 * Generate a gallery manifest (gallery.json) from assets/photos.
 *
 * - All image files found under assets/photos (recursively) are flattened into
 *   a single list (no folders in the output schema).
 * - Thumbnail/full pairs are inferred via configurable filename suffixes.
 * - Resulting manifest matches assets/gallery.schema.json.
 *
 * Usage:
 *   node scripts/generate-gallery.mjs [outputPath]
 *     [--thumbnail-suffix=_small] [--full-suffix=_large]
 *     [--archive=photos/photos.zip]
 *     [--hero-eyebrow="Our Wedding"] [--hero-title="Title"]
 *     [--hero-subtitle="Subtitle"] [--hero-image=photos/hero.jpg]
 *
 * If outputPath is omitted the manifest is written to assets/gallery.generated.json
 * to protect any hand-maintained gallery.json. Review the generated file and rename
 * it to gallery.json once you're ready.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PHOTOS_DIR = path.join(ASSETS_DIR, 'photos');
const DEFAULT_OUTPUT = path.join(ROOT_DIR, 'assets', 'gallery.generated.json');
const DEFAULT_THUMBNAIL_SUFFIX = '_small';
const DEFAULT_FULL_SUFFIX = '_large';
const DEFAULT_HERO_IMAGE_CANDIDATES = ['hero.jpg', 'hero.jpeg', 'hero.png', 'hero.webp'];

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
]);

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

async function readFileSafe(filePath) {
  return fs.readFile(filePath);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parsePngDimensions(buffer) {
  const PNG_SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (!buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature');
  }
  // IHDR chunk starts at byte 8, data begins at byte 16.
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function parseJpegDimensions(buffer) {
  if (buffer.readUInt16BE(0) !== 0xffd8) {
    throw new Error('Invalid JPEG header');
  }

  let offset = 2;
  const length = buffer.length;

  while (offset < length) {
    // Skip padding FF bytes
    while (offset < length && buffer[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= length) {
      break;
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    offset += 2;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 5 > length) {
        break;
      }
      const height = buffer.readUInt16BE(offset + 1);
      const width = buffer.readUInt16BE(offset + 3);
      return { width, height };
    }

    offset += segmentLength - 2;
  }

  throw new Error('Failed to locate JPEG dimensions');
}

async function getImageDimensions(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await readFileSafe(filePath);

  if (ext === '.png') {
    return parsePngDimensions(buffer);
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    return parseJpegDimensions(buffer);
  }

  return null;
}

const toKebabCase = (value) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const toTitleCase = (value) =>
  value
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const toPosixPath = (value) => value.split(path.sep).join(path.posix.sep);

const isProbablyUrl = (value) =>
  /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//');

const normalizeAssetPath = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (isProbablyUrl(trimmed)) {
    return trimmed;
  }
  let stripped = trimmed.replace(/^\.\/*/, '');
  if (stripped.startsWith('assets/')) {
    stripped = stripped.slice('assets/'.length);
  }
  return toPosixPath(stripped);
};

const stripMarker = (value, marker) => {
  if (!marker) {
    return value;
  }
  const index = value.indexOf(marker);
  if (index === -1) {
    return value;
  }
  return `${value.slice(0, index)}${value.slice(index + marker.length)}`;
};

const deriveEntryKey = (relativeDir, baseName) => {
  if (!relativeDir) {
    return baseName;
  }
  return `${relativeDir}/${baseName}`;
};

const classifyBaseName = (baseName, thumbnailSuffix, fullSuffix) => {
  if (thumbnailSuffix && baseName.includes(thumbnailSuffix)) {
    return {
      type: 'thumbnail',
      cleanBaseName: stripMarker(baseName, thumbnailSuffix),
    };
  }

  if (fullSuffix && baseName.includes(fullSuffix)) {
    return {
      type: 'full',
      cleanBaseName: stripMarker(baseName, fullSuffix),
    };
  }

  return {
    type: 'generic',
    cleanBaseName: baseName,
  };
};

const determineOrientation = (width, height) => {
  if (!width || !height) {
    return 'square';
  }
  if (Math.abs(width - height) <= 1) {
    return 'square';
  }
  return height > width ? 'portrait' : 'landscape';
};

const computeAspectRatio = (width, height) => {
  if (!width || !height) {
    return undefined;
  }
  return Number((height / width).toFixed(6));
};

const isImageFile = (fileName) =>
  IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());

async function collectImageFiles(rootDir) {
  const results = [];

  const walk = async (currentDir, relativeDir = '') => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const nextRelative = relativeDir
          ? path.join(relativeDir, entry.name)
          : entry.name;
        await walk(absolutePath, nextRelative);
        continue;
      }
      if (!entry.isFile() || !isImageFile(entry.name)) {
        continue;
      }
      const relativeFilePath = relativeDir
        ? path.join(relativeDir, entry.name)
        : entry.name;
      results.push({
        absolutePath,
        relativeDir,
        fileName: entry.name,
        relativePath: toPosixPath(path.join('photos', relativeFilePath)),
      });
    }
  };

  await walk(rootDir, '');
  return results;
}

async function findDefaultHeroImage() {
  for (const filename of DEFAULT_HERO_IMAGE_CANDIDATES) {
    const relative = path.posix.join('photos', filename);
    const absolute = path.join(ASSETS_DIR, relative);
    if (await pathExists(absolute)) {
      return relative;
    }
  }
  return '';
}

async function buildPhotosFromFiles(files, options) {
  const { thumbnailSuffix, fullSuffix, nextPhotoId } = options;
  const entries = new Map();

  for (const file of files) {
    const { absolutePath, relativeDir, fileName, relativePath } = file;
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    const classification = classifyBaseName(
      baseName,
      thumbnailSuffix,
      fullSuffix
    );
    const cleanBaseName = classification.cleanBaseName || baseName;
    const entryKey = deriveEntryKey(relativeDir, cleanBaseName);

    if (!entries.has(entryKey)) {
      entries.set(entryKey, {
        key: entryKey,
        relativeDir,
        baseName: cleanBaseName,
        sortKey: entryKey.toLowerCase(),
      });
    }

    const entry = entries.get(entryKey);

    let dimensions = null;
    try {
      dimensions = await getImageDimensions(absolutePath);
    } catch (error) {
      console.warn(
        `⚠ Unable to read dimensions for ${absolutePath}: ${error.message}`
      );
    }

    const assignDimensions = (target) => {
      if (!dimensions) {
        return;
      }
      entry[`${target}Width`] = dimensions.width;
      entry[`${target}Height`] = dimensions.height;
    };

    if (classification.type === 'thumbnail') {
      entry.thumbnail = relativePath;
      assignDimensions('thumbnail');
    } else if (classification.type === 'full') {
      entry.full = relativePath;
      entry.width = dimensions?.width;
      entry.height = dimensions?.height;
    } else {
      if (!entry.full) {
        entry.full = relativePath;
        entry.width = dimensions?.width;
        entry.height = dimensions?.height;
      }
      if (!entry.thumbnail) {
        entry.thumbnail = relativePath;
        assignDimensions('thumbnail');
      }
    }
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  return Array.from(entries.values())
    .sort((a, b) => collator.compare(a.sortKey, b.sortKey))
    .map((entry) => finalizePhotoEntry(entry, nextPhotoId))
    .filter(Boolean);
}

function finalizePhotoEntry(entry, nextPhotoId) {
  const thumbnail = entry.thumbnail || entry.full;
  const full = entry.full || entry.thumbnail;
  if (!thumbnail && !full) {
    return null;
  }

  const idSeed = [entry.relativeDir, entry.baseName]
    .filter(Boolean)
    .join(' ');
  const id = toKebabCase(idSeed) || nextPhotoId();
  const titleSource = entry.baseName?.replace(/[-_]+/g, ' ').trim();
  const title = titleSource ? toTitleCase(titleSource) : 'Untitled photo';

  const width = entry.width ?? entry.thumbnailWidth;
  const height = entry.height ?? entry.thumbnailHeight;
  const aspectRatio = computeAspectRatio(width, height);
  const orientation = determineOrientation(width, height);

  const photo = {
    id,
    title,
    description: '',
    thumbnail,
    full,
    orientation,
  };

  if (entry.width) {
    photo.width = entry.width;
  }
  if (entry.height) {
    photo.height = entry.height;
  }
  if (entry.thumbnailWidth) {
    photo.thumbnailWidth = entry.thumbnailWidth;
  }
  if (entry.thumbnailHeight) {
    photo.thumbnailHeight = entry.thumbnailHeight;
  }
  if (aspectRatio) {
    photo.aspectRatio = aspectRatio;
  }

  return photo;
}

async function main() {
  const args = process.argv.slice(2);
  let outputArg;
  let archiveArg;
  let heroEyebrowArg;
  let heroTitleArg;
  let heroSubtitleArg;
  let heroImageArg;
  let thumbnailSuffixArg;
  let fullSuffixArg;

  for (const arg of args) {
    if (arg.startsWith('--archive=')) {
      archiveArg = arg.slice('--archive='.length);
    } else if (arg.startsWith('--hero-eyebrow=')) {
      heroEyebrowArg = arg.slice('--hero-eyebrow='.length);
    } else if (arg.startsWith('--hero-title=')) {
      heroTitleArg = arg.slice('--hero-title='.length);
    } else if (arg.startsWith('--hero-subtitle=')) {
      heroSubtitleArg = arg.slice('--hero-subtitle='.length);
    } else if (arg.startsWith('--hero-image=')) {
      heroImageArg = arg.slice('--hero-image='.length);
    } else if (arg.startsWith('--thumbnail-suffix=')) {
      thumbnailSuffixArg = arg.slice('--thumbnail-suffix='.length);
    } else if (arg.startsWith('--full-suffix=')) {
      fullSuffixArg = arg.slice('--full-suffix='.length);
    } else if (!outputArg) {
      outputArg = arg;
    }
  }

  const outputPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : DEFAULT_OUTPUT;

  const normalizeOption = (value) =>
    typeof value === 'string' ? value.trim() : '';
  const normalizeOptional = (value) =>
    typeof value === 'string' ? value.trim() : undefined;

  const downloadArchive =
    normalizeOption(archiveArg) || normalizeOption(process.env.GALLERY_ARCHIVE);
  const heroEyebrow =
    normalizeOption(heroEyebrowArg) ||
    normalizeOption(process.env.GALLERY_HERO_EYEBROW);
  const heroTitle =
    normalizeOption(heroTitleArg) ||
    normalizeOption(process.env.GALLERY_HERO_TITLE);
  const heroSubtitle =
    normalizeOption(heroSubtitleArg) ||
    normalizeOption(process.env.GALLERY_HERO_SUBTITLE);
  const heroImageRaw =
    normalizeOption(heroImageArg) ||
    normalizeOption(process.env.GALLERY_HERO_IMAGE);
  let heroImage = normalizeAssetPath(heroImageRaw);
  const thumbnailSuffix =
    normalizeOptional(thumbnailSuffixArg) ??
    normalizeOptional(process.env.GALLERY_THUMBNAIL_SUFFIX) ??
    DEFAULT_THUMBNAIL_SUFFIX;
  const fullSuffix =
    normalizeOptional(fullSuffixArg) ??
    normalizeOptional(process.env.GALLERY_FULL_SUFFIX) ??
    DEFAULT_FULL_SUFFIX;

  try {
    await fs.access(PHOTOS_DIR);
  } catch {
    console.error(`✗ photos directory not found at ${PHOTOS_DIR}`);
    process.exit(1);
  }

  if (!heroImage) {
    heroImage = await findDefaultHeroImage();
  }

  const imageFiles = await collectImageFiles(PHOTOS_DIR);
  if (!imageFiles.length) {
    console.warn(
      `⚠ No image files found in ${PHOTOS_DIR}. Generated manifest will be empty.`
    );
  }

  const heroImageRelativePath =
    heroImage && !isProbablyUrl(heroImage) ? heroImage : '';

  const filteredImageFiles = heroImageRelativePath
    ? imageFiles.filter((file) => file.relativePath !== heroImageRelativePath)
    : imageFiles;

  let photoCounter = 1;
  const nextPhotoId = () => `photo-${String(photoCounter++).padStart(3, '0')}`;

  const photos = await buildPhotosFromFiles(filteredImageFiles, {
    thumbnailSuffix,
    fullSuffix,
    nextPhotoId,
  });

  if (photos.length === 0) {
    console.warn('⚠ No photos detected. Generated manifest will be empty.');
  }

  const manifest = {
    $schema: './gallery.schema.json',
    photos,
  };

  if (downloadArchive) {
    manifest.downloadArchive = downloadArchive;
  }
  if (heroEyebrow) {
    manifest.heroEyebrow = heroEyebrow;
  }
  if (heroTitle) {
    manifest.heroTitle = heroTitle;
  }
  if (heroSubtitle) {
    manifest.heroSubtitle = heroSubtitle;
  }
  if (heroImage) {
    manifest.heroImage = heroImage;
  }

  await fs.writeFile(
    outputPath,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
  console.log(`✓ Gallery manifest written to ${outputPath}`);
}

main().catch((error) => {
  console.error('✗ Failed to generate gallery manifest');
  console.error(error);
  process.exit(1);
});
