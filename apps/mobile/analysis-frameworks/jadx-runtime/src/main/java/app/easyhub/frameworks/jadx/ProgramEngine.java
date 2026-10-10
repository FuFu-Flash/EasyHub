package app.easyhub.frameworks.jadx;

import jadx.api.JadxArgs;
import jadx.api.JadxDecompiler;
import jadx.api.JavaClass;
import jadx.api.impl.NoOpCodeCache;
import jadx.api.plugins.JadxPlugin;
import jadx.api.plugins.loader.JadxPluginLoader;
import jadx.core.plugins.files.IJadxFilesGetter;
import jadx.plugins.input.dex.DexInputPlugin;
import jadx.plugins.input.java.JavaInputPlugin;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Stable Java-only boundary loaded by the host after archive verification. */
public final class ProgramEngine {
  public static final String VERSION = "1.5.6";
  private static final int MAX_CLASSES = 20_000;
  private static final int SAMPLE_CLASSES = 12;
  private static final int MAX_CODE = 4000;
  private static final Pattern IMPORT = Pattern.compile("(?m)^import\\s+([^;]+);");
  private static final Pattern STRING = Pattern.compile("\"((?:[^\"\\\\]|\\\\.){3,200})\"");

  private ProgramEngine() {}

  /** The host validates bytecode/container limits before invoking this method. */
  public static Map<String, Object> analyze(File input, String format, String language,
      File directory, Runnable check, Consumer<Map<String, Object>> progress) {
    final boolean en = "en".equals(language);
    check.run();
    JadxArgs args = new JadxArgs();
    args.setInputFiles(Arrays.asList(input));
    args.setOutDir(new File(directory, "output"));
    args.setThreadsCount(1);
    args.setSkipResources(true);
    args.setSkipFilesSave(true);
    args.setCodeCache(new NoOpCodeCache());
    args.setFilesGetter(new IJadxFilesGetter() {
      private Path owned(String name) {
        File path = new File(directory, name);
        if (!path.isDirectory() && !path.mkdirs()) throw new IllegalStateException(en
          ? "The analysis workspace could not be prepared." : "无法准备分析工作目录。");
        return path.toPath();
      }
      @Override public Path getTempDir() { return owned("tmp"); }
      @Override public Path getCacheDir() { return owned("cache"); }
      @Override public Path getConfigDir() { return owned("config"); }
    });
    args.setPluginLoader(new JadxPluginLoader() {
      @Override public List<JadxPlugin> load() { return Arrays.asList(new DexInputPlugin(), new JavaInputPlugin()); }
      @Override public void close() {}
    });
    report(progress, 0, SAMPLE_CLASSES, en ? "Reading bytecode" : "读取字节码");
    try (JadxDecompiler decompiler = new JadxDecompiler(args)) {
      decompiler.load();
      check.run();
      List<JavaClass> classes = decompiler.getClasses();
      if (classes.isEmpty()) throw new IllegalArgumentException(en
        ? "The file has no decompilable DEX or Java classes." : "文件中没有可反编译的 DEX 或 Java 类。");
      if (classes.size() > MAX_CLASSES) throw new IllegalArgumentException(en
        ? "The file contains too many classes. Choose a smaller DEX or JAR." : "文件包含过多类，请选择较小的 DEX 或 JAR。");
      List<JavaClass> candidates = new ArrayList<>(classes);
      candidates.sort(Comparator.comparing((JavaClass cls) ->
        !cls.getFullName().endsWith("MainActivity") && !cls.getFullName().endsWith("Main"))
        .thenComparing(JavaClass::getFullName));
      candidates = candidates.subList(0, Math.min(SAMPLE_CLASSES, candidates.size()));
      List<Map<String, String>> functions = new ArrayList<>();
      Set<String> imports = new LinkedHashSet<>();
      Set<String> strings = new LinkedHashSet<>();
      int failed = 0;
      int longIdentifiers = 0;
      boolean shortened = false;
      for (int index = 0; index < candidates.size(); index++) {
        check.run();
        JavaClass cls = candidates.get(index);
        String identity = cls.getFullName();
        report(progress, index, candidates.size(), take(identity, 180));
        if (identity.length() > 512) { longIdentifiers++; continue; }
        try {
          String code = cls.getCode();
          check.run();
          if (code == null || code.trim().isEmpty()) { failed++; continue; }
          shortened |= code.length() > MAX_CODE;
          Map<String, String> function = new LinkedHashMap<>();
          function.put("name", take(identity, 240));
          function.put("address", identity);
          function.put("code", take(code, MAX_CODE));
          functions.add(function);
          Matcher imported = IMPORT.matcher(code);
          while (imported.find() && imports.size() < 100) imports.add(take(imported.group(1), 240));
          Matcher literal = STRING.matcher(code);
          while (literal.find() && strings.size() < 80) strings.add(literal.group(1));
        } catch (Exception error) {
          // Cancellation from the host must never be swallowed as one failed class.
          check.run();
          failed++;
        }
      }
      if (functions.isEmpty()) throw new IllegalArgumentException(en
        ? "These classes did not produce usable decompiled code." : "这些类无法生成可用的反编译代码。");
      List<String> limitations = new ArrayList<>();
      limitations.add(en ? "Java code is reconstructed from bytecode, not the original source. The file was not executed."
        : "Java 代码由字节码还原，并非原始源码；没有执行这个文件。");
      if (classes.size() > functions.size()) limitations.add(en
        ? "Sampled " + functions.size() + " of " + classes.size() + " classes; this does not cover the entire program."
        : "共 " + classes.size() + " 个类，本次抽样 " + functions.size() + " 个，未覆盖整个程序。");
      if (shortened) limitations.add(en ? "Long class output was limited to " + MAX_CODE + " characters per class."
        : "较长的类代码仅显示前 " + MAX_CODE + " 个字符。");
      if (longIdentifiers > 0) limitations.add(en
        ? longIdentifiers + " class identifiers exceeded 512 characters and were omitted without truncating their identity."
        : longIdentifiers + " 个类标识符超过 512 字符，已略过且没有截断其标识。");
      if (failed > 0 || decompiler.getErrorsCount() > 0) limitations.add(en
        ? "Some bytecode could not be fully decompiled." : "部分字节码未能完整反编译。");
      if ("apk".equals(format)) limitations.add(en
        ? "APK analysis covers Java/Dalvik bytecode. Native libraries and resources are not included; select a .so file separately."
        : "APK 分析覆盖 Java/Dalvik 字节码，不包含原生库与资源；原生库请单独选择 .so 文件。");
      check.run();
      report(progress, candidates.size(), candidates.size(), en ? "Decompilation complete" : "反编译完成");
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("architecture", "dex".equals(format) || "apk".equals(format) ? "Dalvik" : "JVM");
      result.put("functionCount", classes.size());
      result.put("functions", functions);
      result.put("imports", new ArrayList<>(imports));
      result.put("strings", new ArrayList<>(strings));
      result.put("limitations", limitations);
      return result;
    }
  }

  private static String take(String text, int length) { return text.substring(0, Math.min(length, text.length())); }
  private static void report(Consumer<Map<String, Object>> progress, int done, int total, String message) {
    Map<String, Object> value = new LinkedHashMap<>();
    value.put("done", done);
    value.put("total", total);
    value.put("message", message);
    progress.accept(value);
  }
}
