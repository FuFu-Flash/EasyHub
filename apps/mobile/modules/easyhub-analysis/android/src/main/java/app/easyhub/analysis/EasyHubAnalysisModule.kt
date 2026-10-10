package app.easyhub.analysis

import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class EasyHubAnalysisModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private val timers = Executors.newSingleThreadScheduledExecutor()
  private val lock = Any()
  private var active: AnalysisJob? = null
  private val cancelledBeforeStart = linkedMapOf<String, Long>()

  override fun definition() = ModuleDefinition {
    Name("EasyHubAnalysis")
    Events("onProgress", "onFrameworkProgress")

    Function("getStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("App context unavailable")
      FrameworkManager.status(context)
    }

    AsyncFunction("installFramework") { request: Map<String, Any?>, promise: Promise ->
      frameworkOperation(request, promise, true)
    }

    AsyncFunction("removeFramework") { request: Map<String, Any?>, promise: Promise ->
      frameworkOperation(request, promise, false)
    }

    AsyncFunction("getFileInfo") { value: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("App context unavailable")
      val info = fileInfo(value, context)
      mapOf("name" to (info.name ?: "program.bin"), "size" to info.size)
    }

    Function("cancel") { id: String ->
      synchronized(lock) {
        val job = active?.takeIf { it.id == id }
        if (job != null) job.cancel() else if (UUID_PATTERN.matches(id)) {
          pruneCancelled()
          cancelledBeforeStart[id] = System.nanoTime()
          while (cancelledBeforeStart.size > 64) cancelledBeforeStart.remove(cancelledBeforeStart.keys.first())
        }
      }
    }

    AsyncFunction("analyze") { request: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("unavailable", "App context unavailable", null)
      } else {
        val id = request["requestId"] as? String
        val language = if (request["language"] == "en") "en" else "zh"
        val job = if (id != null && UUID_PATTERN.matches(id)) AnalysisJob(id, language) else null
        val started = synchronized(lock) {
          pruneCancelled()
          if (job != null && cancelledBeforeStart.remove(job.id) != null) { job.cancelled.set(true); false }
          else if (job != null && active == null) { active = job; true } else false
        }
        if (!started || job == null) {
          if (job?.cancelled?.get() == true) promise.reject("cancelled", if (language == "en") "Analysis cancelled." else "分析已取消。", null)
          else promise.reject("busy", if (language == "en") "Another analysis is still finishing. Try again in a moment." else "另一个分析仍在结束，请稍后重试。", null)
        } else {
          executor.execute {
            job.thread = Thread.currentThread()
            val root = File(context.cacheDir, "easyhub-analysis")
            val directory = File(root, job.id)
            var result: Map<String, Any?>? = null
            var failureCode: String? = null
            var failureMessage: String? = null
            var timeout: ScheduledFuture<*>? = null
            try {
              timeout = timers.schedule({ job.timeout() }, 180, TimeUnit.SECONDS)
              val uri = request["uri"] as? String ?: throw AnalysisException("input", "请选择一个文件。", "Choose a file.")
              val info = fileInfo(uri, context)
              // Cache download names are opaque UUIDs. Only a document provider
              // supplies a display name; preserve the verified remote name.
              val fileName = if (Uri.parse(uri).scheme == "content") info.name ?: cleanName(request["name"] as? String) ?: "program.bin"
                else cleanName(request["name"] as? String) ?: info.name ?: "program.bin"
              if (info.size != null && info.size > MAX_BYTES) throw AnalysisException("limit", "文件超过 128 MB，请选择较小的文件。", "The file exceeds 128 MB. Choose a smaller file.")
              if (!directory.mkdirs()) throw AnalysisException("storage", "没有足够空间准备文件。", "Could not prepare the file. Check available storage.")
              val extension = fileName.substringAfterLast('.', "bin").lowercase().takeIf { it.matches(Regex("[a-z0-9]{1,8}")) } ?: "bin"
              val input = File(directory, "input.$extension")
              val sha256 = MessageDigest.getInstance("SHA-256")
              var size = 0L
              val expectedSize = (request["expectedSize"] as? Number)?.toLong()
              openInput(uri, context.cacheDir, context.filesDir).use { stream ->
                job.inputStream = stream
                try { input.outputStream().use { output ->
                  val buffer = ByteArray(64 * 1024)
                  while (true) {
                    job.check()
                    val count = stream.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    size += count
                    if (size > MAX_BYTES) throw AnalysisException("limit", "文件超过 128 MB，请选择较小的文件。", "The file exceeds 128 MB. Choose a smaller file.")
                    output.write(buffer, 0, count)
                    sha256.update(buffer, 0, count)
                    emit(job, "preparing", size, expectedSize ?: 0, if (language == "en") "Preparing file" else "准备文件", "bytes")
                  }
                } } finally { job.inputStream = null }
              }
              job.check()
              if (size == 0L || (expectedSize != null && expectedSize != size)) throw AnalysisException("changed", "文件大小与预期不符，请刷新后重试。", "The file size differs from the expected version. Refresh and try again.")
              val digest = sha256.digest().hex()
              val expectedSha256 = request["expectedSha256"] as? String
              if (expectedSha256 != null && !digest.equals(expectedSha256, true)) throw AnalysisException("changed", "文件校验失败，无法分析这个版本。", "File verification failed. This version cannot be analyzed.")
              val expectedBlobSha = request["expectedBlobSha"] as? String
              if (expectedBlobSha != null && !gitBlobSha(input, size, job).equals(expectedBlobSha, true)) throw AnalysisException("changed", "修改文件与已检查的 GitHub 版本不符，请刷新后重试。", "The changed file does not match the inspected GitHub version. Refresh and try again.")
              val format = BinaryInput.detectFormat(input, job)
              val evidence = if (format in listOf("apk", "dex", "jar", "class")) {
                JadxEngine.analyze(context, input, format, directory, job) { done, total, text -> emit(job, "analyzing", done.toLong(), total.toLong(), text) }
              } else {
                NativeEngine.analyze(context, input, directory, job) { done, total, text -> emit(job, "analyzing", done.toLong(), total.toLong(), text) }
              }
              job.check()
              val en = language == "en"
              result = mapOf(
                "id" to job.id, "fileName" to fileName, "size" to size, "sha256" to digest, "format" to format,
                "architecture" to evidence.architecture, "functionCount" to evidence.functionCount,
                "functions" to evidence.functions, "imports" to evidence.imports, "strings" to evidence.strings,
                "summary" to if (en) "Static decompilation of $fileName. Review the extracted code and analysis limits below." else "$fileName 的静态反编译已完成，可查看下方代码与分析范围。",
                "limitations" to evidence.limitations
              )
              emit(job, "complete", 1, 1, if (en) "Analysis complete" else "分析完成")
            } catch (error: Throwable) {
              if (job.timedOut) {
                failureCode = "timeout"
                failureMessage = if (language == "en") "Analysis timed out. Try a smaller file." else "分析超时，请选择较小的文件重试。"
              } else if (job.cancelled.get() || error is CancellationException || error is InterruptedException) {
                failureCode = "cancelled"
                failureMessage = if (language == "en") "Analysis cancelled." else "分析已取消。"
              } else if (error is AnalysisException) {
                failureCode = error.code
                failureMessage = error.message(language)
              } else {
                failureCode = "engine"
                failureMessage = if (language == "en") "The file could not be decompiled. It may be damaged, unsupported or too large for this phone." else "这个文件无法反编译，可能已损坏、格式不受支持，或超过手机可处理的范围。"
              }
            } finally {
              timeout?.cancel(false)
              job.process?.let { job.finishProcess(it) }
              directory.deleteRecursively()
              synchronized(lock) { if (active === job) active = null }
              job.thread = null
              Thread.interrupted()
            }
            if (failureCode != null) promise.reject(failureCode, failureMessage, null) else promise.resolve(result)
          }
        }
      }
    }

    OnCreate {
      appContext.reactContext?.let { context -> executor.execute { runCatching { FrameworkManager.cleanup(context) } } }
    }

    OnDestroy {
      synchronized(lock) { active?.cancel() }
      executor.shutdown()
      timers.shutdown()
    }
  }

  private fun frameworkOperation(request: Map<String, Any?>, promise: Promise, install: Boolean) {
    val context = appContext.reactContext ?: run { promise.reject("unavailable", "App context unavailable", null); return }
    val language = if (request["language"] == "en") "en" else "zh"
    val id = if (install) request["requestId"] as? String else java.util.UUID.randomUUID().toString()
    if (id == null || !UUID_PATTERN.matches(id)) { promise.reject("input", "Invalid request ID", null); return }
    val job = AnalysisJob(id, language, 600)
    val started = synchronized(lock) {
      pruneCancelled()
      if (cancelledBeforeStart.remove(id) != null) { job.cancelled.set(true); false }
      else if (active == null) { active = job; true } else false
    }
    if (!started) {
      promise.reject(if (job.cancelled.get()) "cancelled" else "busy", if (language == "en")
        (if (job.cancelled.get()) "Download cancelled." else "Another operation is still finishing. Try again shortly.")
        else (if (job.cancelled.get()) "下载已取消。" else "另一个操作仍在结束，请稍后重试。"), null)
      return
    }
    executor.execute {
      job.thread = Thread.currentThread()
      var result: Map<String, Any?>? = null
      var code: String? = null
      var message: String? = null
      var timeout: ScheduledFuture<*>? = null
      try {
        timeout = timers.schedule({ job.timeout() }, 600, TimeUnit.SECONDS)
        val component = request["component"] as? String ?: throw AnalysisException("input", "请选择分析组件。", "Choose an analysis component.")
        if (install) FrameworkManager.install(context, component, job) { phase, completed, total, text, unit ->
          if (!job.cancelled.get()) sendEvent("onFrameworkProgress", mapOf("requestId" to id, "component" to component,
            "phase" to phase, "completed" to completed, "total" to total, "message" to text, "unit" to unit))
        } else FrameworkManager.remove(context, component)
        result = FrameworkManager.status(context)
      } catch (error: Throwable) {
        when {
          job.timedOut -> { code = "timeout"; message = if (language == "en") "Component download timed out. Try again." else "组件下载超时，请重试。" }
          job.cancelled.get() || error is CancellationException || error is InterruptedException -> { code = "cancelled"; message = if (language == "en") "Download cancelled." else "下载已取消。" }
          error is AnalysisException -> { code = error.code; message = error.message(language) }
          else -> { code = "framework"; message = if (language == "en") "Could not install or remove the component. Check the network and available storage, then retry." else "无法安装或移除组件，请检查网络和可用空间后重试。" }
        }
      } finally {
        timeout?.cancel(false)
        synchronized(lock) { if (active === job) active = null }
        job.thread = null
        Thread.interrupted()
      }
      if (code != null) promise.reject(code, message, null) else promise.resolve(result)
    }
  }

  private fun emit(job: AnalysisJob, phase: String, completed: Long, total: Long, message: String, unit: String = "steps") {
    if (!job.cancelled.get()) sendEvent("onProgress", mapOf("requestId" to job.id, "phase" to phase, "completed" to completed, "total" to total, "message" to message, "unit" to unit))
  }

  private fun pruneCancelled() {
    val oldest = System.nanoTime() - 300_000_000_000L
    cancelledBeforeStart.entries.removeAll { it.value < oldest }
  }

  private data class FileInfo(val name: String?, val size: Long?)
  private fun cleanName(value: String?): String? = value?.substringAfterLast('/')?.substringAfterLast('\\')
    ?.replace(Regex("[\\x00-\\x1f\\x7f]"), "")?.take(240)?.takeIf { it.isNotBlank() && it != "." && it != ".." }

  private fun fileInfo(value: String, context: Context): FileInfo {
    val uri = Uri.parse(value)
    if (uri.scheme == "content" && !uri.authority.isNullOrBlank()) {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
          val name = if (nameColumn >= 0 && !cursor.isNull(nameColumn)) cleanName(cursor.getString(nameColumn)) else null
          val size = if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) cursor.getLong(sizeColumn).takeIf { it >= 0 } else null
          return FileInfo(name, size)
        }
      }
      return FileInfo(null, null)
    }
    if (uri.scheme == "file") {
      val file = allowedFile(uri, context.cacheDir, context.filesDir)
      return FileInfo(cleanName(file.name), file.length())
    }
    throw AnalysisException("input", "请选择文件，或从项目下载入口开始分析。", "Choose a file, or start analysis from a project download.")
  }

  private fun allowedFile(uri: Uri, cacheDir: File, filesDir: File): File {
    val file = File(uri.path ?: "").canonicalFile
    val allowed = listOf(cacheDir, filesDir).any { file.path.startsWith(it.canonicalPath + File.separator) }
    if (allowed && file.isFile) return file
    throw AnalysisException("input", "无法读取所选文件，请重新选择。", "Cannot read the selected file. Choose it again.")
  }

  private fun openInput(value: String, cacheDir: File, filesDir: File): InputStream {
    val uri = Uri.parse(value)
    if (uri.scheme == "content") return appContext.reactContext!!.contentResolver.openInputStream(uri)
      ?: throw AnalysisException("input", "无法读取所选文件，请重新选择。", "Cannot read the selected file. Choose it again.")
    if (uri.scheme == "file") {
      return FileInputStream(allowedFile(uri, cacheDir, filesDir))
    }
    throw AnalysisException("input", "请选择文件，或从项目下载入口开始分析。", "Choose a file, or start analysis from a project download.")
  }

  private fun gitBlobSha(input: File, size: Long, job: AnalysisJob): String {
    val digest = MessageDigest.getInstance("SHA-1")
    digest.update("blob $size\u0000".toByteArray(Charsets.UTF_8))
    input.inputStream().use { stream ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        job.check()
        val read = stream.read(buffer)
        if (read < 0) break
        if (read > 0) digest.update(buffer, 0, read)
      }
    }
    return digest.digest().hex()
  }

  private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 255) }

  companion object {
    private const val MAX_BYTES = BinaryInput.MAX_BYTES
    private val UUID_PATTERN = Regex("[a-fA-F0-9-]{36}")
  }
}
