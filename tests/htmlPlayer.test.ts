import { describe, expect, it } from 'vitest'
import { isPlayerWrapperHtml, withPlayerAutoplay } from '../src/main/services/htmlPlayer'

const wrapper = '<iframe sandbox="allow-scripts" src="https://player.21st.app/v/x/"></iframe><script>f.contentWindow.postMessage({"type":"21st-video:load","mode":"block","ref":"21st/x"},"*")</script>'

describe('21st player wrapper', () => {
  it('detects the online-player wrapper', () => {
    expect(isPlayerWrapperHtml(wrapper)).toBe(true)
    expect(isPlayerWrapperHtml('<html><body><img src="a.png"></body></html>')).toBe(false)
  })

  it('turns autoplay on so the first frame is not an empty in-phase', () => {
    expect(withPlayerAutoplay(wrapper)).toContain('"mode":"block","autoPlay":true')
    expect(withPlayerAutoplay('<html></html>')).toBe('<html></html>')
  })
})