/**
 * JEE Preparation Platform - PDF Extractor Module
 * Client-side PDF processing using PDF.js with text extraction, canvas rendering,
 * and page-to-image conversion for Gemini AI Multimodal analysis.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PdfExtractor = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PDFJS_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let pdfJsLoadingPromise = null;

  /**
   * Ensure PDF.js is loaded in the browser environment.
   */
  async function ensurePdfJs() {
    if (typeof window === 'undefined') {
      throw new Error('PDF.js client extractor requires a browser window environment.');
    }

    if (window.pdfjsLib && window.pdfjsLib.getDocument) {
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      }
      return window.pdfjsLib;
    }

    if (pdfJsLoadingPromise) {
      return pdfJsLoadingPromise;
    }

    pdfJsLoadingPromise = new Promise((resolve, reject) => {
      // Check if already in DOM
      const existingScript = document.querySelector(`script[src*="pdf.min.js"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
            resolve(window.pdfjsLib);
          } else {
            reject(new Error('PDF.js script loaded but window.pdfjsLib not found.'));
          }
        });
        existingScript.addEventListener('error', () => reject(new Error('Failed to load PDF.js script.')));
        return;
      }

      const script = document.createElement('script');
      script.src = PDFJS_CDN_URL;
      script.async = true;
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('PDF.js script loaded but window.pdfjsLib not found.'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js from CDN: ' + PDFJS_CDN_URL));
      document.head.appendChild(script);
    });

    return pdfJsLoadingPromise;
  }

  /**
   * Convert File or Blob to ArrayBuffer
   */
  function fileToArrayBuffer(fileOrBlob) {
    if (fileOrBlob instanceof ArrayBuffer) {
      return Promise.resolve(fileOrBlob);
    }
    if (fileOrBlob.buffer instanceof ArrayBuffer) {
      return Promise.resolve(fileOrBlob.buffer);
    }
    if (typeof fileOrBlob.arrayBuffer === 'function') {
      return fileOrBlob.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file as ArrayBuffer'));
      reader.readAsArrayBuffer(fileOrBlob);
    });
  }

  /**
   * Wrapped PDF Document instance
   */
  class PdfDocumentWrapper {
    constructor(pdfDoc, originalSource) {
      this.doc = pdfDoc;
      this.source = originalSource;
      this.numPages = pdfDoc.numPages;
    }

    /**
     * Get a specific page
     */
    async getPage(pageNumber) {
      if (pageNumber < 1 || pageNumber > this.numPages) {
        throw new Error(`Page number ${pageNumber} out of bounds (1 - ${this.numPages})`);
      }
      return this.doc.getPage(pageNumber);
    }

    /**
     * Render a page onto an HTML5 Canvas
     * @param {number} pageNumber (1-based)
     * @param {HTMLCanvasElement} canvas
     * @param {Object} options { scale: 1.5, rotation: 0 }
     */
    async renderPageToCanvas(pageNumber, canvas, options = {}) {
      const scale = options.scale || 1.5;
      const page = await this.getPage(pageNumber);
      const viewport = page.getViewport({ scale, rotation: options.rotation || 0 });

      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;
      return { canvas, width: viewport.width, height: viewport.height, scale };
    }

    /**
     * Render a page directly to base64 Data URL (PNG or JPEG)
     * @param {number} pageNumber (1-based)
     * @param {Object} options { scale: 1.5, type: 'image/jpeg', quality: 0.92 }
     */
    async renderPageToDataUrl(pageNumber, options = {}) {
      const scale = options.scale || 1.8;
      const type = options.type || 'image/jpeg';
      const quality = options.quality !== undefined ? options.quality : 0.92;

      let canvas;
      if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
      } else {
        throw new Error('Canvas rendering requires browser document object.');
      }

      await this.renderPageToCanvas(pageNumber, canvas, { scale, rotation: options.rotation });
      const dataUrl = canvas.toDataURL(type, quality);
      const base64 = dataUrl.split(',')[1] || '';

      return {
        pageNumber,
        dataUrl,
        base64,
        mimeType: type,
        width: canvas.width,
        height: canvas.height
      };
    }

    /**
     * Extract structured text from a specific page, sorting text items by reading order
     * (top-to-bottom, left-to-right) to preserve questions and mathematical formulas.
     * @param {number} pageNumber (1-based)
     */
    async extractTextFromPage(pageNumber) {
      const page = await this.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = textContent.items;

      if (!items || items.length === 0) {
        return '';
      }

      const viewport = page.getViewport({ scale: 1.0 });
      const midX = viewport.width / 2;

      // Detect if page has two distinct columns
      let leftCount = 0;
      let rightCount = 0;
      let crossingCount = 0;

      for (const item of items) {
        const x = item.transform[4];
        const w = item.width || 0;
        if (x + w < midX - 5) leftCount++;
        else if (x > midX + 5) rightCount++;
        else if (w > midX * 0.6) crossingCount++;
      }

      const isTwoColumn = leftCount > 8 && rightCount > 8 && crossingCount < (leftCount + rightCount) * 0.2;

      function formatColumnItems(colItems) {
        const sortedItems = [...colItems].sort((a, b) => {
          const yA = a.transform[5];
          const yB = b.transform[5];
          const xA = a.transform[4];
          const xB = b.transform[4];

          if (Math.abs(yA - yB) <= 6) {
            return xA - xB;
          }
          return yB - yA;
        });

        let text = '';
        let lastY = null;
        let lastX = null;

        for (const item of sortedItems) {
          const str = item.str;
          if (!str) continue;

          const currentY = item.transform[5];
          const currentX = item.transform[4];

          if (lastY !== null) {
            if (Math.abs(lastY - currentY) > 6) {
              if (Math.abs(lastY - currentY) > 18) {
                text += '\n\n';
              } else {
                text += '\n';
              }
            } else {
              if (lastX !== null && currentX - lastX > 4 && !text.endsWith(' ') && !str.startsWith(' ')) {
                text += ' ';
              }
            }
          }

          text += str;
          lastY = currentY;
          lastX = currentX + (item.width || 0);
        }
        return text.trim();
      }

      if (isTwoColumn) {
        const col1Items = items.filter(it => it.transform[4] < midX + 5);
        const col2Items = items.filter(it => it.transform[4] >= midX - 5);
        const col1Text = formatColumnItems(col1Items);
        const col2Text = formatColumnItems(col2Items);
        return (col1Text + '\n\n' + col2Text).trim();
      }

      return formatColumnItems(items);
    }

    /**
     * Extract text from all pages in the PDF document
     * @param {Function} onProgress Callback receiving { current, total, percent }
     */
    async extractAllText(onProgress) {
      const pageTexts = [];
      for (let i = 1; i <= this.numPages; i++) {
        if (typeof onProgress === 'function') {
          onProgress({ current: i, total: this.numPages, percent: Math.round((i / this.numPages) * 100) });
        }
        const text = await this.extractTextFromPage(i);
        pageTexts.push(`--- Page ${i} ---\n${text}`);
      }
      return pageTexts.join('\n\n');
    }

    /**
     * Convert all (or selected) pages to base64 images suitable for Multimodal Gemini API
     * @param {Object} options { pages: [1, 2], scale: 1.8, type: 'image/jpeg', quality: 0.9 }
     * @param {Function} onProgress Callback receiving { current, total, percent }
     */
    async convertPagesToImages(options = {}, onProgress) {
      const pagesToConvert = options.pages || Array.from({ length: this.numPages }, (_, i) => i + 1);
      const images = [];

      for (let idx = 0; idx < pagesToConvert.length; idx++) {
        const pageNum = pagesToConvert[idx];
        if (typeof onProgress === 'function') {
          onProgress({
            current: idx + 1,
            total: pagesToConvert.length,
            percent: Math.round(((idx + 1) / pagesToConvert.length) * 100)
          });
        }
        const img = await this.renderPageToDataUrl(pageNum, options);
        images.push(img);
      }

      return images;
    }
  }

  /**
   * Load PDF document from File, Blob, ArrayBuffer, or URL
   * @param {File|Blob|ArrayBuffer|string} source
   */
  async function loadDocument(source) {
    const pdfjs = await ensurePdfJs();

    let loadingTask;
    if (typeof source === 'string') {
      // URL or base64 data URL
      if (source.startsWith('data:application/pdf;base64,')) {
        const base64Data = source.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        loadingTask = pdfjs.getDocument({ data: bytes });
      } else {
        loadingTask = pdfjs.getDocument(source);
      }
    } else {
      const buffer = await fileToArrayBuffer(source);
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    }

    const doc = await loadingTask.promise;
    return new PdfDocumentWrapper(doc, source);
  }

  /**
   * One-step text extraction from PDF file/blob
   * @param {File|Blob|ArrayBuffer} file
   * @param {Function} onProgress
   */
  async function extractText(file, onProgress) {
    const pdfWrapper = await loadDocument(file);
    return pdfWrapper.extractAllText(onProgress);
  }

  /**
   * Quick utility to check if a file is a PDF
   */
  function isPdfFile(file) {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    if (typeof file.name === 'string' && file.name.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  /**
   * Convert file to base64 string
   */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // strip data:*/*;base64,
        const base64 = typeof result === 'string' ? (result.split(',')[1] || '') : '';
        resolve({
          dataUrl: result,
          base64: base64,
          mimeType: file.type || 'application/octet-stream'
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file as base64'));
      reader.readAsDataURL(file);
    });
  }

  return {
    ensurePdfJs,
    loadDocument,
    load: loadDocument,
    extractText,
    isPdfFile,
    fileToBase64,
    fileToArrayBuffer,
    PDFJS_CDN_URL,
    PDFJS_WORKER_URL
  };
});
