// Shared time-formatting utilities used across pages.
// All times display in UTC (with Z suffix) + browser-local in brackets
// when the user's timezone differs from UTC.

const NOT_UTC = new Date().getTimezoneOffset() !== 0

function _utcHHMM(d) {
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}Z`
}
function _localHHMM(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

// "12 May 14:30Z (22:30)"
export function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const date = d.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' })
  const utc  = _utcHHMM(d)
  return NOT_UTC ? `${date} ${utc} (${_localHHMM(d)})` : `${date} ${utc}`
}

// "14:30Z (22:30)"
export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const utc = _utcHHMM(d)
  return NOT_UTC ? `${utc} (${_localHHMM(d)})` : utc
}

// "14:30Z (22:30)" from a Date object (for computed times like ETA)
export function fmtTimeDate(d) {
  const utc = _utcHHMM(d)
  return NOT_UTC ? `${utc} (${_localHHMM(d)})` : utc
}
