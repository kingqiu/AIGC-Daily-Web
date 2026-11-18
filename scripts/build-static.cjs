// Build a smaller static deployment; keep source images and every public URL.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.vercel/output');
const staticRoot = path.join(output, 'static');
const overrides = {};
const summary = { files: 0, optimizedImages: 0, sourceBytes: 0, outputBytes: 0 };

async function emit(relativePath) {
  const input = path.join(root, relativePath);
  const stat = await fs.lstat(input);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${relativePath}`);
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(input)).sort()) {
      if (name === '.DS_Store') continue;
      await emit(path.posix.join(relativePath, name));
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Unsupported file: ${relativePath}`);
  const original = await fs.readFile(input);
  let bytes = original;
  if (/\.(png|jpe?g)$/i.test(relativePath)) {
    // Existing hero files have .png names but contain JPEG bytes.
    const metadata = await sharp(original).metadata();
    if (metadata.format === 'jpeg' && !metadata.hasAlpha && (metadata.pages || 1) === 1) {
      const compressed = await sharp(original)
        .keepMetadata()
        .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
      if (compressed.length < original.length) {
        bytes = compressed;
        summary.optimizedImages++;
      }
      overrides[relativePath] = { contentType: 'image/jpeg' };
    }
    // PNGs (including the logo), alpha and animated images stay unchanged.
  }
  const target = path.join(staticRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  summary.files++;
  summary.sourceBytes += original.length;
  summary.outputBytes += bytes.length;
}

async function main() {
  // Clear only generated output, never source images or newsletter archives.
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  for (const entry of ['index.html', 'newsletters', 'images', 'img']) await emit(entry);
  await fs.writeFile(path.join(output, 'config.json'), JSON.stringify({
    version: 3,
    routes: [{ src: '^/$', dest: '/index.html' }, { handle: 'filesystem' }],
    overrides
  }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
