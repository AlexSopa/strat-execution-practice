import type { Scenario } from '../engine/types'

export interface QuizStats {
  asked: number
  scenarioCorrect: number
  sideCorrect: number
  levelCorrect: number
  missesByScenario: Partial<Record<Scenario | 'none', number>>
}

export interface SessionSummary {
  date: string
  seed: number
  trades: number
  totalR: number
  winRate: number | null
  entryAvg: number
  stopsAvg: number
  managementAvg: number
  overall: number
}

interface PersistShape {
  quiz: QuizStats
  sessions: SessionSummary[]
}

const KEY = 'strat-execution-practice-v1'

const EMPTY: PersistShape = {
  quiz: { asked: 0, scenarioCorrect: 0, sideCorrect: 0, levelCorrect: 0, missesByScenario: {} },
  sessions: [],
}

export function loadStats(): PersistShape {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(EMPTY)
    const parsed = JSON.parse(raw) as PersistShape
    return { ...structuredClone(EMPTY), ...parsed, quiz: { ...EMPTY.quiz, ...parsed.quiz } }
  } catch {
    return structuredClone(EMPTY)
  }
}

function save(data: PersistShape) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Private browsing or quota — practice still works, stats just don't stick.
  }
}

export function recordQuizAnswer(result: {
  scenarioCorrect: boolean
  sideCorrect: boolean
  levelCorrect: boolean
  actualScenario: Scenario | 'none'
}) {
  const data = loadStats()
  data.quiz.asked++
  if (result.scenarioCorrect) data.quiz.scenarioCorrect++
  else {
    data.quiz.missesByScenario[result.actualScenario] =
      (data.quiz.missesByScenario[result.actualScenario] ?? 0) + 1
  }
  if (result.sideCorrect) data.quiz.sideCorrect++
  if (result.levelCorrect) data.quiz.levelCorrect++
  save(data)
}

export function recordSession(summary: SessionSummary) {
  const data = loadStats()
  data.sessions.unshift(summary)
  data.sessions = data.sessions.slice(0, 100)
  save(data)
}

export function clearStats() {
  save(structuredClone(EMPTY))
}
