const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// EasyHub release signing";
const VARIABLES = [
  "EASYHUB_UPLOAD_STORE_FILE",
  "EASYHUB_UPLOAD_STORE_PASSWORD",
  "EASYHUB_UPLOAD_KEY_ALIAS",
  "EASYHUB_UPLOAD_KEY_PASSWORD",
];

const helper = `${MARKER}
def easyhubSigningValue = { String name -> System.getenv(name) ?: project.findProperty(name) }
def easyhubSigningVariables = [${VARIABLES.map((name) => `'${name}'`).join(", ")}]
def easyhubMissingSigning = easyhubSigningVariables.findAll { !easyhubSigningValue(it) }
gradle.taskGraph.whenReady { graph ->
  def building = graph.allTasks.any { it.project == project && it.name ==~ /(?i).*(assemble|bundle|package|validateSigning).*release.*/ }
  if (building && !easyhubMissingSigning.isEmpty()) {
    throw new GradleException("发布构建需要自己的发布签名，缺少：\${easyhubMissingSigning.join(', ')}。请设置同名环境变量，或写进 ~/.gradle/gradle.properties；步骤见 docs/android-parity.md 的“从源码构建”。不会退回调试签名。")
  }
  if (building && !new File(easyhubSigningValue('EASYHUB_UPLOAD_STORE_FILE') as String).isFile()) {
    throw new GradleException("找不到发布密钥文件：\${easyhubSigningValue('EASYHUB_UPLOAD_STORE_FILE')}。请检查 EASYHUB_UPLOAD_STORE_FILE。")
  }
}
`;

const releaseConfig = `        release {
            storeFile easyhubSigningValue('EASYHUB_UPLOAD_STORE_FILE') ? file(easyhubSigningValue('EASYHUB_UPLOAD_STORE_FILE')) : null
            storePassword easyhubSigningValue('EASYHUB_UPLOAD_STORE_PASSWORD')
            keyAlias easyhubSigningValue('EASYHUB_UPLOAD_KEY_ALIAS')
            keyPassword easyhubSigningValue('EASYHUB_UPLOAD_KEY_PASSWORD')
        }
`;

/** Rewrites an Expo-generated app/build.gradle so release builds use the maintainer's own keystore and never the public debug one. */
function applyReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;
  const android = contents.search(/^android\s*\{/mu);
  const signing = contents.search(/^\s*signingConfigs\s*\{/mu);
  const buildTypes = contents.search(/^\s*buildTypes\s*\{/mu);
  const releasePattern =
    /(^\s*release\s*\{[ \t]*\n)((?:[ \t]*\/\/[^\n]*\n)*)([ \t]*)signingConfig\s+signingConfigs\.debug/mu;
  if (android < 0 || signing < android || buildTypes < signing || !releasePattern.test(contents.slice(buildTypes))) {
    throw new Error("with-release-signing: app/build.gradle 的结构和预期不同，无法配置发布签名。");
  }
  // Switch the release build type first, while the only signing configs left are the template's.
  let result =
    contents.slice(0, buildTypes) +
    contents.slice(buildTypes).replace(releasePattern, "$1$3signingConfig signingConfigs.release");
  const open = result.indexOf("{", result.search(/^\s*signingConfigs\s*\{/mu));
  let depth = 0,
    close = -1;
  for (let index = open; index < result.length; index += 1) {
    if (result[index] === "{") depth += 1;
    else if (result[index] === "}" && --depth === 0) {
      close = index;
      break;
    }
  }
  const lineStart = result.lastIndexOf("\n", close) + 1;
  result = result.slice(0, lineStart) + releaseConfig + result.slice(lineStart);
  const first = result.search(/^android\s*\{/mu);
  return result.slice(0, first) + helper + "\n" + result.slice(first);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (result) => {
    result.modResults.contents = applyReleaseSigning(result.modResults.contents);
    return result;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
module.exports.REQUIRED_VARIABLES = VARIABLES;
