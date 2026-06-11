import type { SessionReport } from '../../engine/grader'
import type { Scenario } from '../../engine/types'

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? '#26a69a' : value >= 55 ? '#f5a623' : '#ef5350'
  return (
    <div className="score-row">
      <span>{label}</span>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <strong>{value}</strong>
    </div>
  )
}

export default function ReportCard({
  report,
  onNewSession,
}: {
  report: SessionReport
  onNewSession: () => void
}) {
  return (
    <div className="overlay">
      <div className="card report-card">
        <h2>Session report card</h2>
        {report.trades.length === 0 ? (
          <p className="muted">
            No trades this session. If no clean reversal triggered, sitting out was right — but make sure you're
            arming orders when 2-2 / 2-1-2 / 3-1-2 / 1-2-2 / 3-2-2 patterns appear.
          </p>
        ) : (
          <>
            <ScoreBar label="Entries" value={report.entryAvg} />
            <ScoreBar label="Stops" value={report.stopsAvg} />
            <ScoreBar label="Management" value={report.managementAvg} />
            <div className="report-totals">
              <span>
                Overall <strong>{report.overall}</strong>
              </span>
              <span>
                Trades <strong>{report.trades.length}</strong>
              </span>
              <span>
                Win rate <strong>{report.winRate !== null ? `${report.winRate}%` : '—'}</strong>
              </span>
              <span className={report.totalR >= 0 ? 'green' : 'red'}>
                Total <strong>{report.totalR >= 0 ? '+' : ''}{report.totalR.toFixed(2)}R</strong>
              </span>
            </div>
            {Object.keys(report.byScenario).length > 0 && (
              <div className="muted small">
                {Object.entries(report.byScenario).map(([sc, v]) => (
                  <span key={sc} className="pill">
                    {sc as Scenario}: {v.count} trade{v.count > 1 ? 's' : ''}, {v.totalR >= 0 ? '+' : ''}
                    {v.totalR.toFixed(2)}R
                  </span>
                ))}
              </div>
            )}
            <div className="notes">
              {report.trades.map((g, k) => (
                <div key={k} className="trade-note">
                  <strong>
                    Trade {k + 1} {g.scenario ? `(${g.scenario})` : ''} — E{g.entry} / S{g.stops} / M{g.management}
                    {g.r !== null && (
                      <span className={g.r >= 0 ? 'green' : 'red'}>
                        {' '}
                        {g.r >= 0 ? '+' : ''}
                        {g.r.toFixed(2)}R
                      </span>
                    )}
                  </strong>
                  {g.notes.map((n, j) => (
                    <div key={j} className="muted small">
                      • {n}
                    </div>
                  ))}
                  {g.notes.length === 0 && <div className="green small">• Textbook execution.</div>}
                </div>
              ))}
            </div>
          </>
        )}
        <button className="btn btn-green" onClick={onNewSession}>
          New session
        </button>
      </div>
    </div>
  )
}
