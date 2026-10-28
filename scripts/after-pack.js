const fs = require('fs');
const path = require('path');

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(source)) return;
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const items = fs.readdirSync(source, { withFileTypes: true });
  for (const item of items) {
    const srcPath = path.join(source, item.name);
    const destPath = path.join(target, item.name);

    if (item.isDirectory()) {
      copyFolderRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

exports.default = async function (context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const resourcesDir = path.join(appOutDir, 'resources');
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');

  console.log(`[afterPack] Running Ownbase post-packaging sync on ${appOutDir}...`);

  // 1. Copy node_modules/.prisma (Prisma client & native query engine)
  const sourcePrismaModule = path.join(projectDir, 'node_modules', '.prisma');
  if (fs.existsSync(sourcePrismaModule)) {
    const targetPrisma1 = path.join(unpackedDir, 'node_modules', '.prisma');
    const targetPrisma2 = path.join(resourcesDir, 'node_modules', '.prisma');
    console.log(`[afterPack] Copying .prisma to ${targetPrisma1} and ${targetPrisma2}...`);
    copyFolderRecursiveSync(sourcePrismaModule, targetPrisma1);
    copyFolderRecursiveSync(sourcePrismaModule, targetPrisma2);
  } else {
    console.warn(`[afterPack] WARNING: ${sourcePrismaModule} not found!`);
  }

  // 2. Ensure prisma directory (schema and migrations) is copied
  const sourcePrismaDir = path.join(projectDir, 'prisma');
  if (fs.existsSync(sourcePrismaDir)) {
    const targetPrismaDir1 = path.join(unpackedDir, 'prisma');
    const targetPrismaDir2 = path.join(resourcesDir, 'prisma');
    copyFolderRecursiveSync(sourcePrismaDir, targetPrismaDir1);
    copyFolderRecursiveSync(sourcePrismaDir, targetPrismaDir2);
  }

  // 3. Ensure installer directory (WinSW & PowerShell scripts) is copied
  const sourceInstaller = path.join(projectDir, 'installer');
  if (fs.existsSync(sourceInstaller)) {
    const targetInstaller1 = path.join(resourcesDir, 'installer');
    const targetInstaller2 = path.join(appOutDir, 'installer');
    console.log(`[afterPack] Copying installer scripts to ${targetInstaller1}...`);
    copyFolderRecursiveSync(sourceInstaller, targetInstaller1);
    copyFolderRecursiveSync(sourceInstaller, targetInstaller2);
  }

  // 4. Ensure @prisma (client, engines, etc.) is present in app.asar.unpacked and resources
  const sourcePrismaScope = path.join(projectDir, 'node_modules', '@prisma');
  if (fs.existsSync(sourcePrismaScope)) {
    const targetPrismaScope1 = path.join(unpackedDir, 'node_modules', '@prisma');
    const targetPrismaScope2 = path.join(resourcesDir, 'node_modules', '@prisma');
    console.log(`[afterPack] Copying @prisma scope to ${targetPrismaScope1}...`);
    copyFolderRecursiveSync(sourcePrismaScope, targetPrismaScope1);
    copyFolderRecursiveSync(sourcePrismaScope, targetPrismaScope2);
  }

  // 4b. Ensure prisma CLI is also present in app.asar.unpacked and resources
  const sourcePrismaCli = path.join(projectDir, 'node_modules', 'prisma');
  if (fs.existsSync(sourcePrismaCli)) {
    const targetPrismaCli1 = path.join(unpackedDir, 'node_modules', 'prisma');
    const targetPrismaCli2 = path.join(resourcesDir, 'node_modules', 'prisma');
    console.log(`[afterPack] Copying prisma CLI to ${targetPrismaCli1}...`);
    copyFolderRecursiveSync(sourcePrismaCli, targetPrismaCli1);
    copyFolderRecursiveSync(sourcePrismaCli, targetPrismaCli2);
  }

  // 5. Ensure Next.js static web app (out directory) is copied to unpacked, resources, and app root
  const sourceOutDir = path.join(projectDir, 'out');
  if (fs.existsSync(sourceOutDir)) {
    const targetOutDir1 = path.join(resourcesDir, 'out');
    const targetOutDir2 = path.join(unpackedDir, 'out');
    const targetOutDir3 = path.join(appOutDir, 'out');
    console.log(`[afterPack] Copying static web app to ${targetOutDir1}, ${targetOutDir2}, and ${targetOutDir3}...`);
    copyFolderRecursiveSync(sourceOutDir, targetOutDir1);
    copyFolderRecursiveSync(sourceOutDir, targetOutDir2);
    copyFolderRecursiveSync(sourceOutDir, targetOutDir3);
  } else {
    console.warn(`[afterPack] WARNING: Static out directory not found at ${sourceOutDir}!`);
  }

  // 6. Ensure assets (icons, etc.) are synced to unpacked, resources, and app root
  const sourceAssetsDir = path.join(projectDir, 'assets');
  if (fs.existsSync(sourceAssetsDir)) {
    const targetAssetsDir1 = path.join(resourcesDir, 'assets');
    const targetAssetsDir2 = path.join(unpackedDir, 'assets');
    const targetAssetsDir3 = path.join(appOutDir, 'assets');
    console.log(`[afterPack] Copying assets to ${targetAssetsDir1}...`);
    copyFolderRecursiveSync(sourceAssetsDir, targetAssetsDir1);
    copyFolderRecursiveSync(sourceAssetsDir, targetAssetsDir2);
    copyFolderRecursiveSync(sourceAssetsDir, targetAssetsDir3);
  }

  // 6b. Ensure dist (daemon, shared, main, electron) is copied to unpacked, resources, and app root
  const sourceDistDir = path.join(projectDir, 'dist');
  if (fs.existsSync(sourceDistDir)) {
    const targetDistDir1 = path.join(resourcesDir, 'dist');
    const targetDistDir2 = path.join(unpackedDir, 'dist');
    const targetDistDir3 = path.join(appOutDir, 'dist');
    console.log(`[afterPack] Copying dist to ${targetDistDir1}, ${targetDistDir2}, and ${targetDistDir3}...`);
    copyFolderRecursiveSync(sourceDistDir, targetDistDir1);
    copyFolderRecursiveSync(sourceDistDir, targetDistDir2);
    copyFolderRecursiveSync(sourceDistDir, targetDistDir3);
  }

  // 7. Ensure Prisma CLI runtime dependencies are unpacked
  const prismaDeps = ['effect', 'c12', 'deepmerge-ts', 'empathic', 'dotenv', 'chokidar'];
  for (const dep of prismaDeps) {
    const srcDep = path.join(projectDir, 'node_modules', dep);
    if (fs.existsSync(srcDep)) {
      copyFolderRecursiveSync(srcDep, path.join(unpackedDir, 'node_modules', dep));
      copyFolderRecursiveSync(srcDep, path.join(resourcesDir, 'node_modules', dep));
    }
  }

  console.log('[afterPack] Packaging sync completed successfully.');
};
