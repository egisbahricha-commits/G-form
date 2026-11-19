import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/forms.body');
provider.setCustomParameters({
  include_granted_scopes: 'true',
  prompt: 'consent',
});

const silentRefreshProvider = new GoogleAuthProvider();
silentRefreshProvider.addScope('https://www.googleapis.com/auth/forms.body');
silentRefreshProvider.setCustomParameters({
  include_granted_scopes: 'true',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedExpiresAtMs = 0;

export interface GoogleAuthSnapshot {
  user: User | null;
  accessToken: string | null;
  expiresAtMs: number;
}

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function recordToken(accessToken: string, expiresInSec = 3300) {
  cachedAccessToken = accessToken;
  cachedExpiresAtMs = Date.now() + expiresInSec * 1000;
}

export function initGoogleAuth(
  onAuthChange: (state: GoogleAuthSnapshot) => void
) {
  // Handle return from mobile signInWithRedirect if active
  void getRedirectResult(auth)
    .then((result) => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          recordToken(credential.accessToken);
          onAuthChange({
            user: result.user,
            accessToken: cachedAccessToken,
            expiresAtMs: cachedExpiresAtMs,
          });
        }
      }
    })
    .catch(() => {
      // Redirect result may be empty on normal page load
    });

  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken && Date.now() < cachedExpiresAtMs) {
      onAuthChange({
        user,
        accessToken: cachedAccessToken,
        expiresAtMs: cachedExpiresAtMs,
      });
    } else if (!isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
        cachedExpiresAtMs = 0;
      }
      onAuthChange({
        user,
        accessToken: cachedAccessToken,
        expiresAtMs: cachedExpiresAtMs,
      });
    }
  });
}

export async function signInWithGoogleForms(): Promise<{
  user: User;
  accessToken: string;
  expiresAtMs: number;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh token akses Google Forms dari autentikasi.');
    }
    recordToken(credential.accessToken);
    return {
      user: result.user,
      accessToken: cachedAccessToken!,
      expiresAtMs: cachedExpiresAtMs,
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    const shouldRedirectFallback =
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      (isMobileBrowser() && code === 'auth/cancelled-popup-request');

    if (shouldRedirectFallback) {
      await signInWithRedirect(auth, provider);
      throw new Error('Mengalihkan ke halaman persetujuan Google...');
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export async function refreshGoogleAccessToken(): Promise<{
  user: User;
  accessToken: string;
  expiresAtMs: number;
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return signInWithGoogleForms();
  }

  try {
    isSigningIn = true;
    const result = await reauthenticateWithPopup(currentUser, silentRefreshProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      return signInWithGoogleForms();
    }
    recordToken(credential.accessToken);
    return {
      user: result.user,
      accessToken: cachedAccessToken!,
      expiresAtMs: cachedExpiresAtMs,
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await reauthenticateWithRedirect(currentUser, silentRefreshProvider);
      throw new Error('Mengalihkan ke otorisasi ulang Google...');
    }
    return signInWithGoogleForms();
  } finally {
    isSigningIn = false;
  }
}

export function isAccessTokenExpiringSoon(): boolean {
  if (!cachedAccessToken) return true;
  return Date.now() >= cachedExpiresAtMs - 60_000;
}

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogle(): Promise<void> {
  cachedAccessToken = null;
  cachedExpiresAtMs = 0;
  await auth.signOut();
}
