const fs = require('fs');
const path = require('path');
const { generateChecksums } = require('./generate-checksums');

const projectRoot = path.join(__dirname, '..');
const buildDir = path.join(projectRoot, 'release-build');
const releaseDir = path.join(projectRoot, 'release');

function finalizeRelease() {
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  if (fs.existsSync(buildDir)) {
    const files = fs.readdirSync(buildDir);
    for (const file of files) {
      const srcPath = path.join(buildDir, file);
      const stat = fs.statSync(srcPath);
      if (stat.isFile() && (file.endsWith('.exe') || file.endsWith('.blockmap') || file.endsWith('.yml'))) {
        const destPath = path.join(releaseDir, file);
        console.log(`[finalize-release] Copying ${file} -> release/`);
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  console.log('[finalize-release] Updating release checksums...');
  generateChecksums(releaseDir);
}

if (require.main === module) {
  finalizeRelease();
}

module.exports = { finalizeRelease };

