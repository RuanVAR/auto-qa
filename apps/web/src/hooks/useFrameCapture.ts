import { useCallback, useState } from 'react';
import { useScreenRecording, type UseScreenRecordingReturn } from './useScreenRecording';
import { captureViaDisplayMedia, captureViaCropTarget, cropBlobToIframe } from '@/lib/frameCapture';
import { toast } from '@/components/ui/Toast';

interface Options {
  /** The app-under-test iframe to capture. Return null to capture via the
   *  screen picker instead (e.g. the bug modal opened outside the testing view). */
  getIframe: () => HTMLIFrameElement | null;
  /** Called with the captured screenshot blob (WebP). */
  onScreenshot: (blob: Blob) => void | Promise<void>;
  /** Called with the finished recording blob + duration. */
  onRecordingComplete: (blob: Blob, durationMs: number) => void | Promise<void>;
  onRecordingError?: (message: string) => void;
}

interface FrameCapture {
  captureScreenshot: () => Promise<void>;
  isCapturing: boolean;
  recording: UseScreenRecordingReturn;
}

const HTTPS_HINT =
  'This page is served over plain HTTP, so the browser refuses to expose screen-capture APIs. Ask an admin to put TLS in front of the platform.';

/**
 * Shared "capture the app frame" behaviour for the testing floating bar and the
 * bug modal. Screenshot tries, in order: same-origin DOM render (instant, no
 * prompt) → Chromium Region Capture cropped to the iframe → getDisplayMedia +
 * manual crop. Recording crops to the iframe via Region Capture where supported.
 */
export function useFrameCapture({ getIframe, onScreenshot, onRecordingComplete, onRecordingError }: Options): FrameCapture {
  const [isCapturing, setCapturing] = useState(false);

  const surfaceFail = (reason: 'unsupported' | 'denied' | 'unknown' | 'insecure-context') => {
    switch (reason) {
      case 'insecure-context':
        toast.error('Screen capture needs HTTPS', HTTPS_HINT, 0);
        break;
      case 'unsupported':
        toast.error('Browser doesn’t support screen capture', 'Try the latest Chrome, Edge or Firefox.');
        break;
      case 'denied':
        toast.warning('Capture cancelled', 'You closed the picker — try again.');
        break;
      default:
        toast.error('Capture failed', 'The browser returned no frame. Try again.');
    }
  };

  const captureScreenshot = useCallback(async () => {
    setCapturing(true);
    try {
      const iframe = getIframe();

      // No iframe context → straight to the screen picker.
      if (!iframe) {
        const r = await captureViaDisplayMedia();
        if (r.ok) await onScreenshot(r.blob);
        else surfaceFail(r.reason);
        return;
      }

      // Path 1: same-origin iframe — instant DOM render, no permission prompt.
      const doc = iframe.contentDocument;
      if (doc?.documentElement) {
        const { toCanvas } = await import('html-to-image');
        const canvas = await toCanvas(doc.documentElement, { cacheBust: true, pixelRatio: window.devicePixelRatio || 1 });
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
        if (!blob) throw new Error('capture-failed');
        await onScreenshot(blob);
        return;
      }

      // Path 2: cross-origin — Region Capture crops the tab stream to the iframe.
      const crop = await captureViaCropTarget(iframe);
      if (crop.ok) { await onScreenshot(crop.blob); return; }
      if (crop.reason === 'denied') { toast.warning('Capture cancelled', 'You closed the picker — try again and pick this tab.'); return; }
      if (crop.reason === 'insecure-context') { toast.error('Screen capture needs HTTPS', HTTPS_HINT, 0); return; }

      // Path 3: Firefox/Safari — full getDisplayMedia frame, manually cropped.
      toast.info('Screen share prompt incoming', 'Cross-origin app — pick THIS TAB for a clean crop.');
      const r = await captureViaDisplayMedia();
      if (!r.ok) { surfaceFail(r.reason); return; }
      const cropped = await cropBlobToIframe(r.blob, iframe).catch(() => null);
      await onScreenshot(cropped ?? r.blob);
    } catch (err) {
      const msg = (err as Error)?.message;
      toast.error('Capture failed', msg === 'capture-failed' ? 'Try again — DOM render returned no image.' : 'Try again.');
    } finally {
      setCapturing(false);
    }
  }, [getIframe, onScreenshot]);

  const recording = useScreenRecording({
    onComplete: onRecordingComplete,
    onError: onRecordingError ?? ((msg) => toast.error('Recording error', msg)),
    // Crop the recording to the app iframe where the browser supports it.
    getCropTargetEl: getIframe,
  });

  return { captureScreenshot, isCapturing, recording };
}
