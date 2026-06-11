import { useState } from 'react'
import { clearStats, loadStats } from '../../store/persist'

export default function StatsMode() {
  const [data, setData] = useState(loadStats)
  const q = data.quiz
  const pct = (n: number) => (q.asked ? `${Math.round((n / q.asked) * 100)}%` : '—')
  const sessions = data.sessions

  return (
    <div className="stats-layout">
      <div className="card">
        <h3>Pattern recognition (quiz)</h3>
        <div className="stat-grid">
          <span>Questions answered</span>
          <strong>{q.asked}</strong>
          <span>Scenario accuracy</span>
          <strong>{pct(q.scenarioCorrect)}</strong>
          <span>Side accuracy</span>
          <strong>{pct(q.sideCorrect)}</strong>
          <span>Trigger-level accuracy</span>
          <strong>{pct(q.levelCorrect)}</strong>
        </div>
        {Object.keys(q.missesByScenario).length > 0 && (
          <>
            <h4>Most missed</h4>
            {Object.entries(q.missesByScenario)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => (
                <div key={s} className="row order-row">
                  <span>{s}</span>
                  <span className="red">{n} misses</span>
                </div>
              ))}
            <p className="muted small">The quiz automatically serves your most-missed scenarios more often.</p>
          </>
        )}
      </div>

      <div className="card">
        <h3>Execution sessions (replay)</h3>
        {sessions.length === 0 ? (
          <p className="muted">No completed sessions yet — finish a replay session and it lands here.</p>
        ) : (
          <>
            <div className="stat-grid">
              <span>Sessions</span>
              <strong>{sessions.length}</strong>
              <span>Lifetime R</span>
              <strong className={sessions.reduce((a, s) => a + s.totalR, 0) >= 0 ? 'green' : 'red'}>
                {sessions.reduce((a, s) => a + s.totalR, 0).toFixed(2)}R
              </strong>
              <span>Avg entry score</span>
              <strong>{Math.round(sessions.reduce((a, s) => a + s.entryAvg, 0) / sessions.length)}</strong>
              <span>Avg stop score</span>
              <strong>{Math.round(sessions.reduce((a, s) => a + s.stopsAvg, 0) / sessions.length)}</strong>
              <span>Avg management score</span>
              <strong>{Math.round(sessions.reduce((a, s) => a + s.managementAvg, 0) / sessions.length)}</strong>
            </div>
            <h4>Recent sessions</h4>
            <table className="sessions-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Seed</th>
                  <th>Trades</th>
                  <th>R</th>
                  <th>E/S/M</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 15).map((s, k) => (
                  <tr key={k}>
                    <td>{new Date(s.date).toLocaleDateString()}</td>
                    <td className="muted">{s.seed}</td>
                    <td>{s.trades}</td>
                    <td className={s.totalR >= 0 ? 'green' : 'red'}>
                      {s.totalR >= 0 ? '+' : ''}
                      {s.totalR.toFixed(2)}
                    </td>
                    <td>
                      {s.entryAvg}/{s.stopsAvg}/{s.managementAvg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <button
          className="btn btn-muted"
          onClick={() => {
            if (confirm('Clear all saved practice stats?')) {
              clearStats()
              setData(loadStats())
            }
          }}
        >
          Reset stats
        </button>
      </div>
    </div>
  )
}
