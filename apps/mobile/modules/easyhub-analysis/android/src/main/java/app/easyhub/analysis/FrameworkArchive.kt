package app.easyhub.analysis

import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.zip.ZipFile

/** A verified archive may write only the manifest's regular files. */
internal object FrameworkArchive {
  data class Entry(val path: String, val size: Long, val sha256: String)
  private val pathPattern = Regex("[A-Za-z0-9_./+@() -]{1,220}")
  fun safePath(path: String): Boolean = pathPattern.matches(path) && !path.startsWith("/") &&
    path.split('/').all { it.isNotEmpty() && it != "." && it != ".." } && path != "framework.json" && path != ".installed"

  fun extract(archive: File, directory: File, entries: List<Entry>, check: () -> Unit, progress: (Long, Long) -> Unit) {
    require(entries.isNotEmpty() && entries.size <= 2000)
    require(entries.map { it.path }.toSet().size == entries.size)
    require(entries.all { safePath(it.path) && it.size in 0..MAX_EXPANDED && it.sha256.matches(Regex("[a-f0-9]{64}")) })
    val expected = entries.associateBy { it.path }
    val total = entries.sumOf { it.size }
    require(total <= MAX_EXPANDED)
    var completed = 0L
    val seen = mutableSetOf<String>()
    ZipFile(archive).use { zip ->
      val iterator = zip.entries()
      while (iterator.hasMoreElements()) {
        check()
        val item = iterator.nextElement()
        if (item.name == "framework.json") continue
        // Empty directory entries are unnecessary; reject them as unlisted data.
        val spec = expected[item.name] ?: throw IllegalArgumentException("Unlisted archive entry")
        require(!item.isDirectory && seen.add(item.name) && item.size == spec.size)
        val target = File(directory, spec.path)
        require(target.canonicalPath.startsWith(directory.canonicalPath + File.separator))
        require(target.parentFile!!.isDirectory || target.parentFile!!.mkdirs())
        val digest = MessageDigest.getInstance("SHA-256")
        var written = 0L
        // Android 14 requires dynamically loaded code to be read-only BEFORE
        // writing. The already-open descriptor remains writable for this copy.
        FileOutputStream(target).use { output ->
          require(target.setReadOnly())
          zip.getInputStream(item).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              check()
              val size = input.read(buffer)
              if (size < 0) break
              if (size == 0) continue
              written += size
              require(written <= spec.size)
              output.write(buffer, 0, size)
              digest.update(buffer, 0, size)
              completed += size
              progress(completed, total)
            }
          }
          output.fd.sync()
        }
        require(written == spec.size && hex(digest.digest()) == spec.sha256)
        if (spec.path.startsWith("lib/")) require(target.setExecutable(true, false))
      }
    }
    require(seen == expected.keys)
  }

  fun hash(file: File, check: () -> Unit): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { stream ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        check()
        val n = stream.read(buffer)
        if (n < 0) break
        if (n > 0) digest.update(buffer, 0, n)
      }
    }
    return hex(digest.digest())
  }
  fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
  private const val MAX_EXPANDED = 160L * 1024 * 1024
}
