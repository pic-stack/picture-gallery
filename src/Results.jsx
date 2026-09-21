import { useState, useRef } from 'react'
import React from 'react'
import BarcodeScanner from './barcode.jsx'


import './App.css'
//pls work
const API_KEY = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY// restrict this in Google Cloud Console to Drive API + your domain
const FLOWER_EMAIL_FOLDER_ID = import.meta.env.VITE_FLOWER_EMAIL_FOLDER_ID;
const DELETE_ENDPOINT_URL = import.meta.env.VITE_DELETE_ENDPOINT_URL;
const DELETE_SECRET = import.meta.env.VITE_DELETE_SECRET;

// 1) find the order-number folder inside flower_email
async function getOrderFolderId(orderNumber, parentFolderId) {
  const query = `'${parentFolderId}' in parents and name = '${orderNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name)&key=${API_KEY}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Drive API error (folder lookup): ${response.status}`)
  }

  const data = await response.json()
  return data.files.length > 0 ? data.files[0].id : null
}

// 2) get all images inside that order folder
async function getFolderImages(folderId) {
  const query = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,mimeType)&key=${API_KEY}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Drive API error (image list): ${response.status}`)
  }

  const data = await response.json()
  return data.files
}

// 3) ask the Apps Script web app to trash a specific file
async function deleteImageFromDrive(fileId) {
  const response = await fetch(DELETE_ENDPOINT_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight request that Apps Script web apps
    // don't handle well — Apps Script still parses the JSON body fine.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fileId, secret: DELETE_SECRET }),
  })

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
    setImages([])
    setDeleteError(null)

    try {
      const folderId = await getOrderFolderId(orderNumber, FLOWER_EMAIL_FOLDER_ID)

      // If a newer search has started since this one began, drop this result.
      if (thisSearchId !== searchIdRef.current) return

      if (!folderId) {
        setError(`No folder found for order #${orderNumber}`)
        return
      }

      const files = await getFolderImages(folderId)

      if (thisSearchId !== searchIdRef.current) return

      setImages(files)
    } catch (err) {
      if (thisSearchId !== searchIdRef.current) return
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      if (thisSearchId === searchIdRef.current) {
        setLoading(false)
      }
    }
  }

  function handleScan(code) {
    if (code === lastScannedRef.current) return // ignore repeat reads of the same barcode
    lastScannedRef.current = code
    setLastScanned(code)
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
          type="number"
          placeholder="Order #"
          value={value}
          onChange={(e) => setValue(e.target.value)}
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
            src={`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`}
            alt={file.name}
            onClick={() => onImageClick(file)}
            onError={(e) => {
              console.error(`Failed to load image: ${file.name} (${file.id})`)
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

function Lightbox({ file, onClose, onDeleteRequest }) {
  const fullSrc = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={fullSrc} alt={file.name} />
        <div className="lightbox-controls">
          <button onClick={() => onDeleteRequest(file)}>
            Delete
          </button>
          <button onClick={onClose}>Close</button>
        </div>
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
  const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body || '')}`;

  return (
    <a href={mailtoLink} id="email-button">
      Email Pictures
    </a>
    
  );
}


export default Results;
