import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { api } from '@/lib/api';

/**
 * ArtifactImage
 * -------------
 * Renders an artifact image fetched from /api/v1/artifacts/:id/download?inline=1.
 *
 * Why this exists: the artifact download endpoint is gated by the global
 * JwtAuthGuard, so a plain <img src="/api/v1/artifacts/abc/download?inline=1">
 * silently 401s — the browser doesn't attach the Authorization header to
 * <img> requests. Result: broken-image icons everywhere screenshots should
 * be visible.
 *
 * Fix: fetch the bytes via axios (the interceptor attaches our Bearer
 * token), wrap them in a blob URL, point the <img> at that. The blob URL
 * is revoked on unmount or artifact change so we don't leak megabytes per
 * screenshot in long-lived run pages.
 */

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  artifactId: string;
  /** Optional placeholder while bytes are loading. */
  placeholder?: React.ReactNode;
  /** Alt text — defaults to filename or "Artifact" if unknown. */
  alt?: string;
}

export function ArtifactImage({ artifactId, placeholder, alt, className, style, ...rest }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setErr(null);
    setSrc(null);

    (async () => {
      try {
        // axios.get with responseType: 'blob' returns the raw image bytes
        // with our Bearer token attached via the request interceptor.
        const r = await api.get(`/api/v1/artifacts/${artifactId}/download`, {
          params: { inline: 1 },
          responseType: 'blob',
        });
        if (revoked) return;
        objectUrl = URL.createObjectURL(r.data as Blob);
        setSrc(objectUrl);
      } catch (e) {
        if (revoked) return;
        const msg =
          (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          ?? (e as Error).message
          ?? 'Failed to load image';
        setErr(msg);
      }
    })();

    // Revoke on unmount or artifact change. Without this, every reopened
    // lightbox would leak ~500KB.
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId]);

  if (err) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(239,68,68,0.08)',
          color: '#f87171',
          fontSize: 11,
          padding: '8px',
          textAlign: 'center',
        }}
        title={err}
      >
        Image unavailable
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.04)',
          color: 'rgba(238,238,248,0.40)',
          fontSize: 11,
        }}
      >
        {placeholder ?? 'Loading…'}
      </div>
    );
  }

  return <img src={src} alt={alt ?? 'Artifact'} className={className} style={style} {...rest} />;
}

/**
 * Trigger a browser download of an artifact via authenticated fetch. Used
 * by the gallery's download chips and the lightbox download button. Saves
 * to disk with the artifact's stored filename.
 */
export async function downloadArtifact(artifactId: string, filename: string): Promise<void> {
  const r = await api.get(`/api/v1/artifacts/${artifactId}/download`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Don't revoke immediately — Safari sometimes still needs the URL during
  // the click cycle. A short timeout is safe and the GC will catch up.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
