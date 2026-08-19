const express = require('express')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const app = express()
app.use(express.json())

const bots = {} // name -> { process, pid, status, job }

const BOT_SCRIPT = 'bot.js'      // path to your bot script
const BOT_DIR = __dirname         // folder where bot.js lives (adjust if needed)

// matches the bot's log format: [HH:MM:SS] [LEVEL] [module] message
const LOG_LINE = /^\[\d\d:\d\d:\d\d\] \[(\w+)\] \[(\w+)\] (.*)$/

function startJob(bot, raw) {
  const steps = raw.split(';').map(c => c.trim()).filter(Boolean).map(cmd => ({
    cmd,
    status: 'not_started',
    progress: null
  }))
  bot.job = { raw, steps, cursor: -1 }
  bot.progressTimestamps = []
}

// finds the first step matching cmd that hasn't finished yet and marks it
function advanceJob(bot, cmd, status, error) {
  if (!bot.job) return
  const idx = bot.job.steps.findIndex(s => s.cmd === cmd && s.status !== 'done' && s.status !== 'failed')
  if (idx === -1) return

  bot.job.cursor = idx
  bot.job.steps[idx].status = status
  if (error) bot.job.steps[idx].error = error

  if (status === 'done') {
    bot.failureResumeCount = 0 // successful step resets the consecutive-failure counter
    bot.crashCount = 0
  }
}

const SPIN_WINDOW = 5
const SPIN_MAX_SPAN_MS = 10000

function updateJobProgress(bot, message) {
  if (!bot.job || bot.job.cursor < 0) return
  const m = message.match(/(\d+)\/(\d+)/)
  if (!m) return
  bot.job.steps[bot.job.cursor].progress = { current: parseInt(m[1]), total: parseInt(m[2]) }
  bot.lastProgressAt = Date.now()

  bot.progressTimestamps = bot.progressTimestamps || []
  bot.progressTimestamps.push(bot.lastProgressAt)
  if (bot.progressTimestamps.length > SPIN_WINDOW) bot.progressTimestamps.shift()

  if (bot.progressTimestamps.length === SPIN_WINDOW) {
    const span = bot.progressTimestamps[SPIN_WINDOW - 1] - bot.progressTimestamps[0]
    if (span < SPIN_MAX_SPAN_MS) {
      console.log(`progress spinning too fast (${SPIN_WINDOW} updates in ${span}ms) - no real work happening, forcing hard reset`)
      bot.progressTimestamps = []
      bot.process.kill('SIGKILL') // exit handler takes it from here (resume + @gohome)
    }
  }
}

// figures out what's left to run from a job that got interrupted mid-way.
// steps with numeric progress (like @chop 10 at 7/10) get rewritten to only
// run the remainder (@chop 3). steps with no progress info just rerun whole.
function buildResumeCommand(job) {
  if (!job) return null
  const remaining = []

  for (const step of job.steps) {
    if (step.status === 'done') continue

    if (step.progress) {
      const left = step.progress.total - step.progress.current
      if (left > 0) {
        remaining.push(step.cmd.replace(/\d+/, left))
      }
      continue
    }

    // no progress info (never started, or failed before any progress) -> rerun as-is
    remaining.push(step.cmd)
  }

  return remaining.length ? remaining.join(';') : null
}

// parses one line of bot output and updates job state accordingly.
// the bot has no idea this exists - it just logs normally.
function handleLogLine(bot, line) {
  const m = line.match(LOG_LINE)
  if (!m) return
  const [, level, module, message] = m

  if (module === 'whisper') {
    const wm = message.match(/^\w+: (.*)$/)
    if (wm) startJob(bot, wm[1])
    return
  }

  if (module === 'stdin') {
    startJob(bot, message)
    return
  }

  if (module === 'command') {
    if (message.startsWith('start: ')) {
      advanceJob(bot, message.slice(7), 'in_progress')
    } else if (message.startsWith('done: ')) {
      advanceJob(bot, message.slice(6), 'done')
    } else if (message.startsWith('failed: ')) {
      const rest = message.slice(8)
      const [cmd, error] = rest.split(' - ')
      advanceJob(bot, cmd, 'failed', error)

      // process is still alive here - resume right away instead of waiting for exit
      bot.failureResumeCount = (bot.failureResumeCount || 0) + 1
      if (bot.failureResumeCount > MAX_AUTO_RESTARTS) {
        console.log(`[resume-after-failure] too many failures for this job, giving up`)
      } else {
        const partial = buildResumeCommand(bot.job)
        if (partial) {
          const resume = `@gohome;${partial}`
          console.log(`[resume-after-failure] sending: ${resume}`)
          bot.process.stdin.write(resume + '\n')
        }
      }
    }
    return
  }

  if (module === 'auth' && message === 'logged in') {
    if (bot.pendingResume) {
      const resume = `@gohome;${bot.pendingResume}`
      bot.pendingResume = null
      console.log(`[resume] scheduled in ${RESUME_DELAY_MS / 1000}s: ${resume}`)
      setTimeout(() => {
        if (bot.process && bot.status === 'running') {
          console.log(`[resume] sending: ${resume}`)
          bot.process.stdin.write(resume + '\n')
        }
      }, RESUME_DELAY_MS)
    }
    return
  }

  if (module === 'progress') {
    updateJobProgress(bot, message)
  }
}

const MAX_AUTO_RESTARTS = 5
const RESUME_DELAY_MS = 8000 // wait after login before sending resume command
const VIEWER_BASE_PORT = 3100

// list of proxies, one per bot. format: "host:port" or "host:port:user:pass"
// fill this in (or load from a file/env) before starting bots
const PROXY_LIST_FILE = path.join(BOT_DIR, 'proxylist.txt')

function loadProxies() {
  try {
    return fs.readFileSync(PROXY_LIST_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return [] // file doesn't exist -> no proxies, bots connect directly
  }
}

const PROXIES = loadProxies()
console.log(`loaded ${PROXIES.length} proxies from ${PROXY_LIST_FILE}`)

let nextViewerPort = VIEWER_BASE_PORT
function assignViewerPort(previous) {
  if (previous && previous.viewerPort) return previous.viewerPort
  return nextViewerPort++
}

let nextProxyIndex = 0
function assignProxy(previous) {
  if (previous && previous.proxy) return previous.proxy // keep same proxy across restarts
  if (PROXIES.length === 0) return null
  const proxy = PROXIES[nextProxyIndex % PROXIES.length]
  nextProxyIndex++
  return proxy
}

function startBot(name) {
  if (bots[name] && bots[name].status === 'running') {
    return { error: 'already running' }
  }

  const previous = bots[name]
  const viewerPort = assignViewerPort(previous)
  const proxy = assignProxy(previous)

  const args = [BOT_SCRIPT, name, viewerPort]
  if (proxy) args.push(proxy)

  const child = spawn('node', args, { cwd: BOT_DIR })

  bots[name] = {
    process: child,
    pid: child.pid,
    status: 'running',
    job: previous ? previous.job : null,
    pendingResume: previous ? previous.pendingResume : null,
    intentionalStop: false,
    crashCount: previous ? (previous.crashCount || 0) : 0,
    failureResumeCount: previous ? (previous.failureResumeCount || 0) : 0,
    lastProgressAt: null,
    viewerPort,
    proxy
  }

  child.stdout.on('data', (data) => {
    const text = data.toString()
    process.stdout.write(`[${name}] ${text}`)
    text.split('\n').filter(Boolean).forEach(line => handleLogLine(bots[name], line))
  })
  child.stderr.on('data', (data) => process.stderr.write(`[${name}][err] ${data}`))

  child.on('exit', () => {
    const bot = bots[name]
    if (!bot) return
    bot.status = 'stopped'

    if (bot.intentionalStop) {
      bot.intentionalStop = false
      return
    }

    // unexpected crash
    if (bot.crashCount >= MAX_AUTO_RESTARTS) {
      console.log(`[${name}] crashed too many times, giving up auto-restart`)
      return
    }

    bot.crashCount++
    bot.pendingResume = buildResumeCommand(bot.job)
    console.log(`[${name}] crashed unexpectedly (${bot.crashCount}/${MAX_AUTO_RESTARTS}), restarting${bot.pendingResume ? ' and resuming: ' + bot.pendingResume : ''}`)

    setTimeout(() => startBot(name), 1000)
  })

  return { ok: true, pid: child.pid }
}

function stopBot(name) {
  const bot = bots[name]
  if (!bot || bot.status !== 'running') return { error: 'not running' }

  bot.intentionalStop = true
  bot.process.kill('SIGKILL')
  bot.status = 'stopped'
  bot.job = null
  bot.pendingResume = null
  bot.failureResumeCount = 0
  return { ok: true }
}

function restartBot(name) {
  const bot = bots[name]
  if (bot) {
    bot.crashCount = 0 // manual restart resets the crash counter
    bot.job = null
    bot.pendingResume = null
    bot.failureResumeCount = 0
  }
  stopBot(name)
  setTimeout(() => startBot(name), 500)
  return { ok: true }
}

function sendCommand(name, cmd) {
  const bot = bots[name]
  if (!bot || bot.status !== 'running') return { error: 'not running' }

  bot.process.stdin.write(cmd + '\n')
  return { ok: true }
}

function listBots() {
  return Object.entries(bots).map(([name, b]) => ({
    name,
    pid: b.pid,
    status: b.status,
    job: b.job,
    viewerPort: b.viewerPort,
    proxy: b.proxy
  }))
}

// --- API ---

app.get('/bots', (req, res) => {
  res.json(listBots())
})

app.post('/bots/:name/start', (req, res) => {
  res.json(startBot(req.params.name))
})

app.post('/bots/:name/stop', (req, res) => {
  res.json(stopBot(req.params.name))
})

app.post('/bots/:name/restart', (req, res) => {
  res.json(restartBot(req.params.name))
})

app.post('/bots/:name/command', (req, res) => {
  const { cmd } = req.body
  if (!cmd) return res.status(400).json({ error: 'missing cmd' })
  res.json(sendCommand(req.params.name, cmd))
})

// --- Webpage ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

const PORT = 3000
app.listen(PORT, () => console.log(`manager running on http://localhost:${PORT}`))

// --- stall watchdog ---
// if a bot is mid-progress-step and hasn't logged progress in STALL_TIMEOUT_MS,
// assume it's stuck (e.g. pathfinder hung) and kill it. the existing exit
// handler already knows how to resume from the last known progress.
const STALL_TIMEOUT_MS = 3 * 60 * 1000 // hardcoded 3 minutes
const STALL_CHECK_INTERVAL_MS = 10 * 1000

setInterval(() => {
  const now = Date.now()

  for (const [name, bot] of Object.entries(bots)) {
    if (bot.status !== 'running') continue
    if (!bot.job || bot.job.cursor < 0) continue

    const step = bot.job.steps[bot.job.cursor]
    if (!step || step.status !== 'in_progress' || !bot.lastProgressAt) continue

    if (now - bot.lastProgressAt > STALL_TIMEOUT_MS) {
      console.log(`[${name}] stalled (no progress for ${STALL_TIMEOUT_MS / 1000}s), killing to trigger resume`)
      bot.process.kill('SIGKILL') // exit handler takes it from here
    }
  }
}, STALL_CHECK_INTERVAL_MS)