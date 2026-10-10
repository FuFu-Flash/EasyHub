package app.easyhub.analysis

import java.io.File
import java.io.InputStream
import java.util.zip.ZipFile

internal object BinaryInput {
  const val MAX_BYTES = 128L * 1024 * 1024
  const val MAX_JAVA_BYTES = 64L * 1024 * 1024
  const val MAX_CLASSES = 20_000
  private val classTags = setOf(1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20)
  private val machMagic = setOf("feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca")

  fun detectFormat(input: File, job: AnalysisJob): String {
    job.check()
    val header = input.inputStream().use { readPrefix(it, 112) }
    val magic = header.take(4).joinToString("") { "%02x".format(it.toInt() and 255) }
    if (magic == "7f454c46") return "elf"
    if (header.size >= 2 && header[0] == 'M'.code.toByte() && header[1] == 'Z'.code.toByte()) return "pe"
    if (magic == "cafebabe" && isClass(header)) return "class"
    if (magic in machMagic) return "mach-o"
    if (isDex(header)) return "dex"
    if (magic == "504b0304" || magic == "504b0506" || magic == "504b0708") {
      val archive = inspectArchive(input, job)
      if (archive.hasDex) return "apk"
      if (archive.hasClass) return "jar"
    }
    throw AnalysisException("format", "请选择 APK、DEX、JAR、CLASS、EXE、DLL、SO 或 Mach-O 程序文件。", "Choose an APK, DEX, JAR, CLASS, EXE, DLL, SO or Mach-O program file.")
  }

  fun inspectJava(input: File, format: String, job: AnalysisJob) {
    job.check()
    if (input.length() > MAX_JAVA_BYTES) javaLimit()
    if (format == "apk" || format == "jar") inspectArchive(input, job)
    if (format == "dex") {
      val header = input.inputStream().use { readPrefix(it, 112) }
      if (!isDex(header) || header.size < 112) throw AnalysisException("format", "DEX 文件头无效。", "The DEX header is invalid.")
      if (dexClasses(header) > MAX_CLASSES) classLimit()
    }
  }

  private data class Archive(val hasDex: Boolean, val hasClass: Boolean)
  private fun inspectArchive(input: File, job: AnalysisJob): Archive {
    if (input.length() > MAX_JAVA_BYTES) javaLimit()
    var count = 0
    var bytecodeSize = 0L
    var totalSize = 0L
    var classes = 0L
    var hasDex = false
    var hasClass = false
    fun inspect(file: File, depth: Int) {
      job.check()
      if (depth > 8) throw AnalysisException("limit", "压缩包嵌套层数过多，请选择较简单的文件。", "The archive is nested too deeply. Choose a simpler file.")
      ZipFile(file).use { zip ->
        val entries = zip.entries()
        while (entries.hasMoreElements()) {
          job.check()
          val entry = entries.nextElement()
          if (++count > MAX_CLASSES) classLimit()
          if (entry.isDirectory) continue
          // ZIP central-directory sizes can be forged. Count the actual decoded
          // stream before JADX is allowed to allocate complete entry buffers.
          var nested: File? = null
          try {
            zip.getInputStream(entry).use { stream ->
              job.inputStream = stream
              try {
                job.check()
                val header = readPrefix(stream, 112)
                val dex = isDex(header)
                val java = isClass(header)
                // Match the input plugins' broad magic checks even if the rest of
                // the header is malformed: they buffer these entries before parsing.
                val magic = header.take(4).joinToString("") { "%02x".format(it.toInt() and 255) }
                val bytecode = magic == "6465780a" || magic == "cafebabe" || entry.name.endsWith(".dex", true) || entry.name.endsWith(".class", true)
                val archive = magic != "cafebabe" && !entry.name.endsWith(".class") &&
                  (magic in setOf("504b0304", "504b0506", "504b0708") || Regex("\\.(zip|jar|apk)$", RegexOption.IGNORE_CASE).containsMatchIn(entry.name))
                if (dex && header.size < 112) throw AnalysisException("format", "DEX 文件头无效。", "The DEX header is invalid.")
                var entrySize = 0L
                fun countBytes(count: Int) {
                  job.check()
                  val bytes = count.toLong()
                  if (bytes > MAX_BYTES - entrySize || bytes > MAX_BYTES - totalSize) {
                    throw AnalysisException("limit", "压缩包内容过大，无法在手机上分析。", "The expanded archive is too large to analyze on this phone.")
                  }
                  if (bytecode && bytes > MAX_JAVA_BYTES - bytecodeSize) javaLimit()
                  entrySize += bytes
                  totalSize += bytes
                  if (bytecode) bytecodeSize += bytes
                }
                countBytes(header.size)
                if (archive) nested = File.createTempFile("nested-", ".zip", input.parentFile)
                nested?.outputStream().use { output ->
                  output?.write(header)
                  val buffer = ByteArray(64 * 1024)
                  while (true) {
                    job.check()
                    val read = stream.read(buffer)
                    if (read < 0) break
                    if (read > 0) { countBytes(read); output?.write(buffer, 0, read) }
                  }
                }
                job.check()
                if (entry.size < 0 || entrySize != entry.size) throw AnalysisException("format", "压缩项的实际大小与声明不符，请选择完整的文件。", "An archive entry differs from its declared size. Choose an intact file.")
                if (bytecode) {
                  classes += if (dex) dexClasses(header) else if (java) 1 else 0
                  if (classes > MAX_CLASSES) classLimit()
                }
                hasDex = hasDex || dex
                hasClass = hasClass || java
              } catch (error: Exception) {
                job.check()
                throw error
              } finally {
                if (job.inputStream === stream) job.inputStream = null
              }
            }
            // JavaInputPlugin recursively opens ZIP/JAR entries, including renamed
            // archives. Keep their entries and bytecode in the same global budgets.
            nested?.let { inspect(it, depth + 1) }
          } finally { nested?.delete() }
        }
      }
    }
    inspect(input, 0)
    return Archive(hasDex, hasClass)
  }

  private fun isClass(header: ByteArray): Boolean {
    if (header.size < 11 || header[0] != 0xca.toByte() || header[1] != 0xfe.toByte() || header[2] != 0xba.toByte() || header[3] != 0xbe.toByte()) return false
    val minor = u16(header, 4)
    val major = u16(header, 6)
    // CAFEBABE also marks a Mach-O fat binary. A JVM version, constant-pool
    // count and valid first tag distinguish real class headers from CPU types.
    return (minor == 0 || minor == 65535) && major in 45..255 && u16(header, 8) >= 2 && (header[10].toInt() and 255) in classTags
  }
  private fun isDex(header: ByteArray) = header.size >= 8 && header[0] == 'd'.code.toByte() && header[1] == 'e'.code.toByte() && header[2] == 'x'.code.toByte() && header[3] == '\n'.code.toByte() && (4..6).all { header[it] in '0'.code.toByte()..'9'.code.toByte() } && header[7] == 0.toByte()
  private fun dexClasses(header: ByteArray): Long {
    if (header.size < 112) return 0
    val reverse = header[40] == 0x12.toByte() && header[41] == 0x34.toByte() && header[42] == 0x56.toByte() && header[43] == 0x78.toByte()
    var result = 0L
    for (index in 0..3) result = result or ((header[96 + index].toLong() and 255) shl (if (reverse) (3 - index) * 8 else index * 8))
    return result
  }
  private fun u16(header: ByteArray, offset: Int) = ((header[offset].toInt() and 255) shl 8) or (header[offset + 1].toInt() and 255)
  private fun readPrefix(stream: InputStream, length: Int): ByteArray {
    val bytes = ByteArray(length)
    var size = 0
    while (size < length) { val read = stream.read(bytes, size, length - size); if (read < 0) break; if (read > 0) size += read }
    return bytes.copyOf(size)
  }
  private fun javaLimit(): Nothing = throw AnalysisException("limit", "Java/DEX 输入或展开字节码超过 64 MB，请选择较小的文件。", "Java/DEX input or expanded bytecode exceeds 64 MB. Choose a smaller file.")
  private fun classLimit(): Nothing = throw AnalysisException("limit", "文件包含过多类或压缩项，请选择较小的文件。", "The file contains too many classes or archive entries. Choose a smaller file.")
}
