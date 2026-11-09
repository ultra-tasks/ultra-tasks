const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies'];

// Direct tarballs are intentional only when the real workspace manifest and
// lockfile both declare the same package and URL. This is not a host allowlist.
const declaredTarballs = (lock, manifests) => {
  const declared = new Map();
  for (const [location, lockedPackage] of Object.entries(lock.packages || {})) {
    if (location.split('/').includes('node_modules')) continue;
    const manifest = manifests[location];
    if (!manifest) continue;
    for (const section of dependencySections) {
      for (const [name, spec] of Object.entries(manifest[section] || {})) {
        if (
          typeof spec === 'string' &&
          spec.startsWith('https://') &&
          lockedPackage[section]?.[name] === spec
        ) {
          if (!declared.has(name)) declared.set(name, new Set());
          declared.get(name).add(spec);
        }
      }
    }
  }
  return declared;
};

const packageName = (location) => {
  const parts = location.split('/');
  const index = parts.lastIndexOf('node_modules');
  if (index < 0 || !parts[index + 1]) return null;
  return parts[index + 1].startsWith('@')
    ? `${parts[index + 1]}/${parts[index + 2] || ''}`
    : parts[index + 1];
};

const hasSha512Integrity = (integrity) => {
  if (typeof integrity !== 'string') return false;
  return integrity.split(/\s+/).some((entry) => {
    const hash = entry.match(/^sha512-([A-Za-z0-9+/]{86}==)$/)?.[1];
    return !!hash && Buffer.from(hash, 'base64').length === 64;
  });
};

const findRegistryViolations = (lock, manifests) => {
  if (
    !lock ||
    !lock.packages ||
    typeof lock.packages !== 'object' ||
    Array.isArray(lock.packages) ||
    !lock.packages['']
  ) {
    return [
      'Lockfile is missing package metadata; regenerate it with the current npm version.',
    ];
  }
  const direct = declaredTarballs(lock, manifests);
  const violations = [];
  const checkPackage = (location, name, pkg) => {
    if (!pkg || typeof pkg !== 'object') return;
    if (typeof pkg.resolved !== 'string' || !/^https?:\/\//i.test(pkg.resolved)) {
      return;
    }
    let url;
    try {
      url = new URL(pkg.resolved);
    } catch {
      violations.push(`${location}: invalid resolved URL`);
      return;
    }
    const isSafeHttps =
      url.protocol === 'https:' && !url.username && !url.password && !url.port;
    if (isSafeHttps && url.hostname === 'registry.npmjs.org') return;

    const isDeclaredTarball =
      isSafeHttps &&
      !url.hash &&
      !url.search &&
      url.pathname.endsWith('.tgz') &&
      name &&
      direct.get(name)?.has(pkg.resolved) &&
      hasSha512Integrity(pkg.integrity);
    if (!isDeclaredTarball) {
      violations.push(`${location}: ${pkg.resolved}`);
    }
  };
  for (const [location, pkg] of Object.entries(lock.packages)) {
    checkPackage(location, packageName(location), pkg);
  }

  // npm v2 lockfiles can also carry a legacy dependencies tree. Inspect it as
  // well so a second resolved URL cannot evade the check above.
  const checkLegacyDependencies = (dependencies, location) => {
    if (!dependencies || typeof dependencies !== 'object') return;
    for (const [name, pkg] of Object.entries(dependencies)) {
      const child = `${location}/${name}`;
      checkPackage(child, name, pkg);
      if (pkg && typeof pkg === 'object') {
        checkLegacyDependencies(pkg.dependencies, `${child}/dependencies`);
      }
    }
  };
  checkLegacyDependencies(lock.dependencies, 'dependencies');
  return violations;
};

const loadManifests = (lock, lockPath) => {
  const manifests = {};
  const lockDir = path.dirname(path.resolve(repoRoot, lockPath));
  for (const location of Object.keys(lock.packages || {})) {
    if (location.split('/').includes('node_modules')) continue;
    const manifestPath = path.resolve(lockDir, location, 'package.json');
    const relative = path.relative(repoRoot, manifestPath);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Workspace manifest is outside the repository: ${location}`);
    }
    if (fs.existsSync(manifestPath)) {
      manifests[location] = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  }
  return manifests;
};

const main = () => {
  const lockPaths = ['package-lock.json', 'packages/plugin-dev/package-lock.json'];
  let failed = false;
  for (const lockPath of lockPaths) {
    const lock = JSON.parse(fs.readFileSync(path.resolve(repoRoot, lockPath), 'utf8'));
    const violations = findRegistryViolations(lock, loadManifests(lock, lockPath));
    if (violations.length) {
      failed = true;
      console.error(`::error::${lockPath} contains unapproved dependency sources:`);
      for (const violation of violations) console.error(`  ${violation}`);
    } else {
      console.log(`${lockPath}: registry sources and declared tarballs verified`);
    }
  }
  if (failed) process.exitCode = 1;
};

if (require.main === module) main();

module.exports = { declaredTarballs, findRegistryViolations, hasSha512Integrity };
