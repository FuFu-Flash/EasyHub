package app.easyhub.analysis

import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import java.io.InputStream

internal class AnalysisJob(val id: String, val language: String, timeoutSeconds: Long = 180) {
  val cancelled = AtomicBoolean(false)
  @Volatile var process: Process? = null
  @Volatile var thread: Thread? = null
  @Volatile var inputStream: InputStream? = null
  @Volatile var connection: java.net.HttpURLConnection? = null
  @Volatile var timedOut = false
  val deadline = System.nanoTime() + timeoutSeconds * 1_000_000_000L

  fun check() {
    if (timedOut || System.nanoTime() > deadline) throw AnalysisException("timeout", "分析超时，请选择较小的文件重试。", "Analysis timed out. Try a smaller file.")
    if (cancelled.get() || Thread.currentThread().isInterrupted) throw CancellationException("Analysis cancelled")
  }

  fun cancel() {
    cancelled.set(true)
    stop()
  }

  fun timeout() {
    timedOut = true
    stop()
  }

  private fun stop() {
    runCatching { inputStream?.close() }
    runCatching { connection?.disconnect() }
    process?.destroy()
    if (android.os.Build.VERSION.SDK_INT >= 26) process?.destroyForcibly()
    thread?.interrupt()
  }

  fun finishProcess(owned: Process) {
    var interrupted = Thread.interrupted()
    try {
      owned.destroy()
      if (android.os.Build.VERSION.SDK_INT >= 26) owned.destroyForcibly()
      while (true) {
        try { owned.waitFor(); break }
        catch (_: InterruptedException) {
          interrupted = true
          owned.destroy()
          if (android.os.Build.VERSION.SDK_INT >= 26) owned.destroyForcibly()
        }
      }
    } finally {
      runCatching { owned.outputStream.close() }
      runCatching { owned.inputStream.close() }
      runCatching { owned.errorStream.close() }
      if (process === owned) process = null
      if (interrupted) Thread.currentThread().interrupt()
    }
  }
}

internal class AnalysisException(val code: String, val zh: String, val en: String) : Exception(zh) {
  fun message(language: String) = if (language == "en") en else zh
}

internal data class EngineEvidence(
  val architecture: String,
  val functionCount: Int,
  val functions: List<Map<String, String>>,
  val imports: List<String>,
  val strings: List<String>,
  val limitations: List<String>
)
