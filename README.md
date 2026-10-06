# Ownstage QR

Simple dynamic QR codes for Ownstage: create once, change the destination anytime. No accounts — you keep a private edit token.

## How it works

1. Enter a destination URL and create a QR code.
2. The QR encodes a short redirect link (`/r/{id}`).
3. Update the destination from the manage page using your edit token (saved in this browser or via bookmark).

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

Set `PUBLIC_BASE_URL` in `wrangler.toml` to your production URL after the first deploy.

## License

MIT
