
import fs from 'fs';
import path from 'path';

const manifestPath = path.resolve(__dirname, '../dist/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

manifest.content_scripts = [
  {
    "matches": ["https://calendar.google.com/*"],
    "js": ["content.js"],
    "run_at": "document_end"
  }
];

// Ensure web_accessible_resources includes assets used by content script if any
// But since we bundle everything into content.js (including styles), we might not need much.
// However, if there are images or other assets, they should be there.
// CRXJS usually adds them. Since we run CRXJS for other parts, it might add some.
// We'll leave web_accessible_resources as is, or ensure it exists.

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('Manifest patched with content script.');
