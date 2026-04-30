// @ts-nocheck
// TODO: tighten types
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText } from 'lucide-react'

import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

/**
 * PDF Viewer con pdfjs-dist.
 * Accetta `pdfData` (ArrayBuffer/Uint8Array) oppure `url` come fallback.
 * Preferire pdfData per evitare problemi CORS con Supabase signed URLs.
 */
interface PdfViewerProps {
  pdfData?: ArrayBuffer | Uint8Array | null
  url?: string
  className?: string
}

export default function PdfViewer({ pdfData, url, className = '' }: PdfViewerProps) {
  // TODO: tighten type — pdfjs PDFDocumentProxy
  const [pdf, setPdf] = useState<any>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // TODO: tighten type — pdfjs RenderTask
  const renderTaskRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Carica il PDF da dati binari o URL
  useEffect(() => {
    if (!pdfData && !url) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setPdf(null)
    setCurrentPage(1)

    const loadPdf = async () => {
      try {
        let source
        if (pdfData) {
          // Dati già scaricati — usa direttamente
          source = { data: pdfData instanceof ArrayBuffer ? new Uint8Array(pdfData) : pdfData }
        } else {
          // Fallback: prova fetch diretto
          const response = await fetch(url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const ab = await response.arrayBuffer()
          source = { data: new Uint8Array(ab) }
        }

        if (cancelled) return

        const loadingTask = pdfjsLib.getDocument(source)
        const pdfDoc = await loadingTask.promise

        if (cancelled) return

        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        setCurrentPage(1)
      } catch (err) {
        if (!cancelled) {
          console.error('PDF load error:', err)
          setError(err.message || 'Errore caricamento PDF')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [pdfData, url])

  // Renderizza la pagina corrente
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current) return

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }

      const page = await pdf.getPage(currentPage)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')

      const dpr = window.devicePixelRatio || 1
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      context.scale(dpr, dpr)

      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      })
      renderTaskRef.current = renderTask

      await renderTask.promise
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('Render error:', err)
      }
    }
  }, [pdf, currentPage, scale])

  useEffect(() => {
    renderPage()
  }, [renderPage])

  // Cleanup
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
      if (pdf) {
        pdf.destroy()
      }
    }
  }, [pdf])

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Caricamento PDF...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center text-slate-500">
          <FileText size={48} className="opacity-40 mx-auto mb-3" />
          <p className="text-sm mb-3">Impossibile visualizzare il PDF</p>
          {url && (
            <button
              onClick={() => window.open(url, '_blank')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
            >
              Scarica file
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm text-slate-600 min-w-[80px] text-center">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
            disabled={scale <= 0.5}
            className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 transition"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-xs text-slate-500 min-w-[45px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.2))}
            disabled={scale >= 3}
            className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 transition"
          >
            <ZoomIn size={18} />
          </button>
        </div>
      </div>
      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center p-4 bg-slate-100">
        <canvas ref={canvasRef} className="shadow-lg rounded" />
      </div>
    </div>
  )
}
