package app.easyhub.analysis

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.BufferedInputStream
import java.io.BufferedWriter
import java.io.File
import java.io.OutputStreamWriter
import java.io.IOException

internal object NativeEngine {
  fun analyze(context: Context, input: File, directory: File, job: AnalysisJob, progress: (Int, Int, String) -> Unit): EngineEvidence {
    val en = job.language == "en"
    progress(0, 16, if (en) "Preparing the native engine" else "准备原生分析引擎")
    val runtime = FrameworkManager.nativeDirectory(context, job)
    val libraryDir = File(runtime, "lib").canonicalPath
    val executable = File(libraryDir, "libeasyhub-radare2.so")
    if (!executable.isFile) throw AnalysisException("unavailable", "请先下载并安装原生反编译框架。", "Download and install the native decompilation framework first.")
    job.check()
    // Android 10+ prevents execve of app-private files. The system linker maps
    // the verified, read-only engine while retaining the app's UID and sandbox.
    val command = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= 29) command.add("/system/bin/linker64")
    command.addAll(listOf(executable.absolutePath, "-N", "-q0", "-2", "-e", "scr.color=0", "-e", "scr.interactive=false",
      "-e", "bin.str.maxbuf=1048576", "-e", "dir.plugins=$libraryDir", input.canonicalPath))
    val process = ProcessBuilder(command).apply {
      directory(directory)
      environment().apply {
        // React Native supplies the same pinned NDK libc++_shared.so; do not
        // download or override a second copy of that common runtime.
        put("LD_LIBRARY_PATH", "$libraryDir:${context.applicationInfo.nativeLibraryDir}")
        put("SLEIGHHOME", File(runtime, "sleigh").absolutePath)
        put("R2_PREFIX", File(runtime, "r2").absolutePath)
        put("R2_LIBR_PLUGINS", libraryDir)
        put("R2_USER_PLUGINS", libraryDir)
        put("HOME", directory.absolutePath)
        remove("R2_NOPLUGINS")
      }
    }.start()
    job.process = process
    try {
      job.check()
      Console(process, job).use { console ->
        console.readFrame()
        val metadata = JSONObject(console.command("ij"))
        val bin = metadata.optJSONObject("bin") ?: throw AnalysisException("format", "程序格式或架构不受支持。", "The program format or architecture is not supported.")
        val architecture = "${bin.optString("arch", "unknown")} ${bin.optInt("bits", 0)}-bit"
        // Some PE images have sections but no initial IO maps. Map only numeric, file-backed, read-only ranges.
        if (JSONArray(console.command("omj")).length() == 0) {
          val fd = metadata.optJSONObject("core")?.optInt("fd", -1) ?: -1
          val sections = JSONArray(console.command("iSj"))
          if (fd >= 0) for (index in 0 until minOf(256, sections.length())) {
            job.check()
            val section = sections.optJSONObject(index) ?: continue
            val address = section.optLong("vaddr", -1)
            val offset = section.optLong("paddr", -1)
            val size = minOf(section.optLong("size", 0), input.length() - offset)
            if (address >= 0 && offset >= 0 && size > 0) {
              val permission = if (section.optString("perm").contains('x')) "r-x" else "r--"
              console.command("om $fd 0x${address.toString(16)} 0x${size.toString(16)} 0x${offset.toString(16)} $permission")
            }
          }
        }
        // Keep decompilation in the owned process; the job watchdog can then stop it completely.
        console.command("e r2ghidra.timeout=0")
        progress(0, 16, if (en) "Finding functions" else "查找函数")
        console.command("aaa")
        job.check()
        val allFunctions = JSONArray(console.command("aflj"))
        val candidates = (0 until minOf(allFunctions.length(), 512)).mapNotNull { allFunctions.optJSONObject(it) }
          .filter { it.optLong("addr", it.optLong("offset", -1)) >= 0 && !it.optString("name").startsWith("sym.imp.") }
          .sortedWith(compareBy({ !it.optString("name").contains("main", true) && it.optString("name") != "entry0" }, { it.optLong("addr", it.optLong("offset", -1)) })).take(16)
        val limits = mutableListOf(if (en) "C-like code is reconstructed from machine code, not the original source. The file was not executed." else "类 C 代码由机器码还原，并非原始源码；没有执行这个文件。")
        val imports = optionalArray(console, "iij", limits, en).let { array ->
          (0 until minOf(array.length(), 100)).mapNotNull { array.optJSONObject(it)?.optString("name")?.takeIf(String::isNotBlank)?.take(240) }
        }
        val strings = optionalArray(console, "izj", limits, en).let { array ->
          (0 until minOf(array.length(), 80)).mapNotNull { array.optJSONObject(it)?.optString("string")?.takeIf(String::isNotBlank)?.take(200) }
        }
        val functions = mutableListOf<Map<String, String>>()
        var shortened = false
        var failed = 0
        candidates.forEachIndexed { index, candidate ->
          job.check()
          val address = "0x${candidate.optLong("addr", candidate.optLong("offset", -1)).toString(16)}"
          val name = candidate.optString("name", address).take(240)
          progress(index, candidates.size, name)
          try {
            val response = JSONObject(console.command("pdgj @ $address"))
            val code = (response.opt("code") as? String).orEmpty()
            if (code.isBlank()) { failed++; return@forEachIndexed }
            shortened = shortened || code.length > 4000
            functions.add(mapOf("name" to name, "address" to address, "code" to code.take(4000)))
          } catch (error: Exception) { job.check(); if (error is AnalysisException && error.code == "protocol") throw error; failed++ }
        }
        job.check()
        if (functions.isEmpty()) throw AnalysisException("engine", "这个程序未能生成可用的反编译代码，可能使用了不受支持的架构或保护。", "This program did not produce usable decompiled code. Its architecture or protection may not be supported.")
        if (allFunctions.length() > functions.size) limits.add(if (en) "Sampled ${functions.size} of ${allFunctions.length()} discovered functions; this does not cover the entire program." else "共发现 ${allFunctions.length()} 个函数，本次抽样 ${functions.size} 个，未覆盖整个程序。")
        if (allFunctions.length() > 512) limits.add(if (en) "Candidates were selected from the first 512 discovered functions." else "抽样候选范围为最先发现的 512 个函数。")
        if (shortened) limits.add(if (en) "Long function output was limited to 4000 characters per function." else "较长的函数代码仅显示前 4000 个字符。")
        if (failed > 0) limits.add(if (en) "$failed sampled functions could not be decompiled." else "抽样的 $failed 个函数未能反编译。")
        progress(candidates.size, candidates.size, if (en) "Decompilation complete" else "反编译完成")
        return EngineEvidence(architecture, allFunctions.length(), functions, imports, strings, limits.distinct())
      }
    } finally {
      job.finishProcess(process)
    }
  }

  private fun optionalArray(console: Console, command: String, limits: MutableList<String>, en: Boolean): JSONArray = try {
    JSONArray(console.command(command))
  } catch (error: Exception) {
    console.job.check()
    if (error is AnalysisException && error.code == "protocol") throw error
    limits.add(if (en) "Some imports or strings could not be extracted within the output limit." else "部分导入项或字符串未能在输出上限内提取。")
    JSONArray()
  }

  private class Console(val process: Process, val job: AnalysisJob) : AutoCloseable {
    private val input = BufferedInputStream(process.inputStream)
    private val output = BufferedWriter(OutputStreamWriter(process.outputStream, Charsets.UTF_8))
    fun command(value: String): String {
      job.check()
      try { output.write(value); output.newLine(); output.flush() }
      catch (_: IOException) { throw protocolFailure() }
      return readFrame()
    }
    fun readFrame(): String {
      val bytes = ByteArrayOutputStream()
      var count = 0
      while (true) {
        job.check()
        val value = try { input.read() } catch (_: IOException) { throw protocolFailure() }
        if (value < 0) throw protocolFailure()
        if (value == 0) break
        count++
        if (count <= 1024 * 1024) bytes.write(value)
        if (count > 8 * 1024 * 1024) throw AnalysisException("protocol", "引擎输出超出安全上限，分析已停止，请选择较小的程序。", "The engine output exceeded the safe limit. Analysis stopped; choose a smaller program.")
      }
      if (count > 1024 * 1024) throw AnalysisException("limit", "引擎返回的内容超过上限。", "The engine output exceeded the limit.")
      return bytes.toString(Charsets.UTF_8.name()).trim()
    }
    private fun protocolFailure() = AnalysisException("protocol", "反编译引擎已停止或通信中断，请重试。", "The decompiler stopped or its connection was lost. Please try again.")
    override fun close() { runCatching { output.close() }; runCatching { input.close() } }
  }
}
