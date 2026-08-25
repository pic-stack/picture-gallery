import { useState } from 'react'
import React from 'react'
import BarcodeScanner from './barcode.jsx'


import './App.css'

// client id: 979321381043-72psorrk4i34qcivdtg2akote1tl0ak4.apps.googleusercontent.com
// google drive folder (flower_email): 1Y8c16CG6TkgztQjkV3lf5lqHyIuwPio3

const API_KEY = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY// restrict this in Google Cloud Console to Drive API + your domain
const FLOWER_EMAIL_FOLDER_ID = import.meta.env.VITE_FLOWER_EMAIL_FOLDER_ID;

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

function Results(){
    const [images, setImages] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [searched, setSearched] = useState(false)
    const [lastScanned, setLastScanned] = useState(null) // guards against duplicate scans

  async function handleSearch(orderNumber) {
    setLoading(true)
    setError(null)
    setSearched(true)
    setImages([])

    try {
      const folderId = await getOrderFolderId(orderNumber, FLOWER_EMAIL_FOLDER_ID)

      if (!folderId) {
        setError(`No folder found for order #${orderNumber}`)
        return; 
      }

      const files = await getFolderImages(folderId)
      setImages(files)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleScan(code) {
    if (code === lastScanned) return // ignore repeat reads of the same barcode
    setLastScanned(code)
    handleSearch(code)
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

        <PictureGallery
          images={images}
          loading={loading}
          error={error}
          searched={searched}
        />

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

function PictureGallery({ images, loading, error, searched }) {
  if (!searched) return null
  if (loading) return <p className="gallery-status">Loading images...</p>
  if (error) return <p className="gallery-error">{error}</p>
  if (images.length === 0) {
    return <p className="gallery-empty">No images found for this order.</p>
  }

  return (
    <div id="picture-gallery">
      {images.map((file) => (
        <img
          key={file.id}
          src={`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`}
          alt={file.name}
          onError={(e) => {
            console.error(`Failed to load image: ${file.name} (${file.id})`)
          }}
        />
      ))}
    </div>
  )
}


function EmailButton({ recipient, subject, body }) {
  const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body || '')}`;

  return (
    <a href={mailtoLink} id="email-button">
      Open Email
    </a>
    
  );
}


export default Results;
