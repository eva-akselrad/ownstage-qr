# Ownstage QR

Simple dynamic QR codes for Ownstage: create once, change the destination anytime. Accounts save your codes so you can come back from any device.

## How it works

1. Create a free account and sign in.
2. Enter a destination URL and create a QR code (encodes `/r/{id}`).
3. Update destinations from **My QR codes** or the manage page.
4. Legacy anonymous codes (KV-only) still work with an edit token.

Built for [Ownstage](https://ownstage.app) branding and deployed on Cloudflare Workers + KV.

## Develop

```bash
npm install
npx wrangler kv namespace create LINKS
# Put the namespace id in wrangler.toml, then:
npm run dev
```

## Deploy

```bash
npm run deploy
```

**Live:** https://ownstage-qr.scienceandfire66.workers.dev

Set `PUBLIC_BASE_URL` in `wrangler.toml` if you add a custom domain (e.g. `qr.ownstage.app`).

## License

MIT
