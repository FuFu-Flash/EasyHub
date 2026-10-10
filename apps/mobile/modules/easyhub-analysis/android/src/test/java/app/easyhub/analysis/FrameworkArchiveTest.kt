package app.easyhub.analysis

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CancellationException
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class FrameworkArchiveTest {
  private fun archive(root: File, entries: List<Pair<String, ByteArray>>): File = File(root, "runtime.zip").apply {
    ZipOutputStream(outputStream()).use { zip -> entries.forEach { (path, content) ->
      zip.putNextEntry(ZipEntry(path)); zip.write(content); zip.closeEntry()
    } }
  }
  private fun spec(path: String, content: ByteArray) = FrameworkArchive.Entry(path, content.size.toLong(),
    FrameworkArchive.hex(java.security.MessageDigest.getInstance("SHA-256").digest(content)))
  private fun temp(block: (File) -> Unit) {
    val root = Files.createTempDirectory("framework-test").toFile()
    try { block(root) } finally { root.deleteRecursively() }
  }
  @Test fun onlyManifestListedFilesAreExtractedAndHashVerified() = temp { root ->
    val content = "verified engine".toByteArray()
    val zip = archive(root, listOf("runtime/engine.apk" to content, "framework.json" to "{}".toByteArray()))
    val output = File(root, "installed").apply { mkdir() }
    FrameworkArchive.extract(zip, output, listOf(spec("runtime/engine.apk", content)), {}, { _, _ -> })
    assertArrayEquals(content, File(output, "runtime/engine.apk").readBytes())
  }
  @Test fun unsafePathsAreRejected() {
    listOf("../escape", "/absolute", "lib/../../escape", "lib//a", "lib/./a", "lib\\a", ".installed", "framework.json").forEach {
      assertFalse(it, FrameworkArchive.safePath(it))
    }
    assertTrue(FrameworkArchive.safePath("sleigh/x86-64.sla"))
  }
  @Test fun unlistedArchiveEntriesAreRejected() = temp { root ->
    val content = byteArrayOf(1, 2, 3)
    val zip = archive(root, listOf("runtime/engine.apk" to content, "../escape" to content))
    val output = File(root, "installed").apply { mkdir() }
    assertThrows(IllegalArgumentException::class.java) {
      FrameworkArchive.extract(zip, output, listOf(spec("runtime/engine.apk", content)), {}, { _, _ -> })
    }
    assertFalse(File(root, "escape").exists())
  }
  @Test fun incorrectDigestIsRejected() = temp { root ->
    val zip = archive(root, listOf("runtime/engine.apk" to byteArrayOf(1, 2, 3)))
    val output = File(root, "installed").apply { mkdir() }
    assertThrows(IllegalArgumentException::class.java) {
      FrameworkArchive.extract(zip, output, listOf(spec("runtime/engine.apk", byteArrayOf(3, 2, 1))), {}, { _, _ -> })
    }
  }
  @Test fun missingAndDuplicateManifestEntriesAreRejected() = temp { root ->
    val entry = spec("runtime/engine.apk", byteArrayOf(1))
    val zip = archive(root, listOf("runtime/engine.apk" to byteArrayOf(1)))
    assertThrows(IllegalArgumentException::class.java) {
      FrameworkArchive.extract(zip, File(root, "out"), listOf(entry, entry), {}, { _, _ -> })
    }
    assertThrows(IllegalArgumentException::class.java) {
      FrameworkArchive.extract(zip, File(root, "out"), listOf(entry, spec("runtime/missing.apk", byteArrayOf(2))), {}, { _, _ -> })
    }
  }
  @Test fun expansionBudgetIsCheckedBeforeWrites() = temp { root ->
    val zip = archive(root, emptyList())
    assertThrows(IllegalArgumentException::class.java) {
      FrameworkArchive.extract(zip, File(root, "out"), listOf(FrameworkArchive.Entry("runtime/huge.apk", 161L*1024*1024, "0".repeat(64))), {}, { _, _ -> })
    }
    assertFalse(File(root, "out").exists())
  }
  @Test fun cancellationStopsExtraction() = temp { root ->
    val zip = archive(root, listOf("runtime/engine.apk" to byteArrayOf(1)))
    assertThrows(CancellationException::class.java) {
      FrameworkArchive.extract(zip, File(root, "out"), listOf(spec("runtime/engine.apk", byteArrayOf(1))), { throw CancellationException() }, { _, _ -> })
    }
    assertFalse(File(root, "out").exists())
  }
}
