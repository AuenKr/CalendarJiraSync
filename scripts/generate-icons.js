
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sizes = [16, 32, 48, 128];
const inputFile = 'public/icon.svg';
const outputDir = 'public';

async function generateIcons() {
  if (!fs.existsSync(inputFile)) {
    console.error('Input file not found:', inputFile);
    process.exit(1);
  }

  for (const size of sizes) {
    const outputFile = path.join(outputDir, `icon-${size}.png`);
    try {
      await sharp(inputFile)
        .resize(size, size)
        .png()
        .toFile(outputFile);
      console.log(`Generated ${outputFile}`);
    } catch (error) {
      console.error(`Error generating ${outputFile}:`, error);
    }
  }
}

generateIcons();
