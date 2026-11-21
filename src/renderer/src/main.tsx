import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ModelThumbApp from './ModelThumbApp'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource-variable/noto-sans-sc'
import './styles/tokens.css'
import './styles/glass.css'
import './styles/app.css'
import './styles/sidebar.css'
import './styles/content.css'
import './styles/grid.css'
import './styles/inspector.css'
import './styles/lightbox.css'
import './styles/menu.css'
import './styles/preferences.css'
import './styles/dedup.css'
import './styles/recovery.css'

const modelThumb = new URLSearchParams(window.location.search).has('modelThumb')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  modelThumb ? <ModelThumbApp /> : <React.StrictMode><App /></React.StrictMode>
)
