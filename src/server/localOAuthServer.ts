import http from 'node:http';
import { execFile } from 'node:child_process';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { setAuthorizedGoogleToken } from './authBridge.ts';
import { verifyGoogleOAuthToken } from './googleFormsService.ts';

interface PendingAuthWaiter {
  resolve: (result: { accessToken: string; email?: string }) => void;
  reject: (err: Error) => void;
}

let activeServer: http.Server | null = null;
let activeBaseUrl: string | null = null;
const pendingWaiters: PendingAuthWaiter[] = [];

function buildLocalConnectHtml(): string {
  const safeConfigJson = JSON.stringify(firebaseConfig);
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AssessCraft — Hubungkan Google Forms (OAuth 2.0)</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #f8fafc;
        color: #0f172a;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .card {
        width: 100%;
        max-width: 460px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 28px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #1d4ed8;
        margin: 0 0 8px;
      }
      h1 {
        font-size: 20px;
        line-height: 1.3;
        margin: 0 0 10px;
      }
      p {
        font-size: 14px;
        line-height: 1.55;
        color: #475569;
        margin: 0 0 18px;
      }
      .btn {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 13px 16px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        background: #1d4ed8;
        color: #ffffff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }
      .btn:hover { background: #1e40af; }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .status {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        font-size: 13px;
        line-height: 1.5;
        display: none;
      }
      .status.ok {
        display: block;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #065f46;
      }
      .status.err {
        display: block;
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
      }
      .status.info {
        display: block;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #1e3a8a;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">AssessCraft Google Forms Bridge</p>
      <h1>Hubungkan Akun Google Anda</h1>
      <p>
        Setujui akses <strong>Google Forms</strong> agar Claude dan AssessCraft dapat langsung membuat formulir kuis, kunci jawaban, dan bobot poin ke akun Google Anda.
      </p>
      <button id="connectBtn" class="btn" type="button">
        Sign in with Google (OAuth 2.0)
      </button>
      <div id="statusBox" class="status"></div>
    </main>

    <script type="module">
      import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
      import {
        getAuth,
        getRedirectResult,
        GoogleAuthProvider,
        signInWithPopup,
        signInWithRedirect,
      } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

      const firebaseConfig = ${safeConfigJson};
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);

      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/forms.body');
      provider.setCustomParameters({
        include_granted_scopes: 'true',
        prompt: 'consent',
      });

      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('sessionId') || '';
      const btn = document.getElementById('connectBtn');
      const statusBox = document.getElementById('statusBox');

      function setStatus(kind, text) {
        statusBox.className = 'status ' + kind;
        statusBox.textContent = text;
      }

      async function sendTokenToLocalBridge(accessToken, email) {
        setStatus('info', 'Memverifikasi izin Google Forms dan menghubungkan ke Claude...');
        const res = await fetch('/oauth-callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken, email, sessionId }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gagal menyimpan sesi OAuth.');
        }
        setStatus(
          'ok',
          'Berhasil terhubung sebagai ' +
            (data.email || email || 'akun Google Anda') +
            '! Anda dapat kembali ke terminal / Claude sekarang — Google Form sedang dibuat.'
        );
        btn.textContent = 'Terhubung ke Google Forms';
      }

      // Check redirect fallback result if returning from redirect flow
      getRedirectResult(auth)
        .then(async (result) => {
          if (result) {
            const cred = GoogleAuthProvider.credentialFromResult(result);
            if (cred?.accessToken) {
              await sendTokenToLocalBridge(cred.accessToken, result.user?.email || undefined);
            }
          }
        })
        .catch(() => {});

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        setStatus('info', 'Membuka persetujuan Google OAuth 2.0...');
        try {
          const result = await signInWithPopup(auth, provider);
          const cred = GoogleAuthProvider.credentialFromResult(result);
          if (!cred?.accessToken) {
            throw new Error('Token akses Google Forms tidak ditemukan pada respons OAuth.');
          }
          await sendTokenToLocalBridge(cred.accessToken, result.user?.email || undefined);
        } catch (err) {
          const code = err?.code || '';
          if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
            setStatus('info', 'Popup diblokir, mengalihkan ke halaman login Google...');
            await signInWithRedirect(auth, provider);
            return;
          }
          setStatus('err', err?.message || 'Gagal menghubungkan akun Google.');
          btn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

export function tryOpenBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      execFile('open', [url], () => {});
    } else if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], () => {});
    } else {
      execFile('xdg-open', [url], () => {});
    }
  } catch {
    // Non-fatal if headless or browser launcher unavailable
  }
}

async function listenOnPreferredPort(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Gagal membaca port server OAuth lokal.'));
      }
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function ensureLocalOAuthBridge(sessionId?: string): Promise<{
  baseUrl: string;
  connectUrl: string;
  waitForAuthorization: (timeoutMs?: number) => Promise<{ accessToken: string; email?: string }>;
  close: () => Promise<void>;
}> {
  if (!activeServer || !activeBaseUrl) {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');

      if (req.method === 'GET' && reqUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/connect')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildLocalConnectHtml());
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/oauth-callback') {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            accessToken?: string;
            email?: string;
            sessionId?: string;
          };

          const accessToken = (body.accessToken || '').trim();
          if (!accessToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access token wajib dikirim.' }));
            return;
          }

          const tokenStatus = await verifyGoogleOAuthToken(accessToken);
          if (!tokenStatus.valid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Token Google OAuth tidak valid atau kedaluwarsa.' }));
            return;
          }
          if (!tokenStatus.hasFormsScope) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Izin Google Forms (forms.body) belum disetujui. Silakan centang izin akses Forms.',
              })
            );
            return;
          }

          const email = tokenStatus.email || body.email;
          setAuthorizedGoogleToken({
            key: body.sessionId || undefined,
            accessToken,
            email,
            expiresInSeconds: tokenStatus.expiresInSeconds,
          });

          while (pendingWaiters.length > 0) {
            const waiter = pendingWaiters.shift();
            waiter?.resolve({ accessToken, email });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, email }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Gagal memproses callback OAuth.',
            })
          );
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });

    let boundPort: number;
    try {
      boundPort = await listenOnPreferredPort(server, 43110);
    } catch {
      boundPort = await listenOnPreferredPort(server, 0);
    }

    activeServer = server;
    // Use localhost (authorized in Firebase Auth by default)
    activeBaseUrl = `http://localhost:${boundPort}`;
  }

  const baseUrl = activeBaseUrl;
  const connectUrl = sessionId
    ? `${baseUrl}/connect?sessionId=${encodeURIComponent(sessionId)}`
    : `${baseUrl}/connect`;

  const waitForAuthorization = (timeoutMs = 180_000) =>
    new Promise<{ accessToken: string; email?: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = pendingWaiters.findIndex((w) => w === waiter);
        if (idx >= 0) pendingWaiters.splice(idx, 1);
        reject(
          new Error(
            `Waktu tunggu otorisasi Google OAuth habis (${Math.round(timeoutMs / 1000)} detik). Buka ${connectUrl} dan coba lagi.`
          )
        );
      }, timeoutMs);

      const waiter: PendingAuthWaiter = {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      pendingWaiters.push(waiter);
    });

  const close = async () => {
    if (!activeServer) return;
    const srv = activeServer;
    activeServer = null;
    activeBaseUrl = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  };

  return { baseUrl, connectUrl, waitForAuthorization, close };
}
