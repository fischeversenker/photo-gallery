const ROOT_DIR = new URL('.', import.meta.url);
const INDEX_URL = new URL('./index.html', ROOT_DIR);
const LOGIN_TEMPLATE_PATH = new URL('./login.html', ROOT_DIR);

const COOKIE_NAME = 'gallery_session';
const encoder = new TextEncoder();

// TODO: remove hardcoded password here as soon as Deno Deploy Env Vars are fixed
const PASSWORD = Deno.env.get('GALLERY_PASSWORD') ?? 'yasnafelix2024';
if (!PASSWORD) {
  console.error('Environment variable GALLERY_PASSWORD is not set.');
  Deno.exit(1);
}

const SESSION_SECRET =
  Deno.env.get('SESSION_SECRET') ??
  (await crypto.subtle
    .digest('SHA-256', encoder.encode(PASSWORD + 'wedding-gallery-secret'))
    .then((buffer) => {
      const bytes = new Uint8Array(buffer);
      return Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    }));

const EXPECTED_TOKEN = await computeToken(PASSWORD);
const LOGIN_TEMPLATE = await Deno.readTextFile(LOGIN_TEMPLATE_PATH);

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/login.html',
  '/styles.css',
  '/favicon.ico',
]);

Deno.serve({ port: Number(Deno.env.get('PORT') ?? '8000') }, async (req) => {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);

  const authorized = await isAuthorized(req);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (pathname === '/login' && req.method === 'GET') {
    if (authorized) {
      return redirect('/');
    }
    const errorMessage =
      url.searchParams.get('error') === '1'
        ? 'Incorrect password. Please try again.'
        : '&nbsp;';
    return renderLogin(errorMessage);
  }

  if (pathname === '/login' && req.method === 'POST') {
    const form = await req.formData();
    const submitted = String(form.get('password') ?? '');
    if (!submitted) {
      return renderLogin('Please enter the password.', 400);
    }

    const submittedToken = await computeToken(submitted);
    if (submittedToken !== EXPECTED_TOKEN) {
      return redirect('/login?error=1');
    }

    const headers = new Headers({
      Location: '/',
    });
    headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${EXPECTED_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${
        60 * 60 * 8
      }`
    );
    return new Response(null, { status: 303, headers });
  }

  if (pathname === '/logout') {
    const headers = new Headers({
      Location: '/login',
    });
    headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    );
    return new Response(null, { status: 303, headers });
  }

  if (!authorized && !isPublic) {
    return redirect('/login');
  }

  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(INDEX_URL);
  }

  if (pathname === '/login.html') {
    if (authorized) {
      return redirect('/');
    }
    return renderLogin('&nbsp;');
  }

  if (
    pathname === '/styles.css' ||
    pathname === '/app.js' ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/scripts/')
  ) {
    try {
      const fileUrl = resolvePath(pathname);
      return serveFile(fileUrl);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return notFound();
      }
      console.error(error);
      return new Response('Forbidden', { status: 403 });
    }
  }

  if (authorized) {
    return serveFile(INDEX_URL);
  }

  return redirect('/login');
});

async function isAuthorized(req: Request): Promise<boolean> {
  const cookies = parseCookies(req.headers.get('cookie') || '');
  const token = cookies.get(COOKIE_NAME);
  if (!token) {
    return false;
  }
  return token === EXPECTED_TOKEN;
}

async function computeToken(value: string): Promise<string> {
  const data = encoder.encode(`${value}|${SESSION_SECRET}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64(digest);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function parseCookies(header: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) {
    return map;
  }
  const parts = header.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (!name) continue;
    const value = rest.join('=');
    map.set(name, value);
  }
  return map;
}

function resolvePath(pathname: string): URL {
  const cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const candidate = new URL(cleanPath, ROOT_DIR);
  if (!candidate.pathname.startsWith(ROOT_DIR.pathname)) {
    throw new Error('Path traversal attempt detected.');
  }
  return candidate;
}

async function serveFile(fileUrl: URL): Promise<Response> {
  try {
    const file = await Deno.readFile(fileUrl);
    const contentType = getContentType(fileUrl.pathname);
    const headers = new Headers();
    if (contentType) {
      headers.set('content-type', contentType);
    }
    return new Response(file, { status: 200, headers });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return notFound();
    }
    console.error(error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

function renderLogin(message: string, status = 200): Response {
  const html = LOGIN_TEMPLATE.replace('{{ERROR_MESSAGE}}', message || '&nbsp;');
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
    },
  });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

function getContentType(pathname: string): string | undefined {
  const lower = pathname.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.gif')) return 'image/gif';
  return undefined;
}
