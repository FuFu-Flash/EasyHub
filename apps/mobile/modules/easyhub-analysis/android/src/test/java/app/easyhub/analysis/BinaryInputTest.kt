package app.easyhub.analysis

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BinaryInputTest {
  private val megabyte = 1024L * 1024

  @Test fun acceptsActualBytecodeAndCountsRenamedEntriesByMagic() = withDirectory { directory ->
    val zip = archive(directory, listOf(Entry("renamed.bin", 112, dexHeader())))
    assertEquals("apk", BinaryInput.detectFormat(zip, job()))
    BinaryInput.inspectJava(zip, "apk", job())
  }

  @Test fun forgedCentralDirectorySizeCannotBypassBytecodeLimit() = withDirectory { directory ->
    val zip = archive(directory, listOf(Entry("renamed.bin", 65 * megabyte, dexHeader())))
    forgeFirstDeclaredSize(zip, 112)
    assertTrue(zip.length() < 100_000)
    val failure = failure { BinaryInput.inspectJava(zip, "apk", job()) }
    assertEquals("limit", failure.code)
    assertTrue(failure.en.contains("64 MB"))
  }

  @Test fun separateBytecodeEntriesShareTheActualExpansionBudget() = withDirectory { directory ->
    val zip = archive(directory, listOf(Entry("classes.dex", 33 * megabyte, dexHeader()), Entry("second.bin", 33 * megabyte, dexHeader())))
    val failure = failure { BinaryInput.inspectJava(zip, "apk", job()) }
    assertEquals("limit", failure.code)
    assertTrue(failure.en.contains("64 MB"))
  }

  @Test fun malformedBytecodeMagicStillReceivesThePluginsBufferLimit() = withDirectory { directory ->
    for (magic in listOf("dex\nBAD!".toByteArray(), byteArrayOf(0xca.toByte(), 0xfe.toByte(), 0xba.toByte(), 0xbe.toByte()))) {
      val zip = archive(directory, listOf(Entry("renamed.bin", 65 * megabyte, magic)))
      val failure = failure { BinaryInput.inspectJava(zip, "jar", job()) }
      assertEquals("limit", failure.code)
      assertTrue(failure.en.contains("64 MB"))
    }
  }

  @Test fun nestedRenamedArchivesAreInspectedAndTheirTemporaryCopiesAreCleared() = withDirectory { directory ->
    val contents = archive(directory, listOf(Entry("Main.class", 11, classHeader()))).readBytes()
    val zip = archive(directory, listOf(Entry("dependency.data", contents.size.toLong(), contents)))
    assertEquals("jar", BinaryInput.detectFormat(zip, job()))
    assertEquals(listOf("input.zip"), directory.listFiles()!!.map { it.name })
  }

  @Test fun nestedArchivesCannotHideAnOverLimitForgedClassEntry() = withDirectory { directory ->
    val inner = archive(directory, listOf(Entry("Main.class", 65 * megabyte, classHeader())))
    forgeFirstDeclaredSize(inner, 11)
    val contents = inner.readBytes()
    val zip = archive(directory, listOf(Entry("dependency.data", contents.size.toLong(), contents)))
    val failure = failure { BinaryInput.inspectJava(zip, "jar", job()) }
    assertEquals("limit", failure.code)
    assertTrue(failure.en.contains("64 MB"))
    assertEquals(listOf("input.zip"), directory.listFiles()!!.map { it.name })
  }

  @Test fun excessiveNestingIsBoundedAndItsTemporaryCopiesAreCleared() = withDirectory { directory ->
    var zip = archive(directory, listOf(Entry("Main.class", 11, classHeader())))
    repeat(9) {
      val contents = zip.readBytes()
      zip = archive(directory, listOf(Entry("dependency.jar", contents.size.toLong(), contents)))
    }
    val failure = failure { BinaryInput.inspectJava(zip, "jar", job()) }
    assertEquals("limit", failure.code)
    assertTrue(failure.en.contains("nested too deeply"))
    assertEquals(listOf("input.zip"), directory.listFiles()!!.map { it.name })
  }

  @Test fun forgedResourceEntryCannotBypassItsActualExpansionLimit() = withDirectory { directory ->
    val zip = archive(directory, listOf(Entry("resource.txt", 129 * megabyte)))
    forgeFirstDeclaredSize(zip, 1)
    val failure = failure { BinaryInput.inspectJava(zip, "jar", job()) }
    assertEquals("limit", failure.code)
    assertTrue(failure.en.contains("expanded archive"))
  }

  @Test fun separateResourcesShareTheActualArchiveBudget() = withDirectory { directory ->
    val zip = archive(directory, listOf(Entry("resource-one.txt", 65 * megabyte), Entry("resource-two.txt", 65 * megabyte)))
    val failure = failure { BinaryInput.inspectJava(zip, "jar", job()) }
    assertEquals("limit", failure.code)
    assertTrue(failure.en.contains("expanded archive"))
  }

  @Test fun aFalseSizeWithinAllLimitsIsRejectedAsAnIncompleteArchive() = withDirectory { directory ->
    val zip = archive(directory, listOf(Entry("classes.dex", 1024, dexHeader())))
    forgeFirstDeclaredSize(zip, 112)
    val failure = failure { BinaryInput.inspectJava(zip, "apk", job()) }
    assertEquals("format", failure.code)
    assertTrue(failure.en.contains("declared size"))
  }

  @Test fun cancellationStopsAnArchiveReadAndReleasesItsOwnedStream() = withDirectory { directory ->
    val contents = archive(directory, listOf(Entry("resource.txt", 128 * megabyte))).readBytes()
    val zip = archive(directory, listOf(Entry("dependency.jar", contents.size.toLong(), contents)))
    val analysis = job()
    val worker = AtomicReference<Thread>()
    val executor = Executors.newSingleThreadExecutor()
    val future = CompletableFuture.supplyAsync({
      worker.set(Thread.currentThread())
      analysis.thread = Thread.currentThread()
      try { BinaryInput.inspectJava(zip, "jar", analysis) }
      finally { analysis.thread = null; Thread.interrupted() }
    }, executor)
    try {
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      var reading = false
      while (!future.isDone && System.nanoTime() < deadline) {
        reading = worker.get()?.stackTrace?.any { it.className.contains("java.util.zip") && it.methodName == "read" } == true
        if (reading) break
        Thread.yield()
      }
      assertTrue("Cancellation must occur during decompression, rather than before the read starts", reading)
      analysis.cancel()
      try {
        future.get(5, TimeUnit.SECONDS)
        throw AssertionError("The cancelled archive must not finish successfully")
      } catch (error: ExecutionException) {
        assertTrue(error.cause is CancellationException)
      }
      assertNull(analysis.inputStream)
      assertEquals(listOf("input.zip"), directory.listFiles()!!.map { it.name })
      assertTrue("ZipFile and entry stream must be released", zip.delete())
    } finally {
      analysis.cancel()
      executor.shutdownNow()
      assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
    }
  }

  private data class Entry(val name: String, val bytes: Long, val header: ByteArray = byteArrayOf())

  private fun archive(directory: File, entries: List<Entry>): File {
    val file = File(directory, "input.zip")
    ZipOutputStream(file.outputStream()).use { zip ->
      val buffer = ByteArray(64 * 1024)
      for (entry in entries) {
        zip.putNextEntry(ZipEntry(entry.name))
        zip.write(entry.header)
        var remaining = entry.bytes - entry.header.size
        while (remaining > 0) {
          val count = minOf(remaining, buffer.size.toLong()).toInt()
          zip.write(buffer, 0, count)
          remaining -= count
        }
        zip.closeEntry()
      }
    }
    return file
  }

  private fun dexHeader() = ByteArray(112).apply {
    "dex\n035\u0000".toByteArray().copyInto(this)
    this[96] = 1
  }

  private fun classHeader() = byteArrayOf(0xca.toByte(), 0xfe.toByte(), 0xba.toByte(), 0xbe.toByte(), 0, 0, 0, 55, 0, 2, 1)

  private fun forgeFirstDeclaredSize(zip: File, size: Int) {
    val bytes = zip.readBytes()
    val offset = (0..bytes.size - 28).first { bytes[it] == 0x50.toByte() && bytes[it + 1] == 0x4b.toByte() && bytes[it + 2] == 1.toByte() && bytes[it + 3] == 2.toByte() }
    for (index in 0..3) bytes[offset + 24 + index] = (size ushr (index * 8)).toByte()
    zip.writeBytes(bytes)
  }

  private fun failure(action: () -> Unit): AnalysisException {
    try { action() } catch (error: AnalysisException) { return error }
    throw AssertionError("Expected the unsafe archive to be rejected")
  }

  private fun job() = AnalysisJob("00000000-0000-4000-8000-000000000001", "en")

  private fun withDirectory(action: (File) -> Unit) {
    val directory = Files.createTempDirectory("easyhub-archive-test").toFile()
    try { action(directory) } finally { directory.deleteRecursively() }
  }
}
