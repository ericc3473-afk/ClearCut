# ClearCut

Remove the background from a photo entirely in your browser. No uploads, no
account, no API key — the AI model runs on your own machine via WebAssembly.

## Run it

Any static file server pointed at `site/` works, e.g.:

```
npx http-server . -c-1 -p 8080 -a 127.0.0.1
```

Then open `http://127.0.0.1:8080/`.

(No build step is required — plain HTML/CSS/JS modules.)

## Privacy

The image you drop, drag or paste never leaves your device. The only network
traffic is downloading the AI model itself from a CDN, which is cached by the
browser after the first run.

## What it uses

- [`@imgly/background-removal@1.7.0`](https://www.npmjs.com/package/@imgly/background-removal)
  (pinned version, loaded as an ES module from jsdelivr) with the `isnet_fp16`
  model, `cpu` device.
- Supported inputs: JPEG, PNG, WebP, up to 22 MB.

## Try it

Drop in `assets/samples/sample-portrait.jpg` (NASA image, public domain)
if you want a ready-made example.
