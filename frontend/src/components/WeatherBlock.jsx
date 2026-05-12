import { useEffect, useState } from 'react'

const CAT_COLOR = {
  VFR:  '#3fb950',
  MVFR: '#58a6ff',
  IFR:  '#f85149',
  LIFR: '#bc8cff',
}

const METAR_URL = '/api/weather/metar/'
const TAF_URL   = '/api/weather/taf/'

const pre = {
  fontSize: 10, color: 'var(--muted)', background: '#0d1117',
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6,
  fontFamily: 'monospace',
}

export default function WeatherBlock({ icao }) {
  const [metar, setMetar]   = useState(null)
  const [taf,   setTaf]     = useState(null)
  const [showTaf, setShowTaf] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!icao) return
    setLoading(true)
    setMetar(null); setTaf(null)

    Promise.all([
      fetch(METAR_URL + icao.toUpperCase()).then(r => r.json()).then(d => Array.isArray(d) ? d[0] ?? null : null),
      fetch(TAF_URL   + icao.toUpperCase()).then(r => r.json()).then(d => Array.isArray(d) ? d[0] ?? null : null),
    ])
      .then(([m, t]) => { setMetar(m); setTaf(t) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [icao])

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0 }}>Loading…</p>
  if (!metar)  return <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0 }}>No METAR for {icao}</p>

  const cat     = metar.fltCat
  const catColor = CAT_COLOR[cat] ?? 'var(--muted)'
  const wspd    = metar.wspd ?? 0
  const wgst    = metar.wgst ? `G${metar.wgst}` : ''
  const wdir    = metar.wdir != null ? String(metar.wdir).padStart(3, '0') : 'VRB'
  const wind    = `${wdir}/${wspd}${wgst}KT`
  const vis     = metar.visib != null ? `${metar.visib}SM` : null
  const temp    = metar.temp != null ? `${metar.temp}/${metar.dewp ?? '?'}°C` : null
  const qnh     = metar.altim != null ? `Q${Math.round(metar.altim)}` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Category + decoded summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {cat && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 700,
            background: catColor + '22', color: catColor, border: `1px solid ${catColor}55`,
          }}>{cat}</span>
        )}
        {[wind, vis, temp, qnh].filter(Boolean).map(v => (
          <span key={v} style={{ fontSize: 11, color: 'var(--muted)' }}>{v}</span>
        ))}
      </div>

      {/* Raw METAR */}
      <pre style={pre}>{metar.rawOb}</pre>

      {/* TAF toggle */}
      {taf?.rawTAF && (
        <>
          <button
            onClick={() => setShowTaf(s => !s)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', padding: 0, textAlign: 'left' }}
          >
            {showTaf ? '▾ Hide TAF' : '▸ Show TAF'}
          </button>
          {showTaf && <pre style={pre}>{taf.rawTAF}</pre>}
        </>
      )}
    </div>
  )
}
