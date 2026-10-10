package app.easyhub.analysis

import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipFile

/** Fixed repository assets, installed explicitly, shared by local and PR review. */
internal object FrameworkManager {
  data class Component(val id: String, val version: String, val abi: String, val minSdk: Int,
    val url: String, val sha256: String, val bytes: Long, val manifestSha256: String) {
    val supported: Boolean get() = Build.VERSION.SDK_INT >= minSdk &&
      (abi == "any" || (abi == "arm64-v8a" && Process.is64Bit() && Build.SUPPORTED_ABIS.contains(abi)))
    val folder: String get() = "$id-$version-v1"
  }
  @Volatile private var catalog: List<Component>? = null
  private fun components(context: Context): List<Component> = catalog ?: synchronized(this) {
    catalog ?: context.assets.open("analysis-frameworks/catalog.json").use { stream ->
      val list = JSONObject(stream.bufferedReader().readText()).getJSONArray("components")
      (0 until list.length()).map { index ->
        val item = list.getJSONObject(index)
        Component(item.getString("id"), item.getString("version"), item.getString("abi"), item.getInt("minSdk"),
          item.getString("url"), item.getString("sha256"), item.getLong("downloadBytes"), item.getString("manifestSha256"))
      }.also { items ->
        require(items.map { it.id }.toSet() == setOf("java", "native"))
        require(items.all { it.bytes in 1..MAX_DOWNLOAD && it.sha256.matches(Regex("[a-f0-9]{64}")) && it.manifestSha256.matches(Regex("[a-f0-9]{64}")) })
        catalog = items
      }
    }
  }
  private fun component(context: Context, id: String): Component = components(context).firstOrNull { it.id == id }
    ?: throw AnalysisException("input", "未知的分析组件。", "Unknown analysis component.")
  private fun root(context: Context) = File(context.filesDir, "easyhub-analysis-frameworks")
  private fun directory(context: Context, item: Component) = File(root(context), item.folder)
  private fun installed(context: Context, item: Component): Boolean {
    val path = directory(context, item)
    val marker = File(path, ".installed")
    if (!marker.isFile || marker.length() >= 200 || runCatching { marker.readText() != item.sha256 }.getOrDefault(true)) return false
    return runCatching {
      readManifest(File(path, "framework.json"), item).all { entry ->
        File(path, entry.path).let { it.isFile && it.length() == entry.size }
      }
    }.getOrDefault(false)
  }
  fun status(context: Context): Map<String, Any?> {
    val items = components(context)
    val states = items.associateWith { installed(context, it) }
    val rows = items.map { item -> mapOf("id" to item.id, "version" to item.version, "supported" to item.supported,
      "installed" to states.getValue(item), "downloadBytes" to item.bytes,
      "installedBytes" to if (states.getValue(item)) runCatching { readManifest(File(directory(context, item), "framework.json"), item).sumOf { it.size } }.getOrDefault(0L) else 0L) }
    return mapOf("javaAvailable" to items.any { it.id == "java" && it.supported && states.getValue(it) },
      "nativeAvailable" to items.any { it.id == "native" && it.supported && states.getValue(it) },
      "javaVersion" to items.first { it.id == "java" }.version, "nativeVersion" to items.first { it.id == "native" }.version,
      "androidApi" to Build.VERSION.SDK_INT, "maxBytes" to BinaryInput.MAX_BYTES, "maxJavaBytes" to BinaryInput.MAX_JAVA_BYTES,
      "components" to rows)
  }

  fun javaRuntime(context: Context, job: AnalysisJob): File = File(verifiedDirectory(context, "java", job), "runtime/jadx-runtime.apk")
  fun nativeDirectory(context: Context, job: AnalysisJob): File = verifiedDirectory(context, "native", job)
  private fun verifiedDirectory(context: Context, id: String, job: AnalysisJob): File {
    val item = component(context, id)
    if (!item.supported) throw AnalysisException("unsupported", "当前安卓版本或处理器不支持这个分析组件。", "This Android version or processor does not support this component.")
    if (!installed(context, item)) throw AnalysisException("framework_missing", "请先在设置的程序文件审查中下载所需分析组件。", "Download the required analysis component in Settings > Program file review first.")
    val path = directory(context, item)
    val entries = readManifest(File(path, "framework.json"), item)
    for (entry in entries) {
      job.check()
      val file = File(path, entry.path)
      if (!file.isFile || file.length() != entry.size || FrameworkArchive.hash(file, job::check) != entry.sha256) {
        throw AnalysisException("framework_damaged", "分析组件校验失败，请移除后重新下载。", "Analysis component verification failed. Remove it and download it again.")
      }
    }
    return path
  }

  fun install(context: Context, id: String, job: AnalysisJob, progress: (String, Long, Long, String, String) -> Unit) {
    val item = component(context, id)
    if (!item.supported) throw AnalysisException("unsupported", "当前安卓版本或处理器不支持这个分析组件。", "This Android version or processor does not support this component.")
    if (installed(context, item)) { verifiedDirectory(context, id, job); return }
    val base = root(context).apply { if (!isDirectory && !mkdirs()) storageError() }
    val staging = File(base, ".install-${job.id}")
    val archive = File(context.cacheDir, "easyhub-framework-${job.id}.zip")
    val en = job.language == "en"
    try {
      if (!staging.mkdirs()) storageError()
      download(item, archive, job) { done -> progress("downloading", done, item.bytes, if (en) "Downloading analysis component" else "下载分析组件", "bytes") }
      job.check()
      progress("verifying", 0, 1, if (en) "Verifying component" else "校验分析组件", "steps")
      if (archive.length() != item.bytes || FrameworkArchive.hash(archive, job::check) != item.sha256) invalidError()
      ZipFile(archive).use { zip ->
        val matches = zip.entries().asSequence().filter { it.name == "framework.json" }.toList()
        if (matches.size != 1 || matches[0].size !in 1..MANIFEST_LIMIT) invalidError()
        val output = File(staging, "framework.json")
        zip.getInputStream(matches[0]).use { input -> output.outputStream().use { stream ->
          val content = input.readBytes()
          if (content.size > MANIFEST_LIMIT) invalidError()
          stream.write(content)
        } }
        if (!output.setReadOnly()) storageError()
      }
      val entries = readManifest(File(staging, "framework.json"), item)
      FrameworkArchive.extract(archive, staging, entries, job::check) { done, total ->
        progress("installing", done, total, if (en) "Installing analysis component" else "安装分析组件", "bytes")
      }
      job.check()
      val marker = File(staging, ".installed")
      marker.writeText(item.sha256)
      if (!marker.setReadOnly()) storageError()
      val destination = directory(context, item)
      // Keep a prior directory intact until the fully verified replacement exists.
      val old = File(base, ".old-${job.id}")
      if (destination.exists() && !destination.renameTo(old)) storageError()
      if (!staging.renameTo(destination)) { if (old.exists()) old.renameTo(destination); storageError() }
      old.deleteRecursively()
      // Remove obsolete asset-extracted runtime from the former bundled build.
      File(context.filesDir, "easyhub-native-runtime-6.2.2").deleteRecursively()
    } catch (error: IllegalArgumentException) {
      job.check()
      invalidError()
    } finally {
      job.inputStream = null
      archive.delete()
      staging.deleteRecursively()
    }
  }

  fun remove(context: Context, id: String) {
    val path = directory(context, component(context, id))
    if (path.exists() && !path.deleteRecursively()) storageError()
    if (id == "java") File(context.codeCacheDir, "easyhub-jadx-${component(context, id).version}").deleteRecursively()
  }

  /** Runs on the shared executor before any new operation after process start. */
  fun cleanup(context: Context) {
    val base = root(context)
    val items = components(context)
    for (old in base.listFiles().orEmpty().filter { it.isDirectory && it.name.matches(Regex("\\.old-[a-fA-F0-9-]{36}")) }) {
      val item = items.firstOrNull { candidate -> runCatching {
        File(old, ".installed").readText() == candidate.sha256 && readManifest(File(old, "framework.json"), candidate).isNotEmpty()
      }.getOrDefault(false) }
      if (item != null && !directory(context, item).exists()) old.renameTo(directory(context, item))
      if (old.exists()) old.deleteRecursively()
    }
    base.listFiles().orEmpty().filter { it.name.matches(Regex("\\.install-[a-fA-F0-9-]{36}")) }.forEach { it.deleteRecursively() }
    context.cacheDir.listFiles().orEmpty().filter { it.isFile && it.name.matches(Regex("easyhub-framework-[a-fA-F0-9-]{36}\\.zip")) }.forEach { it.delete() }
  }

  private fun readManifest(file: File, item: Component): List<FrameworkArchive.Entry> {
    if (!file.isFile || file.length() !in 1..MANIFEST_LIMIT || FrameworkArchive.hash(file) {} != item.manifestSha256) invalidError()
    val data = JSONObject(file.readText())
    if (data.getInt("schema") != 1 || data.getString("id") != item.id || data.getString("version") != item.version ||
      data.getString("abi") != item.abi || data.getInt("minSdk") != item.minSdk) invalidError()
    val list = data.getJSONArray("files")
    if (list.length() !in 1..2000) invalidError()
    val entries = (0 until list.length()).map { index -> val entry = list.getJSONObject(index)
      FrameworkArchive.Entry(entry.getString("path"), entry.getLong("size"), entry.getString("sha256")) }
    if (entries.any { !FrameworkArchive.safePath(it.path) || it.size !in 0..160L*1024*1024 || !it.sha256.matches(Regex("[a-f0-9]{64}")) } ||
      entries.map { it.path }.toSet().size != entries.size || entries.sumOf { it.size } > 160L*1024*1024) invalidError()
    return entries
  }
  private fun download(item: Component, target: File, job: AnalysisJob, progress: (Long) -> Unit) {
    var url = URL(item.url)
    for (redirect in 0..5) {
      job.check()
      if (url.protocol != "https" || url.host !in ALLOWED_HOSTS || url.userInfo != null || url.ref != null || url.port !in listOf(-1, 443)) invalidError()
      val connection = url.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 20_000
      connection.readTimeout = 20_000
      connection.setRequestProperty("Accept", "application/octet-stream")
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("User-Agent", "EasyHub-Android/analysis-frameworks-v1")
      job.connection = connection
      try {
        job.check()
        val code = connection.responseCode
        if (code in listOf(301, 302, 303, 307, 308)) {
          val location = connection.getHeaderField("Location") ?: invalidError()
          url = URL(url, location)
          continue
        }
        if (code != 200) throw AnalysisException("download", "组件下载失败（HTTP $code），请稍后重试。", "Component download failed (HTTP $code). Try again later.")
        if (connection.contentLengthLong >= 0 && connection.contentLengthLong != item.bytes) invalidError()
        connection.inputStream.use { input ->
          job.inputStream = input
          try { target.outputStream().use { output ->
            var total = 0L
            val buffer = ByteArray(64*1024)
            while (true) {
              job.check()
              val count = input.read(buffer)
              if (count < 0) break
              if (count == 0) continue
              total += count
              if (total > item.bytes || total > MAX_DOWNLOAD) invalidError()
              output.write(buffer, 0, count)
              progress(total)
            }
            if (total != item.bytes) invalidError()
          } } finally { job.inputStream = null }
        }
        return
      } finally { job.connection = null; connection.disconnect() }
    }
    throw AnalysisException("download", "组件下载跳转过多，请稍后重试。", "Too many component download redirects. Try again later.")
  }
  private fun invalidError(): Nothing = throw AnalysisException("framework_invalid", "分析组件校验失败，已清理下载，请重试。", "Analysis component verification failed. The download was cleaned up. Try again.")
  private fun storageError(): Nothing = throw AnalysisException("storage", "无法安装分析组件，请检查可用空间。", "Could not install the component. Check available storage.")
  private const val MAX_DOWNLOAD = 80L * 1024 * 1024
  private const val MANIFEST_LIMIT = 384L * 1024
  private val ALLOWED_HOSTS = setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")
}
