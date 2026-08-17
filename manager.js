const express = require('express')
const { spawn } = require('child_process')
const path = require('path')

const app = express()
app.use(express.json())

const bots = {} // name -> { process, pid, status, job }

const BOT_SCRIPT = 'test.js'      // path to your bot script
const BOT_DIR = __dirname         // folder where test.js lives (adjust if needed)

// matches the bot's log format: [HH:MM:SS] [LEVEL] [module] message
const LOG_LINE = /^\[\d\d:\d\d:\d\d\] \[(\w+)\] \[(\w+)\] (.*)$/

function startJob(bot, raw) {
  const steps = raw.split(';').map(c => c.trim()).filter(Boolean).map(cmd => ({
    cmd,
    status: 'not_started',
    progress: null
  }))
  bot.job = { raw, steps, cursor: -1 }
}

// finds the first step matching cmd that hasn't finished yet and marks it
function advanceJob(bot, cmd, status, error) {
  if (!bot.job) return
  const idx = bot.job.steps.findIndex(s => s.cmd === cmd && s.status !== 'done' && s.status !== 'failed')
  if (idx === -1) return

  bot.job.cursor = idx
  bot.job.steps[idx].status = status
  if (error) bot.job.steps[idx].error = error
}

function updateJobProgress(bot, message) {
  if (!bot.job || bot.job.cursor < 0) return
  const m = message.match(/(\d+)\/(\d+)/)
  if (!m) return
  bot.job.steps[bot.job.cursor].progress = { current: parseInt(m[1]), total: parseInt(m[2]) }
}

// figures out what's left to run from a job that got interrupted mid-way.
// steps with numeric progress (like @chop 10 at 7/10) get rewritten to only
// run the remainder (@chop 3). steps with no progress info just rerun whole.
function buildResumeCommand(job) {
  if (!job) return null
  const remaining = []

  for (const step of job.steps) {
    if (step.status === 'done') continue

    if (step.status === 'in_progress' && step.progress) {
      const left = step.progress.total - step.progress.current
      if (left > 0) {
        remaining.push(step.cmd.replace(/\d+/, left))
      }
      continue
    }

    // in_progress without progress, not_started, or failed -> rerun as-is
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
    }
    return
  }

  if (module === 'auth' && message === 'logged in') {
    if (bot.pendingResume) {
      console.log(`[resume] sending: ${bot.pendingResume}`)
      bot.process.stdin.write(bot.pendingResume + '\n')
      bot.pendingResume = null
    }
    return
  }

  if (module === 'progress') {
    updateJobProgress(bot, message)
  }
}

const MAX_AUTO_RESTARTS = 5

function startBot(name) {
  if (bots[name] && bots[name].status === 'running') {
    return { error: 'already running' }
  }

  const previous = bots[name]
  const child = spawn('node', [BOT_SCRIPT, name], { cwd: BOT_DIR })

  bots[name] = {
    process: child,
    pid: child.pid,
    status: 'running',
    job: previous ? previous.job : null,
    pendingResume: previous ? previous.pendingResume : null,
    intentionalStop: false,
    crashCount: previous ? (previous.crashCount || 0) : 0
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
  return { ok: true }
}

function restartBot(name) {
  const bot = bots[name]
  if (bot) {
    bot.crashCount = 0 // manual restart resets the crash counter
    bot.job = null
    bot.pendingResume = null
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
    job: b.job
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