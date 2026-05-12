import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { api } from '../api'

const COLORS = ['#58a6ff', '#3fb950', '#f0883e', '#a78bfa', '#fbbf24', '#f85149', '#79c0ff', '#56d364', '#ff7c7c', '#c9d1d9']
const tooltip = { background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 12 }

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value ?? '—'}</div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 600, marginBottom: 16 }}>{title}</p>
      {children}
    </div>
  )
}

const th = { padding: '7px 12px', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', fontWeight: 500 }
const td = { padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }

export default function Stats() {
  const [summary,  setSummary]  = useState(null)
  const [monthly,  setMonthly]  = useState([])
  const [airports, setAirports] = useState([])
  const [aircraft, setAircraft] = useState([])
  const [routes,   setRoutes]   = useState([])

  useEffect(() => {
    api.stats().then(setSummary).catch(() => {})
    api.statsMonthly().then(setMonthly).catch(() => {})
    api.statsAirports().then(setAirports).catch(() => {})
    api.statsAircraft().then(setAircraft).catch(() => {})
    api.statsRoutes().then(setRoutes).catch(() => {})
  }, [])

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, marginBottom: 24 }}>Statistics</h1>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 12, marginBottom: 28 }}>
          <StatCard label="Total Flights"  value={summary.total_flights} />
          <StatCard label="Flight Hours"   value={summary.total_hours}   sub="logged" />
          <StatCard label="Completed"      value={summary.completed_flights} />
          <StatCard label="Highest Alt"    value={summary.highest_altitude ? `FL${Math.round(summary.highest_altitude / 100)}` : '—'} />
          <StatCard label="Top Speed"      value={summary.highest_gs ? summary.highest_gs + ' kt' : '—'} />
          <StatCard label="Unique Airports" value={Math.max(summary.unique_departures ?? 0, summary.unique_arrivals ?? 0)} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card title="Flight Hours by Month">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={m => m.slice(5)} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickCount={4} />
              <Tooltip contentStyle={tooltip} formatter={v => [v + 'h', 'Hours']} labelFormatter={m => m} />
              <Bar dataKey="hours" fill="#58a6ff" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Flights per Month">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={m => m.slice(5)} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickCount={4} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} formatter={v => [v, 'Flights']} labelFormatter={m => m} />
              <Bar dataKey="flights" fill="#3fb950" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card title="Top Airports">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={airports.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#8b949e', fontSize: 10 }} allowDecimals={false} />
              <YAxis type="category" dataKey="icao" tick={{ fill: '#8b949e', fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltip} formatter={v => [v, 'Visits']} />
              <Bar dataKey="visits" fill="#f0883e" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Aircraft Types">
          {aircraft.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={aircraft} dataKey="count" nameKey="aircraft"
                  cx="50%" cy="46%" outerRadius={95} innerRadius={50} paddingAngle={2}>
                  {aircraft.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltip} formatter={(v, n) => [v + ' flights', n]} />
                <Legend iconSize={10} formatter={v => <span style={{ color: 'var(--muted)', fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>No data</p>
          )}
        </Card>
      </div>

      <Card title="Busiest Routes">
        {routes.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Route', 'Times Flown', 'Avg Duration'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {routes.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={td}>
                    <span style={{ color: '#3fb950', fontWeight: 600 }}>{r.departure}</span>
                    <span style={{ color: 'var(--muted)', margin: '0 8px' }}>→</span>
                    <span style={{ color: '#f0883e', fontWeight: 600 }}>{r.arrival}</span>
                  </td>
                  <td style={td}>{r.count}×</td>
                  <td style={td}>{r.avg_hours ? r.avg_hours + 'h' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No data</p>
        )}
      </Card>
    </div>
  )
}
