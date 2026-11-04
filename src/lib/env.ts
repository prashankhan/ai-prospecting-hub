/** Environment access. Values are read lazily so builds succeed before configuration. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "",
    setupToken: process.env.SETUP_TOKEN ?? "",
    cronSecret: process.env.CRON_SECRET ?? "",
    appUrl: (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
  };
}

export function configurationStatus() {
  const s = serverEnv();
  return {
    supabase: isSupabaseConfigured(),
    serviceRole: Boolean(s.serviceRoleKey),
    encryptionKey: Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY),
    setupToken: Boolean(s.setupToken),
    cronSecret: Boolean(s.cronSecret),
  };
}
