'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  /** Blob URL or absolute/relative URL to a PDF */
  src: string;
  className?: string;
  onError?: () => void;
  onReady?: () => void;
};

/**
 * Renders a PDF as stacked canvases so the outer page scrolls smoothly.
 * Avoids Chrome's nested PDF-viewer iframe (laggy scrollbar + thumbnail pane).
 */
export default function PdfPagePreview({ src, className, onError, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    setError(false);

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const loadingTask = pdfjs.getDocument({ url: src, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const maxWidth = Math.min(container.clientWidth || 720, 900);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const unscaled = page.getViewport({ scale: 1 });
          const scale = maxWidth / unscaled.width;
          const viewport = page.getViewport({ scale: Math.min(scale, 2) });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          canvas.style.background = '#fff';
          if (pageNum > 1) canvas.style.marginTop = '12px';

          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }

        onReadyRef.current?.();
      } catch {
        if (!cancelled) {
          setError(true);
          onErrorRef.current?.();
        }
      }
    })();

    return () => {
      cancelled = true;
      container.innerHTML = '';
    };
  }, [src]);

  if (error) return null;

  return <div ref={containerRef} className={className} />;
}
