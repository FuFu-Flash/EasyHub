import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyReleaseSigning, REQUIRED_VARIABLES } = require('../plugins/with-release-signing.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const template = `apply plugin: "com.android.application"

android {
    namespace "app.easyhub.mobile"
    defaultConfig {
        versionCode 4
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

const releaseBlock = (gradle) => gradle.slice(gradle.indexOf('buildTypes')).match(/release\s*\{[^}]*\}/u)[0];
const debugBlock = (gradle) => gradle.slice(gradle.indexOf('buildTypes')).match(/debug\s*\{[^}]*\}/u)[0];

test('release builds use the release signing config and never the public debug key', () => {
  const output = applyReleaseSigning(template);
  assert.match(releaseBlock(output), /signingConfig signingConfigs\.release/u);
  assert.doesNotMatch(releaseBlock(output), /signingConfigs\.debug/u);
  assert.doesNotMatch(output, /Caution! In production/u);
  assert.match(debugBlock(output), /signingConfig signingConfigs\.debug/u);
  assert.match(output, /debug \{\s+storeFile file\('debug\.keystore'\)/u);
});

test('the release signing config reads all four variables and none of them has a default', () => {
  const output = applyReleaseSigning(template);
  const config = output.match(/signingConfigs \{[\s\S]*?\n    \}\n    buildTypes/u)[0];
  assert.match(config, /release \{[\s\S]*storeFile easyhubSigningValue\('EASYHUB_UPLOAD_STORE_FILE'\)/u);
  assert.match(config, /storePassword easyhubSigningValue\('EASYHUB_UPLOAD_STORE_PASSWORD'\)/u);
  assert.match(config, /keyAlias easyhubSigningValue\('EASYHUB_UPLOAD_KEY_ALIAS'\)/u);
  assert.match(config, /keyPassword easyhubSigningValue\('EASYHUB_UPLOAD_KEY_PASSWORD'\)/u);
  assert.doesNotMatch(config.slice(config.indexOf('release {')), /\?:\s*['"]/u);
  assert.deepEqual(REQUIRED_VARIABLES, ['EASYHUB_UPLOAD_STORE_FILE', 'EASYHUB_UPLOAD_STORE_PASSWORD', 'EASYHUB_UPLOAD_KEY_ALIAS', 'EASYHUB_UPLOAD_KEY_PASSWORD']);
});

test('a release build without the variables fails in Chinese instead of falling back, and only release tasks are checked', () => {
  const output = applyReleaseSigning(template);
  assert.match(output, /gradle\.taskGraph\.whenReady/u);
  assert.match(output, /throw new GradleException\("发布构建需要自己的发布签名，缺少/u);
  assert.match(output, /不会退回调试签名/u);
  assert.match(output, /\(assemble\|bundle\|package\|validateSigning\)\.\*release/u);
  assert.match(output, /System\.getenv\(name\) \?: project\.findProperty\(name\)/u);
});

test('applying the plugin twice changes nothing, and an unexpected template is refused', () => {
  const once = applyReleaseSigning(template);
  assert.equal(applyReleaseSigning(once), once);
  assert.throws(() => applyReleaseSigning('android { }'), /结构和预期不同/u);
});

test('the real Expo template layout keeps working when the analysis block is appended', () => {
  const analysis = `${template}\n// EasyHub analysis runtime\nandroid {\n  compileOptions { coreLibraryDesugaringEnabled true }\n}\n`;
  const output = applyReleaseSigning(analysis);
  assert.match(releaseBlock(output), /signingConfigs\.release/u);
  assert.equal(output.match(/signingConfig signingConfigs\.debug/gu).length, 1);
});

test('the plugin is registered, the keystore files are ignored and the app version is 1.2.0 with versionCode 5', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(app.plugins.includes('./plugins/with-release-signing.cjs'));
  assert.equal(app.version, '1.2.0');
  assert.equal(app.android.versionCode, 5);
  assert.equal(pkg.version, app.version);
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n');
  for (const pattern of ['*.jks', '*.keystore', 'keystore.properties']) assert.ok(ignore.includes(pattern), pattern);
});
