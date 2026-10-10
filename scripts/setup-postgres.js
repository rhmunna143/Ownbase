const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetDir = path.join(__dirname, '..', 'extraResources');
const zipPath = path.join(targetDir, 'postgresql.zip');
const pgsqlDir = path.join(targetDir, 'pgsql');
const downloadUrl = 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip';

async function main() {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const initdb = path.join(pgsqlDir, 'bin', 'initdb.exe');
  if (fs.existsSync(initdb)) {
    console.log('✓ PostgreSQL portable binaries already exist in extraResources/pgsql/bin');
    return;
  }

  if (!fs.existsSync(zipPath)) {
    console.log(`Downloading PostgreSQL portable binaries from ${downloadUrl}...`);
    execSync(`curl.exe -L -o "${zipPath}" "${downloadUrl}"`, { stdio: 'inherit' });
    console.log('✓ Download complete.');
  }

  console.log('Extracting PostgreSQL archive...');
  execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, { stdio: 'inherit' });
  console.log('✓ Extracted to extraResources/pgsql');
}

main().catch((err) => {
  console.error('Failed to setup postgres binaries:', err);
  process.exit(1);
});
