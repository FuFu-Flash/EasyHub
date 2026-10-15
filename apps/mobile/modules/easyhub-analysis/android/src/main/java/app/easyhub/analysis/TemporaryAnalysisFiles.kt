package app.easyhub.analysis

import java.io.File

/** Only disposable snapshots owned by this module; never downloads saved by the user. */
internal object TemporaryAnalysisFiles {
  private val session = Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")
  private val download = Regex("${session.pattern}\\.[a-z0-9]{1,8}")
  private const val MAX_SESSIONS = 32
  private const val MAX_ENTRIES = 4096

  fun cleanup(cacheDirectory: File) {
    runCatching {
      val cache = cacheDirectory.canonicalFile
      var remaining = MAX_SESSIONS
      for ((name, directories) in listOf("easyhub-analysis" to true, "easyhub-analysis-downloads" to false)) {
        val root = File(cache, name)
        if (!root.isDirectory || root.canonicalFile != root.absoluteFile) continue
        for (entry in root.listFiles().orEmpty().sortedBy { it.name }) {
          if (remaining <= 0) return
          if (!(if (directories) session else download).matches(entry.name)) continue
          // Reject linked roots and top-level entries, including links to another private folder.
          if (entry.canonicalFile != entry.absoluteFile || entry.canonicalFile.parentFile != root) continue
          if (directories != entry.isDirectory || (!directories && !entry.isFile)) continue
          remaining--
          if (directories) removeSnapshot(entry, root, intArrayOf(MAX_ENTRIES)) else entry.delete()
        }
      }
    }
  }

  private fun removeSnapshot(entry: File, root: File, budget: IntArray, depth: Int = 0): Boolean {
    if (budget[0]-- <= 0 || depth > 32) return false
    if (entry.absoluteFile.parentFile != root || root.canonicalFile != root.absoluteFile) return false
    // File.delete unlinks an internal symbolic link without traversing its target.
    if (entry.canonicalFile != entry.absoluteFile) return entry.delete()
    if (entry.isDirectory) {
      for (child in entry.listFiles().orEmpty()) {
        if (!removeSnapshot(child, entry, budget, depth + 1)) return false
      }
    }
    return entry.delete()
  }
}
