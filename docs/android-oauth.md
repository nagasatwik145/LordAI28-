# Android Google OAuth configuration

The Android Google sign-in uses the installed app's callback:

```text
com.nagasatwik145.lordai://auth/callback
```

## Supabase Auth

In **Authentication → URL Configuration → Redirect URLs**, add this exact URL:

```text
com.nagasatwik145.lordai://auth/callback
```

Keep the exact production website redirect URLs already in use. Website Google sign-in returns to `https://<production-host>/auth`; email confirmation returns to `https://<production-host>/chat`; password reset returns to `https://<production-host>/reset-password`. Add the corresponding exact URLs/origins used by each production website if they are not already allowed. Do not replace them with the mobile callback or use a wildcard.

## Google Cloud OAuth client

In the OAuth client used by the Supabase Google provider, keep/add the Supabase project's callback URI under **Authorized redirect URIs**:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Replace `<project-ref>` with the Supabase project reference. Google redirects to Supabase first; Supabase then redirects to the selected `redirectTo` URL (the website for web sign-in or the app scheme for Android). The mobile callback is **not** a Google authorized redirect URI.

The Android manifest declares the exact scheme, `auth` host, and `/callback` path. Rebuild and reinstall the Android app after syncing the Capacitor project for this intent filter to take effect. This repository does not change Supabase or Google dashboard settings.
