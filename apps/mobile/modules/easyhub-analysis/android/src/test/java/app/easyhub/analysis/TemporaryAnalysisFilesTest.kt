package app.easyhub.analysis

import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test

class TemporaryAnalysisFilesTest {
  private fun fixture(run: (File) -> Unit) {
    val root = Files.createTempDirectory("easyhub-cleanup-test").toFile()
    try { run(root) } finally {
      Files.walk(root.toPath()).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }
  }

  @Test fun cleansCrashedSnapshotsAndDownloadsButKeepsOtherFiles() = fixture { root ->
    val cache = File(root, "cache").apply { mkdirs() }
    val snapshot = File(cache, "easyhub-analysis/${UUID.randomUUID()}").apply { mkdirs() }
    File(snapshot, "input.apk").writeText("temporary")
    val download = File(cache, "easyhub-analysis-downloads/${UUID.randomUUID()}.exe").apply { parentFile!!.mkdirs(); writeText("temporary") }
    val saved = File(cache, "saved-downloads/app.exe").apply { parentFile!!.mkdirs(); writeText("keep") }
    val unrelated = File(cache, "easyhub-analysis-downloads/user-file.apk").apply { writeText("keep") }
    TemporaryAnalysisFiles.cleanup(cache)
    assertFalse(snapshot.exists()); assertFalse(download.exists())
    assertEquals("keep", saved.readText()); assertEquals("keep", unrelated.readText())
  }

  @Test fun neverTraversesLinkedRootsOrLinkedSessions() = fixture { root ->
    val cache = File(root, "cache").apply { mkdirs() }
    val external = File(root, "external").apply { mkdirs() }
    val sentinel = File(external, "original.apk").apply { writeText("keep") }
    val snapshots = File(cache, "easyhub-analysis").apply { mkdirs() }
    Files.createSymbolicLink(File(snapshots, UUID.randomUUID().toString()).toPath(), external.toPath())
    Files.createSymbolicLink(File(cache, "easyhub-analysis-downloads").toPath(), external.toPath())
    TemporaryAnalysisFiles.cleanup(cache)
    assertEquals("keep", sentinel.readText())
  }

  @Test fun removesInternalLinksWithoutRemovingTheirTargets() = fixture { root ->
    val cache = File(root, "cache").apply { mkdirs() }
    val sentinel = File(root, "original.apk").apply { writeText("keep") }
    val snapshot = File(cache, "easyhub-analysis/${UUID.randomUUID()}").apply { mkdirs() }
    Files.createSymbolicLink(File(snapshot, "input.apk").toPath(), sentinel.toPath())
    TemporaryAnalysisFiles.cleanup(cache)
    assertFalse(snapshot.exists()); assertEquals("keep", sentinel.readText())
  }

  @Test fun startupWorkIsBoundedAndMissingFoldersAreHarmless() = fixture { root ->
    val cache = File(root, "cache").apply { mkdirs() }
    TemporaryAnalysisFiles.cleanup(cache)
    val downloads = File(cache, "easyhub-analysis-downloads").apply { mkdirs() }
    repeat(40) { File(downloads, "${UUID.randomUUID()}.apk").writeText("temporary") }
    TemporaryAnalysisFiles.cleanup(cache)
    assertEquals(8, downloads.listFiles()!!.size)
  }
}
