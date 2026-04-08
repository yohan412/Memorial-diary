import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'

const SLIDE_IMAGES = [
  '/landing/slide1.png',
  '/landing/slide2.png',
  '/landing/slide3.png',
]

const SLIDE_INTERVAL_MS = 4000
const FADE_MS = 1600

export default function LandingPage() {
  const [active, setActive] = useState(0)
  const nav = useNavigate()
  const { initDemo, exitDemo, markStarted } = useApp()

  useEffect(() => {
    const t = window.setInterval(() => {
      setActive((i) => (i + 1) % SLIDE_IMAGES.length)
    }, SLIDE_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [])

  return (
    <div className="landing-root">
      <div className="landing-slides" aria-hidden>
        {SLIDE_IMAGES.map((src, i) => (
          <div
            key={src}
            className="landing-slide"
            style={{
              backgroundImage: `url(${src})`,
              opacity: i === active ? 1 : 0,
              transition: `opacity ${FADE_MS}ms ease-in-out`,
            }}
          />
        ))}
      </div>
      <div className="landing-scrim" />
      <div className="landing-content">
        <p className="landing-tagline">Memorial diary</p>
        <button
          type="button"
          className="landing-memorize-btn"
          onClick={() => {
            markStarted()
            exitDemo()
            nav('/book/setup')
          }}
        >
          memorize
        </button>
        <button
          type="button"
          className="landing-memorize-btn"
          style={{ marginTop: '0.85rem' }}
          onClick={() => {
            markStarted()
            initDemo()
            nav('/book/setup')
          }}
        >
          demo
        </button>
      </div>
    </div>
  )
}
