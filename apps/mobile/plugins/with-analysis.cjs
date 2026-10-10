const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withAnalysis(config) {
  return withAppBuildGradle(config, (result) => {
    const marker = '// EasyHub analysis runtime';
    if (!result.modResults.contents.includes(marker)) {
      result.modResults.contents += `\n${marker}\nandroid {\n  compileOptions { coreLibraryDesugaringEnabled true }\n  packagingOptions { jniLibs.pickFirsts += ['**/libc++_shared.so'] }\n}\ndependencies {\n  coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'\n}\n`;
    }
    return result;
  });
};
