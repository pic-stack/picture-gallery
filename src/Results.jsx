import { useState, useRef, useEffect } from 'react'
import React from 'react'
import BarcodeScanner from './barcode.jsx'


import './App.css'
//pls work
const API_KEY = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY// restrict this in Google Cloud Console to Drive API + your domain
const FLOWER_EMAIL_FOLDER_ID = import.meta.env.VITE_FLOWER_EMAIL_FOLDER_ID;
const DELETE_ENDPOINT_URL = import.meta.env.VITE_DELETE_ENDPOINT_URL;
const DELETE_SECRET = import.meta.env.VITE_DELETE_SECRET;

// 1) find ALL order-number folders inside flower_email
// (returns every match so that if duplicate folders ever exist, no images get missed)
async function getOrderFolderIds(orderNumber, parentFolderId) {
  const query = `'${parentFolderId}' in parents and name = '${orderNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name)&key=${API_KEY}`

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Drive API error (folder lookup): ${response.status}`)
  }

  const data = await response.json()
  return data.files.map((f) => f.id)
}

// 2) get all images inside those order folders (exact duplicates hidden by checksum)
async function getFolderImages(folderIds) {
  const parents = folderIds.map((id) => `'${id}' in parents`).join(' or ')
  const query = `(${parents}) and mimeType contains 'image/' and trashed = false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&orderBy=createdTime&pageSize=200&fields=files(id,name,mimeType,md5Checksum)&key=${API_KEY}`

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Drive API error (image list): ${response.status}`)
  }

  const data = await response.json()

  // Safety net: hide byte-for-byte identical images.
  const seen = new Set()
  return data.files.filter((f) => {
    if (!f.md5Checksum) return true
    if (seen.has(f.md5Checksum)) return false
    seen.add(f.md5Checksum)
    return true
  })
}

// 3) ask the Apps Script web app to trash a specific file
// Uses GET (not POST): POST requests to the Apps Script web app were being rejected,
// while GET requests work reliably from the browser.
async function deleteImageFromDrive(fileId) {
  const url =
    `${DELETE_ENDPOINT_URL}?action=delete` +
    `&fileId=${encodeURIComponent(fileId)}` +
    `&secret=${encodeURIComponent(DELETE_SECRET)}`

  const response = await fetch(url, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Delete request failed: ${response.status}`)
  }

  const result = await response.json()
  if (!result.success) {
    throw new Error(result.error || 'Delete failed')
  }
}

function Results(){
    const [images, setImages] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [searched, setSearched] = useState(false)
    const [lastScanned, setLastScanned] = useState(null) // used for display (e.g. EmailButton)

    // File pending user confirmation before deletion (null = no dialog open)
    const [deleteTarget, setDeleteTarget] = useState(null)
    // File ID currently being deleted (shows a spinner state, disables button)
    const [deletingId, setDeletingId] = useState(null)
    const [deleteError, setDeleteError] = useState(null)

    // File currently shown enlarged in the lightbox (null = closed)
    const [selectedImage, setSelectedImage] = useState(null)

    // Ref version of the last-scanned code, used for the duplicate-scan guard.
    // Refs update immediately (unlike state, which updates on next render),
    // so this reliably blocks rapid-fire duplicate scans even if several
    // onScan calls land before React has re-rendered.
    const lastScannedRef = useRef(null)

    // Tracks the "generation" of the current search so that if an older,
    // slower search resolves after a newer one has already started, its
    // result gets ignored instead of overwriting the newer one.
    const searchIdRef = useRef(0)

  async function handleSearch(orderNumber) {
    const thisSearchId = ++searchIdRef.current

    setLoading(true)
    setError(null)
    setSearched(true)
    setLastScanned(null) // hide the email button until this search finishes
    setImages([])
    setDeleteError(null)

    try {
      const folderIds = await getOrderFolderIds(orderNumber, FLOWER_EMAIL_FOLDER_ID)

      // If a newer search has started since this one began, drop this result.
      if (thisSearchId !== searchIdRef.current) return

      if (folderIds.length === 0) {
        setError(`No folder found for order #${orderNumber}`)
        return
      }

      const files = await getFolderImages(folderIds)

      if (thisSearchId !== searchIdRef.current) return

      setImages(files)
    } catch (err) {
      if (thisSearchId !== searchIdRef.current) return
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      if (thisSearchId === searchIdRef.current) {
        setLoading(false)
        // Show the "Email Pictures" button for this order, whether it came from
        // a barcode scan or was typed in. Shown even when no images were found,
        // since that's exactly when you may want to email the first ones.
        setLastScanned(orderNumber)
        // Search finished: allow the same barcode to be scanned again to refresh.
        lastScannedRef.current = null
      }
    }
  }

  function handleScan(code) {
    if (code === lastScannedRef.current) return // ignore repeat reads of the same barcode
    lastScannedRef.current = code
    handleSearch(code)
  }

  // Opens the confirmation dialog for a given photo — does NOT delete yet.
  function requestDelete(file) {
    setDeleteError(null)
    setDeleteTarget(file)
  }

  function cancelDelete() {
    setDeleteTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const file = deleteTarget

    setDeletingId(file.id)
    setDeleteError(null)

    try {
      await deleteImageFromDrive(file.id)
      // Remove it from the gallery immediately — no need to refetch the whole folder.
      setImages((prev) => prev.filter((img) => img.id !== file.id))
      // If the deleted photo was open in the lightbox, close it.
      setSelectedImage((prev) => (prev && prev.id === file.id ? null : prev))
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete photo. Please try again.'
      )
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  return (
      <div>

        <BarcodeScanner onScan={handleScan}/>

        <SearchBarCode onSearch={handleSearch} />

        {lastScanned && (
          <EmailButton
            recipient="pic@ahsam.com"
            subject={`${lastScanned}`}
            body=""
          />
        )}

        {deleteError && <p className="gallery-error">{deleteError}</p>}

        <PictureGallery
          images={images}
          loading={loading}
          error={error}
          searched={searched}
          deletingId={deletingId}
          onDeleteRequest={requestDelete}
          onImageClick={setSelectedImage}
        />

        {selectedImage && (
          <Lightbox
            file={selectedImage}
            onClose={() => setSelectedImage(null)}
            onDeleteRequest={requestDelete}
          />
        )}

        {deleteTarget && (
          <ConfirmDialog
            fileName={deleteTarget.name}
            onConfirm={confirmDelete}
            onCancel={cancelDelete}
            isDeleting={deletingId === deleteTarget.id}
          />
        )}

      </div>
  )
}

function SearchBarCode({ onSearch }) {
  const [value, setValue] = useState('')

  function handleSubmit() {
    if (value.trim().length === 0) return
    onSearch(value.trim())
  }

  return (
    <>
      <div id="outer-searchbar-div">
        <input
          id="search-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Order #"
          onFocus={(e) => {
              // Highlight the existing number: it stays visible until the user types,
              // and the first digit they type replaces it. (setTimeout is needed so
              // iOS Safari and desktop browsers don't clear the selection on tap.)
              const el = e.target
              setTimeout(() => el.setSelectionRange(0, el.value.length), 0)
            }}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
        />
        <button id="search-button" onClick={handleSubmit}>
          <div id="search-button-text">Search</div>
        </button>
      </div>
    </>
  )
}

function PictureGallery({ images, loading, error, searched, deletingId, onDeleteRequest, onImageClick }) {
  if (!searched) return null
  if (loading) return <p className="gallery-status">Loading images...</p>
  if (error) return <p className="gallery-error">{error}</p>
  if (images.length === 0) {
    return <p className="gallery-empty">No images found for this order.</p>
  }

  return (
    <div id="picture-gallery">
      {images.map((file) => (
        <div className="thumb-wrapper" key={file.id}>
          <img
            src={`https://drive.google.com/thumbnail?id=${file.id}&sz=w680`}
            alt={file.name}
            loading="lazy"
            onClick={() => onImageClick(file)}
            onError={(e) => {
              // First failure: fall back to the full file once. Second failure: just log it.
              if (!e.currentTarget.dataset.fellBack) {
                e.currentTarget.dataset.fellBack = '1'
                e.currentTarget.src = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`
              } else {
                console.error(`Failed to load image: ${file.name} (${file.id})`)
              }
            }}
          />
          <button
            className="thumb-delete-btn"
            title="Delete this photo"
            disabled={deletingId === file.id}
            onClick={(e) => {
              e.stopPropagation() // don't also open the lightbox
              onDeleteRequest(file)
            }}
          >
            {deletingId === file.id ? '…' : '✕'}
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- Lightbox with pinch/scroll zoom + drag-to-pan ----------

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const DOUBLE_TAP_ZOOM = 2.5

function Lightbox({ file, onClose, onDeleteRequest }) {
  const fullSrc = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`

  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })

  const frameRef = useRef(null)
  // Pointer Events unify mouse drag and touch drag/pinch into one code path.
  const pointersRef = useRef(new Map()) // pointerId -> { x, y }
  const dragStateRef = useRef(null) // { startX, startY, startTx, startTy }
  const pinchStateRef = useRef(null) // { startDistance, startScale }

  function clampScale(value) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
  }

  // Keeps the image from being dragged/pinched entirely off screen.
  function clampTranslate(t, currentScale) {
    if (!frameRef.current) return t
    const rect = frameRef.current.getBoundingClientRect()
    const maxX = (rect.width * (currentScale - 1)) / 2
    const maxY = (rect.height * (currentScale - 1)) / 2
    return {
      x: Math.min(maxX, Math.max(-maxX, t.x)),
      y: Math.min(maxY, Math.max(-maxY, t.y)),
    }
  }

  function resetZoom() {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }

  function applyScale(nextRaw) {
    const next = clampScale(nextRaw)
    setScale(next)
    if (next === 1) {
      setTranslate({ x: 0, y: 0 })
    } else {
      setTranslate((prev) => clampTranslate(prev, next))
    }
  }

  // Manually bind wheel with { passive: false } — React's JSX onWheel can be
  // registered as a passive listener, which silently blocks preventDefault()
  // and lets the page scroll instead of the image zooming.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return

    function handleWheel(e) {
      e.preventDefault()
      const delta = -e.deltaY * 0.0018
      applyScale(scale + delta)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  function handleDoubleClick() {
    if (scale > 1) {
      resetZoom()
    } else {
      applyScale(DOUBLE_TAP_ZOOM)
    }
  }

  function distanceBetween(p1, p2) {
    const dx = p1.x - p2.x
    const dy = p1.y - p2.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2) {
      // Two fingers down — start a pinch, cancel any single-finger drag.
      const points = Array.from(pointersRef.current.values())
      pinchStateRef.current = {
        startDistance: distanceBetween(points[0], points[1]),
        startScale: scale,
      }
      dragStateRef.current = null
    } else if (pointersRef.current.size === 1 && scale > 1) {
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTx: translate.x,
        startTy: translate.y,
      }
    }
  }

  function handlePointerMove(e) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2 && pinchStateRef.current) {
      const points = Array.from(pointersRef.current.values())
      const newDistance = distanceBetween(points[0], points[1])
      const ratio = newDistance / pinchStateRef.current.startDistance
      applyScale(pinchStateRef.current.startScale * ratio)
    } else if (dragStateRef.current && scale > 1) {
      const dx = e.clientX - dragStateRef.current.startX
      const dy = e.clientY - dragStateRef.current.startY
      setTranslate(
        clampTranslate(
          { x: dragStateRef.current.startTx + dx, y: dragStateRef.current.startTy + dy },
          scale
        )
      )
    }
  }

  function handlePointerUp(e) {
    pointersRef.current.delete(e.pointerId)

    if (pointersRef.current.size < 2) {
      pinchStateRef.current = null
    }

    if (pointersRef.current.size === 1 && scale > 1) {
      // One finger lifted out of a pinch — resume panning with the remaining finger.
      const [remaining] = Array.from(pointersRef.current.values())
      dragStateRef.current = {
        startX: remaining.x,
        startY: remaining.y,
        startTx: translate.x,
        startTy: translate.y,
      }
    } else if (pointersRef.current.size === 0) {
      dragStateRef.current = null
    }
  }

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <div
          className="lightbox-image-frame"
          ref={frameRef}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            src={fullSrc}
            alt={file.name}
            draggable={false}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              cursor: scale > 1 ? 'grab' : 'zoom-in',
            }}
          />
        </div>

        <div className="lightbox-controls">
          <button onClick={() => applyScale(scale - 0.5)} disabled={scale <= MIN_ZOOM}>
            −
          </button>
          <button onClick={resetZoom} disabled={scale === 1}>
            ↺
          </button>
          <button onClick={() => applyScale(scale + 0.5)} disabled={scale >= MAX_ZOOM}>
            +
          </button>
        </div>
          
          {/*
          <button onClick={() => onDeleteRequest(file)}>Delete</button>
          */}

          <button class="close-button-inside" onClick={onClose}>Close</button>

        <p className="lightbox-hint">Scroll, pinch, or double-tap to zoom. Drag to pan.</p>
      </div>
    </div>
  )
}

function ConfirmDialog({ fileName, onConfirm, onCancel, isDeleting }) {
  return (
    <div className="confirm-overlay" onClick={isDeleting ? undefined : onCancel}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <h2>Delete this photo?</h2>
        <p className="confirm-message">
          <strong>{fileName}</strong> will be permanently removed from this order.
          This can't be undone.
        </p>
        <div className="confirm-actions">
          <button
            className="confirm-cancel-btn"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            className="confirm-delete-btn"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete Photo'}
          </button>
        </div>
      </div>
    </div>
  )
}


function EmailButton({ recipient, subject, body }) {
  const enc = encodeURIComponent
  // Opens the device's default mail app (Mail on Mac/iPhone, Gmail/Outlook on Android, etc.)
  const mailtoLink = `mailto:${recipient}?subject=${enc(subject)}&body=${enc(body || '')}`
  // Fallback for computers with no mail app set up: opens a Gmail compose window in the browser.
  const gmailLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(recipient)}&su=${enc(subject)}&body=${enc(body || '')}`

  return (
    <div className="email-wrap">
      <a href={mailtoLink} id="email-button">
        Add Pictures
      </a>
      
      {/*
      <p className="email-fallback">
        Mail app didn't open?{' '}
        <a href={gmailLink} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
        {' '}or email <strong>{recipient}</strong> with subject <strong>{subject}</strong>.
      </p>
      */}
      
    </div>
  )
}


export default Results;
