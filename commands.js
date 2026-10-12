// comandos extras do bot. este arquivo e relido a cada comando, entao
// e so salvar e mandar o comando de novo: nao precisa reiniciar o bot.
//
// cada comando recebe (ctx, args):
//   ctx  -> bot, log, username, Vec3, goals e as funcoes do bot.js
//           (goTo, chopTree, chopLoop, sell, getBalance, goHome, setHome, eat, ...)
//   args -> o resto da mensagem separado por espaco ("@chopsell 5" -> ['5'])
//
// o nome tem que ser a primeira palavra do comando, e um comando daqui
// tem prioridade sobre um de mesmo nome no bot.js.

module.exports = {
  // exemplo: corta N arvores e ja vende ("@chopsell 10")
  '@chopsell': async (ctx, args) => {
    const times = parseInt(args[0]) || 1
    await ctx.chopLoop(times)
    await ctx.sell()
    const balance = await ctx.getBalance()
    ctx.log('INFO', 'economy', `balance after sell: ${balance}`)
  },

  // conta nova: pega Kit Basico (slot 10) e Kit Basico Diario (slot 12) pelo menu do /kits
  '@bootstrap': async (ctx) => {
    const { bot, log } = ctx
    for (const slot of [10, 12]) {
      const opened = new Promise(resolve => {
        bot.once('windowOpen', resolve)
        setTimeout(() => resolve(null), 15000)
      })
      await bot.chat('/kits')
      const window = await opened
      if (!window) {
        log('WARN', 'bootstrap', `kits menu did not open for slot ${slot}`)
        continue
      }
      await bot.waitForTicks(10)
      await bot.clickWindow(slot, 1, 0) // botao direito = pegar o kit
      await bot.waitForTicks(20)
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
    }
    const axe = ctx.findAxe()
    log('INFO', 'bootstrap', `done, axe: ${axe ? axe.name : 'none'}, items: ${bot.inventory.items().length}`)
  },

  // loop de farm sem fim: "@grind <arvores>" corta <arvores> (padrao 20), vende, volta pra home, repete.
  // - corta 1 arvore por lote e checa se ainda tem arvore perto; se acabou, anda ~48 blocos e faz /sethome la
  //   (sem isso o chopLoop "termina" arvores vazias rapido e o spin detector do manager mata o bot)
  // - placas ficam OFF durante o Gladiador; enquanto isso continua cortando em vez de vender
  // - so roda um grind por bot; "@stopgrind" para no fim do lote atual
  '@grind': async (ctx, args) => {
    const { bot, log, goals } = ctx
    const trees = parseInt(args[0]) || 20

    if (bot._grinding) {
      log('WARN', 'grind', 'already grinding, ignoring')
      return
    }
    bot._grinding = true
    bot._grindStop = false

    if (!bot._signsWatch) {
      bot._signsWatch = true
      bot._signsOffAt = Date.now() // ate ouvir o primeiro aviso, assume OFF (90s)
      bot.on('message', (m) => {
        if (m.toString().includes('Placas/MOBs e Plantações OFF')) bot._signsOffAt = Date.now()
      })
    }
    const signsOff = () => bot._signsOffAt && Date.now() - bot._signsOffAt < 90 * 1000
    // mesma regra do locateNearestTree (tronco = log com log em cima ou embaixo); log solto nao conta,
    // senao o chopTree volta "no tree found" na hora e o spin detector do manager mata o bot
    const isLog = (b) => b?.name.includes('log')
    const treesNearby = () => !!bot.findBlock({
      maxDistance: 32,
      matching: b => isLog(b) && (isLog(bot.blockAt(b.position.offset(0, 1, 0))) || isLog(bot.blockAt(b.position.offset(0, -1, 0))))
    })
    const logCount = () => bot.inventory.items().filter(i => i.name.includes('log')).reduce((t, i) => t + i.count, 0)

    async function moveToNewArea() {
      for (let attempt = 1; attempt <= 4; attempt++) {
        const angle = Math.random() * 2 * Math.PI
        const p = bot.entity.position
        const x = Math.round(p.x + Math.cos(angle) * 48)
        const z = Math.round(p.z + Math.sin(angle) * 48)
        log('INFO', 'grind', `no trees nearby, walking to (${x}, ${z}) attempt ${attempt}`)
        try {
          await bot.pathfinder.goto(new goals.GoalXZ(x, z))
        } catch (err) {
          log('WARN', 'grind', `walk failed: ${err.message}`)
        }
        if (treesNearby()) {
          await ctx.setHome()
          log('INFO', 'grind', `new home at ${bot.entity.position.floored()}`)
          return true
        }
      }
      return false
    }

    async function chopBatch() {
      // o chopLoop so come quando acha arvore; procurando area nova o bot passava fome
      if (bot.food < 15) await ctx.eat()
      if (!treesNearby() && !(await moveToNewArea())) {
        log('WARN', 'grind', 'could not find trees after 4 walks')
        await bot.waitForTicks(20 * 10)
        return
      }
      // sem machado: chopLoop tentaria comprar diamante sem dinheiro e falharia.
      // so deixa ele craftar se ja tem saldo; senao corta na mao
      const logsBefore = logCount()
      if (ctx.findAxe() || (bot._lastBalance || 0) >= 200) {
        await ctx.chopLoop(1)
      } else {
        if (treesNearby()) {
          await ctx.chopTree()
          log('INFO', 'progress', '1/1 (no axe, by hand)')
        }
      }
      bot._pathFails = 0
      // lote que nao aumentou a madeira nao cortou nada ("no tree found" / caminho falhou mesmo com log por perto).
      // muda de area antes do proximo lote, senao o spin detector do manager mata o bot
      if (logCount() <= logsBefore) {
        log('INFO', 'grind', 'batch found no reachable tree, moving to a new area')
        await moveToNewArea()
      }
    }

    async function sellAndReport(round) {
      const before = await ctx.getBalance()
      await ctx.sell()
      const after = await ctx.getBalance()
      bot._lastBalance = after
      log('INFO', 'grind', `round ${round} sold: balance ${before} -> ${after} (+${(after - before).toFixed(2)}), logs left: ${logCount()}`)
    }

    try {
      for (let round = 1; !bot._grindStop; round++) {
        try {
          log('INFO', 'grind', `round ${round}: chopping ${trees} trees`)
          // muita madeira acumulada: vende antes, pra um problema de machado nunca travar a venda
          if (logCount() > 150 && !signsOff()) await sellAndReport(round)
          await ctx.goHome()

          const target = logCount() + trees * 5 // ~5+ logs por arvore
          for (let n = 0; n < trees && logCount() < target && !bot._grindStop; n++) {
            await chopBatch()
            // progresso da rodada (o "1/1" do chopLoop faria o resume do manager achar que acabou)
            log('INFO', 'progress', `${n + 1}/${trees}`)
          }
          while (signsOff() && !bot._grindStop) {
            log('INFO', 'grind', 'shop signs are OFF (Gladiador), chopping while waiting')
            await chopBatch()
          }
          if (bot._grindStop) break

          await sellAndReport(round)
        } catch (err) {
          log('WARN', 'grind', `round ${round} error: ${err.message}, going home and retrying`)
          await bot.waitForTicks(20 * 5)
          // arvores que sobraram estao inalcancaveis: depois de 2 falhas de caminho seguidas, muda de area
          if (/path|Took to long/i.test(err.message)) {
            bot._pathFails = (bot._pathFails || 0) + 1
            if (bot._pathFails >= 2) {
              log('INFO', 'grind', `${bot._pathFails} path failures in a row, moving to a new area`)
              bot._pathFails = 0
              await moveToNewArea().catch(e => log('WARN', 'grind', `move failed: ${e.message}`))
            }
          }
        }
      }
    } finally {
      bot._grinding = false
      log('INFO', 'grind', 'stopped')
    }
  },

  // teleporta este bot ate outro bot da frota: "@tpto claudinhoda14"
  // /call custa 5 coins e o pedido expira rapido, entao o alvo aceita sozinho:
  // este bot manda um /tell "@bring <eu>" e o alvo roda o @bring abaixo (via handler de whisper)
  '@tpto': async (ctx, args) => {
    const { bot, log } = ctx
    const target = args[0]
    if (!target) return log('WARN', 'tpto', 'usage: @tpto <bot>')

    // grind rodando faria /home e desfaria o teleporte
    const wasGrinding = !!bot._grinding
    if (wasGrinding) {
      // cancela a caminhada atual em vez de esperar o lote acabar (esperar minutos dispara o
      // stall watchdog do manager). o grind sai no proximo check do _grindStop
      bot._grindStop = true
      bot.pathfinder.setGoal(null)
      log('INFO', 'tpto', 'stopping grind first')
      const deadline = Date.now() + 20000
      while (bot._grinding && Date.now() < deadline) await bot.waitForTicks(20)
    }

    const balance = await ctx.getBalance()
    if (balance === null || balance < 5) {
      log('WARN', 'tpto', `need 5 coins for /call, balance: ${balance}`)
      return
    }

    const from = bot.entity.position.clone()
    await bot.chat(`/call ${target}`)
    await bot.chat(`/tell ${target} @bring ${bot.username}`)

    const deadline = Date.now() + 30000
    while (bot.entity.position.distanceTo(from) < 5 && Date.now() < deadline) await bot.waitForTicks(10)
    if (bot.entity.position.distanceTo(from) < 5) {
      log('WARN', 'tpto', `teleport to ${target} did not happen`)
      return
    }

    log('INFO', 'tpto', `arrived at ${target}: ${bot.entity.position.floored()}`)
    await ctx.setHome()

    if (wasGrinding) {
      log('INFO', 'tpto', 'resuming grind')
      await module.exports['@grind'](ctx, ['20'])
    }
  },

  // aceita o pedido de /call de outro bot da frota (chamado pelo @tpto via /tell)
  '@bring': async (ctx, args) => {
    const requester = args[0]
    if (!requester || !/^claudinhoda\d+$/.test(ctx.username) || ctx.username !== requester) {
      ctx.log('WARN', 'tpto', `ignoring @bring ${requester} from ${ctx.username}`)
      return
    }
    await ctx.bot.chat(`/bring ${requester}`)
    ctx.log('INFO', 'tpto', `accepted teleport from ${requester}`)
  },

  // debug: loga o JSON cru (com clickEvent) das proximas mensagens que contem o texto. "@rawchat quer ir"
  '@rawchat': async (ctx, args) => {
    const needle = args.join(' ')
    const listener = (msg) => {
      if (!msg.toString().includes(needle)) return
      ctx.log('INFO', 'rawchat', JSON.stringify(msg.json))
    }
    ctx.bot.on('message', listener)
    setTimeout(() => ctx.bot.removeListener('message', listener), 60000)
    ctx.log('INFO', 'rawchat', `watching for "${needle}" for 60s`)
  },

  '@stopgrind': async (ctx) => {
    ctx.bot._grindStop = true
    ctx.log('INFO', 'grind', 'stop requested, finishing current batch')
  },
}
