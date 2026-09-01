import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/glass.css'
import './styles/app.css'
import './styles/sidebar.css'
import './styles/content.css'
import './styles/grid.css'
import './styles/inspector.css'
import './styles/lightbox.css'
import './styles/menu.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
