/**
 * Browser screen-capture helpers shared by the testing floating bar and the
 * bug modal. Pure functions — no React, no component state. They produce a
 * WebP Blob cropped to the app-under-test iframe wherever the browser allows
 * it (Region Capture on Chromium; manual crop fallback elsewhere).
 */

type CaptureFail = { ok: false; reason: 'unsupported' | 'denied' | 'unknown' | 'insecure-context' };
type CaptureOk = { ok: true; blob: Blob };
export type CaptureResult = CaptureOk | CaptureFail;

/**
 * Grab a single frame via getDisplayMedia — the user picks a tab/window/screen.
 * The fallback when same-origin DOM capture isn't possible (cross-origin iframe).
 */
export async function captureViaDisplayMedia(): Promise<CaptureResult> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, reason: 'insecure-context' };
  }
  if (!navigator.mediaDevices?.getDisplayMedia) return { ok: false, reason: 'unsupported' };
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as unknown as MediaTrackConstraints,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return { ok: false, reason: 'unknown' };
    const blob = await grabFrame(track, stream);
    return blob ? { ok: true, blob } : { ok: false, reason: 'unknown' };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return { ok: false, reason: name === 'NotAllowedError' ? 'denied' : 'unknown' };
  } finally {
    for (const t of stream?.getTracks() ?? []) t.stop();
  }
}

/**
 * Cross-origin iframe screenshot via Chromium's Region Capture API. The browser
 * crops the share-this-tab stream to the iframe's pixels in the compositor, so
 * the result is iframe-only with no surrounding chrome. Chrome/Edge 104+.
 */
export async function captureViaCropTarget(iframe: HTMLIFrameElement): Promise<CaptureResult> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, reason: 'insecure-context' };
  }
  const CT = (window as unknown as { CropTarget?: { fromElement: (el: Element) => Promise<unknown> } }).CropTarget;
  if (!CT || !navigator.mediaDevices?.getDisplayMedia) return { ok: false, reason: 'unsupported' };

  let stream: MediaStream | null = null;
  try {
    const cropTarget = await CT.fromElement(iframe);
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as unknown as MediaTrackConstraints,
      audio: false,
      ...({ preferCurrentTab: true, selfBrowserSurface: 'include' } as Record<string, unknown>),
    });
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { cropTo?: (t: unknown) => Promise<void> };
    if (!track) return { ok: false, reason: 'unknown' };
    if (typeof track.cropTo !== 'function') return { ok: false, reason: 'unsupported' };
    await track.cropTo(cropTarget);
    const blob = await grabFrame(track, stream);
    return blob ? { ok: true, blob } : { ok: false, reason: 'unknown' };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return { ok: false, reason: name === 'NotAllowedError' ? 'denied' : 'unknown' };
  } finally {
    for (const t of stream?.getTracks() ?? []) t.stop();
  }
}

/** Single-frame grab: ImageCapture (Chromium) or a hidden <video> (Safari/FF). */
async function grabFrame(track: MediaStreamTrack, stream: MediaStream): Promise<Blob | null> {
  const ICAny = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture;
  if (ICAny) {
    const bitmap = await new ICAny(track).grabFrame();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
  }
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  await new Promise((r) => setTimeout(r, 120));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width) return null;
  ctx.drawImage(video, 0, 0);
  return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
}

/**
 * Crop a full-tab/window frame to the iframe's bounding rect — Firefox/Safari
 * fallback when CropTarget isn't available. Correct when the user picks "this
 * tab" (rect is page-relative).
 */
export async function cropBlobToIframe(blob: Blob, iframe: HTMLIFrameElement): Promise<Blob | null> {
  const rect = iframe.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  const bmp = await createImageBitmap(blob);
  const sx = bmp.width / window.innerWidth;
  const sy = bmp.height / window.innerHeight;
  const cx = Math.max(0, Math.round(rect.left * sx));
  const cy = Math.max(0, Math.round(rect.top * sy));
  const cw = Math.min(bmp.width - cx, Math.round(rect.width * sx));
  const ch = Math.min(bmp.height - cy, Math.round(rect.height * sy));
  if (cw < 4 || ch < 4) return null;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);
  return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
}
