const galleryElement = document.getElementById("gallery");
const emptyStateElement = document.getElementById("gallery-empty");
const template = document.getElementById("gallery-item-template");
const folderControls = document.getElementById("folder-controls");
const detailView = document.getElementById("detail-view");
const detailImage = document.getElementById("detail-image");
const detailTitle = document.getElementById("detail-title");
const detailCount = document.getElementById("detail-count");
const detailCloseButton = document.getElementById("detail-close");
const detailPrevButton = document.getElementById("detail-prev");
const detailNextButton = document.getElementById("detail-next");
const detailDownloadButton = document.getElementById("detail-download");
const homeLink = document.getElementById("home-link");
const heroElement = document.getElementById("hero");
const heroTitleElement = document.getElementById("hero-title");
const heroSubtitleElement = document.getElementById("hero-subtitle");
const heroEyebrowElement = document.getElementById("hero-eyebrow");
const downloadAllButton = document.getElementById("download-all");
const bodyElement = document.body || document.querySelector("body");
const pageElement = document.querySelector(".page");

const AGGREGATE_FOLDER_ID = "alle";
const AGGREGATE_FOLDER_NAME = "All Photos";

const basePageTitle = document.title;
const initialHeroEyebrow = heroEyebrowElement?.textContent ?? "";
const initialHeroTitle = heroTitleElement?.textContent ?? "";
const initialHeroSubtitle = heroSubtitleElement?.textContent ?? "";

let heroConfig = {
  eyebrow: null,
  title: null,
  subtitle: null,
  image: "",
};

let baseFolders = [];
let folders = [];
let folderButtons = [];
let currentFolderIndex = 0;
let currentPhotos = [];
let currentPhotoIndex = -1;
let masonryRafId = null;
let resizeTimerId = null;
let imageObserver = null;
const hoverPreloadTimers = new WeakMap();
const preloadedPhotoUrls = new Set();
const preloadedImageElements = new Map();

const layoutPattern = [{}];

const GALLERY_ITEM_SELECTOR = ".gallery-item";
const DOWNLOAD_LINK_SELECTOR = ".gallery-item__download";
const HOVER_PRELOAD_DELAY = 350;

const ensurePhotoPreloaded = (photo) => {
  if (!photo || !photo.full || preloadedPhotoUrls.has(photo.full)) {
    return;
  }

  preloadedPhotoUrls.add(photo.full);
  if (!preloadedImageElements.has(photo.full)) {
    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.src = photo.full;
    preloadedImageElements.set(photo.full, image);
  }
};

const API_BASE_URL =
  typeof window !== "undefined" && window.API_BASE_URL
    ? String(window.API_BASE_URL).trim()
    : "";
const NORMALIZED_API_BASE = API_BASE_URL
  ? API_BASE_URL.replace(/\/?$/, "/")
  : "";

const isAbsoluteUrl = (value) =>
  /^([a-z][a-z\d+.-]*:)?\/\//i.test(value || "") ||
  (value || "").startsWith("data:");

const resolveAssetPath = (value) => {
  const cleaned = safeText(value);
  if (!cleaned) {
    return "";
  }
  if (isAbsoluteUrl(cleaned) || cleaned.startsWith("/")) {
    return cleaned;
  }
  const trimmed = cleaned.replace(/^\.?\/*/, "");
  if (NORMALIZED_API_BASE) {
    return NORMALIZED_API_BASE + trimmed;
  }
  return `/${trimmed.startsWith("assets/") ? trimmed : `assets/${trimmed}`}`;
};

const supportsNativeLazyLoading = "loading" in HTMLImageElement.prototype;
const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

const escapeForSingleQuotes = (value) =>
  String(value || "").replace(/'/g, "\\'");

const findFirstPhotoInFolder = (folder) => {
  if (!folder || !Array.isArray(folder.photos)) {
    return null;
  }
  return (
    folder.photos.find((photo) => photo && (photo.full || photo.thumbnail)) ||
    null
  );
};

const resolveHeroPhoto = (folderIndex = currentFolderIndex) => {
  const candidateFolders = [];
  const seenIds = new Set();

  const enqueue = (folder) => {
    if (!folder || seenIds.has(folder.id)) {
      return;
    }
    seenIds.add(folder.id);
    candidateFolders.push(folder);
  };

  enqueue(folders[folderIndex]);
  enqueue(baseFolders[folderIndex]);
  baseFolders.forEach(enqueue);
  folders.forEach(enqueue);

  for (const folder of candidateFolders) {
    const photo = findFirstPhotoInFolder(folder);
    if (photo) {
      return photo;
    }
  }

  return null;
};

const applyHeroContent = () => {
  if (heroEyebrowElement) {
    const eyebrow = heroConfig.eyebrow ?? initialHeroEyebrow;
    heroEyebrowElement.textContent = eyebrow || "";
  }
  if (heroTitleElement) {
    const title = heroConfig.title ?? initialHeroTitle;
    heroTitleElement.textContent = title || "";
  }
  if (heroSubtitleElement) {
    const subtitle = heroConfig.subtitle ?? initialHeroSubtitle;
    heroSubtitleElement.textContent = subtitle || "";
  }
};

const updateHeroBackground = (folderIndex = currentFolderIndex) => {
  if (!heroElement) {
    return;
  }

  if (heroConfig.image) {
    heroElement.style.setProperty(
      "--hero-image",
      `url('${escapeForSingleQuotes(heroConfig.image)}')`,
    );
    return;
  }

  const candidate = resolveHeroPhoto(folderIndex);
  if (!candidate) {
    heroElement.style.removeProperty("--hero-image");
    return;
  }

  const source = candidate.full || candidate.thumbnail;
  if (!source) {
    heroElement.style.removeProperty("--hero-image");
    return;
  }

  heroElement.style.setProperty(
    "--hero-image",
    `url('${escapeForSingleQuotes(source)}')`,
  );
};

const ensureImageObserver = () => {
  if (
    typeof window === "undefined" ||
    typeof window.IntersectionObserver !== "function"
  ) {
    return null;
  }

  if (imageObserver) {
    return imageObserver;
  }

  imageObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const img = entry.target;
        const pendingSrc = img.dataset.pendingSrc;
        if (pendingSrc) {
          img.src = pendingSrc;
          delete img.dataset.pendingSrc;
        }

        observer.unobserve(img);
      });
    },
    { rootMargin: "300px 0px" },
  );

  return imageObserver;
};

const prepareImageForLazyLoading = (image, targetSrc) => {
  if (!image) {
    return;
  }

  if (!targetSrc) {
    image.removeAttribute("loading");
    delete image.dataset.pendingSrc;
    image.src = "";
    return;
  }

  if (supportsNativeLazyLoading) {
    image.loading = "lazy";
    image.src = targetSrc;
    return;
  }

  image.src = PLACEHOLDER_IMAGE;
  image.dataset.pendingSrc = targetSrc;
  const observer = ensureImageObserver();
  if (observer) {
    observer.observe(image);
  } else {
    delete image.dataset.pendingSrc;
    image.src = targetSrc;
  }
};

const safeText = (value, fallback = "") =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;

const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const deriveOrientation = (rawOrientation, width, height) => {
  const normalized = safeText(rawOrientation).toLowerCase();
  if (
    normalized === "landscape" ||
    normalized === "portrait" ||
    normalized === "square"
  ) {
    return normalized;
  }

  if (width && height) {
    if (Math.abs(width - height) <= 1) {
      return "square";
    }
    return height > width ? "portrait" : "landscape";
  }

  return "";
};

const toggleBodyLock = (shouldLock) => {
  if (!bodyElement) {
    return;
  }
  bodyElement.classList.toggle("is-locked", shouldLock);
};

const normalizeFolderId = (value) => {
  const cleaned = safeText(value, "");
  return cleaned || AGGREGATE_FOLDER_ID;
};

const buildPathFromState = ({ photoId }) => {
  const normalizedPhoto = safeText(photoId, "");
  if (!normalizedPhoto) {
    return "/";
  }
  return `/${encodeURIComponent(normalizedPhoto)}`;
};

const parseLocationState = () => {
  const segments = window.location.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  const photoId = segments[0] || "";
  return {
    folderId: AGGREGATE_FOLDER_ID,
    photoId: safeText(photoId, ""),
  };
};

const updateHistoryState = ({ folderId, photoId = "", replace = false }) => {
  const state = {
    folderId: normalizeFolderId(folderId),
    photoId: safeText(photoId, ""),
  };
  const path = buildPathFromState(state);
  if (replace) {
    history.replaceState(state, "", path);
    return;
  }
  history.pushState(state, "", path);
};

let isHandlingPopState = false;

const normalizeDownloadName = (photo) => {
  const fallbackName = safeText(photo?.id, "photo");
  const raw = safeText(photo?.title, fallbackName);
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length ? `${base}.jpg` : `${fallbackName}.jpg`;
};

const extractFileName = (value) => {
  const cleaned = safeText(value, "");
  if (!cleaned) {
    return "";
  }
  const base = cleaned.split(/[?#]/)[0];
  const segments = base.split(/[\\/]/);
  return segments.pop() || "";
};

const createDownloadUrl = (source, filename) => {
  const cleanedSource = safeText(source, "");
  if (!cleanedSource) {
    return "";
  }
  const params = new URLSearchParams();
  params.set("url", cleanedSource);
  if (filename) {
    params.set("filename", filename);
  }
  return `/download?${params.toString()}`;
};

const buildFoldersWithAggregate = (rawFolders) => {
  const aggregatePhotos = [];

  rawFolders.forEach((folder, folderIndex) => {
    folder.photos.forEach((photo, photoIndex) => {
      aggregatePhotos.push({
        ...photo,
        sourceFolderIndex: folderIndex,
        sourcePhotoIndex: photoIndex,
      });
    });
  });

  const clonedFolders = rawFolders.map((folder) => ({
    ...folder,
    photos: folder.photos.map((photo) => ({ ...photo })),
  }));

  return [
    {
      id: AGGREGATE_FOLDER_ID,
      name: AGGREGATE_FOLDER_NAME,
      description: "All images from every folder.",
      photos: aggregatePhotos,
    },
    ...clonedFolders,
  ];
};

const applySizeMode = () => {
  scheduleMasonryUpdate();
};

const toggleLoading = (isLoading) => {
  galleryElement.classList.toggle("is-loading", isLoading);
  galleryElement.setAttribute("aria-busy", String(isLoading));
};

const fetchManifest = async () => {
  const manifestUrl = NORMALIZED_API_BASE
    ? `${NORMALIZED_API_BASE}gallery.json`
    : "/assets/gallery.json";
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `assets/gallery.json could not be loaded (${response.status})`,
    );
  }

  const payload = await response.json();

  heroConfig = {
    eyebrow: null,
    title: null,
    subtitle: null,
    image: "",
  };
  applyHeroContent();
  heroElement?.style.removeProperty("--hero-image");

  let foldersPayload = payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const heroImageSource = safeText(payload.heroImage, "");
    heroConfig = {
      eyebrow: Object.prototype.hasOwnProperty.call(payload, "heroEyebrow")
        ? safeText(payload.heroEyebrow, "")
        : null,
      title: Object.prototype.hasOwnProperty.call(payload, "heroTitle")
        ? safeText(payload.heroTitle, "")
        : null,
      subtitle: Object.prototype.hasOwnProperty.call(payload, "heroSubtitle")
        ? safeText(payload.heroSubtitle, "")
        : null,
      image: heroImageSource ? resolveAssetPath(heroImageSource) : "",
    };
    applyHeroContent();
    if (!heroConfig.image) {
      heroElement?.style.removeProperty("--hero-image");
    }
    updateHeroBackground();

    if (downloadAllButton) {
      const archiveValue = payload.downloadArchive;
      const archiveUrl = resolveAssetPath(archiveValue || "");
      if (archiveUrl) {
        const archiveName = extractFileName(archiveValue) || "photos.zip";
        downloadAllButton.href = archiveUrl;
        downloadAllButton.setAttribute("download", archiveName);
      } else {
        downloadAllButton.href = "#download-all";
        downloadAllButton.removeAttribute("download");
      }
    }
    if (Array.isArray(payload.folders)) {
      foldersPayload = payload.folders;
    } else {
      throw new Error("The gallery configuration must include a folders array");
    }
  }

  if (!Array.isArray(foldersPayload)) {
    throw new Error(
      "The gallery configuration must be an array or contain a folders array",
    );
  }

  return foldersPayload.map((folder, folderIndex) => {
    const photos = Array.isArray(folder.photos) ? folder.photos : [];

    const normalizedPhotos = photos
      .map((item, photoIndex) => {
        const width = toPositiveNumber(item.width);
        const height = toPositiveNumber(item.height);
        const thumbnailWidth = toPositiveNumber(item.thumbnailWidth);
        const thumbnailHeight = toPositiveNumber(item.thumbnailHeight);

        let aspectRatio = toPositiveNumber(item.aspectRatio);
        if (!aspectRatio) {
          if (thumbnailWidth && thumbnailHeight) {
            aspectRatio = thumbnailHeight / thumbnailWidth;
          } else if (width && height) {
            aspectRatio = height / width;
          }
        }

        const orientation = deriveOrientation(
          item.orientation,
          thumbnailWidth || width,
          thumbnailHeight || height,
        );

        return {
          id: safeText(item.id, `photo-${folderIndex}-${photoIndex}`),
          title: safeText(item.title, "Untitled photo"),
          description: safeText(item.description, ""),
          thumbnail: resolveAssetPath(
            item.thumbnail || item.full || item.src || "",
          ),
          full: resolveAssetPath(item.full || item.src || item.thumbnail || ""),
          width,
          height,
          thumbnailWidth,
          thumbnailHeight,
          aspectRatio: aspectRatio || null,
          orientation,
        };
      })
      .filter((item) => item.full || item.thumbnail);

    return {
      id: safeText(folder.id, `folder-${folderIndex}`),
      name: safeText(folder.name || folder.title, `Folder ${folderIndex + 1}`),
      description: safeText(folder.description, ""),
      photos: normalizedPhotos,
    };
  });
};

const clearGallery = () => {
  galleryElement.innerHTML = "";
};

const getLayoutForIndex = (index) =>
  layoutPattern[index % layoutPattern.length];

const applyLayoutToFigure = (figure, index) => {
  const layout = getLayoutForIndex(index);
  const emphasisClass =
    layout.emphasis === "hero"
      ? "gallery-item--hero"
      : layout.emphasis === "highlight"
        ? "gallery-item--highlight"
        : null;

  if (layout.columns && layout.columns > 1) {
    figure.classList.add(`gallery-item--span-${layout.columns}`);
  }

  if (emphasisClass) {
    figure.classList.add(emphasisClass);
  }
};

const readMasonryMetrics = () => {
  if (!galleryElement) {
    return null;
  }

  const style = window.getComputedStyle(galleryElement);
  const columns = parseInt(style.getPropertyValue("--columns"), 10) || 1;
  const rowHeight =
    parseFloat(style.getPropertyValue("--masonry-row-height")) || 10;
  const rowGap =
    parseFloat(style.rowGap || style.gridRowGap || style.gap || "0") || 0;
  const columnGap =
    parseFloat(style.columnGap || style.gridColumnGap || style.gap || "0") || 0;
  const containerWidth =
    galleryElement.clientWidth || galleryElement.offsetWidth;
  const usableWidth =
    columns > 0 ? Math.max(0, containerWidth - columnGap * (columns - 1)) : 0;
  const columnWidth = columns > 0 ? usableWidth / columns : usableWidth;

  return { columns, rowHeight, rowGap, columnWidth };
};

const updateMasonrySpans = () => {
  const metrics = readMasonryMetrics();
  if (!metrics) {
    return;
  }

  const { rowHeight, rowGap, columnWidth } = metrics;
  if (!rowHeight || !columnWidth) {
    return;
  }

  const items = galleryElement.querySelectorAll(".gallery-item");
  items.forEach((item) => {
    const aspect = Number(item.dataset.aspectRatio);
    if (!Number.isFinite(aspect) || aspect <= 0) {
      item.style.removeProperty("grid-row-end");
      return;
    }

    const estimatedHeight = columnWidth * aspect;
    const span = Math.max(
      1,
      Math.round((estimatedHeight + rowGap) / (rowHeight + rowGap)),
    );
    item.style.gridRowEnd = `span ${span}`;
  });
};

const scheduleMasonryUpdate = () => {
  if (masonryRafId) {
    cancelAnimationFrame(masonryRafId);
  }
  masonryRafId = requestAnimationFrame(() => {
    masonryRafId = null;
    updateMasonrySpans();
  });
};

const renderGallery = (items) => {
  clearGallery();

  if (items.length === 0) {
    const activeFolder = folders[currentFolderIndex];
    if (activeFolder) {
      emptyStateElement.textContent = `No photos in "${activeFolder.name}" yet. Add entries to assets/gallery.json to display them here.`;
    }
    emptyStateElement.classList.remove("hidden");
    galleryElement.classList.add("hidden");
    return;
  }

  emptyStateElement.classList.add("hidden");
  galleryElement.classList.remove("hidden");

  const fragment = document.createDocumentFragment();

  items.forEach((item, index) => {
    const instance = template.content.firstElementChild.cloneNode(true);
    const figure = instance;
    const image = figure.querySelector(".gallery-item__image");
    const downloadLink = figure.querySelector(".gallery-item__download");
    const displaySrc = item.thumbnail || item.full;
    const fullSrc = item.full || item.thumbnail;
    const baseWidth = item.thumbnailWidth || item.width;
    const baseHeight = item.thumbnailHeight || item.height;
    const aspectRatio =
      item.aspectRatio ||
      (baseWidth && baseHeight ? baseHeight / baseWidth : null);

    applyLayoutToFigure(figure, index);

    image.alt = item.title;
    image.dataset.index = String(index);
    image.decoding = "async";

    figure.dataset.index = String(index);
    figure.dataset.photoId = item.id;
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-haspopup", "dialog");
    figure.setAttribute("aria-label", `View photo: ${item.title}`);
    if (aspectRatio && Number.isFinite(aspectRatio)) {
      figure.dataset.aspectRatio = String(aspectRatio);
      if (baseWidth && baseHeight) {
        figure.style.setProperty(
          "--gallery-item-aspect",
          `${baseWidth} / ${baseHeight}`,
        );
      } else {
        figure.style.setProperty(
          "--gallery-item-aspect",
          String(1 / Math.max(aspectRatio, Number.EPSILON)),
        );
      }
    } else {
      delete figure.dataset.aspectRatio;
      figure.style.removeProperty("--gallery-item-aspect");
    }

    prepareImageForLazyLoading(image, displaySrc);
    image.addEventListener(
      "load",
      () => {
        scheduleMasonryUpdate();
      },
      { once: true },
    );

    const overlayTitle = figure.querySelector(".gallery-item__title");
    if (overlayTitle) {
      overlayTitle.textContent = item.title;
    }

    if (downloadLink && fullSrc) {
      const downloadName = normalizeDownloadName(item);
      const proxiedHref = createDownloadUrl(fullSrc, downloadName);
      if (proxiedHref) {
        downloadLink.href = proxiedHref;
        downloadLink.setAttribute("download", downloadName);
      } else {
        downloadLink.href = fullSrc;
        downloadLink.removeAttribute("download");
      }
      downloadLink.title = "Download photo";
    }

    fragment.appendChild(instance);
  });

  galleryElement.appendChild(fragment);
  scheduleMasonryUpdate();
};

function renderFolderControls() {
  if (!folderControls) {
    return;
  }

  folderControls.innerHTML = "";
  folderButtons = [];
  folderControls.removeEventListener("keydown", handleFolderKeydown);

  if (folders.length <= 1) {
    folderControls.classList.add("hidden");
    return;
  }

  folderControls.classList.remove("hidden");

  const fragment = document.createDocumentFragment();

  folders.forEach((folder, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-controls__button";
    button.textContent = folder.name;
    button.dataset.index = String(index);
    button.addEventListener("click", () => {
      setActiveFolder(index);
      showGrid({ updateHistory: false });
    });
    fragment.appendChild(button);
  });

  folderControls.appendChild(fragment);
  folderButtons = Array.from(folderControls.querySelectorAll("button"));

  folderControls.addEventListener("keydown", handleFolderKeydown);
}

function handleFolderKeydown(event) {
  if (!folderButtons.length) {
    return;
  }

  const { key } = event;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
    return;
  }

  event.preventDefault();
  const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const currentFocusedIndex = folderButtons.indexOf(document.activeElement);
  const fallbackIndex =
    currentFocusedIndex >= 0 ? currentFocusedIndex : currentFolderIndex;
  const nextIndex =
    (fallbackIndex + direction + folderButtons.length) % folderButtons.length;
  folderButtons[nextIndex].focus();
  setActiveFolder(nextIndex);
  showGrid({ updateHistory: false });
}

function setActiveFolder(
  index,
  { updateHistory = true, replaceHistory = false } = {},
) {
  if (!folders[index]) {
    return;
  }

  currentFolderIndex = index;
  currentPhotos = folders[index].photos || [];
  currentPhotoIndex = -1;

  updateFolderSelectionUI();
  renderGallery(currentPhotos);
  updateHeroBackground(index);
  scheduleMasonryUpdate();

  if (updateHistory) {
    const folder = folders[index];
    updateHistoryState({ folderId: folder.id, replace: replaceHistory });
  }
}

function updateFolderSelectionUI() {
  if (!folderButtons.length) {
    return;
  }

  folderButtons.forEach((button, index) => {
    const isActive = index === currentFolderIndex;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function openDetail(
  folderIndex,
  photoIndex,
  { updateHistory = true, replaceHistory = false } = {},
) {
  if (!folders[folderIndex] || !folders[folderIndex].photos[photoIndex]) {
    return;
  }

  if (folderIndex !== currentFolderIndex) {
    setActiveFolder(folderIndex, { updateHistory: false });
  }

  currentPhotos = folders[currentFolderIndex].photos || [];
  currentPhotoIndex = photoIndex;

  const photo = currentPhotos[currentPhotoIndex];
  const activeFolder = folders[currentFolderIndex];

  detailImage.src = photo.full;
  detailImage.alt = photo.title;
  detailTitle.textContent = photo.title;
  if (detailCount) {
    const humanIndex = currentPhotoIndex + 1;
    detailCount.textContent = `${humanIndex} / ${currentPhotos.length}`;
  }
  ensurePhotoPreloaded(photo);

  if (detailDownloadButton) {
    const downloadName = normalizeDownloadName(photo);
    const proxiedHref = createDownloadUrl(photo.full, downloadName);
    if (proxiedHref) {
      detailDownloadButton.href = proxiedHref;
      detailDownloadButton.setAttribute("download", downloadName);
    } else {
      detailDownloadButton.href = photo.full;
      detailDownloadButton.removeAttribute("download");
    }
  }

  if (detailPrevButton && detailNextButton) {
    const disableNav = currentPhotos.length < 2;
    detailPrevButton.disabled = disableNav;
    detailNextButton.disabled = disableNav;
  }

  detailView.classList.remove("hidden");
  detailView.setAttribute("aria-hidden", "false");
  detailView.scrollTop = 0;
  toggleBodyLock(true);
  if (typeof detailView.focus === "function") {
    detailView.focus({ preventScroll: true });
  }
  pageElement?.classList.add("page--lightbox-active");
  galleryElement?.setAttribute("aria-hidden", "true");
  emptyStateElement.classList.add("hidden");

  document.title = `${photo.title} • ${basePageTitle}`;

  preloadAdjacentDetailPhotos();

  if (updateHistory) {
    updateHistoryState({
      folderId: activeFolder ? activeFolder.id : AGGREGATE_FOLDER_ID,
      photoId: photo.id,
      replace: replaceHistory,
    });
  }
}

function showGrid({ updateHistory = true, replaceHistory = false } = {}) {
  currentPhotoIndex = -1;
  detailView.classList.add("hidden");
  detailView.setAttribute("aria-hidden", "true");
  toggleBodyLock(false);
  pageElement?.classList.remove("page--lightbox-active");
  galleryElement?.removeAttribute("aria-hidden");
  document.title = basePageTitle;

  if (detailImage) {
    detailImage.src = "";
    detailImage.removeAttribute("src");
    detailImage.alt = "";
  }
  if (detailDownloadButton) {
    detailDownloadButton.href = "#";
    detailDownloadButton.removeAttribute("download");
  }

  if (updateHistory) {
    const folder = folders[currentFolderIndex];
    const folderId = folder ? folder.id : AGGREGATE_FOLDER_ID;
    updateHistoryState({ folderId, replace: replaceHistory });
  }

  scheduleMasonryUpdate();
}

function showRelative(delta) {
  if (currentPhotoIndex === -1 || !currentPhotos.length) {
    return;
  }

  const nextIndex =
    (currentPhotoIndex + delta + currentPhotos.length) % currentPhotos.length;
  openDetail(currentFolderIndex, nextIndex);
}

function findFolderIndexById(id) {
  return folders.findIndex((folder) => folder.id === id);
}

function findPhotoIndexById(folderIndex, photoId) {
  if (!folders[folderIndex]) {
    return -1;
  }
  return folders[folderIndex].photos.findIndex((photo) => photo.id === photoId);
}

function handlePopState(event) {
  if (isHandlingPopState) {
    return;
  }

  isHandlingPopState = true;
  try {
    const state =
      event?.state && typeof event.state === "object"
        ? {
            folderId: normalizeFolderId(event.state.folderId),
            photoId: safeText(event.state.photoId, ""),
          }
        : parseLocationState();

    if (!folders.length) {
      return;
    }

    let targetFolderIndex = findFolderIndexById(state.folderId);
    if (targetFolderIndex === -1) {
      targetFolderIndex = findFolderIndexById(AGGREGATE_FOLDER_ID);
      if (targetFolderIndex === -1) {
        targetFolderIndex = 0;
      }
    }

    setActiveFolder(targetFolderIndex, { updateHistory: false });

    if (state.photoId) {
      const photoIndex = findPhotoIndexById(targetFolderIndex, state.photoId);
      if (photoIndex !== -1) {
        openDetail(targetFolderIndex, photoIndex, { updateHistory: false });
        return;
      }
    }

    showGrid({ updateHistory: false });
  } finally {
    isHandlingPopState = false;
  }
}

const boot = async () => {
  toggleLoading(true);
  try {
    baseFolders = await fetchManifest();
    if (!Array.isArray(baseFolders) || baseFolders.length === 0) {
      emptyStateElement.textContent =
        "No folders found. Add at least one folder with photos in assets/gallery.json.";
      emptyStateElement.classList.remove("hidden");
      folderControls?.classList.add("hidden");
      return;
    }

    folders = buildFoldersWithAggregate(baseFolders);

    renderFolderControls();
    applySizeMode();

    const { photoId } = parseLocationState();
    const aggregateIndex = findFolderIndexById(AGGREGATE_FOLDER_ID);
    const initialFolderIndex = aggregateIndex !== -1 ? aggregateIndex : 0;

    setActiveFolder(initialFolderIndex, { updateHistory: false });

    let openedPhoto = false;
    if (photoId) {
      const photoIndex = findPhotoIndexById(initialFolderIndex, photoId);
      if (photoIndex !== -1) {
        openDetail(initialFolderIndex, photoIndex, {
          updateHistory: false,
        });
        openedPhoto = true;
      }
    }

    const activeFolder = folders[currentFolderIndex];
    const activePhoto =
      openedPhoto && currentPhotos[currentPhotoIndex]
        ? currentPhotos[currentPhotoIndex]
        : null;

    updateHistoryState({
      folderId: activeFolder ? activeFolder.id : AGGREGATE_FOLDER_ID,
      photoId: activePhoto ? activePhoto.id : "",
      replace: true,
    });

    window.addEventListener("popstate", handlePopState);
  } catch (error) {
    console.error(error);
    emptyStateElement.textContent = `${error.message}. Please open index.html via a local server.`;
    emptyStateElement.classList.remove("hidden");
  } finally {
    toggleLoading(false);
    scheduleMasonryUpdate();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((error) => console.error(error));
});

window.addEventListener("resize", () => {
  if (resizeTimerId) {
    window.clearTimeout(resizeTimerId);
  }
  resizeTimerId = window.setTimeout(() => scheduleMasonryUpdate(), 120);
});

homeLink?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!folders.length) {
    return;
  }
  setActiveFolder(0);
  showGrid({ updateHistory: false });
});

const getPhotoFromItem = (item) => {
  const index = Number(item?.dataset.index);
  if (Number.isNaN(index) || index < 0) {
    return null;
  }
  return currentPhotos?.[index] || null;
};

const clearHoverPreload = (item) => {
  const timerId = hoverPreloadTimers.get(item);
  if (typeof timerId === "number") {
    window.clearTimeout(timerId);
    hoverPreloadTimers.delete(item);
  }
};

const scheduleHoverPreload = (item) => {
  clearHoverPreload(item);
  const photo = getPhotoFromItem(item);
  if (!photo || !photo.full || preloadedPhotoUrls.has(photo.full)) {
    return;
  }

  const timerId = window.setTimeout(() => {
    hoverPreloadTimers.delete(item);
    ensurePhotoPreloaded(photo);
  }, HOVER_PRELOAD_DELAY);

  hoverPreloadTimers.set(item, timerId);
};

const preloadAdjacentDetailPhotos = () => {
  if (
    !Array.isArray(currentPhotos) ||
    currentPhotos.length < 2 ||
    currentPhotoIndex === -1
  ) {
    return;
  }

  const prevIndex =
    (currentPhotoIndex - 1 + currentPhotos.length) % currentPhotos.length;
  const nextIndex = (currentPhotoIndex + 1) % currentPhotos.length;

  if (prevIndex !== currentPhotoIndex) {
    ensurePhotoPreloaded(currentPhotos[prevIndex]);
  }
  if (nextIndex !== currentPhotoIndex) {
    ensurePhotoPreloaded(currentPhotos[nextIndex]);
  }
};

galleryElement?.addEventListener(
  "pointerenter",
  (event) => {
    const item =
      event.target instanceof Element
        ? event.target.closest(GALLERY_ITEM_SELECTOR)
        : null;
    if (!item || !galleryElement.contains(item)) {
      return;
    }
    if (
      event.relatedTarget instanceof Element &&
      item.contains(event.relatedTarget)
    ) {
      return;
    }
    scheduleHoverPreload(item);
  },
  true,
);

galleryElement?.addEventListener(
  "pointerleave",
  (event) => {
    const item =
      event.target instanceof Element
        ? event.target.closest(GALLERY_ITEM_SELECTOR)
        : null;
    if (!item || !galleryElement.contains(item)) {
      return;
    }
    if (
      event.relatedTarget instanceof Element &&
      item.contains(event.relatedTarget)
    ) {
      return;
    }
    clearHoverPreload(item);
  },
  true,
);

galleryElement?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(DOWNLOAD_LINK_SELECTOR)) {
    return;
  }

  const item = target.closest(GALLERY_ITEM_SELECTOR);
  if (!item) {
    return;
  }

  const photoIndex = Number(item.dataset.index);
  if (!Number.isNaN(photoIndex)) {
    openDetail(currentFolderIndex, photoIndex);
  }
});

galleryElement?.addEventListener("keydown", (event) => {
  if (
    !(event.target instanceof Element) ||
    event.target.closest(DOWNLOAD_LINK_SELECTOR)
  ) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const item = event.target.closest(GALLERY_ITEM_SELECTOR);
  if (!item) {
    return;
  }

  event.preventDefault();
  const photoIndex = Number(item.dataset.index);
  if (!Number.isNaN(photoIndex)) {
    openDetail(currentFolderIndex, photoIndex);
  }
});

detailCloseButton?.addEventListener("click", () => showGrid());
detailPrevButton?.addEventListener("click", () => showRelative(-1));
detailNextButton?.addEventListener("click", () => showRelative(1));

detailView?.addEventListener("click", (event) => {
  if (event.target === detailView) {
    showGrid();
  }
});

document.addEventListener("keydown", (event) => {
  if (currentPhotoIndex === -1) {
    return;
  }

  if (event.key === "Escape") {
    showGrid();
  } else if (event.key === "ArrowRight") {
    showRelative(1);
  } else if (event.key === "ArrowLeft") {
    showRelative(-1);
  }
});
