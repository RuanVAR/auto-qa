import { useMutation } from '@tanstack/react-query';
import { pluginsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * "Connect with Google" button. Asks the API for a consent URL (which stashes
 * a one-time state server-side) and navigates the browser to it. Google
 * redirects back to /org/plugins?gdrive=connected (handled on PluginsPage).
 *
 * A 400 here means the deployment hasn't set GOOGLE_CLIENT_ID/SECRET — surface
 * the operator-facing message rather than a generic failure.
 */
export function GoogleDriveConnect({ orgId, displayLabel }: { orgId: string; displayLabel?: string }) {
  const start = useMutation({
    mutationFn: () => pluginsApi.gdriveOauthStart(orgId, displayLabel),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Could not start Google connect');
    },
  });

  return (
    <Button onClick={() => start.mutate()} loading={start.isPending} className="w-full justify-center">
      <GoogleGlyph /> Connect with Google
    </Button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" className="mr-1" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C40.9 35.4 44 30.1 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}
