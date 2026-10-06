import { build } from "esbuild";

await build({
  entryPoints: ["src/client/main.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "public/app.js",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
});

console.log("Built public/app.js");
