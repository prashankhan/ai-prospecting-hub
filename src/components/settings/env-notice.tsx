import { CircleAlert } from "lucide-react";

export function EncryptionNotice() {
  return (
    <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-warning">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <p><strong className="font-medium">CREDENTIALS_ENCRYPTION_KEY is not set.</strong> Credentials can&apos;t be saved until the hosting environment provides a 32-byte base64 key. See README → Configuration.</p>
    </div>
  );
}
