#!/usr/bin/env node

/**
 * Generate a gallery manifest (gallery.json) from assets/photos.
 *
 * - Each first-level folder beneath assets/photos becomes a gallery folder.
 * - Each image file inside a folder becomes a photo entry referencing a relative path.
 * - Resulting manifest uses the schema at assets/gallery.schema.json.
 *
 * Usage:
 *   node scripts/generate-gallery.mjs [outputPath]
 *
 * If outputPath is omitted the manifest is written to assets/gallery.generated.json
 * to protect any hand-maintained gallery.json. Review the generated file and rename
 * it to gallery.json once you're ready.
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PHOTOS_DIR = path.join(ROOT_DIR, "assets", "photos");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "assets", "gallery.generated.json");

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
]);

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

async function readFileSafe(filePath) {
  return fs.readFile(filePath);
}

function parsePngDimensions(buffer) {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature");
  }
  // IHDR chunk starts at byte 8, data begins at byte 16.
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function parseJpegDimensions(buffer) {
  if (buffer.readUInt16BE(0) !== 0xffd8) {
    throw new Error("Invalid JPEG header");
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

  throw new Error("Failed to locate JPEG dimensions");
}

async function getImageDimensions(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await readFileSafe(filePath);

  if (ext === ".png") {
    return parsePngDimensions(buffer);
  }

  if (ext === ".jpg" || ext === ".jpeg") {
    return parseJpegDimensions(buffer);
  }

  return null;
}

const toKebabCase = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const toTitleCase = (value) =>
  value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const isImageFile = (fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());

async function readDirectories(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function readFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function buildFolder(folderName) {
  const folderDir = path.join(PHOTOS_DIR, folderName);
  const files = (await readFiles(folderDir)).filter(isImageFile).sort((a, b) => a.localeCompare(b));

  const folderId = toKebabCase(folderName);
  const folderTitle = toTitleCase(folderName);

  const photos = await Promise.all(
    files.map(async (fileName, index) => {
      const baseName = path.parse(fileName).name;
      const photoId = `${folderId}-${toKebabCase(baseName) || `photo-${index + 1}`}`;
      const relativePath = `photos/${folderName}/${fileName}`;
      const title = toTitleCase(baseName);
      const absolutePath = path.join(folderDir, fileName);

      let width;
      let height;
      let aspectRatio;
      let orientation = "square";
      try {
        const dims = await getImageDimensions(absolutePath);
        if (dims) {
          ({ width, height } = dims);
        }
        if (width && height) {
          aspectRatio = Number((height / width).toFixed(6));
          if (height > width) {
            orientation = "portrait";
          } else if (width > height) {
            orientation = "landscape";
          } else {
            orientation = "square";
          }
        }
      } catch (error) {
        console.warn(`⚠ Unable to read dimensions for ${absolutePath}: ${error.message}`);
      }

      return {
        id: photoId,
        title,
        thumbnail: relativePath,
        full: relativePath,
        width,
        height,
        thumbnailWidth: width,
        thumbnailHeight: height,
        aspectRatio,
        orientation,
      };
    })
  );

  return {
    id: folderId,
    name: folderTitle,
    description: "",
    photos,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let outputArg;
  let archiveArg;
  let heroEyebrowArg;
  let heroTitleArg;
  let heroSubtitleArg;
  let heroImageArg;

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
    } else if (!outputArg) {
      outputArg = arg;
    }
  }

  const outputPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : DEFAULT_OUTPUT;

  const normalizeOption = (value) =>
    typeof value === 'string' ? value.trim() : '';

  const downloadArchive =
    normalizeOption(archiveArg) || normalizeOption(process.env.GALLERY_ARCHIVE);
  const heroEyebrow =
    normalizeOption(heroEyebrowArg) || normalizeOption(process.env.GALLERY_HERO_EYEBROW);
  const heroTitle =
    normalizeOption(heroTitleArg) || normalizeOption(process.env.GALLERY_HERO_TITLE);
  const heroSubtitle =
    normalizeOption(heroSubtitleArg) || normalizeOption(process.env.GALLERY_HERO_SUBTITLE);
  const heroImage =
    normalizeOption(heroImageArg) || normalizeOption(process.env.GALLERY_HERO_IMAGE);

  try {
    await fs.access(PHOTOS_DIR);
  } catch {
    console.error(`✗ photos directory not found at ${PHOTOS_DIR}`);
    process.exit(1);
  }

  const folderNames = (await readDirectories(PHOTOS_DIR)).sort((a, b) =>
    a.localeCompare(b)
  );

  if (folderNames.length === 0) {
    console.warn("⚠ No folders found in assets/photos. Generated manifest will be empty.");
  }

  const folders = [];
  for (const folderName of folderNames) {
    const folder = await buildFolder(folderName);
    if (folder.photos.length === 0) {
      console.warn(`⚠ Folder "${folderName}" contains no image files and was skipped.`);
      continue;
    }
    folders.push(folder);
  }

  const manifest = {
    $schema: "./gallery.schema.json",
    folders,
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

  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`✓ Gallery manifest written to ${outputPath}`);
}

main().catch((error) => {
  console.error("✗ Failed to generate gallery manifest");
  console.error(error);
  process.exit(1);
});
