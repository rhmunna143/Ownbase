const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

function generateChecksums(dirPath = path.join(__dirname, '..', 'release')) {
  if (!fs.existsSync(dirPath)) {
    console.log(`Directory does not exist: ${dirPath}`);
    return {};
  }

  const files = fs.readdirSync(dirPath).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ['.exe', '.zip', '.bak', '.tar', '.gz', '.json'].includes(ext) && !f.startsWith('SHA256');
  });

  if (files.length === 0) {
    console.log(`No release artifacts found in ${dirPath} to checksum.`);
    return {};
  }

  const checksums = {};
  const outputLines = [];

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const hash = computeFileSha256(fullPath);
    checksums[file] = hash;
    outputLines.push(`${hash}  ${file}`);
    console.log(`[SHA-256] ${file} -> ${hash}`);
  }

  const outputPath = path.join(dirPath, 'SHA256SUMS.txt');
  fs.writeFileSync(outputPath, outputLines.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${outputLines.length} checksum(s) to ${outputPath}`);

  return checksums;
}

if (require.main === module) {
  const targetDir = process.argv[2] || path.join(__dirname, '..', 'release');
  generateChecksums(targetDir);
}

module.exports = { computeFileSha256, generateChecksums };
