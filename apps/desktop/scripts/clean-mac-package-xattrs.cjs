const { execFileSync } = require('node:child_process');
const { existsSync, lstatSync, realpathSync } = require('node:fs');
const { homedir } = require('node:os');
const { isAbsolute, join, resolve, sep } = require('node:path');

// afterPack runs after the application copy and before electron-builder signs it.
// Desktop/File Provider metadata can survive that copy and invalidate codesign.
module.exports = async function cleanMacPackageAttributes(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!isAbsolute(context.appOutDir)) throw new Error('Expected an absolute generated app output directory.');
  const output = realpathSync(context.appOutDir);
  const application = join(output, 'EasyHub.app');
  if (lstatSync(application).isSymbolicLink()) throw new Error('Generated application cannot be a symbolic link.');
  const project = realpathSync(context.packager.projectDir);
  const forbidden = [join(project, 'node_modules'), '/Applications', join(homedir(), 'Applications')]
    .flatMap(path => existsSync(path) ? [resolve(path), realpathSync(path)] : [resolve(path)]);
  if (forbidden.some(path => output === path || output.startsWith(path + sep))) throw new Error('Refusing to clean source dependencies or an installed application.');
  const identifier = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(application, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  if (identifier !== 'app.easyhub.mac') throw new Error('Expected the freshly packaged EasyHub macOS app.');
  execFileSync('/usr/bin/xattr', ['-cr', application], { stdio: 'inherit' });
};
