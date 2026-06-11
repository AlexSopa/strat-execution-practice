import { useState } from 'react'
import QuizMode from './modes/quiz/QuizMode'
import ReplayMode from './modes/replay/ReplayMode'
import StatsMode from './modes/stats/StatsMode'

type Tab = 'replay' | 'quiz' | 'stats'

export default function App() {
  const [tab, setTab] = useState<Tab>('replay')
  return (
    <div className="app">
      <header className="header">
        <h1>
          TheStrat <span className="accent">Execution Practice</span>
        </h1>
        <nav className="tabs">
          <button className={tab === 'replay' ? 'tab active' : 'tab'} onClick={() => setTab('replay')}>
            Replay trainer
          </button>
          <button className={tab === 'quiz' ? 'tab active' : 'tab'} onClick={() => setTab('quiz')}>
            Pattern quiz
          </button>
          <button className={tab === 'stats' ? 'tab active' : 'tab'} onClick={() => setTab('stats')}>
            My stats
          </button>
        </nav>
      </header>
      <main>
        {tab === 'replay' && <ReplayMode />}
        {tab === 'quiz' && <QuizMode />}
        {tab === 'stats' && <StatsMode />}
      </main>
      <footer className="footer muted small">
        Free practice tool for TheStrat reversal execution — synthetic data, runs entirely in your browser,
        nothing leaves your machine. Not financial advice.
      </footer>
    </div>
  )
}
