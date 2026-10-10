package app.easyhub.analysis

import android.content.Context
import dalvik.system.DexClassLoader
import java.io.File
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy

/** Only this small adapter ships in the App; JADX lives in the optional DEX package. */
internal object JadxEngine {
  const val VERSION = "1.5.6"
  fun analyze(context: Context, input: File, format: String, directory: File, job: AnalysisJob,
    progress: (Int, Int, String) -> Unit): EngineEvidence {
    BinaryInput.inspectJava(input, format, job)
    val runtime = FrameworkManager.javaRuntime(context, job)
    job.check()
    val optimized = File(context.codeCacheDir, "easyhub-jadx-$VERSION").apply { mkdirs() }
    val loader = DexClassLoader(runtime.absolutePath, optimized.absolutePath, null, JadxEngine::class.java.classLoader)
    val engine = loader.loadClass("app.easyhub.frameworks.jadx.ProgramEngine")
    // Resolve the API-26 platform interface by name: the host desugar build may
    // otherwise rewrite its compile-time Consumer to a different j$ interface.
    val consumerType = Class.forName("java.util.function.Consumer", true, loader)
    val callback = Proxy.newProxyInstance(loader, arrayOf(consumerType)) { proxy, method, args ->
      when (method.name) {
        "accept" -> {
          job.check()
          val value = args?.firstOrNull() as? Map<*, *> ?: invalid()
          progress((value["done"] as? Number)?.toInt() ?: 0, (value["total"] as? Number)?.toInt() ?: 0,
            (value["message"] as? String)?.take(180) ?: "")
          null
        }
        "toString" -> "EasyHubAnalysisProgress"
        "hashCode" -> System.identityHashCode(proxy)
        "equals" -> proxy === args?.firstOrNull()
        else -> null
      }
    }
    val method = engine.getMethod("analyze", File::class.java, String::class.java, String::class.java,
      File::class.java, Runnable::class.java, consumerType)
    val raw = try { method.invoke(null, input, format, job.language, directory, Runnable { job.check() }, callback) } catch (error: InvocationTargetException) {
      job.check()
      throw (error.targetException ?: error)
    }
    job.check()
    val data = raw as? Map<*, *> ?: invalid()
    val architecture = data["architecture"] as? String ?: invalid()
    val count = (data["functionCount"] as? Number)?.toInt() ?: invalid()
    if (architecture !in listOf("Dalvik", "JVM") || count !in 1..BinaryInput.MAX_CLASSES) invalid()
    val functions = (data["functions"] as? List<*>)?.takeIf { it.size in 1..12 }?.map { item ->
      val fn = item as? Map<*, *> ?: invalid()
      val name = (fn["name"] as? String)?.takeIf { it.length in 1..240 } ?: invalid()
      val address = (fn["address"] as? String)?.takeIf { it.length in 1..512 } ?: invalid()
      val code = (fn["code"] as? String)?.takeIf { it.length in 1..4000 } ?: invalid()
      mapOf("name" to name, "address" to address, "code" to code)
    } ?: invalid()
    fun strings(key: String, limit: Int, length: Int): List<String> = (data[key] as? List<*>)?.takeIf { it.size <= limit }
      ?.map { (it as? String)?.takeIf { text -> text.length <= length } ?: invalid() } ?: invalid()
    return EngineEvidence(architecture, count, functions, strings("imports", 100, 240), strings("strings", 80, 200), strings("limitations", 10, 1000))
  }
  private fun invalid(): Nothing = throw AnalysisException("engine", "分析组件返回了无效结果，请重新下载组件。", "The analysis component returned an invalid result. Download it again.")
}
