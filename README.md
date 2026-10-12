# craftlandia-rich-empire

Mineflayer bots that farm wood on CraftLandia Olimpo (Minecraft 1.8.8) and sell it at `/warp loja`, plus a small web manager that starts, watches and restarts them.

## Requirements

- Node.js 18+ (tested on Node 24)
- `npm install` (the `canvas` dependency needs the native build tools for your OS)

## Quick start

```bash
npm install
node manager.js
```

Open http://localhost:3000, type a bot name and click **Create + Start**.

A **new account** needs three steps the first time:

1. **Start it once.** It registers and the server drops it at a random spot in the world, which becomes its first `/home`. New accounts can't chat in the session where they register.
2. **Restart it** (dashboard **Restart** button) so it can send commands.
3. **Send `@bootstrap;@grind 20`**: claims the free kits (iron axe, food, armor), then farms forever.

Existing accounts just need `@grind 20`.

## Files

| File | What it is |
|---|---|
| `manager.js` | Express server on port 3000: dashboard, HTTP API, auto-restart and resume of crashed/stalled bots |
| `index.html` | The dashboard |
| `bot.js` | One bot (one process per account). Login, chat queue, built-in commands |
| `commands.js` | Extra commands, **reloaded on every command**: edit and save, no bot restart needed |

## Commands

Send commands from the dashboard, by `POST /bots/:name/command`, or by whispering the bot in game (`/tell <bot> @cmd`). Chain several with `;`: `@chop 10;@sell`.

**Farming** (`commands.js`)

| Command | What it does |
|---|---|
| `@bootstrap` | Claims Kit Basico and Kit Basico Diario from `/kits` |
| `@grind [trees]` | Endless loop: chop `trees` (default 20), sell, go home, repeat. Moves to a new area when trees run out, keeps chopping while shop signs are off (Gladiador event), chops by hand when it has no axe and no money |
| `@stopgrind` | Stops the grind after the current tree |
| `@tpto <bot>` | Teleports to another fleet bot (`/call` + the target auto-accepts with `/bring`), then sets home there. Costs 5 coins |
| `@chopsell [n]` | Chop `n` trees, sell, print balance |

**Built in** (`bot.js`)

| Command | What it does |
|---|---|
| `@chop [n]` | Chop `n` trees near the bot |
| `@sell` | Walk to the sell signs at `/warp loja` and sell |
| `@buyfood`, `@buydiamond` | Buy at the shop |
| `@craftaxe` | Craft a diamond axe (buys diamonds if needed) |
| `@gohome`, `@sethome` | `/home`, `/sethome` |
| `@balance`, `@inventory`, `@position` | Print balance, inventory, position |
| `@goto x y z`, `@findtree`, `@treebreak x y z` | Movement / chopping helpers |
| `@click <slot> [button]` | Click a slot in an open menu (button 1 = right click) |
| `@signs` | Print nearby sign text (shop debugging) |
| `@chat <text>` | Send raw chat or a server command |
| `@wait <ticks>` | Wait (20 ticks = 1 s) |
| `@pay <amount>` | Pay the player who sent the command (see Security) |

## Adding a command without restarting

Add an entry to `commands.js` and save. The next command picks it up:

```js
'@mycommand': async (ctx, args) => {
  // ctx: bot, log, goTo, chopLoop, sell, getBalance, goHome, setHome, eat, findAxe, ...
  // args: "@mycommand 5 x" -> ['5', 'x']
  ctx.log('INFO', 'mine', `hello from ${ctx.bot.username}`)
},
```

A command that is already running keeps its old code. Stop it and start it again to pick up changes. Changes to `bot.js` need a bot restart.

## Manager API

| Endpoint | |
|---|---|
| `GET /bots` | All bots with status, job and latest state |
| `GET /bots/:name/state` | Position, health, food, held item, inventory, nearby drops (updated every second over IPC, doesn't disturb the job) |
| `GET /bots/:name/map?r=24` | Top-down text map of the blocks around the bot |
| `POST /bots/:name/start` \| `stop` \| `restart` | Process control |
| `POST /bots/:name/command` | Body `{"cmd": "@grind 20"}` |

Each bot also runs a 3D viewer (prismarine-viewer) on port 3100, 3101, …; the dashboard's **Show view** opens it. It listens on all network interfaces.

The manager restarts a bot that crashes, that stalls (no progress for 3 min), or whose progress "spins" (5 updates in under 10 s, i.e. no real work), and resumes the unfinished part of its job.

## Server quirks the code handles

- **Login limbo:** the server doesn't send health until `/login`, so Mineflayer's `spawn` only fires after it. `/register` and `/login` are sent on the `login` event.
- **Anti-flood:** commands closer than ~5 s apart are refused ("Aguarde 5 segundos"). All chat goes through a 5.5 s queue.
- **5 accounts per IP** for non-VIP players. A 6th bot is kicked ("Jogadores sem VIP são limitados a 5 contas por IP").
- **AFK:** a bot idle for ~5 min is moved to the AFK world. The bot answers with `/home`.
- **Gladiador event:** shop signs are off while it runs ("Placas/MOBs e Plantações OFF"). `@grind` keeps chopping and sells afterwards.
- **1.8 dark oak:** `log2` crafts into `planks` (no `planks2` item).

## Security

- **Anyone in game can command the bots by whisper**, including `@pay <amount>`, which pays the sender. Don't keep large balances on the bots until the whisper handler only accepts your own names.
- The account password is hardcoded in `bot.js` (`/register` / `/login`) and shared by all bots. Change it before using the code, and don't publish it.
