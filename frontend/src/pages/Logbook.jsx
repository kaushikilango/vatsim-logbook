import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useFlights, useStats } from '../hooks/useFlights'
import { api } from '../api'
import { fmt } from '../utils/time'

const PAGE_SIZE = 50

function minsToHM(mins) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function minsToBlock(mins) {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
}

function flightMins(f) {
  // logoff_time IS NULL means still live — use now, ignore any stale arr_time
  const live  = !f.logoff_time
  const start = f.dep_time || f.logon_time
  const end   = live ? new Date().toISOString() : (f.arr_time || f.logoff_time)
  if (!start || !end) return null
  return Math.round((new Date(end) - new Date(start)) / 60000)
}

function duration(f) {
  if (!f.logoff_time) {
    // Live flight — elapsed since dep_time (or logon_time)
    const start   = f.dep_time || f.logon_time
    const elapsed = Math.round((Date.now() - new Date(start)) / 60000)
    return <span style={{ color: 'var(--green)' }}>{minsToHM(elapsed)} ●</span>
  }
  const mins = flightMins(f)
  if (mins == null) return '—'
  return minsToHM(mins)
}

function blockHours(f) {
  const mins = flightMins(f)
  if (mins == null) return null
  return minsToBlock(mins)
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const th = {
  padding: '8px 12px', textAlign: 'left', color: 'var(--muted)',
  fontWeight: 500, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
}
const td = { padding: '8px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

function inputStyle() {
  return {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12,
    padding: '5px 10px', width: 90, outline: 'none',
  }
}

async function exportPDF(allFlights, stats) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  doc.setFontSize(16)
  doc.setTextColor(200, 200, 200)
  doc.text('VATSIM Flight Logbook', 14, 16)

  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text(`Generated ${new Date().toLocaleString()} · ${allFlights.length} flights`, 14, 22)

  if (stats) {
    doc.text(
      `Total hours: ${stats.total_hours}h · Airports: ${Math.max(stats.unique_departures, stats.unique_arrivals)} · Highest alt: FL${Math.round(stats.highest_altitude / 100)}`,
      14, 27,
    )
  }

  autoTable(doc, {
    startY: 32,
    head: [['Date', 'Callsign', 'From', 'To', 'Aircraft', 'Rules', 'Block', 'Max Alt', 'Max G/S']],
    body: allFlights.map(f => [
      fmt(f.logon_time),
      f.callsign,
      f.departure ?? '—',
      f.arrival ?? '—',
      f.aircraft_short ?? '—',
      f.flight_rules === 'I' ? 'IFR' : f.flight_rules === 'V' ? 'VFR' : (f.flight_rules ?? '—'),
      blockHours(f) ?? '—',
      f.max_altitude ? `FL${Math.round(f.max_altitude / 100)}` : '—',
      f.max_gs ? f.max_gs + ' kt' : '—',
    ]),
    styles: { fontSize: 8, cellPadding: 2.5, textColor: [200, 200, 200], fillColor: [22, 27, 34] },
    headStyles: { fillColor: [13, 17, 23], textColor: [139, 148, 158], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [28, 33, 40] },
    theme: 'grid',
    tableLineColor: [48, 54, 61],
    tableLineWidth: 0.1,
  })

  doc.save('vatsim-logbook.pdf')
}

export default function Logbook() {
  const { flights, total, loading, error, offset, setOffset, limit, filters, setFilters } = useFlights(PAGE_SIZE)
  const { stats } = useStats()

  const [draft, setDraft] = useState({ search: '', departure: '', arrival: '', aircraft: '' })
  const [exporting, setExporting] = useState(false)

  const totalPages   = Math.ceil(total / limit)
  const currentPage  = Math.floor(offset / limit) + 1
  const hasFilters   = Object.values(filters).some(Boolean)

  function applyFilters() {
    const active = {}
    if (draft.search)    active.search    = draft.search.trim()
    if (draft.departure) active.departure = draft.departure.trim()
    if (draft.arrival)   active.arrival   = draft.arrival.trim()
    if (draft.aircraft)  active.aircraft  = draft.aircraft.trim()
    setFilters(active)
  }

  function clearFilters() {
    setDraft({ search: '', departure: '', arrival: '', aircraft: '' })
    setFilters({})
  }

  async function handleExport() {
    setExporting(true)
    try {
      const data = await api.flights(500, 0)
      await exportPDF(data.flights, stats)
    } catch (e) { console.error(e) }
    setExporting(false)
  }

  return (
    <div style={{ padding: 24 }}>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="Total Flights"  value={stats.total_flights} />
          <StatCard label="Flight Hours"   value={stats.total_hours ?? '—'} sub="completed flights" />
          <StatCard label="Highest Alt"    value={stats.highest_altitude ? stats.highest_altitude.toLocaleString() + ' ft' : '—'} />
          <StatCard label="Highest G/S"    value={stats.highest_gs ? stats.highest_gs + ' kt' : '—'} />
          <StatCard label="Airports"       value={Math.max(stats.unique_departures ?? 0, stats.unique_arrivals ?? 0)} sub="unique" />
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, marginRight: 8 }}>Flight Logbook</h1>

        <input
          style={{ ...inputStyle(), width: 130 }}
          placeholder="Search callsign…"
          value={draft.search}
          onChange={e => setDraft(d => ({ ...d, search: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && applyFilters()}
        />
        <input
          style={inputStyle()}
          placeholder="From ICAO"
          value={draft.departure}
          onChange={e => setDraft(d => ({ ...d, departure: e.target.value.toUpperCase() }))}
          onKeyDown={e => e.key === 'Enter' && applyFilters()}
        />
        <input
          style={inputStyle()}
          placeholder="To ICAO"
          value={draft.arrival}
          onChange={e => setDraft(d => ({ ...d, arrival: e.target.value.toUpperCase() }))}
          onKeyDown={e => e.key === 'Enter' && applyFilters()}
        />
        <input
          style={inputStyle()}
          placeholder="Aircraft"
          value={draft.aircraft}
          onChange={e => setDraft(d => ({ ...d, aircraft: e.target.value.toUpperCase() }))}
          onKeyDown={e => e.key === 'Enter' && applyFilters()}
        />
        <button onClick={applyFilters} style={btnStyle(false)}>Filter</button>
        {hasFilters && <button onClick={clearFilters} style={{ ...btnStyle(false), color: 'var(--muted)' }}>Clear</button>}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {!loading && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{total} flight{total !== 1 ? 's' : ''}</span>}
          <button
            onClick={handleExport}
            disabled={exporting}
            style={{ ...btnStyle(exporting), color: 'var(--accent)', whiteSpace: 'nowrap' }}
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', marginBottom: 12 }}>Failed to load: {error}</p>}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : flights.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No flights found.</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: 8 }}>
              <thead>
                <tr>
                  {['Callsign', 'Route', 'Aircraft', 'Rules', 'Departed', 'Duration', 'Max Alt', 'Max G/S'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flights.map(f => (
                  <tr
                    key={f.id}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#1c2128'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={td}><Link to={`/flight/${f.id}`} style={{ fontWeight: 600 }}>{f.callsign}</Link></td>
                    <td style={td}>{f.departure ?? '?'} → {f.arrival ?? '?'}</td>
                    <td style={td}>{f.aircraft_short ?? '—'}</td>
                    <td style={td}>{f.flight_rules ?? '—'}</td>
                    <td style={td}>{fmt(f.logon_time)}</td>
                    <td style={td}>{duration(f)}</td>
                    <td style={td}>{f.max_altitude ? f.max_altitude.toLocaleString() + ' ft' : '—'}</td>
                    <td style={td}>{f.max_gs ? f.max_gs + ' kt' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: 'center' }}>
              <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} style={btnStyle(offset === 0)}>← Prev</button>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>Page {currentPage} of {totalPages}</span>
              <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} style={btnStyle(offset + limit >= total)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function btnStyle(disabled) {
  return {
    padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
    background: disabled ? 'transparent' : 'var(--surface)',
    color: disabled ? 'var(--border)' : 'var(--text)',
    cursor: disabled ? 'default' : 'pointer', fontSize: 13,
  }
}
