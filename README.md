# Wedding Picture Gallery

A minimalist, static wedding photo gallery with a masonry layout and shareable detail pages.

## Getting started

1. Set a password via environment variable and start the bundled Deno server:
   ```bash
   export GALLERY_PASSWORD="super-secret-password"
   deno run --allow-net --allow-read --allow-env server.ts
   ```
   The server listens on port `8000` by default (override with `PORT=...`). If you want a custom signing salt for the session cookie, set `SESSION_SECRET`.
2. Open [http://localhost:8000](http://localhost:8000) and sign in with the password you just configured.

## Adding your photos

1. Drop images into `assets/photos/` **or** host them on an asset server.
2. Edit `assets/gallery.json` and add folders with photo entries. The root object must contain a `folders` array:
   ```json
   {
     "$schema": "./gallery.schema.json",
     "heroEyebrow": "Our Wedding",
     "heroTitle": "Elena & Max",
     "heroSubtitle": "June 5, 2026",
     "heroImage": "assets/hero.jpg",
     "downloadArchive": "assets/elena-max.zip",
     "folders": [
       {
         "id": "day-1",
         "name": "Day 1 — Ceremony",
         "description": "Highlights from the ceremony and early celebrations.",
         "photos": [
           {
             "id": "day1-photo-001",
             "title": "Day 1 Photo 1",
             "thumbnail": "photos/day-1/photo-001-thumb.jpg",
             "full": "photos/day-1/photo-001.jpg"
           }
         ]
       }
     ]
   }
   ```
- Keep the folder count small (the UI is tuned for up to three groups).
- `thumbnail` can point to the same file as `full`; using a smaller file speeds up loading.
- `description` fields are optional and currently hidden in the UI.
- `heroEyebrow`, `heroTitle`, `heroSubtitle`, and `heroImage` (all optional) control the hero section at the top of the page; omit them to fall back to the defaults baked into `index.html`.
- `downloadArchive` (optional) points to a ZIP that the “Download All Photos” button should deliver.
3. Refresh the page and the new photos appear automatically.

### Hosting assets on a different domain

If your images and `gallery.json` live on another origin, expose `window.API_BASE_URL` **before** `app.js` loads:

```html
<script>
  window.API_BASE_URL = "https://assets.example.com/";
</script>
<script type="module" src="/app.js"></script>
```

All paths inside `gallery.json` should be relative (for example `photos/day-1/photo-001.jpg`). The app prefixes them with `API_BASE_URL`, or with `assets/` when no base URL is provided (local development).

### Generating the manifest automatically

When the export finishes populating `assets/photos/`, run the helper script to generate a manifest:

```bash
node scripts/generate-gallery.mjs
```

The script scans every first-level folder inside `assets/photos/`, builds a `gallery.generated.json`, and keeps paths relative (e.g. `photos/<folder>/<file>`). Review the output and rename it to `gallery.json` once you are satisfied:

```bash
mv assets/gallery.generated.json assets/gallery.json
```

You can optionally pass a custom output path:

```bash
node scripts/generate-gallery.mjs dist/gallery.json
```

To include the bulk download archive when generating the manifest, pass `--archive` (or set `GALLERY_ARCHIVE`):

```bash
node scripts/generate-gallery.mjs --archive assets/wedding-photos.zip
```

You can set hero metadata the same way:

```bash
node scripts/generate-gallery.mjs \
  --hero-eyebrow "Our Wedding" \
  --hero-title "Elena & Max" \
  --hero-subtitle "June 5, 2026" \
  --hero-image assets/hero.jpg
```

## Features

- Folder navigation with a masonry-style grid that scales to hundreds of landscape photos.
- Header toggle to switch between compact and large thumbnail sizes without leaving the page.
- Detail view with keyboard navigation (Arrow keys / Escape) and shareable, human-readable URLs like `/wedding-photo-042`.
- Password-protected entry point served by a lightweight Deno server—no external infrastructure required.

## Customising the look

- Adjust colours and spacing in `styles.css` (variables in the `:root` block).
- Replace the heading text or metadata directly in `index.html`.
- Tweak grid density via the CSS variables on `.gallery` or by adapting the layout pattern in `app.js`.

## Notes

- Opening the gallery via `file://` will block JSON loading in most browsers—always use the provided server (or any server that rewrites unknown routes back to `index.html`).
- The demo data includes 100 landscape placeholders in the “Day 1” folder (generated with `https://placehold.co`) so you can test the dense layout.
- Share an exact photo by copying the browser URL from the detail view (for example `/day1-photo-042`).
