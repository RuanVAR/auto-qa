import { useEffect, useRef } from 'react';
import * as markerjs2 from 'markerjs2';

/**
 * Wraps marker.js 2 into a full-screen modal. Loads the screenshot into
 * an <img>, hands it to MarkerArea, and resolves the parent's onSave with
 * a flattened WebP blob once the user clicks the marker.js OK button.
 *
 * Discard / Cancel both close without saving. marker.js handles its own
 * toolbar UI; we just give it a host element.
 */
export function ScreenshotAnnotator({
  imageUrl,
  onSave,
  onCancel,
}: {
  imageUrl: string;
  onSave: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const areaRef = useRef<markerjs2.MarkerArea | null>(null);

  // Initialise once the image has loaded — MarkerArea needs measured pixel
  // dimensions and will throw if the source isn't ready.
  const handleImageLoaded = () => {
    const img = imgRef.current;
    if (!img || areaRef.current) return;
    const area = new markerjs2.MarkerArea(img);
    areaRef.current = area;
    area.settings.displayMode = 'popup'; // own modal, full screen
    area.uiStyleSettings.toolbarStyleColorsClassName = 'qa-mjs-toolbar';
    area.addEventListener('render', async (event) => {
      try {
        const dataUrl = event.dataUrl;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        // marker.js returns PNG dataURL; transcode to WebP for parity with
        // the rest of the capture pipeline (~5–10× smaller).
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { onSave(blob); return; }
        ctx.drawImage(bmp, 0, 0);
        const webp = await new Promise<Blob | null>((res2) =>
          canvas.toBlob(res2, 'image/webp', 0.9),
        );
        onSave(webp ?? blob);
      } catch {
        onCancel();
      }
    });
    area.addEventListener('close', () => onCancel());
    area.show();
  };

  // Tear down the MarkerArea on unmount — leaving its popup mounted would
  // leak DOM nodes and an event listener on window.
  useEffect(() => {
    return () => {
      areaRef.current?.close();
      areaRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, opacity: 0, pointerEvents: 'none' }}>
      {/* Hidden host — marker.js opens its own popup; this img just feeds it. */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Annotating screenshot"
        crossOrigin="anonymous"
        onLoad={handleImageLoaded}
      />
    </div>
  );
}
