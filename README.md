# LagTag

A 4-player tag game you play in the browser. It also shows how online games hide lag.

## How to play

- One player is **IT**. IT chases the others, and touching someone makes them IT.
- After 90 seconds, whoever spent the **least time as IT** wins.
- Move with **WASD** or the arrow keys. **Space** dashes.
- Bots take any empty seats, so you can play alone.
- To play with friends, click **Copy invite** and send them the link.

### Power-ups

| | Power-up | What it does |
|---|---|---|
| ⚡ | Speed | You run faster for 4 seconds |
| 🛡 | Shield | Blocks the next tag |
| 👻 | Ghost | You walk through walls for 3 seconds |

### Hot potato 💣

In the last 15 seconds, a bomb sits on whoever is IT. Tag someone fast to hand it on. If it explodes on you, you get **+5 seconds**.

Press **M** to turn the sound on or off.

## Run it

You need Node.js 20 or newer.

```
npm install
npm start      # open http://localhost:3000
npm test
```

If port 3000 is already in use, pick another one: `PORT=3100 npm start`

## Netcode Lab

Click **⚙ Netcode Lab** to make the network worse on purpose and see what each technique fixes:

1. Set **latency to 300 ms**. Your own movement still feels instant (that's prediction).
2. Turn off **Client-side prediction**. Now every move lags.
3. Turn off **Server reconciliation**. You jump back and forth (rubber-banding).
4. Turn off **Entity interpolation**. Other players move in jerks.
5. Turn on **Show ghosts** to see where the server thinks everyone is.

## How it works

- The **server** runs the game 60 times a second. It is the only one who decides what really happened.
- The **browser** moves you right away instead of waiting for the server, then fixes small mistakes when the server replies.
- Other players are drawn about 100 ms in the past, so their movement stays smooth.
- When you tag someone, the server checks what *your* screen showed. That way tags work fairly even with lag.
- Fast game data travels over **WebRTC** (UDP-like). Everything else goes over **Socket.IO**. If WebRTC can't connect, the game uses Socket.IO for everything.

## Project layout

```
shared/   game rules and physics (used by server and browser)
server/   game server, rooms, bots
client/   browser game (no build step)
tests/    automated tests
```

## Deploy

```
docker build -t lagtag . && docker run -p 3000:3000 lagtag
```

- `PORT` sets the port.
- `DISABLE_RTC=1` turns WebRTC off.

## License

MIT
