import { useState } from 'react'
import React from 'react'
import BarcodeScanner from './barcode'
import Results from './Results'

import './App.css'



function AppAI() {
  

  return (
    
      <div id="outter-most">
        <header>
          <h1 id="top-text">Scan Bar Code to enter Order#</h1>
        </header>


        <Results/>

        
      </div>
    
  )
}



export default AppAI